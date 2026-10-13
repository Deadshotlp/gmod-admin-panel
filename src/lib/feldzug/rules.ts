/**
 * Galaktischer Feldzug - Regeln für Aufbau und Sicht (Nebel des Krieges).
 *
 * Alles, was ein Kommandeur zu sehen bekommt, läuft durch viewFor(): eigene
 * Systeme und Einheiten vollständig, Besitzer fremder Systeme nur in
 * Reichweite (supplyHop) eigener Systeme, gegnerische Einheiten nur dort, wo
 * eigene Einheiten stehen. Geplante Züge der Gegenseite nie.
 */

import type { CampaignState, Intel } from "./db";
import { hopCost } from "./routing";
import { KNOWN_TRAITS, SIDES } from "./types";
import type { CampaignSystem, Side, Unit, UnitType } from "./types";

export class RuleError extends Error {}

/** Wert eines Systems (1-5): Himmelskörper, Lage an Hauptrouten, Besonderheiten */
export function systemTier(name: string, bodies: number, nearMajor: boolean): { tier: number; traits: string[] } {
  const traits = KNOWN_TRAITS[name.trim().toLowerCase()] ?? [];
  let tier = 1 + Math.min(2, Math.floor(bodies / 4)) + (nearMajor ? 1 : 0) + (traits.length > 0 ? 1 : 0);
  if (traits.includes("capital")) tier = 5;
  return { tier: Math.max(1, Math.min(5, tier)), traits };
}

export const otherSide = (side: Side): Side => (side === "republik" ? "kus" : "republik");

export function occupyCost(state: CampaignState, sys: CampaignSystem): number {
  return sys.tier * state.campaign.settings.occupyCostPerTier;
}

/** Erreichbar über einen Sprung bis supplyHop von einem eigenen System */
export function connectedToSide(state: CampaignState, side: Side, systemId: string): boolean {
  const max = state.campaign.settings.supplyHop;
  for (const s of state.systems.values()) {
    if (s.owner === side && hopCost(state.graph, s.id, systemId) <= max) return true;
  }
  return false;
}

function requireSetup(state: CampaignState) {
  if (state.campaign.status !== "setup") throw new RuleError("Nur in der Aufbauphase möglich");
}

function requireSystem(state: CampaignState, systemId: string): CampaignSystem {
  const sys = state.systems.get(systemId);
  if (!sys) throw new RuleError("System gehört nicht zum Feldzuggebiet");
  return sys;
}

/** Aufbau: neutrales System besetzen (Garnison kommt automatisch dazu) */
export function checkOccupy(state: CampaignState, side: Side, systemId: string): { sys: CampaignSystem; cost: number } {
  requireSetup(state);
  if (!state.campaign.hq[side]) throw new RuleError("Erst das Hauptquartier festlegen");
  const sys = requireSystem(state, systemId);
  if (sys.owner) throw new RuleError("System ist bereits besetzt");
  if (!connectedToSide(state, side, systemId)) throw new RuleError("Nicht mit eigenen Systemen verbunden (Sprungweite zu groß)");
  const cost = occupyCost(state, sys);
  if (state.campaign.points[side] < cost) throw new RuleError(`Zu wenig Punkte (${cost} benötigt)`);
  return { sys, cost };
}

/** Aufbau: eigenes System wieder aufgeben (nur mit Garnison allein) */
export function checkRelease(state: CampaignState, side: Side, systemId: string): { sys: CampaignSystem; refund: number; units: Unit[] } {
  requireSetup(state);
  const sys = requireSystem(state, systemId);
  if (sys.owner !== side) throw new RuleError("Kein eigenes System");
  if (state.campaign.hq[side] === systemId) throw new RuleError("Das Hauptquartier kann nicht aufgegeben werden");
  const units = state.units.filter((u) => u.systemId === systemId && u.side === side);
  const garrison = state.campaign.settings.garrisonType[side];
  if (units.some((u) => u.type !== garrison) || units.length > 1) throw new RuleError("Erst die gekauften Einheiten dort auflösen");
  return { sys, refund: occupyCost(state, sys), units };
}

/** Wo eine Einheit gebaut bzw. im Aufbau aufgestellt werden darf */
export function canBuildAt(state: CampaignState, side: Side, type: UnitType, sys: CampaignSystem): boolean {
  if (sys.owner !== side) return false;
  // "none": nicht kaufbar (Spielerlegion wird beim Start aufgestellt)
  if (type.buildAt === "none") return false;
  const isHq = state.campaign.hq[side] === sys.id;
  if (type.buildAt === "any") return true;
  if (type.buildAt === "shipyard") return isHq || sys.traits.includes("shipyard");
  // "hq": Hauptquartier, Klon- bzw. Droidenfabrikwelten
  return isHq || sys.traits.includes("clones") || sys.traits.includes("foundry");
}

