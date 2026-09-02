import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { query, transaction } from "@/lib/db";
import { reloadServer } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";
import { getActiveServer } from "@/lib/servers";
import {
  ATTACHMENT_KEYS,
  WEAPON_KEYS,
  ZONE_KEYS,
  readList,
  readValues,
  type Values,
} from "@/lib/arccw";

export const dynamic = "force-dynamic";

/**
 * Werte der ArcCW-Waffen: Waffen selbst, Trefferzonen, Aufsätze.
 *
 * Die Tabellen legt das Gamemode-Modul modules/arccw an. Die Ausgangswerte aus
 * dem Addon stehen in pd_arccw_stats und pd_arccw_atts und sind nur zur Anzeige;
 * geändert wird ausschließlich in den Override-Tabellen. Ein fehlender Wert
 * heißt dort "Ausgangswert behalten" — das Addon selbst wird nie angefasst.
 */

interface WeaponRow {
  class: string;
  name: string;
  category: string;
  slots: string[];
  defaults: Values;
  override: Values;
  note: string;
}

interface AttachmentRow {
  id: string;
  name: string;
  slot: string;
  defaults: Values;
  override: Values;
  note: string;
}

interface ZoneRow {
  class: string;
  values: Values;
}

async function tablesExist(): Promise<boolean> {
  const rows = await query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM information_schema.tables " +
      "WHERE table_schema = DATABASE() AND table_name IN " +
      "('pd_arccw_stats', 'pd_arccw_overrides', 'pd_arccw_atts', " +
      "'pd_arccw_att_over', 'pd_arccw_zones')",
  );

  return Number(rows[0]?.c ?? 0) >= 5;
}

async function load(): Promise<{
  weapons: WeaponRow[];
  attachments: AttachmentRow[];
  zones: ZoneRow[];
}> {
  const key = (await getActiveServer()).serverKey;

  const [stats, overrides, atts, attOver, zones] = await Promise.all([
    query<Record<string, unknown>>(
      "SELECT * FROM `pd_arccw_stats` WHERE `server_key` = ? ORDER BY `category`, `name`",
      [key],
    ),
    query<Record<string, unknown>>(
      "SELECT * FROM `pd_arccw_overrides` WHERE `server_key` = ?",
      [key],
    ),
    query<Record<string, unknown>>(
      "SELECT * FROM `pd_arccw_atts` WHERE `server_key` = ? ORDER BY `slot`, `name`",
      [key],
    ),
    query<Record<string, unknown>>(
      "SELECT * FROM `pd_arccw_att_over` WHERE `server_key` = ?",
      [key],
    ),
    query<Record<string, unknown>>(
      "SELECT * FROM `pd_arccw_zones` WHERE `server_key` = ?",
      [key],
    ),
  ]);

  const weaponOverrides = new Map(overrides.map((row) => [String(row.class), row]));
  const attOverrides = new Map(attOver.map((row) => [String(row.att_id), row]));

  return {
    weapons: stats.map((row) => ({
      class: String(row.class),
      name: String(row.name ?? row.class),
      category: String(row.category ?? ""),
      slots: readList(row.slots_json),
      defaults: readValues(row.stats_json, WEAPON_KEYS),
      override: readValues(
        weaponOverrides.get(String(row.class))?.values_json,
        WEAPON_KEYS,
      ),
      note: String(weaponOverrides.get(String(row.class))?.note ?? ""),
    })),

    attachments: atts.map((row) => ({
      id: String(row.att_id),
      name: String(row.name ?? row.att_id),
      slot: String(row.slot ?? ""),
      defaults: readValues(row.stats_json, ATTACHMENT_KEYS),
      override: readValues(
        attOverrides.get(String(row.att_id))?.values_json,
        ATTACHMENT_KEYS,
      ),
      note: String(attOverrides.get(String(row.att_id))?.note ?? ""),
    })),

    zones: zones.map((row) => ({
      class: String(row.class),
      values: readValues(row.values_json, ZONE_KEYS),
    })),
  };
}

// null heißt ausdrücklich "nicht gesetzt" und ist etwas anderes als 0.
const numbers = z.record(z.string(), z.number().min(0).max(1_000_000).nullable());

const schema = z.object({
  weapons: z
    .array(
      z.object({
        class: z.string().min(1).max(128),
        values: numbers,
        note: z.string().max(255).default(""),
      }),
    )
    .max(3000),
  attachments: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        values: numbers,
        note: z.string().max(255).default(""),
      }),
    )
    .max(3000),
  zones: z
    .array(
      z.object({
        class: z.string().min(1).max(128),
        values: numbers,
      }),
    )
    .max(3000),
});

