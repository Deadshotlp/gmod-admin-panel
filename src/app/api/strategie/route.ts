import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { execute, query } from "@/lib/db";
import { reloadServer } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Strategieansicht (Naval, Stufe 4c) - nur lesen; Befehle laufen über
 * /api/flotte.
 *
 * GET ?static=1          Fraktionen, Klassen (mit Geschützstellungen), Systeme,
 *                        Hyperraumrouten, Stellungen des Map-Schiffs
 * GET ?system=<id>       Himmelskörper eines Systems (Umlaufbahnen)
 * GET (ohne Parameter)   Live-Lage aus pd_naval_live (schreibt der Server alle
 *                        2 s) + die letzten Logbuch-Einträge des Map-Schiffs
 * POST {changes: [{kind, key, factionId, contested}]}
 *                        Gebiete (pd_naval_territory) setzen; danach lädt der
 *                        Server die Galaxie neu (pd_reload naval_galaxy)
 */

function parse<T>(text: string | null | undefined, fallback: T): T {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

function fail(error: unknown) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[strategie] Fehler:", error);
  return NextResponse.json({ error: "Datenbank nicht erreichbar", detail: (error as Error).message }, { status: 503 });
}

async function loadStatic() {
  const [factions, classes, systems, routes, settings, territory, sectors] = await Promise.all([
    query<{ id: string; name: string; r: number; g: number; b: number }>(
      "SELECT `id`, `name`, `r`, `g`, `b` FROM `pd_naval_factions` ORDER BY `position`, `id`",
    ),
    query<{ id: string; name: string; length_m: number; hull: number; data: string }>(
      "SELECT `id`, `name`, `length_m`, `hull`, `data` FROM `pd_naval_classes` ORDER BY `position`, `id`",
    ),
    query<{ id: string; name: string; gx: number; gy: number; region: string }>(
      "SELECT `id`, `name`, `gx`, `gy`, `region` FROM `pd_naval_systems` WHERE `hidden` = 0",
    ),
    query<{ id: string; name: string; major: number; lines: string }>("SELECT `id`, `name`, `major`, `lines` FROM `pd_naval_routes`").catch(
      () => [],
    ),
    query<{ config_key: string; config_value: string }>(
      "SELECT `config_key`, `config_value` FROM `pd_naval_settings` WHERE `config_key` LIKE 'hardpoints\\_%'",
    ),
    query<{ kind: string; area_key: string; faction_id: string; contested: number }>(
      "SELECT `kind`, `area_key`, `faction_id`, `contested` FROM `pd_naval_territory`",
    ).catch(() => []),
    query<{ system_id: string; sector: string }>("SELECT `system_id`, `sector` FROM `pd_naval_system_info`").catch(() => []),
  ]);
  const sectorOf = new Map(sectors.map((r) => [r.system_id, r.sector]));

  return {
    factions: factions.map((f) => ({ id: f.id, name: f.name, color: `rgb(${f.r}, ${f.g}, ${f.b})` })),
    classes: classes.map((c) => {
      const data = parse<{ hardpoints?: unknown[] }>(c.data, {});
      return { id: c.id, name: c.name, lengthM: Number(c.length_m), hull: Number(c.hull), hardpoints: data.hardpoints ?? [] };
    }),
    systems: systems.map((s) => ({ id: s.id, name: s.name, x: Number(s.gx), y: Number(s.gy), region: s.region, sector: sectorOf.get(s.id) ?? "" })),
    territory: territory.map((t) => ({ kind: t.kind, key: t.area_key, factionId: t.faction_id, contested: Number(t.contested) === 1 })),
    routes: routes.map((r) => ({ id: r.id, name: r.name, major: Number(r.major) === 1, lines: parse<number[][][]>(r.lines, []) })),
    mapHardpoints: parse<unknown[]>(settings[0]?.config_value, []),
  };
}

