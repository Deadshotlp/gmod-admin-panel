import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { sendConsoleCommand } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Flottenkommando: Schiffe ansehen und befehligen.
 *
 * Lesen aus pd_naval_ships (der Server speichert alle 60 s; mit ?refresh=1
 * wird vorher pd_naval_save geschickt). Befehle laufen als Konsolenbefehle
 * (pd_naval_spawn/order/edit/delete/pause) an den aktiven Server - das
 * Ergebnis steht in der Serverkonsole und nach dem nächsten Speichern hier.
 */

interface ShipRow {
  id: number;
  server_key: string;
  name: string;
  class_id: string;
  faction_id: string;
  system_id: string;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  state: string;
  hull: number;
  subs: string;
  orders: string;
  hyper: string;
  profile: string | null;
  updated_at: number;
}

function parse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function load() {
  const [ships, classes, factions, systems] = await Promise.all([
    query<ShipRow>(
      "SELECT `id`, `server_key`, `name`, `class_id`, `faction_id`, `system_id`, `px`, `py`, `pz`, `vx`, `vy`, `vz`, " +
        "`state`, `hull`, `subs`, `orders`, `hyper`, `profile`, `updated_at` FROM `pd_naval_ships` ORDER BY `server_key`, `id`",
    ),
    query<{ id: string; name: string; faction: string; hull: number }>(
      "SELECT `id`, `name`, `faction`, `hull` FROM `pd_naval_classes` ORDER BY `position`, `id`",
    ),
    query<{ id: string; name: string }>("SELECT `id`, `name` FROM `pd_naval_factions` ORDER BY `position`, `id`"),
    query<{ id: string; name: string }>("SELECT `id`, `name` FROM `pd_naval_systems` WHERE `hidden` = 0 ORDER BY `name`"),
  ]);

  // Himmelskörper nur für Systeme, in denen Schiffe sind (Orbit/Anflug)
  const systemIds = [...new Set(ships.map((ship) => ship.system_id))].filter(Boolean);
  const bodies = systemIds.length
    ? await query<{ id: string; system_id: string; name: string; type: string }>(
        `SELECT \`id\`, \`system_id\`, \`name\`, \`type\` FROM \`pd_naval_bodies\` WHERE \`system_id\` IN (${systemIds
          .map(() => "?")
          .join(", ")}) AND \`type\` IN ('star', 'planet', 'moon', 'station') ORDER BY \`name\``,
        systemIds,
      )
    : [];

  const classHull = new Map(classes.map((c) => [c.id, Number(c.hull) || 1]));
  const mapShips = new Map(ships.filter((ship) => ship.profile).map((ship) => [ship.server_key, ship]));

  return {
    ships: ships.map((ship) => {
      const map = mapShips.get(ship.server_key);
      const orders = parse<{ queue?: Array<{ type?: string }> }>(ship.orders, {});
      const hyper = parse<{ to?: string }>(ship.hyper, {});
      const sameSystem = map && map.system_id === ship.system_id && map !== ship;
      const subs = parse<{ roe?: string; target?: number }>(ship.subs, {});

      return {
        id: Number(ship.id),
        serverKey: ship.server_key,
        name: ship.name,
        classId: ship.class_id,
        factionId: ship.faction_id,
        systemId: ship.system_id,
        state: ship.state,
        order: orders.queue?.[0]?.type ?? null,
        orderCount: orders.queue?.length ?? 0,
        jumpTo: hyper.to ?? null,
        mapShip: Boolean(ship.profile),
        hull: Math.max(0, Math.round((Number(ship.hull) / (classHull.get(ship.class_id) ?? 1)) * 100)),
        roe: subs.roe ?? null,
        target: subs.target ?? null,
        speed: Math.round(Math.hypot(Number(ship.vx), Number(ship.vy), Number(ship.vz))),
        distanceKm: sameSystem
          ? Math.round(
              Math.hypot(Number(ship.px) - Number(map.px), Number(ship.py) - Number(map.py), Number(ship.pz) - Number(map.pz)) /
                1000,
            )
          : null,
        updatedAt: Number(ship.updated_at),
      };
    }),
    classes: classes.map((c) => ({ id: c.id, name: c.name, faction: c.faction })),
    factions,
    systems,
    bodies: bodies.map((body) => ({ id: body.id, systemId: body.system_id, name: body.name, type: body.type })),
  };
}

