import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { query, transaction } from "@/lib/db";
import { reloadServer } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Waffenkategorien, Gewichte und Tragelast.
 *
 * Die Tabellen pd_wb_* legt das Gamemode-Modul modules/waffenkiste an und
 * befüllt sie beim ersten Start aus den bisherigen Lua-Startwerten.
 */

interface Config {
  maxWeight: number;
  defaultWeight: number;
  defaultCategory: string;
  categories: Array<{ name: string; position: number; maxItems: number }>;
  weapons: Array<{ class: string; category: string; weight: number }>;
  always: string[];
}

async function tablesExist(): Promise<boolean> {
  const rows = await query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM information_schema.tables " +
      "WHERE table_schema = DATABASE() AND table_name IN " +
      "('pd_wb_config', 'pd_wb_categories', 'pd_wb_weapons', 'pd_wb_always')",
  );

  return Number(rows[0]?.c ?? 0) >= 4;
}

async function loadConfig(): Promise<Config> {
  const [config, categories, weapons, always] = await Promise.all([
    query<{ config_key: string; config_value: string }>("SELECT * FROM `pd_wb_config`"),
    query<{ name: string; position: number; max_items: number }>(
      "SELECT * FROM `pd_wb_categories` ORDER BY `position`",
    ),
    query<{ class: string; category: string; weight: number }>(
      "SELECT * FROM `pd_wb_weapons` ORDER BY `category`, `class`",
    ),
    query<{ class: string }>("SELECT * FROM `pd_wb_always` ORDER BY `class`"),
  ]);

  const byKey = new Map(config.map((row) => [row.config_key, row.config_value]));

  return {
    maxWeight: Number(byKey.get("max_weight") ?? 20),
    defaultWeight: Number(byKey.get("default_weight") ?? 2),
    defaultCategory: String(byKey.get("default_category") ?? "Sonstiges"),
    categories: categories.map((row) => ({
      name: row.name,
      position: Number(row.position),
      maxItems: Number(row.max_items),
    })),
    weapons: weapons.map((row) => ({
      class: row.class,
      category: row.category,
      weight: Number(row.weight),
    })),
    always: always.map((row) => row.class),
  };
}

const schema = z.object({
  maxWeight: z.number().min(1).max(1000),
  defaultWeight: z.number().min(0).max(1000),
  defaultCategory: z.string().min(1).max(64),
  categories: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        position: z.number().int().min(0).max(999),
        maxItems: z.number().int().min(0).max(99),
      }),
    )
    .min(1)
    .max(32),
  weapons: z
    .array(
      z.object({
        class: z.string().min(1).max(128),
        category: z.string().max(64),
        weight: z.number().min(0).max(1000),
      }),
    )
    .max(2000),
  always: z.array(z.string().min(1).max(128)).max(64),
});

function fail(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[waffen] Fehler:", error);
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
          "Die Tabellen pd_wb_* fehlen. Sie entstehen beim ersten Start des Gamemodes " +
          "mit der aktualisierten Waffenkiste und werden dabei aus den bisherigen " +
          "Werten aus sh_waffenkiste.lua befüllt.",
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

  if (!checkRateLimit(rateLimitKey(request, "weapons-write"), 30, 60_000)) {
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
      { error: "Ungültige Eingabe", detail: parsed.error.issues },
      { status: 400 },
    );
  }

  const input = parsed.data;

  // Eine Waffe darf nicht in einer Kategorie stehen, die es nicht gibt - sonst
  // taucht sie im Spiel nirgends auf.
  const known = new Set(input.categories.map((entry) => entry.name));
  const orphans = input.weapons.filter(
    (weapon) => weapon.category !== "" && !known.has(weapon.category),
  );

  if (orphans.length > 0) {
    return NextResponse.json(
      {
        error: `${orphans.length} Waffe(n) verweisen auf eine Kategorie, die es nicht gibt: ${orphans
          .slice(0, 5)
          .map((weapon) => `${weapon.class} → ${weapon.category}`)
          .join(", ")}`,
      },
      { status: 400 },
    );
  }

  if (!known.has(input.defaultCategory)) {
    return NextResponse.json(
      { error: "Die Auffangkategorie muss eine der angelegten Kategorien sein" },
      { status: 400 },
    );
  }

  try {
    const before = await loadConfig();

    await transaction(async (conn) => {
      await conn.execute("DELETE FROM `pd_wb_categories`");
      await conn.execute("DELETE FROM `pd_wb_weapons`");
      await conn.execute("DELETE FROM `pd_wb_always`");

      for (const [index, category] of input.categories.entries()) {
        await conn.execute(
          "INSERT INTO `pd_wb_categories` (`name`, `position`, `max_items`) VALUES (?, ?, ?)",
          [category.name, index + 1, category.maxItems],
        );
      }

      for (const weapon of input.weapons) {
        await conn.execute(
          "INSERT INTO `pd_wb_weapons` (`class`, `category`, `weight`) VALUES (?, ?, ?)",
          [weapon.class, weapon.category, weapon.weight],
        );
      }

      for (const entry of input.always) {
        await conn.execute("INSERT INTO `pd_wb_always` (`class`) VALUES (?)", [entry]);
      }

      for (const [key, value] of [
        ["max_weight", String(input.maxWeight)],
        ["default_weight", String(input.defaultWeight)],
        ["default_category", input.defaultCategory],
      ] as const) {
        await conn.execute(
          "REPLACE INTO `pd_wb_config` (`config_key`, `config_value`) VALUES (?, ?)",
          [key, value],
        );
      }
    });

    const after = await loadConfig();

    await writeAudit({
      user,
      action: "weapons.save",
      targetType: "waffenkiste",
      targetKey: "config",
      before,
      after,
    });

    const reload = await reloadServer("waffen");

    return NextResponse.json({
      ok: true,
      config: after,
      reload: { ok: reload.ok, message: reload.message },
    });
  } catch (error) {
    console.error("[waffen] Schreiben fehlgeschlagen:", error);

    return NextResponse.json(
      { error: "Änderung fehlgeschlagen", detail: (error as Error).message },
      { status: 500 },
    );
  }
}
