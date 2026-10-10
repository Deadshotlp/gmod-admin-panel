/**
 * Galaktischer Feldzug - Regeln für Aufbau und Sicht (Nebel des Krieges).
 *
 * Alles, was ein Kommandeur zu sehen bekommt, läuft durch viewFor(): eigene
 * Systeme und Einheiten vollständig, Besitzer fremder Systeme nur in
 * Reichweite (supplyHop) eigener Systeme, gegnerische Einheiten nur dort, wo
 * eigene Einheiten stehen. Geplante Züge der Gegenseite nie.
 */

import type { CampaignState } from "./db";
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
    throw new RuleError(type.category === "ship" ? "Schiffe nur am Hauptquartier oder an Werften" : "Nur am Hauptquartier oder an Fabrikwelten");
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
}

export interface ViewUnit extends Unit {
  name: string;
  category: string;
  men: number;
}

export function viewFor(state: CampaignState, viewer: Viewer, types: Map<string, UnitType>) {
  const c = state.campaign;
  const own = viewer.kind === "side" ? viewer.side : null;
  const max = c.settings.supplyHop;

  // Systeme mit eigenen Einheiten (dort sieht man auch den Gegner)
  const presence = new Set<string>();
  if (own) for (const u of state.units) if (u.side === own) presence.add(u.systemId);

  const ownedIds = own ? [...state.systems.values()].filter((s) => s.owner === own).map((s) => s.id) : [];
  const near = new Set<string>(ownedIds);
  for (const id of ownedIds) for (const [n, w] of state.graph[id] ?? []) if (w <= max) near.add(n);

  const systems: ViewSystem[] = [...state.systems.values()].map((s) => {
    const visible = !own || near.has(s.id) || presence.has(s.id);
    const hq = SIDES.find((side) => c.hq[side] === s.id) ?? null;
    return {
      id: s.id,
      name: s.name,
      x: s.x,
      y: s.y,
      tier: s.tier,
      traits: s.traits,
      owner: visible ? s.owner : "?",
      fort: !own || s.owner === own ? s.fort : null,
      contested: visible && s.contested,
      hq: hq && (!own || hq === own || visible) ? hq : null,
      reachable: !!own && !s.owner && near.has(s.id),
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