const id = z.string().regex(/^[a-z0-9_]{1,64}$/);
const name = z
  .string()
  .trim()
  .max(64)
  .regex(/^[\p{L}\p{N} _.\-]*$/u, "Name: nur Buchstaben, Ziffern, Leerzeichen und _ . -");

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("spawn"),
    classId: id,
    factionId: id.optional(),
    distanceKm: z.number().min(0.5).max(5000),
    name: name.optional(),
  }),
  z.object({
    action: z.literal("order"),
    id: z.number().int().positive(),
    type: z.enum(["hold", "jump", "jumpnear", "orbit", "approach", "move", "attack"]),
    targetId: z.number().int().positive().optional(),
    systemId: id.optional(),
    bodyId: id.optional(),
    radiusKm: z.number().min(1).max(10_000_000).optional(),
    x: z.number().min(-1e7).max(1e7).optional(),
    y: z.number().min(-1e7).max(1e7).optional(),
    z: z.number().min(-1e7).max(1e7).optional(),
  }),
  z.object({
    action: z.literal("edit"),
    id: z.number().int().positive(),
    name: name.optional(),
    factionId: id.optional(),
  }),
  z.object({ action: z.literal("delete"), id: z.number().int().positive() }),
  z.object({ action: z.literal("roe"), id: z.number().int().positive(), roe: z.enum(["hold", "return", "free"]) }),
  z.object({ action: z.literal("repair"), id: z.number().int().positive() }),
  z.object({ action: z.literal("pause") }),
]);

function fail(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[flotte] Fehler:", error);
  return NextResponse.json({ error: "Datenbank nicht erreichbar", detail: (error as Error).message }, { status: 503 });
}

export async function GET(request: Request) {
  try {
    await requireUser("viewer");

    let refreshed: { ok: boolean; message: string } | null = null;

    if (new URL(request.url).searchParams.get("refresh") === "1") {
      refreshed = await sendConsoleCommand("pd_naval_save");
      if (refreshed.ok) await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    return NextResponse.json({ ...(await load()), refreshed });
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

  if (!checkRateLimit(rateLimitKey(request, "flotte-write"), 60, 60_000)) {
    return NextResponse.json({ error: "Zu viele Befehle" }, { status: 429 });
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
  const commands: string[] = [];

  switch (input.action) {
    case "spawn": {
      let faction = input.factionId;

      if (!faction) {
        const rows = await query<{ faction: string }>("SELECT `faction` FROM `pd_naval_classes` WHERE `id` = ?", [input.classId]);
        faction = rows[0]?.faction || "neutral";
      }

      commands.push(`pd_naval_spawn ${input.classId} ${faction} ${input.distanceKm} ${input.name ?? ""}`.trim());
      break;
    }

    case "order": {
      const base = `pd_naval_order ${input.id}`;

      if (input.type === "jump") {
        if (!input.systemId) return NextResponse.json({ error: "Zielsystem fehlt" }, { status: 400 });
        commands.push(`${base} jump ${input.systemId}`);
      } else if (input.type === "orbit" || input.type === "approach") {
        if (!input.bodyId) return NextResponse.json({ error: "Himmelskörper fehlt" }, { status: 400 });
        commands.push(`${base} ${input.type} ${input.bodyId}${input.type === "orbit" && input.radiusKm ? ` ${input.radiusKm}` : ""}`);
      } else if (input.type === "attack") {
        if (!input.targetId) return NextResponse.json({ error: "Ziel fehlt" }, { status: 400 });
        commands.push(`${base} attack ${input.targetId}`);
      } else if (input.type === "move") {
        commands.push(`${base} move ${input.x ?? 0} ${input.y ?? 0} ${input.z ?? 0}`);
      } else {
        commands.push(`${base} ${input.type}`);
      }
      break;
    }

    case "edit":
      if (input.name) commands.push(`pd_naval_edit ${input.id} name ${input.name}`);
      if (input.factionId) commands.push(`pd_naval_edit ${input.id} faction ${input.factionId}`);
      break;

    case "delete":
      commands.push(`pd_naval_delete ${input.id}`);
      break;

    case "roe":
      commands.push(`pd_naval_roe ${input.id} ${input.roe}`);
      break;

    case "repair":
      commands.push(`pd_naval_repair ${input.id}`);
      break;

    case "pause":
      commands.push("pd_naval_pause");
      break;
  }

  if (commands.length === 0) {
    return NextResponse.json({ error: "Nichts zu tun" }, { status: 400 });
  }

  let result = { ok: true, message: "" };

  for (const command of commands) {
    result = await sendConsoleCommand(command);
    if (!result.ok) break;
  }

  await writeAudit({
    user,
    action: `flotte.${input.action}`,
    targetType: "naval_ship",
    targetKey: "id" in input ? String(input.id) : input.action,
    before: null,
    after: { commands, ok: result.ok },
  });

  return NextResponse.json({ ok: result.ok, message: result.ok ? "Befehl gesendet" : result.message, commands });
}
