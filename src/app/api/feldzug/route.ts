import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, listPanelUsers, requireUser } from "@/lib/auth";
import type { PanelUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { execute, query } from "@/lib/db";
import {
  addReport,
  createCampaign,
  deleteCampaign,
  deleteUnit,
  deleteUnitType,
  ensureFeldzugTables,
  insertUnit,
  listCampaigns,
  loadReports,
  loadState,
  loadUnitTypes,
  saveGraph,
  saveSystem,
  saveUnitType,
  setCommanders,
  setRegion,
  updateCampaign,
  loadOrders,
  saveOrder,
  deleteOrder,
  loadBattles,
  loadIntel,
} from "@/lib/feldzug/db";
import type { Order } from "@/lib/feldzug/db";
import { incomeOf, orderCost, recordIntel, resolveTurn, suppliedSystems, validateOrder } from "@/lib/feldzug/turn";
import { visibleSystems } from "@/lib/feldzug/rules";
import type { CampaignState } from "@/lib/feldzug/db";
import { buildHopGraph } from "@/lib/feldzug/routing";
import type { RouteLine } from "@/lib/feldzug/routing";
import { RuleError, checkBuy, checkOccupy, checkRelease, checkSell, systemTier, viewFor } from "@/lib/feldzug/rules";
import type { Viewer } from "@/lib/feldzug/rules";
import { DEFAULT_SETTINGS, SIDES, SIDE_NAME } from "@/lib/feldzug/types";
import type { Settings, Side, UnitType } from "@/lib/feldzug/types";

export const dynamic = "force-dynamic";

/**
 * Galaktischer Feldzug (Paket 1: Aufbau).
 *
 * GET ?static=1     Galaxie (Systeme, Routen) für die Karte
 * GET               Feldzüge, auf die der Nutzer Zugriff hat, + Katalog
 * GET ?id=<n>       Lage des Feldzugs - gefiltert nach Seite (Nebel des
 *                   Krieges). Kommandeure sehen nur ihre Seite, die
 *                   Spielleitung (Admin ohne Kommando) alles.
 * POST {op, ...}    Aufbau-Befehle, siehe schema
 *
 * Wer in einem Feldzug Kommandeur ist, bekommt dort immer die Seitenansicht,
 * auch als Admin - die Spielleitung sollte daher selbst kein Kommando haben.
 */

function fail(error: unknown) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof RuleError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error("[feldzug] Fehler:", error);
  return NextResponse.json({ error: "Datenbank nicht erreichbar", detail: (error as Error).message }, { status: 503 });
}

