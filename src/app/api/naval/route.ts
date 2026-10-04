import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { createBackup } from "@/lib/backups";
import { query, transaction } from "@/lib/db";
import { reloadServer, sendConsoleCommand } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Raumflotte (Naval-System).
 *
 * Konfiguration (bearbeitbar): pd_naval_settings, pd_naval_classes,
 * pd_naval_factions, pd_naval_relations, Flags in pd_naval_systems.
 * Laufzeit (nur lesen): pd_naval_ships, pd_naval_log, pd_naval_consoles -
 * die schreibt der Server, Änderungen dort laufen über Konsolenbefehle.
 *
 * Alle Tabellen legt das Gamemode-Modul naval beim Start an. Werte in
 * pd_naval_settings sind JSON-kodiert ("5", "\"text\"", "{...}").
 */

const TABLES = [
  "pd_naval_settings",
  "pd_naval_classes",
  "pd_naval_factions",
  "pd_naval_relations",
  "pd_naval_systems",
  "pd_naval_ships",
];

const RELATIONS = ["ally", "neutral", "hostile"] as const;

async function tablesExist(): Promise<boolean> {
  const rows = await query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() " +
      `AND table_name IN (${TABLES.map(() => "?").join(", ")})`,
    TABLES,
  );

  return Number(rows[0]?.c ?? 0) >= TABLES.length;
}

