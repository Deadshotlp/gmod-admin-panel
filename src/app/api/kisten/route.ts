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
 * Transportkisten: welche Modelle sich zusammenpacken lassen.
 *
 * Die Tabelle pd_kiste_packables legt das Gamemode-Modul
 * modules/transportkiste beim Start an.
 */

interface Packable {
  model: string;
  name: string;
  packTime: number;
  crateModel: string;
}

async function tableExists(): Promise<boolean> {
  const rows = await query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM information_schema.tables " +
      "WHERE table_schema = DATABASE() AND table_name = 'pd_kiste_packables'",
  );

  return Number(rows[0]?.c ?? 0) >= 1;
}

async function loadPackables(): Promise<Packable[]> {
  const rows = await query<{
    model: string;
    name: string;
    pack_time: number;
    crate_model: string;
  }>("SELECT * FROM `pd_kiste_packables` ORDER BY `position`, `model`");

  return rows.map((row) => ({
    model: row.model,
    name: row.name,
    packTime: Number(row.pack_time),
    crateModel: row.crate_model,
  }));
}

interface Spawnable {
  model: string;
  name: string;
  limit: number;
}

/** Sortiment des Kistenlagers. Fehlt die Tabelle (älterer Gamemode), leer. */
async function loadSpawnables(): Promise<Spawnable[]> {
  try {
    const rows = await query<{ model: string; name: string; max_per_player: number }>(
      "SELECT * FROM `pd_kiste_spawnables` ORDER BY `position`, `model`",
    );

    return rows.map((row) => ({
      model: row.model,
      name: row.name,
      limit: Number(row.max_per_player),
    }));
  } catch {
    return [];
  }
}

// Modellpfade wie im Spiel: models/....mdl, nur unbedenkliche Zeichen.
const modelPath = z
  .string()
  .trim()
  .max(255)
  .transform((value) => value.replace(/\\/g, "/").toLowerCase())
  .refine((value) => /^models\/[a-z0-9_\-./ ]+\.mdl$/.test(value), {
    message: "Modellpfad muss mit models/ beginnen und auf .mdl enden",
  });

const schema = z.object({
  packables: z
    .array(
      z.object({
        model: modelPath,
        name: z.string().trim().max(64),
        packTime: z.number().min(0).max(120),
        crateModel: z.union([z.literal(""), modelPath]),
      }),
    )
    .max(300),
  spawnables: z
    .array(
      z.object({
        model: modelPath,
        name: z.string().trim().max(64),
        limit: z.number().int().min(0).max(50),
      }),
    )
    .max(100)
    .default([]),
});

function fail(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[kisten] Fehler:", error);
  return NextResponse.json(
    { error: "Datenbank nicht erreichbar", detail: (error as Error).message },
    { status: 503 },
  );
}

export async function GET() {
  try {
    await requireUser("viewer");

    if (!(await tableExists())) {
      return NextResponse.json({
        configured: false,
        hint:
          "Die Tabelle pd_kiste_packables fehlt. Sie entsteht beim ersten Start des " +
          "Gamemodes mit dem Transportkisten-Modul.",
      });
    }

    return NextResponse.json({
      configured: true,
      packables: await loadPackables(),
      spawnables: await loadSpawnables(),
    });
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

  if (!checkRateLimit(rateLimitKey(request, "crates-write"), 30, 60_000)) {
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
  for (const entry of input.packables) {
    if (seen.has(entry.model)) {
      return NextResponse.json(
        { error: `Modell doppelt eingetragen: ${entry.model}` },
        { status: 400 },
      );
    }
    seen.add(entry.model);
  }

  const seenSpawn = new Set<string>();
  for (const entry of input.spawnables) {
    if (seenSpawn.has(entry.model)) {
      return NextResponse.json(
        { error: `Lager: Modell doppelt eingetragen: ${entry.model}` },
        { status: 400 },
      );
    }
    seenSpawn.add(entry.model);
  }

  try {
    const before = { packables: await loadPackables(), spawnables: await loadSpawnables() };

    await createBackup("kisten", `Automatisch vor dem Speichern durch ${user.displayName}`);

    await transaction(async (conn) => {
      await conn.execute("DELETE FROM `pd_kiste_packables`");

      for (const [index, entry] of input.packables.entries()) {
        await conn.execute(
          "INSERT INTO `pd_kiste_packables` (`model`, `name`, `pack_time`, `crate_model`, `position`) VALUES (?, ?, ?, ?, ?)",
          [entry.model, entry.name, entry.packTime, entry.crateModel, index + 1],
        );
      }

      // Lager-Sortiment. Die Tabelle legt der Gamemode an; fehlt sie noch,
      // bricht das Speichern hier mit einer klaren Meldung ab.
      await conn.execute("DELETE FROM `pd_kiste_spawnables`");

      for (const [index, entry] of input.spawnables.entries()) {
        await conn.execute(
          "INSERT INTO `pd_kiste_spawnables` (`model`, `name`, `max_per_player`, `position`) VALUES (?, ?, ?, ?)",
          [entry.model, entry.name, entry.limit, index + 1],
        );
      }
    });

    const after = { packables: await loadPackables(), spawnables: await loadSpawnables() };

    await writeAudit({
      user,
      action: "crates.save",
      targetType: "transportkisten",
      targetKey: "config",
      before,
      after,
    });

    const reload = await reloadServer("kisten");

    return NextResponse.json({
      ok: true,
      packables: after.packables,
      spawnables: after.spawnables,
      reload: { ok: reload.ok, message: reload.message },
    });
  } catch (error) {
    console.error("[kisten] Schreiben fehlgeschlagen:", error);

    return NextResponse.json(
      { error: "Änderung fehlgeschlagen", detail: (error as Error).message },
      { status: 500 },
    );
  }
}