function parse<T>(text: string | null | undefined, fallback: T): T {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Befehle eines Feldzugs nacheinander (kein doppeltes Ausgeben von Punkten) */
const locks = new Map<number, Promise<unknown>>();
function withLock<T>(id: number, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(id, next);
  return next;
}

function viewerOf(user: PanelUser, state: CampaignState): Viewer {
  const cmd = state.commanders.find((c) => c.steamId === user.steamId);
  if (cmd) return { kind: "side", side: cmd.side };
  if (user.role === "admin") return { kind: "admin" };
  throw new AuthError(403, "Kein Zugriff auf diesen Feldzug");
}

async function loadGalaxy() {
  const [systems, routes, sectors] = await Promise.all([
    query<{ id: string; name: string; gx: number; gy: number; region: string }>(
      "SELECT `id`, `name`, `gx`, `gy`, `region` FROM `pd_naval_systems` WHERE `hidden` = 0",
    ),
    query<{ major: number; lines: string }>("SELECT `major`, `lines` FROM `pd_naval_routes`").catch(() => []),
    query<{ system_id: string; sector: string }>("SELECT `system_id`, `sector` FROM `pd_naval_system_info`").catch(() => []),
  ]);
  const sectorOf = new Map(sectors.map((r) => [r.system_id, r.sector]));
  return {
    systems: systems.map((s) => ({
      id: s.id,
      name: s.name,
      x: Number(s.gx),
      y: Number(s.gy),
      region: (s.region || "").replace(/^\*/, ""),
      sector: sectorOf.get(s.id) ?? "",
    })),
    routes: routes.map((r): RouteLine => ({ major: Number(r.major) === 1, lines: parse<number[][][]>(r.lines, []) })),
  };
}

/** Größte Sprungweite fürs Netz: Nachschub oder schnellstes Schiff */
function maxHopOf(settings: Settings, types: UnitType[]) {
  return Math.max(settings.supplyHop, ...types.filter((t) => t.category === "ship").map((t) => t.speed));
}

/** Kennung der Netzberechnung; ältere Netze werden beim Laden neu berechnet */
const GRAPH_VERSION = "_v2";

async function rebuildGraph(state: CampaignState, types: UnitType[]) {
  const galaxy = await loadGalaxy();
  const points = [...state.systems.values()].map((s) => ({ id: s.id, x: s.x, y: s.y }));
  const graph = buildHopGraph(points, galaxy.routes, state.campaign.settings, maxHopOf(state.campaign.settings, types));
  graph[GRAPH_VERSION] = [];
  await saveGraph(state.campaign.id, graph);
  state.graph = graph;
}

/** Feldzug laden; veraltetes Sprungnetz (vor Inselverbindung) neu berechnen */
async function loadCurrent(id: number, types: UnitType[]): Promise<CampaignState | null> {
  const state = await loadState(id);
  if (state && state.systems.size > 1 && !state.graph[GRAPH_VERSION]) await rebuildGraph(state, types);
  return state;
}

/* -------------------------------------------------------------------- */
/* GET                                                                   */
/* -------------------------------------------------------------------- */

export async function GET(request: Request) {
  try {
    const user = await requireUser("viewer");
    await ensureFeldzugTables();
    const params = new URL(request.url).searchParams;

    if (params.get("static") === "1") return NextResponse.json(await loadGalaxy());

    const types = await loadUnitTypes();
    const idParam = params.get("id");

    if (!idParam) {
      const campaigns = await listCampaigns();
      const mine = await query<{ campaign_id: number; side: string }>(
        "SELECT `campaign_id`, `side` FROM `pd_fz_commanders` WHERE `steamid64` = ?",
        [user.steamId],
      );
      const sideOf = new Map(mine.map((m) => [Number(m.campaign_id), m.side as Side]));
      const isAdmin = user.role === "admin";
      return NextResponse.json({
        isAdmin,
        campaigns: campaigns
          .filter((c) => isAdmin || sideOf.has(c.id))
          .map((c) => ({ id: c.id, name: c.name, status: c.status, turn: c.turn, mySide: sideOf.get(c.id) ?? null })),
        unitTypes: types,
        panelUsers: isAdmin ? (await listPanelUsers()).map((u) => ({ steamId: u.steamId, displayName: u.displayName })) : [],
        defaults: DEFAULT_SETTINGS,
      });
    }

    const state = await loadCurrent(Number(idParam), types);
    if (!state) return NextResponse.json({ error: "Feldzug nicht gefunden" }, { status: 404 });
    const viewer = viewerOf(user, state);
    const typeMap = new Map(types.map((t) => [t.key, t]));
    const intel = viewer.kind === "side" ? await loadIntel(state.campaign.id, viewer.side) : undefined;
    const view = viewFor(state, viewer, typeMap, intel);

    // Namen der Kommandeure (nur die sichtbaren Seiten)
    const names = new Map<string, string>();
    if (view.sides.some((s) => s.commanders.length > 0)) {
      for (const u of await listPanelUsers()) names.set(u.steamId, u.displayName);
    }

    const reports = await loadReports(state.campaign.id, viewer.kind === "side" ? viewer.side : null);
    const sideFilter = viewer.kind === "side" ? viewer.side : null;
    const orders = state.campaign.status === "running" ? await loadOrders(state.campaign.id, state.campaign.turn, sideFilter) : [];
    // Gefechte: nur in Systemen, die die Seite einsehen kann
    const visibleIds = new Set(view.systems.filter((x) => x.owner !== "?").map((x) => x.id));
    const battles = (await loadBattles(state.campaign.id)).filter((b) => !sideFilter || visibleIds.has(b.systemId)).slice(0, 40);
    const shownSides = sideFilter ? [sideFilter] : SIDES;
    return NextResponse.json({
      ...view,
      orders,
      battles: battles.map((b) => ({ ...b, seed: undefined })),
      supply: Object.fromEntries(shownSides.map((side) => [side, { ...incomeOf(state, side), ids: [...suppliedSystems(state, side)] }])),
      sides: view.sides.map((s) => ({ ...s, commanders: s.commanders.map((id) => ({ steamId: id, name: names.get(id) ?? id })) })),
      reports,
      unitTypes: viewer.kind === "side" ? types.filter((t) => t.side === viewer.side) : types,
    });
  } catch (error) {
    return fail(error);
  }
}

/* -------------------------------------------------------------------- */
/* POST                                                                  */
/* -------------------------------------------------------------------- */

const sideSchema = z.enum(["republik", "kus"]);
const sysId = z.string().min(1).max(64);

const unitTypeSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,64}$/, "Schlüssel: a-z, 0-9, _"),
  side: sideSchema,
  category: z.enum(["infantry", "heavy", "armor", "artillery", "ship"]),
  name: z.string().min(1).max(128),
  men: z.number().int().min(1).max(100000),
  cost: z.number().int().min(0).max(1000000),
  buildTurns: z.number().int().min(0).max(50),
  attack: z.number().min(0).max(10000),
  defense: z.number().min(0).max(10000),
  speed: z.number().min(0).max(100000),
  capacity: z.number().int().min(0).max(1000),
  navalClass: z.string().max(64),
  buildAt: z.enum(["hq", "shipyard", "any"]),
  position: z.number().int().min(0).max(10000),
});

