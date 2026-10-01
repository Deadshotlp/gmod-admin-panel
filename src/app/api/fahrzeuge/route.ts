import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { createBackup } from "@/lib/backups";
import { query, transaction } from "@/lib/db";
import { reloadServer } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Fahrzeuginventar: welche Fahrzeuge ein Inventar haben (Name, Slots,
 * Interaktions-Bones) und welche Entity-Klassen eingeladen werden dürfen.
 *
 * Die Tabellen pd_vehinv_* legt das Gamemode-Modul modules/vehical_inventory
 * an und befüllt sie beim ersten Start mit den bisherigen festen Werten.
 */

interface Vehicle {
  class: string;
  name: string;
  cargoSlots: number;
  bones: string;
}

interface Config {
  vehicles: Vehicle[];
  cargo: string[];
}

async function tablesExist(): Promise<boolean> {
  const rows = await query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM information_schema.tables " +
      "WHERE table_schema = DATABASE() AND table_name IN ('pd_vehinv_vehicles', 'pd_vehinv_cargo')",
  );

  return Number(rows[0]?.c ?? 0) >= 2;
}

async function loadConfig(): Promise<Config> {
  const [vehicles, cargo] = await Promise.all([
    query<{ class: string; name: string; cargo_slots: number; bones: string }>(
      "SELECT * FROM `pd_vehinv_vehicles` ORDER BY `position`, `class`",
    ),
    query<{ class: string }>("SELECT * FROM `pd_vehinv_cargo` ORDER BY `class`"),
  ]);

  return {
    vehicles: vehicles.map((row) => ({
      class: row.class,
      name: row.name,
      cargoSlots: Number(row.cargo_slots),
      bones: row.bones,
    })),
    cargo: cargo.map((row) => row.class),
  };
}

// Klassen- und Bone-Namen: nur Zeichen, die in GMod-Klassen/Bones vorkommen.
const className = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_\-.]+$/, "Klassenname enthält ungültige Zeichen");

const schema = z.object({
  vehicles: z
    .array(
      z.object({
        class: className,
        name: z.string().trim().max(64),
        cargoSlots: z.number().int().min(1).max(32),
        bones: z
          .string()
          .trim()
          .max(255)
          .regex(/^[A-Za-z0-9_\-., ]*$/, "Bones enthalten ungültige Zeichen"),
      }),
    )
    .max(200),
  cargo: z.array(className).max(100),
});

function fail(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[fahrzeuge] Fehler:", error);
  return NextResponse.json(
    { error: "Datenbank nicht erreichbar", detail: (error as Error).message },
    { status: 503 },
  );
}

export async function GET() {
  try {
    await requireUser("viewer");

    if (!(await tablesExist())) {
      return NextResponse.json({
        configured: false,
        hint:
          "Die Tabellen pd_vehinv_* fehlen. Sie entstehen beim ersten Start des Gamemodes " +
          "mit dem aktualisierten Fahrzeuginventar.",
      });
    }

    return NextResponse.json({ configured: true, config: await loadConfig() });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  let user;

  try {
    user = await requireUser("editor");
  } catch (error) {
    return fail(error);
  }

  if (!checkRateLimit(rateLimitKey(request, "vehicles-write"), 30, 60_000)) {
    return NextResponse.json({ error: "Zu viele Änderungen" }, { status: 429 });
  }

  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe",
        detail: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const input = parsed.data;

  const seen = new Set<string>();
  for (const vehicle of input.vehicles) {
    if (seen.has(vehicle.class)) {
      return NextResponse.json(
        { error: `Fahrzeugklasse doppelt eingetragen: ${vehicle.class}` },
        { status: 400 },
      );
    }
    seen.add(vehicle.class);
  }

  const cargo = [...new Set(input.cargo)];

  try {
    const before = await loadConfig();

    await createBackup("fahrzeuge", `Automatisch vor dem Speichern durch ${user.displayName}`);

    await transaction(async (conn) => {
      await conn.execute("DELETE FROM `pd_vehinv_vehicles`");
      await conn.execute("DELETE FROM `pd_vehinv_cargo`");

      for (const [index, vehicle] of input.vehicles.entries()) {
        // Bones normalisieren: "a, b ,c" -> "a,b,c"
        const bones = vehicle.bones
          .split(",")
          .map((bone) => bone.trim())
          .filter((bone) => bone !== "")
          .join(",");

        await conn.execute(
          "INSERT INTO `pd_vehinv_vehicles` (`class`, `name`, `cargo_slots`, `bones`, `position`) VALUES (?, ?, ?, ?, ?)",
          [vehicle.class, vehicle.name, vehicle.cargoSlots, bones, index + 1],
        );
      }

      for (const entry of cargo) {
        await conn.execute("INSERT INTO `pd_vehinv_cargo` (`class`) VALUES (?)", [entry]);
      }
    });

    const after = await loadConfig();

    await writeAudit({
      user,
      action: "vehicles.save",
      targetType: "fahrzeuginventar",
      targetKey: "config",
      before,
      after,
    });

    const reload = await reloadServer("fahrzeuge");

    return NextResponse.json({
      ok: true,
      config: after,
      reload: { ok: reload.ok, message: reload.message },
    });
  } catch (error) {
    console.error("[fahrzeuge] Schreiben fehlgeschlagen:", error);

    return NextResponse.json(
      { error: "Änderung fehlgeschlagen", detail: (error as Error).message },
      { status: 500 },
    );
  }
}
