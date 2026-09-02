import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { query, transaction } from "@/lib/db";
import { reloadServer } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";
import { getActiveServer } from "@/lib/servers";

export const dynamic = "force-dynamic";

/**
 * Schadenswerte der ArcCW-Waffen.
 *
 * Zwei Tabellen, beide vom Gamemode-Modul modules/arccw angelegt:
 *
 *   pd_arccw_stats      die Ausgangswerte aus dem Addon, nur zur Anzeige
 *   pd_arccw_overrides  die Abweichungen; NULL heißt "Ausgangswert behalten"
 *
 * Das Addon selbst wird nie angefasst. Ein Update der ArcCW-Pakete überschreibt
 * deshalb keine Anpassung.
 */

const FIELDS = [
  "damage",
  "damage_min",
  "range_min",
  "range",
  "penetration",
  "num",
] as const;

type FieldKey = (typeof FIELDS)[number];

export interface WeaponRow {
  class: string;
  name: string;
  category: string;
  defaults: Record<FieldKey, number>;
  override: Partial<Record<FieldKey, number>>;
  note: string;
  updatedAt: number;
}

async function tablesExist(): Promise<boolean> {
  const rows = await query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM information_schema.tables " +
      "WHERE table_schema = DATABASE() AND table_name IN " +
      "('pd_arccw_stats', 'pd_arccw_overrides')",
  );

  return Number(rows[0]?.c ?? 0) >= 2;
}

async function loadWeapons(): Promise<WeaponRow[]> {
  const server = await getActiveServer();

  const [stats, overrides] = await Promise.all([
    query<Record<string, unknown>>(
      "SELECT * FROM `pd_arccw_stats` WHERE `server_key` = ? ORDER BY `category`, `name`",
      [server.serverKey],
    ),
    query<Record<string, unknown>>(
      "SELECT * FROM `pd_arccw_overrides` WHERE `server_key` = ?",
      [server.serverKey],
    ),
  ]);

  const byClass = new Map(overrides.map((row) => [String(row.class), row]));

  return stats.map((row) => {
    const override = byClass.get(String(row.class));
    const changed: Partial<Record<FieldKey, number>> = {};

    for (const field of FIELDS) {
      const value = override?.[field];

      // NULL bleibt NULL: nicht gesetzt ist etwas anderes als auf 0 gesetzt.
      if (value !== null && value !== undefined) {
        changed[field] = Number(value);
      }
    }

    const defaults = {} as Record<FieldKey, number>;
    for (const field of FIELDS) defaults[field] = Number(row[field] ?? 0);

    return {
      class: String(row.class),
      name: String(row.name ?? row.class),
      category: String(row.category ?? ""),
      defaults,
      override: changed,
      note: String(override?.note ?? ""),
      updatedAt: Number(override?.updated_at ?? 0),
    };
  });
}

// Ein Feld ist entweder eine Zahl oder ausdrücklich nicht gesetzt.
const value = z.number().min(0).max(100_000).nullable();

const schema = z.object({
  changes: z
    .array(
      z.object({
        class: z.string().min(1).max(128),
        damage: value,
        damage_min: value,
        range_min: value,
        range: value,
        penetration: value,
        num: z.number().int().min(1).max(64).nullable(),
        note: z.string().max(255).default(""),
      }),
    )
    .max(2000),
});

function fail(error: unknown, where: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error(`[arccw] ${where}:`, error);

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
          "Die Tabellen pd_arccw_* fehlen. Sie entstehen etwa 15 Sekunden nach dem " +
          "Start des Gamemodes mit dem Modul modules/arccw. Mit pd_arccw_write in " +
          "der Serverkonsole lässt sich der Bestand sofort erfassen.",
      });
    }

    const weapons = await loadWeapons();

    if (weapons.length === 0) {
      return NextResponse.json({
        configured: true,
        weapons: [],
        hint:
          "Der Server hat noch keine ArcCW-Waffen gemeldet. pd_arccw_status in der " +
          "Serverkonsole zeigt, ob das Modul welche gefunden hat.",
      });
    }

    return NextResponse.json({ configured: true, weapons });
  } catch (error) {
    return fail(error, "Laden fehlgeschlagen");
  }
}

export async function POST(request: Request) {
  let user;

  try {
    user = await requireUser("editor");
  } catch (error) {
    return fail(error, "Anmeldung");
  }

  if (!checkRateLimit(rateLimitKey(request, "arccw-write"), 30, 60_000)) {
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

  try {
    const server = await getActiveServer();
    const before = await loadWeapons();

    // Nur Klassen zulassen, die der Server auch gemeldet hat. Ein Tippfehler
    // würde sonst als Karteileiche in der Tabelle liegen bleiben.
    const known = new Set(before.map((weapon) => weapon.class));
    const unknown = parsed.data.changes.filter((entry) => !known.has(entry.class));

    if (unknown.length > 0) {
      return NextResponse.json(
        {
          error:
            `${unknown.length} Waffenklasse(n) hat der Server nicht gemeldet: ` +
            unknown
              .slice(0, 5)
              .map((entry) => entry.class)
              .join(", "),
        },
        { status: 400 },
      );
    }

    const now = Math.floor(Date.now() / 1000);

    await transaction(async (conn) => {
      await conn.execute("DELETE FROM `pd_arccw_overrides` WHERE `server_key` = ?", [
        server.serverKey,
      ]);

      for (const entry of parsed.data.changes) {
        const numbers = FIELDS.map((field) => entry[field]);

        // Eine Zeile ohne einen einzigen gesetzten Wert ist keine Anpassung.
        if (numbers.every((number) => number === null)) continue;

        await conn.execute(
          "INSERT INTO `pd_arccw_overrides` " +
            "(`server_key`, `class`, `damage`, `damage_min`, `range_min`, `range`," +
            " `penetration`, `num`, `note`, `updated_at`) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [server.serverKey, entry.class, ...numbers, entry.note, now],
        );
      }
    });

    const after = await loadWeapons();

    await writeAudit({
      user,
      action: "arccw.save",
      targetType: "arccw",
      targetKey: "overrides",
      before: before.filter((weapon) => Object.keys(weapon.override).length > 0),
      after: after.filter((weapon) => Object.keys(weapon.override).length > 0),
    });

    const reload = await reloadServer("arccw");

    return NextResponse.json({
      ok: true,
      weapons: after,
      reload: { ok: reload.ok, message: reload.message },
    });
  } catch (error) {
    console.error("[arccw] Schreiben fehlgeschlagen:", error);

    return NextResponse.json(
      { error: "Änderung fehlgeschlagen", detail: (error as Error).message },
      { status: 500 },
    );
  }
}