const settingsSchema = z.object({
  startPoints: z.number().int().min(0).max(1000000),
  actionsPerTurn: z.number().int().min(1).max(20),
  occupyCostPerTier: z.number().int().min(0).max(100000),
  incomePerTier: z.number().int().min(0).max(100000),
  supplyHop: z.number().min(10).max(5000),
  garrisonType: z.object({ republik: z.string().max(64), kus: z.string().max(64) }),
  defaultBattleMode: z.enum(["ki", "spieler"]),
  routeMajor: z.number().min(0.05).max(1),
  routeMinor: z.number().min(0.05).max(1),
  junctionDist: z.number().min(0).max(500),
  fortifyCost: z.number().int().min(0).max(100000),
  fortMax: z.number().int().min(0).max(10),
  hqBonus: z.number().int().min(0).max(100000),
  traitBonus: z.number().int().min(0).max(100000),
});

const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), name: z.string().min(1).max(128) }),
  z.object({ op: z.literal("unitTypeSave"), unitType: unitTypeSchema }),
  z.object({ op: z.literal("unitTypeDelete"), key: z.string().max(64) }),
  z.object({ op: z.literal("rename"), id: z.number().int(), name: z.string().min(1).max(128) }),
  z.object({ op: z.literal("delete"), id: z.number().int() }),
  z.object({ op: z.literal("setRegion"), id: z.number().int(), systemIds: z.array(sysId).min(2).max(4000) }),
  z.object({ op: z.literal("setHq"), id: z.number().int(), side: sideSchema, systemId: sysId }),
  z.object({ op: z.literal("commanders"), id: z.number().int(), list: z.array(z.object({ steamId: z.string().regex(/^\d{17}$/), side: sideSchema })).max(20) }),
  z.object({ op: z.literal("settings"), id: z.number().int(), settings: settingsSchema }),
  z.object({ op: z.literal("occupy"), id: z.number().int(), side: sideSchema.optional(), systemId: sysId }),
  z.object({ op: z.literal("release"), id: z.number().int(), side: sideSchema.optional(), systemId: sysId }),
  z.object({ op: z.literal("buy"), id: z.number().int(), side: sideSchema.optional(), systemId: sysId, type: z.string().max(64), count: z.number().int().min(1).max(50) }),
  z.object({ op: z.literal("sell"), id: z.number().int(), side: sideSchema.optional(), unitId: z.number().int() }),
  z.object({ op: z.literal("ready"), id: z.number().int(), side: sideSchema.optional(), ready: z.boolean() }),
  z.object({ op: z.literal("start"), id: z.number().int() }),
  z.object({
    op: z.literal("order"),
    id: z.number().int(),
    side: sideSchema.optional(),
    slot: z.number().int().min(1).max(20).optional(),
    order: z.object({
      kind: z.enum(["move", "build", "fortify", "scout", "occupy"]),
      systemId: sysId.optional(),
      to: sysId.optional(),
      unitIds: z.array(z.number().int()).max(500).optional(),
      type: z.string().max(64).optional(),
      count: z.number().int().min(1).max(50).optional(),
    }),
  }),
  z.object({ op: z.literal("orderRemove"), id: z.number().int(), side: sideSchema.optional(), slot: z.number().int() }),
  z.object({ op: z.literal("endTurn"), id: z.number().int(), turn: z.number().int() }),
]);