export function checkBuy(state: CampaignState, side: Side, type: UnitType | undefined, systemId: string, count: number): number {
  requireSetup(state);
  if (!type || type.side !== side) throw new RuleError("Unbekannter Einheitentyp");
  const sys = requireSystem(state, systemId);
  if (!canBuildAt(state, side, type, sys)) {
    throw new RuleError(type.buildAt === "none" ? "Nicht kaufbar" : type.category === "ship" ? "Schiffe nur am Hauptquartier oder an Werften" : "Nur am Hauptquartier oder an Fabrikwelten");
  }
  const cost = type.cost * count;
  if (state.campaign.points[side] < cost) throw new RuleError(`Zu wenig Punkte (${cost} benötigt)`);
  return cost;
}

/** Aufbau: Einheit auflösen, volle Erstattung - die letzte Garnison eines Systems bleibt (kostenlos) */
export function checkSell(state: CampaignState, side: Side, unit: Unit | undefined, types: Map<string, UnitType>): number {
  requireSetup(state);
  if (!unit || unit.side !== side) throw new RuleError("Einheit nicht gefunden");
  const garrison = state.campaign.settings.garrisonType[side];
  if (unit.type === garrison) {
    const same = state.units.filter((u) => u.side === side && u.systemId === unit.systemId && u.type === garrison);
    if (same.length <= 1) throw new RuleError("Die Garnison des Systems bleibt stehen");
  }
  return types.get(unit.type)?.cost ?? 0;
}

/* -------------------------------------------------------------------- */
/* Sicht                                                                 */
/* -------------------------------------------------------------------- */

export type Viewer = { kind: "admin" } | { kind: "side"; side: Side };

/** Was eine Seite über ein System weiß */
export interface Knowledge {
  owner: Side | null;
  /** sicht = jetzt eingesehen, bericht = früher gesehen/aufgeklärt, annahme = abgeleitet */
  source: "sicht" | "bericht" | "annahme";
  turn: number;
}

export interface ViewSystem {
  id: string;
  name: string;
  x: number;
  y: number;
  tier: number;
  traits: string[];
  /** null = neutral, "?" = unbekannt */
  owner: Side | null | "?";
  fort: number | null;
  contested: boolean;
  hq: Side | null;
  /** Für die Seite: in Reichweite eines eigenen Systems (Besetzen möglich) */
  reachable: boolean;
  /** Lagebild der Seite (Frontlinie); bei der Spielleitung die Wahrheit */
  known: Knowledge | null;
}

export interface ViewUnit extends Unit {
  name: string;
  category: string;
  men: number;
}

/** Systeme, die eine Seite gerade einsieht (eigene, Nachbarn bis supplyHop, Orte eigener Truppen) */
export function visibleSystems(state: CampaignState, side: Side): Set<string> {
  const max = state.campaign.settings.supplyHop;
  const out = new Set<string>();
  for (const s of state.systems.values()) {
    if (s.owner !== side) continue;
    out.add(s.id);
    for (const [n, w] of state.graph[s.id] ?? []) if (w <= max) out.add(n);
  }
  for (const u of state.units) if (u.side === side) out.add(u.systemId);
  return out;
}

/** Kürzeste Wege vom Startsystem (Vorgänger je System), Sprünge bis maxStep */
function shortestTree(state: CampaignState, from: string, maxStep: number): Map<string, string> {
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open: Array<[string, number]> = [[from, 0]];
  const done = new Set<string>();
  while (open.length > 0) {
    // kleine Gebiete: lineare Suche reicht
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][1] < open[bi][1]) bi = i;
    const [id, d] = open.splice(bi, 1)[0];
    if (done.has(id)) continue;
    done.add(id);
    for (const [n, w] of state.graph[id] ?? []) {
      if (w > maxStep || !state.systems.has(n)) continue;
      const nd = d + w;
      if (nd < (dist.get(n) ?? Infinity)) {
        dist.set(n, nd);
        prev.set(n, id);
        open.push([n, nd]);
      }
    }
  }
  return prev;
}

/**
 * Lagebild einer Seite: Sicht und Berichte, dazu die Annahme, dass alle
 * Systeme auf dem Weg vom gegnerischen HQ zu einer bestätigt feindlichen
 * Welt ebenfalls feindlich sind (sonst entstünden Scheininseln in der
 * Frontlinie).
 */
