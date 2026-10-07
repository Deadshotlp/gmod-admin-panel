import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { execute, query } from "@/lib/db";
import { sendConsoleCommand } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Szenarien und Orbit-Events (Naval, Stufe 4e).
 *
 * pd_naval_scenarios legt das Gamemode-Modul an (sv_naval_scenarios.lua) und
 * füllt sie beim ersten Start mit ausgeschalteten Beispielen. Nach jeder
 * Änderung lädt der Server sie mit "pd_naval_scenario reload" neu.
 *
 * GET               Szenarien + Klassen/Fraktionen für die Auswahl
 * GET ?lookup=<q>   Systeme und Himmelskörper (max. 30)
 * POST {op: "save", scenario} | {op: "delete", id} | {op: "start", id}
 *      | {op: "cleanup", id?} | {op: "stop"}
 */

interface Row {
  id: number;
  name: string;
  description: string;
  enabled: number;
  trigger_kind: string;
  trigger_data: string;
  actions: string;
  chance: number;
  cooldown: number;
  once: number;
  runs: number;
  last_run: number;
}

function parse<T>(text: string, fallback: T): T {
  try {
    const value = JSON.parse(text);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function fail(error: unknown) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[naval/scenarios] Fehler:", error);
  return NextResponse.json({ error: "Datenbank nicht erreichbar", detail: (error as Error).message }, { status: 503 });
}

async function tableExists(): Promise<boolean> {
  const rows = await query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'pd_naval_scenarios'",
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

export async function GET(request: Request) {
  try {
    await requireUser("viewer");
    const params = new URL(request.url).searchParams;

    const lookup = (params.get("lookup") ?? "").trim();
    if (lookup) {
      if (lookup.length < 2) return NextResponse.json({ systems: [], bodies: [] });
      const like = `%${lookup}%`;
      const [systems, bodies] = await Promise.all([
        query<{ id: string; name: string }>("SELECT `id`, `name` FROM `pd_naval_systems` WHERE `name` LIKE ? ORDER BY `name` LIMIT 15", [like]),
        query<{ id: string; name: string; type: string; system_name: string }>(
          "SELECT b.`id`, b.`name`, b.`type`, s.`name` AS system_name FROM `pd_naval_bodies` b " +
            "LEFT JOIN `pd_naval_systems` s ON s.`id` = b.`system_id` WHERE b.`type` <> 'star' AND b.`name` LIKE ? ORDER BY b.`name` LIMIT 15",
          [like],
        ),
      ]);
      return NextResponse.json({ systems, bodies });
    }

    if (!(await tableExists())) {
      return NextResponse.json({
        configured: false,
        hint: "Die Tabelle pd_naval_scenarios fehlt noch. Sie entsteht beim nächsten Map-Start mit dem Naval-Modul.",
      });
    }

    const [rows, classes, factions] = await Promise.all([
      query<Row>("SELECT * FROM `pd_naval_scenarios` ORDER BY `id`"),
      query<{ id: string; name: string }>("SELECT `id`, `name` FROM `pd_naval_classes` ORDER BY `position`, `id`"),
      query<{ id: string; name: string }>("SELECT `id`, `name` FROM `pd_naval_factions` ORDER BY `id`"),
    ]);

    return NextResponse.json({
      configured: true,
      classes,
      factions,
      scenarios: rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        description: row.description,
        enabled: Number(row.enabled) === 1,
        trigger: row.trigger_kind,
        data: ((d) => (Array.isArray(d) ? {} : d))(parse<Record<string, unknown>>(row.trigger_data, {})),
        actions: parse<unknown[]>(row.actions, []),
        chance: Number(row.chance),
        cooldown: Number(row.cooldown),
        once: Number(row.once) === 1,
        runs: Number(row.runs),
        lastRun: Number(row.last_run),
      })),
    });
  } catch (error) {
    return fail(error);
  }
}

const id = z.string().max(64).regex(/^[A-Za-z0-9_\-.]*$/);
const text = (max: number) => z.string().max(max);
const delay = z.number().min(0).max(3600).optional();

const action = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("spawn"),
    delay,
    classId: id.min(1),
    factionId: id.optional(),
    count: z.number().int().min(1).max(12),
    name: text(64).optional(),
    distanceKm: z.number().min(0.5).max(2000),
    bearing: z.enum(["front", "back", "left", "right", "above", "below", "random"]),
    arrive: z.enum(["hyperspace", "here"]),
    orders: z.enum(["attack", "hold", "patrol", "derelict"]),
  }),
  z.object({ type: z.literal("comms"), delay, from: text(64).optional(), text: text(300).min(1), kind: z.enum(["msg", "distress"]) }),
  z.object({ type: z.literal("announce"), delay, title: text(64).optional(), text: text(300).min(1) }),
  z.object({ type: z.literal("alert"), delay, level: z.number().int().min(0).max(2) }),
  z.object({ type: z.literal("damage"), delay, percent: z.number().min(0).max(50), weapon: id.optional() }),
  z.object({
    type: z.literal("supply"),
    delay,
    crates: z.object({
      torpedo: z.number().int().min(0).max(20).optional(),
      missile: z.number().int().min(0).max(20).optional(),
      parts: z.number().int().min(0).max(20).optional(),
      craft: z.number().int().min(0).max(20).optional(),
    }),
  }),
  z.object({ type: z.literal("log"), delay, text: text(300).min(1) }),
]);