type Input = z.infer<typeof schema>;

export async function POST(request: Request) {
  let user: PanelUser;
  try {
    user = await requireUser("viewer");
    await ensureFeldzugTables();
  } catch (error) {
    return fail(error);
  }

  let input: Input;
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
    input = parsed.data;
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON" }, { status: 400 });
  }

  try {
    const requireAdmin = () => {
      if (user.role !== "admin") throw new AuthError(403, "Nur für die Spielleitung (Admin)");
    };

    // Ohne Feldzug-Bezug
    if (input.op === "create") {
      requireAdmin();
      const id = await createCampaign(input.name, DEFAULT_SETTINGS);
      await writeAudit({ user, action: "feldzug.create", targetType: "feldzug", targetKey: String(id), after: { name: input.name } });
      return NextResponse.json({ ok: true, id });
    }
    if (input.op === "unitTypeSave") {
      requireAdmin();
      await saveUnitType(input.unitType);
      await writeAudit({ user, action: "feldzug.unittype", targetType: "feldzug_unit", targetKey: input.unitType.key, after: input.unitType });
      return NextResponse.json({ ok: true });
    }
    if (input.op === "unitTypeDelete") {
      requireAdmin();
      const used = await query<{ c: number }>("SELECT COUNT(*) AS c FROM `pd_fz_units` WHERE `type` = ?", [input.key]);
      if (Number(used[0]?.c ?? 0) > 0) throw new RuleError("Typ wird noch von Einheiten benutzt");
      await deleteUnitType(input.key);
      await writeAudit({ user, action: "feldzug.unittype.delete", targetType: "feldzug_unit", targetKey: input.key });
      return NextResponse.json({ ok: true });
    }

    const id = input.id;
    const message = await withLock(id, () => runCampaignOp(user, input, requireAdmin));
    return NextResponse.json({ ok: true, message });
  } catch (error) {
    return fail(error);
  }
}