export function knowledgeFor(state: CampaignState, side: Side, intel: Intel): Map<string, Knowledge> {
  const c = state.campaign;
  const out = new Map<string, Knowledge>();
  const visible = visibleSystems(state, side);
  for (const s of state.systems.values()) {
    if (visible.has(s.id)) out.set(s.id, { owner: s.owner, source: "sicht", turn: c.turn });
    else {
      const i = intel.get(s.id);
      if (i) out.set(s.id, { owner: i.owner, source: "bericht", turn: i.turn });
    }
  }

  const enemy = otherSide(side);
  const enemyHq = c.hq[enemy];
  if (!enemyHq || !state.systems.has(enemyHq)) return out;
  if (!out.has(enemyHq)) out.set(enemyHq, { owner: enemy, source: "annahme", turn: c.turn });

  const confirmed = [...out.entries()].filter(([, k]) => k.owner === enemy && k.source !== "annahme").map(([id]) => id);
  if (confirmed.length === 0) return out;
  // Erst entlang der Nachschubweite, sonst über beliebige Sprünge
  const near = shortestTree(state, enemyHq, c.settings.supplyHop);
  const far = shortestTree(state, enemyHq, Infinity);
  for (const target of confirmed) {
    const prev = near.has(target) ? near : far;
    let id = prev.get(target);
    let guard = 0;
    while (id && id !== enemyHq && guard++ < 500) {
      if (!out.has(id)) out.set(id, { owner: enemy, source: "annahme", turn: c.turn });
      id = prev.get(id);
    }
  }
  return out;
}

export function viewFor(state: CampaignState, viewer: Viewer, types: Map<string, UnitType>, intel?: Intel) {
  const c = state.campaign;
  const own = viewer.kind === "side" ? viewer.side : null;
  const max = c.settings.supplyHop;

  const visible = own ? visibleSystems(state, own) : null;
  const presence = new Set(state.units.filter((u) => u.side === own).map((u) => u.systemId));
  // Besetzbar: neutral und in Reichweite eines eigenen Systems
  const near = new Set<string>();
  if (own) {
    for (const s of state.systems.values()) {
      if (s.owner !== own) continue;
      for (const [n, w] of state.graph[s.id] ?? []) if (w <= max) near.add(n);
    }
  }
  const knowledge = own ? knowledgeFor(state, own, intel ?? new Map()) : null;

  const systems: ViewSystem[] = [...state.systems.values()].map((s) => {
    const seen = !visible || visible.has(s.id);
    // Hauptquartiere beider Seiten sind bekannt
    const hq = SIDES.find((side) => c.hq[side] === s.id) ?? null;
    return {
      id: s.id,
      name: s.name,
      x: s.x,
      y: s.y,
      tier: s.tier,
      traits: s.traits,
      owner: seen ? s.owner : "?",
      fort: !own || s.owner === own ? s.fort : null,
      contested: seen && s.contested,
      hq,
      reachable: !!own && !s.owner && near.has(s.id),
      known: knowledge ? knowledge.get(s.id) ?? null : { owner: s.owner, source: "sicht", turn: c.turn },
    };
  });

  const units: ViewUnit[] = state.units
    .filter((u) => !own || u.side === own || presence.has(u.systemId))
    .map((u) => {
      const t = types.get(u.type);
      const enemy = own && u.side !== own;
      return {
        ...u,
        // Beim Gegner keine Erfahrung, Zustand und Naval-Verknüpfung
        xp: enemy ? 0 : u.xp,
        readyTurn: enemy ? 0 : u.readyTurn,
        navalShipId: enemy ? null : u.navalShipId,
        fleetId: enemy ? null : u.fleetId,
        name: t?.name ?? u.type,
        category: t?.category ?? "",
        men: t?.men ?? 0,
      };
    });

  const sideInfo = (side: Side) => ({
    side,
    points: c.points[side],
    ready: c.ready[side],
    hq: c.hq[side],
    systems: [...state.systems.values()].filter((s) => s.owner === side).length,
    commanders: state.commanders.filter((m) => m.side === side).map((m) => m.steamId),
  });

  return {
    viewer,
    campaign: { id: c.id, name: c.name, status: c.status, turn: c.turn, settings: c.settings },
    sides: own ? [sideInfo(own)] : SIDES.map(sideInfo),
    systems,
    units,
  };
}

export type FeldzugView = ReturnType<typeof viewFor>;