function decode(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function loadConfig() {
  const [settings, classes, factions, relations, systems] = await Promise.all([
    query<{ config_key: string; config_value: string }>("SELECT * FROM `pd_naval_settings` ORDER BY `config_key`"),
    query<{
      id: string; name: string; faction: string; model: string; lod_model: string;
      length_m: number; hull: number; data: string; position: number;
    }>("SELECT * FROM `pd_naval_classes` ORDER BY `position`, `id`"),
    query<{
      id: string; name: string; r: number; g: number; b: number; iff_code: string;
      player_faction: number; position: number;
    }>("SELECT * FROM `pd_naval_factions` ORDER BY `position`, `id`"),
    query<{ faction_a: string; faction_b: string; relation: string }>("SELECT * FROM `pd_naval_relations`"),
    query<{ id: string; name: string; region: string; gx: number; gy: number; hidden: number; jumpable: number }>(
      "SELECT `id`, `name`, `region`, `gx`, `gy`, `hidden`, `jumpable` FROM `pd_naval_systems` ORDER BY `name`",
    ),
  ]);

  return {
    settings: Object.fromEntries(settings.map((row) => [row.config_key, decode(row.config_value)])),
    classes: classes.map((row) => ({
      id: row.id,
      name: row.name,
      faction: row.faction,
      model: row.model,
      lengthM: Number(row.length_m),
      hull: Number(row.hull),
      data: row.data,
    })),
    factions: factions.map((row) => ({
      id: row.id,
      name: row.name,
      color: `${row.r},${row.g},${row.b}`,
      iff: row.iff_code,
      player: Number(row.player_faction) === 1,
    })),
    relations: relations.map((row) => ({ a: row.faction_a, b: row.faction_b, relation: row.relation })),
    systems: systems.map((row) => ({
      id: row.id,
      name: row.name,
      region: row.region,
      x: Number(row.gx),
      y: Number(row.gy),
      hidden: Number(row.hidden) === 1,
      jumpable: Number(row.jumpable) !== 0,
    })),
  };
}

async function loadRuntime() {
  const [ships, log, consoles] = await Promise.all([
    query<{
      id: number; server_key: string; name: string; class_id: string; faction_id: string;
      system_id: string; state: string; profile: string | null; updated_at: number;
    }>(
      "SELECT `id`, `server_key`, `name`, `class_id`, `faction_id`, `system_id`, `state`, `profile`, `updated_at` " +
        "FROM `pd_naval_ships` ORDER BY `server_key`, `id`",
    ),
    query<{ id: number; server_key: string; ts: number; ship_id: number; kind: string; author: string; text: string }>(
      "SELECT * FROM `pd_naval_log` ORDER BY `id` DESC LIMIT 150",
    ),
    query<{ id: number; map: string; station: string; px: number; py: number; pz: number; locked: number }>(
      "SELECT `id`, `map`, `station`, `px`, `py`, `pz`, `locked` FROM `pd_naval_consoles` ORDER BY `map`, `id`",
    ),
  ]);

  return {
    ships: ships.map((row) => ({ ...row, id: Number(row.id), updated_at: Number(row.updated_at) })),
    log: log.map((row) => ({ ...row, id: Number(row.id), ts: Number(row.ts), ship_id: Number(row.ship_id) })),
    consoles: consoles.map((row) => ({
      id: Number(row.id),
      map: row.map,
      station: row.station,
      pos: [row.px, row.py, row.pz].map((v) => Math.round(Number(v))).join(" "),
      locked: Number(row.locked) === 1,
    })),
  };
}

const slug = z.string().trim().regex(/^[a-z0-9_]{2,40}$/, "ID: 2-40 Zeichen a-z, 0-9, _");
const color = z.string().regex(/^\d{1,3},\d{1,3},\d{1,3}$/, "Farbe als r,g,b");

const schema = z.discriminatedUnion("section", [
  z.object({
    section: z.literal("settings"),
    settings: z.record(z.string().regex(/^[a-z0-9_]{1,64}$/), z.union([z.number(), z.string().max(200), z.boolean()])),
  }),
  z.object({
    section: z.literal("classes"),
    classes: z
      .array(
        z.object({
          id: slug,
          name: z.string().trim().min(1).max(128),
          faction: z.string().max(64),
          model: z.string().trim().regex(/^models\/[A-Za-z0-9_\-./]+\.mdl$/, "Modellpfad models/....mdl"),
          lengthM: z.number().min(5).max(200000),
          hull: z.number().min(1).max(10_000_000),
          data: z.string().max(60000),
        }),
      )
      .max(100),
  }),
  z.object({
    section: z.literal("factions"),
    factions: z
      .array(
        z.object({
          id: slug,
          name: z.string().trim().min(1).max(128),
          color,
          iff: z.string().trim().max(16),
          player: z.boolean(),
        }),
      )
      .min(1)
      .max(30),
    relations: z.array(z.object({ a: slug, b: slug, relation: z.enum(RELATIONS) })).max(900),
  }),
  z.object({
    section: z.literal("systems"),
    changes: z
      .array(z.object({ id: z.string().max(64), hidden: z.boolean(), jumpable: z.boolean() }))
      .min(1)
      .max(5000),
  }),
  z.object({
    section: z.literal("action"),
    action: z.enum(["pause", "import_galaxy", "reload", "status"]),
  }),
]);

const ACTION_COMMAND: Record<string, string> = {
  pause: "pd_naval_pause",
  import_galaxy: "pd_naval_import_galaxy",
  reload: "pd_reload naval",
  status: "pd_naval_status",
};

// Werte, die der Server selbst pflegt
const READONLY_SETTINGS = new Set(["galaxy_version", "galaxy_unit"]);

function fail(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[naval] Fehler:", error);
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
        hint: "Die Naval-Tabellen fehlen. Sie entstehen beim ersten Start des Gamemodes mit dem Naval-Modul.",
      });
    }

    const [config, runtime] = await Promise.all([loadConfig(), loadRuntime()]);
    return NextResponse.json({ configured: true, ...config, ...runtime });
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

  if (!checkRateLimit(rateLimitKey(request, "naval-write"), 30, 60_000)) {
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
      { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe", detail: parsed.error.issues },
      { status: 400 },
    );
  }

  const input = parsed.data;

  if (input.section === "action") {
    const result = await sendConsoleCommand(ACTION_COMMAND[input.action]);

    await writeAudit({
      user,
      action: `naval.${input.action}`,
      targetType: "naval",
      targetKey: input.action,
      before: null,
      after: { ok: result.ok },
    });

    return NextResponse.json({ ok: result.ok, message: result.message });
  }

  // Inhaltliche Prüfungen
  if (input.section === "classes") {
    const ids = new Set<string>();

    for (const cls of input.classes) {
      if (ids.has(cls.id)) {
        return NextResponse.json({ error: `Klasse ${cls.id} doppelt` }, { status: 400 });
      }
      ids.add(cls.id);

      try {
        const data = JSON.parse(cls.data);
        if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error();
      } catch {
        return NextResponse.json({ error: `${cls.name}: Zusatzdaten sind kein gültiges JSON-Objekt` }, { status: 400 });
      }
    }

    const used = await query<{ class_id: string }>("SELECT DISTINCT `class_id` FROM `pd_naval_ships`");
    const missing = used.map((row) => row.class_id).filter((id) => !ids.has(id));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Klasse(n) noch von Schiffen benutzt: ${missing.join(", ")}` },
        { status: 400 },
      );
    }
  }

  if (input.section === "factions") {
    const ids = new Set(input.factions.map((faction) => faction.id));

    if (ids.size !== input.factions.length) {
      return NextResponse.json({ error: "Fraktions-ID doppelt" }, { status: 400 });
    }

    for (const faction of input.factions) {
      if (faction.color.split(",").map(Number).some((value) => value > 255)) {
        return NextResponse.json({ error: `Ungültige Farbe bei ${faction.name}` }, { status: 400 });
      }
    }

    const used = await query<{ id: string }>(
      "SELECT DISTINCT `faction_id` AS id FROM `pd_naval_ships` UNION SELECT DISTINCT `faction` FROM `pd_naval_classes`",
    );
    const missing = used.map((row) => row.id).filter((id) => id && !ids.has(id));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Fraktion(en) noch von Schiffen oder Klassen benutzt: ${missing.join(", ")}` },
        { status: 400 },
      );
    }

    for (const rel of input.relations) {
      if (!ids.has(rel.a) || !ids.has(rel.b)) {
        return NextResponse.json({ error: "Beziehung mit unbekannter Fraktion" }, { status: 400 });
      }
    }
  }

  try {
    const before = await loadConfig();

    await createBackup("naval", `Automatisch vor dem Speichern (${input.section}) durch ${user.displayName}`);

    await transaction(async (conn) => {
      if (input.section === "settings") {
        for (const [key, value] of Object.entries(input.settings)) {
          if (READONLY_SETTINGS.has(key) || key.startsWith("mapcal_")) continue;

          await conn.execute(
            "REPLACE INTO `pd_naval_settings` (`config_key`, `config_value`) VALUES (?, ?)",
            [key, JSON.stringify(value)],
          );
        }
      }

      if (input.section === "classes") {
        const keep: string[] = [];

        for (const [index, cls] of input.classes.entries()) {
          keep.push(cls.id);
          await conn.execute(
            "INSERT INTO `pd_naval_classes` (`id`, `name`, `faction`, `model`, `lod_model`, `length_m`, `hull`, `data`, `position`) " +
              "VALUES (?, ?, ?, ?, '', ?, ?, ?, ?) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `faction` = VALUES(`faction`), " +
              "`model` = VALUES(`model`), `length_m` = VALUES(`length_m`), `hull` = VALUES(`hull`), `data` = VALUES(`data`), " +
              "`position` = VALUES(`position`)",
            [cls.id, cls.name, cls.faction, cls.model, cls.lengthM, cls.hull, cls.data, index + 1],
          );
        }

        if (keep.length > 0) {
          await conn.execute(
            `DELETE FROM \`pd_naval_classes\` WHERE \`id\` NOT IN (${keep.map(() => "?").join(", ")})`,
            keep,
          );
        }
      }

      if (input.section === "factions") {
        const keep = input.factions.map((faction) => faction.id);

        for (const [index, faction] of input.factions.entries()) {
          const [r, g, b] = faction.color.split(",").map(Number);
          await conn.execute(
            "REPLACE INTO `pd_naval_factions` (`id`, `name`, `r`, `g`, `b`, `iff_code`, `player_faction`, `position`) " +
              "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [faction.id, faction.name, r, g, b, faction.iff, faction.player ? 1 : 0, index + 1],
          );
        }

        await conn.execute(
          `DELETE FROM \`pd_naval_factions\` WHERE \`id\` NOT IN (${keep.map(() => "?").join(", ")})`,
          keep,
        );
        await conn.execute("DELETE FROM `pd_naval_relations`");

        for (const rel of input.relations) {
          if (rel.a === rel.b) continue;
          await conn.execute(
            "REPLACE INTO `pd_naval_relations` (`faction_a`, `faction_b`, `relation`) VALUES (?, ?, ?)",
            [rel.a, rel.b, rel.relation],
          );
        }
      }

      if (input.section === "systems") {
        for (const change of input.changes) {
          await conn.execute(
            "UPDATE `pd_naval_systems` SET `hidden` = ?, `jumpable` = ? WHERE `id` = ?",
            [change.hidden ? 1 : 0, change.jumpable ? 1 : 0, change.id],
          );
        }
      }
    });

    const after = await loadConfig();

    await writeAudit({
      user,
      action: `naval.${input.section}`,
      targetType: "naval",
      targetKey: input.section,
      before: input.section === "systems" ? { changes: input.changes.length } : before[input.section as "settings"],
      after: input.section === "systems" ? input.changes : after[input.section as "settings"],
    });

    const reload = await reloadServer(input.section === "systems" ? "naval_galaxy" : "naval");

    return NextResponse.json({
      ok: true,
      ...after,
      reload: { ok: reload.ok, message: reload.message },
    });
  } catch (error) {
    console.error("[naval] Schreiben fehlgeschlagen:", error);

    return NextResponse.json(
      { error: "Änderung fehlgeschlagen", detail: (error as Error).message },
      { status: 500 },
    );
  }
}