/** Nur gesetzte Zahlen behalten - der Rest bleibt Ausgangswert. */
function compact(values: Record<string, number | null>, keys: string[]): Values | null {
  const out: Values = {};
  let any = false;

  for (const key of keys) {
    const value = values[key];

    if (value !== null && value !== undefined && Number.isFinite(value)) {
      out[key] = value;
      any = true;
    }
  }

  return any ? out : null;
}

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

    const data = await load();

    if (data.weapons.length === 0) {
      return NextResponse.json({
        configured: true,
        ...data,
        hint:
          "Der Server hat noch keine ArcCW-Waffen gemeldet. pd_arccw_status in der " +
          "Serverkonsole zeigt, ob das Modul welche gefunden hat.",
      });
    }

    return NextResponse.json({ configured: true, ...data });
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
    const key = (await getActiveServer()).serverKey;
    const before = await load();

    // Nur Klassen und Aufsätze zulassen, die der Server gemeldet hat. Ein
    // Tippfehler bliebe sonst als Karteileiche in der Tabelle liegen. Der
    // Schlüssel "*" ist die allgemeine Trefferzonen-Regel für alle Waffen.
    const knownClasses = new Set(before.weapons.map((weapon) => weapon.class));
    const knownAtts = new Set(before.attachments.map((att) => att.id));

    const strays = [
      ...parsed.data.weapons.filter((entry) => !knownClasses.has(entry.class)).map((e) => e.class),
      ...parsed.data.attachments.filter((entry) => !knownAtts.has(entry.id)).map((e) => e.id),
      ...parsed.data.zones
        .filter((entry) => entry.class !== "*" && !knownClasses.has(entry.class))
        .map((e) => e.class),
    ];

    if (strays.length > 0) {
      return NextResponse.json(
        {
          error:
            `${strays.length} Eintrag/Einträge hat der Server nicht gemeldet: ` +
            strays.slice(0, 5).join(", "),
        },
        { status: 400 },
      );
    }

    const now = Math.floor(Date.now() / 1000);

    await transaction(async (conn) => {
      for (const table of ["pd_arccw_overrides", "pd_arccw_att_over", "pd_arccw_zones"]) {
        await conn.execute(`DELETE FROM \`${table}\` WHERE \`server_key\` = ?`, [key]);
      }

      for (const entry of parsed.data.weapons) {
        const values = compact(entry.values, WEAPON_KEYS);
        if (!values) continue;

        await conn.execute(
          "INSERT INTO `pd_arccw_overrides` (`server_key`, `class`, `values_json`, `note`, `updated_at`) " +
            "VALUES (?, ?, ?, ?, ?)",
          [key, entry.class, JSON.stringify(values), entry.note, now],
        );
      }

      for (const entry of parsed.data.attachments) {
        const values = compact(entry.values, ATTACHMENT_KEYS);
        if (!values) continue;

        await conn.execute(
          "INSERT INTO `pd_arccw_att_over` (`server_key`, `att_id`, `values_json`, `note`, `updated_at`) " +
            "VALUES (?, ?, ?, ?, ?)",
          [key, entry.id, JSON.stringify(values), entry.note, now],
        );
      }

      for (const entry of parsed.data.zones) {
        const values = compact(entry.values, ZONE_KEYS);
        if (!values) continue;

        await conn.execute(
          "INSERT INTO `pd_arccw_zones` (`server_key`, `class`, `values_json`, `updated_at`) " +
            "VALUES (?, ?, ?, ?)",
          [key, entry.class, JSON.stringify(values), now],
        );
      }
    });

    const after = await load();

    await writeAudit({
      user,
      action: "arccw.save",
      targetType: "arccw",
      targetKey: "overrides",
      before: {
        weapons: before.weapons.filter((w) => Object.keys(w.override).length > 0),
        attachments: before.attachments.filter((a) => Object.keys(a.override).length > 0),
        zones: before.zones,
      },
      after: {
        weapons: after.weapons.filter((w) => Object.keys(w.override).length > 0),
        attachments: after.attachments.filter((a) => Object.keys(a.override).length > 0),
        zones: after.zones,
      },
    });

    const reload = await reloadServer("arccw");

    return NextResponse.json({
      ok: true,
      ...after,
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