async function runCampaignOp(user: PanelUser, input: Input, requireAdmin: () => void): Promise<string> {
  if (!("id" in input)) return "";
  const types = await loadUnitTypes();
  const state = await loadCurrent(input.id, types);
  if (!state) throw new RuleError("Feldzug nicht gefunden");
  const c = state.campaign;
  const viewer = viewerOf(user, state);
  const typeMap = new Map(types.map((t) => [t.key, t]));

  /** Seite des Befehls: Kommandeur = eigene Seite, Spielleitung = angegebene */
  const sideFor = (side?: Side): Side => {
    if (viewer.kind === "side") return viewer.side;
    if (!side) throw new RuleError("Seite fehlt");
    return side;
  };
  const audit = (action: string, after: unknown) =>
    writeAudit({ user, action: `feldzug.${action}`, targetType: "feldzug", targetKey: String(c.id), after });
  const garrisonFor = (side: Side, systemId: string) =>
    insertUnit(c.id, {
      side,
      type: c.settings.garrisonType[side],
      systemId,
      strength: 1,
      xp: 0,
      status: "ready",
      readyTurn: 0,
      fleetId: null,
      navalShipId: null,
    });

  switch (input.op) {
    case "rename": {
      requireAdmin();
      c.name = input.name;
      await updateCampaign(c);
      await audit("rename", { name: input.name });
      return "Umbenannt";
    }

    case "delete": {
      requireAdmin();
      await deleteCampaign(c.id);
      await audit("delete", { name: c.name });
      return "Feldzug gelöscht";
    }

    case "setRegion": {
      requireAdmin();
      if (c.status !== "setup") throw new RuleError("Nur in der Aufbauphase");
      const galaxy = await loadGalaxy();
      const wanted = new Set(input.systemIds);
      const picked = galaxy.systems.filter((s) => wanted.has(s.id));
      if (picked.length < 2) throw new RuleError("Mindestens zwei Systeme wählen");

      // Systemwert: Himmelskörper und Nähe zu einer Hauptroute (20 pc)
      const bodyRows = await query<{ system_id: string; n: number }>(
        "SELECT `system_id`, COUNT(*) AS n FROM `pd_naval_bodies` GROUP BY `system_id`",
      );
      const bodies = new Map(bodyRows.map((r) => [r.system_id, Number(r.n)]));
      const cell = 20;
      const majorCells = new Set<string>();
      for (const r of galaxy.routes) {
        if (!r.major) continue;
        for (const line of r.lines) {
          for (let i = 0; i < line.length; i++) {
            const [ax, ay] = line[i];
            const [bx, by] = line[i + 1] ?? line[i];
            const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / cell));
            for (let k = 0; k <= steps; k++) {
              const x = ax + ((bx - ax) * k) / steps;
              const y = ay + ((by - ay) * k) / steps;
              majorCells.add(`${Math.floor(x / cell)}:${Math.floor(y / cell)}`);
            }
          }
        }
      }
      const nearMajor = (x: number, y: number) => {
        const cx = Math.floor(x / cell);
        const cy = Math.floor(y / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (majorCells.has(`${cx + dx}:${cy + dy}`)) return true;
        return false;
      };

      await execute("DELETE FROM `pd_fz_units` WHERE `campaign_id` = ?", [c.id]);
      await setRegion(
        c.id,
        picked.map((s) => ({ id: s.id, ...systemTier(s.name, bodies.get(s.id) ?? 0, nearMajor(s.x, s.y)) })),
      );
      c.hq = { republik: "", kus: "" };
      c.points = { republik: c.settings.startPoints, kus: c.settings.startPoints };
      c.ready = { republik: false, kus: false };
      await updateCampaign(c);
      const fresh = (await loadState(c.id))!;
      await rebuildGraph(fresh, types);
      await audit("region", { systems: picked.length });
      return `Gebiet mit ${picked.length} Systemen übernommen (HQs und Käufe zurückgesetzt)`;
    }

    case "setHq": {
      requireAdmin();
      if (c.status !== "setup") throw new RuleError("Nur in der Aufbauphase");
      const sys = state.systems.get(input.systemId);
      if (!sys) throw new RuleError("System gehört nicht zum Feldzuggebiet");
      if (sys.owner && sys.owner !== input.side) throw new RuleError("System gehört der Gegenseite");
      // Seite neu aufsetzen: alle Systeme und Einheiten zurück, volle Punkte
      for (const s of state.systems.values()) {
        if (s.owner === input.side) {
          s.owner = null;
          s.fort = 0;
          await saveSystem(c.id, s);
        }
      }
      for (const u of state.units) if (u.side === input.side) await deleteUnit(u.id);
      sys.owner = input.side;
      sys.fort = 2;
      await saveSystem(c.id, sys);
      await garrisonFor(input.side, sys.id);
      c.hq[input.side] = sys.id;
      c.points[input.side] = c.settings.startPoints;
      c.ready[input.side] = false;
      await updateCampaign(c);
      await addReport(c.id, c.turn, input.side, "setup", `Hauptquartier: ${sys.name}. Startpunkte: ${c.settings.startPoints}.`);
      await audit("hq", { side: input.side, systemId: sys.id });
      return `HQ ${SIDE_NAME[input.side]}: ${sys.name}`;
    }

    case "commanders": {
      requireAdmin();
      await setCommanders(c.id, input.list);
      await audit("commanders", input.list);
      return "Kommandeure gespeichert";
    }

    case "settings": {
      requireAdmin();
      const s = input.settings;
      for (const side of SIDES) {
        const t = typeMap.get(s.garrisonType[side]);
        if (!t || t.side !== side) throw new RuleError(`Garnisonstyp für ${SIDE_NAME[side]} unbekannt`);
      }
      const routingChanged =
        s.supplyHop !== c.settings.supplyHop || s.routeMajor !== c.settings.routeMajor || s.routeMinor !== c.settings.routeMinor || s.junctionDist !== c.settings.junctionDist;
      // Startpunkte: in der Aufbauphase die Differenz gutschreiben
      if (c.status === "setup") for (const side of SIDES) c.points[side] += s.startPoints - c.settings.startPoints;
      c.settings = s;
      await updateCampaign(c);
      if (routingChanged && state.systems.size > 0) await rebuildGraph(state, types);
      await audit("settings", s);
      return routingChanged ? "Einstellungen gespeichert, Sprungnetz neu berechnet" : "Einstellungen gespeichert";
    }

    case "occupy": {
      const side = sideFor(input.side);
      const { sys, cost } = checkOccupy(state, side, input.systemId);
      sys.owner = side;
      await saveSystem(c.id, sys);
      await garrisonFor(side, sys.id);
      c.points[side] -= cost;
      c.ready[side] = false;
      await updateCampaign(c);
      await addReport(c.id, c.turn, side, "setup", `${sys.name} besetzt (${cost} Punkte), Garnison stationiert.`);
      return `${sys.name} besetzt (−${cost})`;
    }

    case "release": {
      const side = sideFor(input.side);
      const { sys, refund, units } = checkRelease(state, side, input.systemId);
      for (const u of units) await deleteUnit(u.id);
      sys.owner = null;
      sys.fort = 0;
      await saveSystem(c.id, sys);
      c.points[side] += refund;
      c.ready[side] = false;
      await updateCampaign(c);
      return `${sys.name} aufgegeben (+${refund})`;
    }

    case "buy": {
      const side = sideFor(input.side);
      const type = typeMap.get(input.type);
      const cost = checkBuy(state, side, type, input.systemId, input.count);
      for (let i = 0; i < input.count; i++) {
        await insertUnit(c.id, { side, type: type!.key, systemId: input.systemId, strength: 1, xp: 0, status: "ready", readyTurn: 0, fleetId: null, navalShipId: null });
      }
      c.points[side] -= cost;
      c.ready[side] = false;
      await updateCampaign(c);
      const where = state.systems.get(input.systemId)?.name ?? input.systemId;
      await addReport(c.id, c.turn, side, "setup", `${input.count}× ${type!.name} in ${where} aufgestellt (${cost} Punkte).`);
      return `${input.count}× ${type!.name} gekauft (−${cost})`;
    }

    case "sell": {
      const side = sideFor(input.side);
      const unit = state.units.find((u) => u.id === input.unitId);
      const refund = checkSell(state, side, unit, typeMap);
      await deleteUnit(unit!.id);
      c.points[side] += refund;
      c.ready[side] = false;
      await updateCampaign(c);
      return `Einheit aufgelöst (+${refund})`;
    }

    case "ready": {
      const side = sideFor(input.side);
      c.ready[side] = input.ready;
      await updateCampaign(c);
      return input.ready ? "Bereit gemeldet" : "Bereit zurückgenommen";
    }

    case "start": {
      requireAdmin();
      if (c.status !== "setup") throw new RuleError("Feldzug läuft bereits");
      for (const side of SIDES) if (!c.hq[side]) throw new RuleError(`HQ für ${SIDE_NAME[side]} fehlt`);
      c.status = "running";
      c.turn = 1;
      c.ready = { republik: false, kus: false };
      await updateCampaign(c);
      for (const side of SIDES) {
        await addReport(c.id, 1, side, "turn", "Der Feldzug beginnt. Zug 1.");
        await recordIntel(state, side, visibleSystems(state, side), 1);
      }
      await audit("start", { turn: 1 });
      return "Feldzug gestartet - Zug 1";
    }

    case "order": {
      const side = sideFor(input.side);
      const existing = await loadOrders(c.id, c.turn, side);
      let others = existing.filter((o) => o.slot !== input.slot);
      let slot = input.slot;
      // Umleiten: gewählte Einheiten verlassen ihren bisherigen Bewegungsbefehl.
      // Ein Befehl, der dabei leer wird, wird ersetzt (sein Platz wird frei).
      const changed: Order[] = [];
      const freed: number[] = [];
      if (input.order.kind === "move" && input.order.unitIds?.length) {
        const moving = new Set(input.order.unitIds);
        const kept: Order[] = [];
        for (const o of others) {
          const ids = (o.data.unitIds as number[] | undefined) ?? [];
          if (o.kind !== "move" || !ids.some((id) => moving.has(id))) {
            kept.push(o);
            continue;
          }
          const rest = ids.filter((id) => !moving.has(id));
          if (rest.length === 0) freed.push(o.slot);
          else {
            const n = { ...o, data: { ...o.data, unitIds: rest, label: `${rest.length} Einheit(en) ${String(o.data.label ?? "").replace(/^d+ Einheit(en) /, "")}` } };
            changed.push(n);
            kept.push(n);
          }
        }
        others = kept;
        if (!slot && freed.length > 0) slot = Math.min(...freed);
      }
      if (!slot) {
        const used = new Set(others.map((o) => o.slot));
        slot = 1;
        while (used.has(slot)) slot++;
      }
      if (slot > c.settings.actionsPerTurn) throw new RuleError(`Nur ${c.settings.actionsPerTurn} Aktionen je Zug`);
      const v = validateOrder(state, side, input.order, others, typeMap);
      for (const o of changed) await saveOrder(c.id, c.turn, o);
      for (const fs of freed) if (fs !== slot) await deleteOrder(c.id, c.turn, side, fs);
      await saveOrder(c.id, c.turn, { side, slot, kind: v.kind, data: { ...v.data, label: v.label }, result: "" });
      if (c.ready[side]) {
        c.ready[side] = false;
        await updateCampaign(c);
      }
      return `Aktion ${slot}: ${v.label}`;
    }

    case "orderRemove": {
      const side = sideFor(input.side);
      if (c.status !== "running") throw new RuleError("Der Feldzug läuft nicht");
      await deleteOrder(c.id, c.turn, side, input.slot);
      if (c.ready[side]) {
        c.ready[side] = false;
        await updateCampaign(c);
      }
      return "Aktion entfernt";
    }

    case "endTurn": {
      requireAdmin();
      if (c.status !== "running") throw new RuleError("Der Feldzug läuft nicht");
      // Schutz gegen doppeltes Klicken / veraltete Ansicht
      if (input.turn !== c.turn) throw new RuleError(`Zug ${input.turn} ist schon ausgewertet`);
      const orders = await loadOrders(c.id, c.turn, null);
      // Punkte je Seite: geplante Kosten dürfen den Stand nicht übersteigen (wurde beim Eintragen geprüft)
      for (const side of SIDES) {
        const planned = orders.filter((o) => o.side === side).reduce((a, o) => a + orderCost(o), 0);
        if (planned > c.points[side]) throw new RuleError(`${SIDE_NAME[side]}: geplante Kosten übersteigen die Punkte`);
      }
      const turn = c.turn;
      await resolveTurn(state, orders, typeMap);
      await audit("endTurn", { turn, orders: orders.length });
      return `Zug ${turn} ausgewertet - jetzt Zug ${c.turn}`;
    }

    default:
      return "";
  }
}