const territory = z.enum(["any", "own", "hostile", "none", "contested"]).optional();

const scenario = z.object({
  id: z.number().int().positive().optional(),
  name: text(128).min(1),
  description: text(255),
  enabled: z.boolean(),
  trigger: z.enum(["manual", "enter_system", "orbit", "field", "interval", "hull_below"]),
  data: z.object({
    systemId: id.optional(),
    bodyId: id.optional(),
    bodyType: z.enum(["", "planet", "moon", "station"]).optional(),
    kind: z.enum(["", "asteroids", "nebula"]).optional(),
    minutes: z.number().min(1).max(1440).optional(),
    percent: z.number().min(1).max(99).optional(),
    territory,
  }),
  actions: z.array(action).max(30),
  chance: z.number().min(0).max(1),
  cooldown: z.number().int().min(0).max(30 * 86400),
  once: z.boolean(),
});

const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("save"), scenario }),
  z.object({ op: z.literal("delete"), id: z.number().int().positive() }),
  z.object({ op: z.literal("start"), id: z.number().int().positive() }),
  z.object({ op: z.literal("cleanup"), id: z.number().int().positive().optional() }),
  z.object({ op: z.literal("stop") }),
]);

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser("editor");
  } catch (error) {
    return fail(error);
  }

  if (!checkRateLimit(rateLimitKey(request, "naval-scenarios"), 30, 60_000)) {
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
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: `${issue?.path.join(".") ?? ""}: ${issue?.message ?? "Ungültige Eingabe"}` }, { status: 400 });
  }
  const input = parsed.data;

  try {
    if (input.op === "start" || input.op === "cleanup" || input.op === "stop") {
      const command =
        input.op === "start"
          ? `pd_naval_scenario start ${input.id}`
          : input.op === "cleanup"
            ? `pd_naval_scenario cleanup${input.id ? ` ${input.id}` : ""}`
            : "pd_naval_scenario stop";
      const result = await sendConsoleCommand(command);
      await writeAudit({ user, action: `naval.scenario.${input.op}`, targetType: "naval_scenario", targetKey: String("id" in input ? input.id ?? "alle" : "alle"), before: null, after: { ok: result.ok } });
      return NextResponse.json({ ok: result.ok, message: result.message });
    }

    if (input.op === "delete") {
      const before = await query<Row>("SELECT * FROM `pd_naval_scenarios` WHERE `id` = ?", [input.id]);
      await execute("DELETE FROM `pd_naval_scenarios` WHERE `id` = ?", [input.id]);
      await writeAudit({ user, action: "naval.scenario.delete", targetType: "naval_scenario", targetKey: String(input.id), before: before[0] ?? null, after: null });
    } else {
      const s = input.scenario;
      const values = [
        s.name, s.description, s.enabled ? 1 : 0, s.trigger, JSON.stringify(s.data), JSON.stringify(s.actions),
        s.chance, s.cooldown, s.once ? 1 : 0, Math.floor(Date.now() / 1000),
      ];
      if (s.id) {
        const before = await query<Row>("SELECT * FROM `pd_naval_scenarios` WHERE `id` = ?", [s.id]);
        if (!before[0]) return NextResponse.json({ error: "Szenario nicht gefunden" }, { status: 404 });
        await execute(
          "UPDATE `pd_naval_scenarios` SET `name` = ?, `description` = ?, `enabled` = ?, `trigger_kind` = ?, `trigger_data` = ?, " +
            "`actions` = ?, `chance` = ?, `cooldown` = ?, `once` = ?, `updated_at` = ? WHERE `id` = ?",
          [...values, s.id],
        );
        await writeAudit({ user, action: "naval.scenario.save", targetType: "naval_scenario", targetKey: String(s.id), before: before[0], after: s });
      } else {
        await execute(
          "INSERT INTO `pd_naval_scenarios` (`name`, `description`, `enabled`, `trigger_kind`, `trigger_data`, `actions`, `chance`, `cooldown`, `once`, `updated_at`) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          values,
        );
        await writeAudit({ user, action: "naval.scenario.create", targetType: "naval_scenario", targetKey: s.name, before: null, after: s });
      }
    }

    const reload = await sendConsoleCommand("pd_naval_scenario reload");
    return NextResponse.json({ ok: true, reload: { ok: reload.ok, message: reload.message } });
  } catch (error) {
    return fail(error);
  }
}