export async function GET(request: Request) {
  try {
    await requireUser("viewer");
    const params = new URL(request.url).searchParams;

    if (params.get("static") === "1") return NextResponse.json(await loadStatic());

    const systemId = params.get("system");
    if (systemId) {
      const bodies = await query<{
        id: string; parent_id: string; type: string; name: string; orbit_radius: number; orbit_phase: number;
        orbit_period: number; orbit_incl: number; radius: number;
      }>(
        "SELECT `id`, `parent_id`, `type`, `name`, `orbit_radius`, `orbit_phase`, `orbit_period`, `orbit_incl`, `radius` " +
          "FROM `pd_naval_bodies` WHERE `system_id` = ?",
        [systemId],
      );
      return NextResponse.json({
        bodies: bodies.map((b) => ({
          id: b.id,
          parentId: b.parent_id || null,
          type: b.type,
          name: b.name,
          orbit: { radius: Number(b.orbit_radius), phase: Number(b.orbit_phase), period: Number(b.orbit_period), incl: Number(b.orbit_incl) },
          radius: Number(b.radius),
        })),
      });
    }

    // Dem Server melden, dass jemand hinschaut: er schreibt die Live-Lage nur
    // dann (Zeile __viewed__, siehe sv_naval_admintool.lua)
    await execute(
      "REPLACE INTO `pd_naval_live` (`server_key`, `updated_at`, `data`) VALUES ('__viewed__', ?, '')",
      [Math.floor(Date.now() / 1000)],
    ).catch(() => undefined);

    const rows = await query<{ server_key: string; updated_at: number; data: string }>(
      "SELECT `server_key`, `updated_at`, `data` FROM `pd_naval_live` WHERE `server_key` <> '__viewed__' ORDER BY `updated_at` DESC",
    ).catch(() => []);
    const live = rows[0] ? { serverKey: rows[0].server_key, updatedAt: Number(rows[0].updated_at), ...parse(rows[0].data, {}) } : null;

    const mapShipId = live && "mapShipId" in live ? Number((live as { mapShipId?: number }).mapShipId) : 0;
    const log = mapShipId
      ? await query<{ ts: number; kind: string; author: string; text: string }>(
          "SELECT `ts`, `kind`, `author`, `text` FROM `pd_naval_log` WHERE `server_key` = ? AND `ship_id` = ? ORDER BY `id` DESC LIMIT 25",
          [rows[0].server_key, mapShipId],
        )
      : [];

    return NextResponse.json({ live, log });
  } catch (error) {
    return fail(error);
  }
}

const territorySchema = z.object({
  changes: z
    .array(
      z.object({
        kind: z.enum(["system", "sector", "region"]),
        key: z.string().min(1).max(128),
        factionId: z.string().max(64),
        contested: z.boolean(),
      }),
    )
    .min(1)
    .max(500),
});

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser("editor");
  } catch (error) {
    return fail(error);
  }

  if (!checkRateLimit(rateLimitKey(request, "strategie-territory"), 30, 60_000)) {
    return NextResponse.json({ error: "Zu viele Änderungen" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = territorySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });

  try {
    const factions = new Set((await query<{ id: string }>("SELECT `id` FROM `pd_naval_factions`")).map((f) => f.id));
    const now = Math.floor(Date.now() / 1000);
    for (const c of parsed.data.changes) {
      if (c.factionId && !factions.has(c.factionId)) return NextResponse.json({ error: `Unbekannte Fraktion ${c.factionId}` }, { status: 400 });
      if (!c.factionId && !c.contested) {
        await execute("DELETE FROM `pd_naval_territory` WHERE `kind` = ? AND `area_key` = ?", [c.kind, c.key]);
      } else {
        await execute(
          "REPLACE INTO `pd_naval_territory` (`kind`, `area_key`, `faction_id`, `contested`, `updated_at`) VALUES (?, ?, ?, ?, ?)",
          [c.kind, c.key, c.factionId, c.contested ? 1 : 0, now],
        );
      }
    }

    await writeAudit({ user, action: "naval.territory", targetType: "naval_territory", targetKey: String(parsed.data.changes.length), before: null, after: parsed.data.changes });
    const reload = await reloadServer("naval_galaxy");
    return NextResponse.json({ ok: true, reload: { ok: reload.ok, message: reload.message } });
  } catch (error) {
    return fail(error);
  }
}
