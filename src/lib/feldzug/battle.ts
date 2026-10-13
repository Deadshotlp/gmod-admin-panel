/**
 * Galaktischer Feldzug - Gefechte (Paket 3).
 *
 * Ein Gefecht entsteht beim Zugende (turn.ts, Lage je System) und wird beim
 * naechsten Zugende entschieden - dazwischen kann die Spielleitung es auf
 * "Spieler" stellen (Ergebnis wird dann eingetragen) oder sofort simulieren.
 *
 * Simulation (Modus "ki"): Runden; je Runde verteilt jede Seite Schaden
 * (Summe Angriff x Staerke x Modifikatoren x Zufall 0,85-1,15) auf die Gegner
 * nach deren Anteil an der Staerke, geteilt durch deren Verteidigung. Eine
 * Seite bricht unter 50 % ihrer Anfangsstaerke; nach 6 Runden verliert die
 * mit dem kleineren Rest (Gleichstand: Verteidiger). Der Zufall haengt am
 * gespeicherten Startwert - gleiche Eingabe, gleiches Ergebnis.
 *
 * Folgen: Verluste bleiben (Staerke), unter 10 % ist eine Einheit vernichtet.
 * Der Verlierer zieht sich ins naechste eigene System zurueck (weitere 10 %
 * Verlust); gibt es keins, ist er verloren. Gewinnt der Angreifer einen
 * Bodenkampf, nimmt er das System ein. Verliert eine Seite die Raumschlacht
 * ohne ueberlebende Schiffe, gehen ihre Truppen an Bord mit unter.
 */

import { saveBattle } from "./db";
import type { Battle, CampaignState } from "./db";
import { pathCost } from "./routing";
import { otherSide } from "./rules";
import { SIDES, SIDE_NAME } from "./types";
import type { Side, Unit, UnitType } from "./types";

const K = 0.12;
const MAX_ROUNDS = 6;
const BREAK_AT = 0.5;
const DESTROYED_BELOW = 0.1;

/** Deterministischer Zufall (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Fighter {
  unit: Unit;
  attack: number;
  defense: number;
  start: number;
}

export interface BattleMods {
  attack: Record<Side, number>;
  defense: Record<Side, number>;
  notes: string[];
}

export interface BattleResult {
  winner: Side;
  attacker: Side;
  defender: Side;
  mode: "ki" | "spieler";
  rounds: Array<Record<Side, number>>;
  before: Record<Side, { units: number; men: number; ships: number }>;
  losses: Record<Side, number>;
  mods?: string[];
  destroyed: Record<Side, number>;
  retreatedTo: Partial<Record<Side, string | null>>;
  lostAboard?: Partial<Record<Side, number>>;
  captured?: boolean;
  cancelled?: string;
  text: string;
}

export interface BattleContext {
  notes: Record<Side, string[]>;
  changedUnits: Set<number>;
  changedSystems: Set<string>;
  removedUnits: Set<number>;
}

export function newContext(): BattleContext {
  return { notes: { republik: [], kus: [] }, changedUnits: new Set(), changedSystems: new Set(), removedUnits: new Set() };
}

const isShip = (types: Map<string, UnitType>, u: Unit) => types.get(u.type)?.category === "ship";

/** Teilnehmer eines Gefechts je Seite */
function participants(state: CampaignState, b: Battle, types: Map<string, UnitType>): Record<Side, Unit[]> {
  const here = state.units.filter((u) => u.systemId === b.systemId && u.strength > 0);
  const pick = (s: Side) =>
    here.filter((u) => u.side === s && (b.kind === "space" ? isShip(types, u) : !isShip(types, u) && u.status !== "orbit"));
  return { republik: pick("republik"), kus: pick("kus") };
}

/** Modifikatoren: Verteidiger, Befestigung (Boden), Nachschub */
function modifiers(state: CampaignState, b: Battle, defender: Side, supplied: Record<Side, Set<string>>): BattleMods {
  const sys = state.systems.get(b.systemId);
  const mods: BattleMods = { attack: { republik: 1, kus: 1 }, defense: { republik: 1, kus: 1 }, notes: [] };

  const defBonus = b.kind === "ground" ? 1.15 : 1.05;
  mods.defense[defender] *= defBonus;
  mods.notes.push(`Verteidiger ${SIDE_NAME[defender]} +${Math.round((defBonus - 1) * 100)} %`);

  if (b.kind === "ground" && sys && sys.owner === defender && sys.fort > 0) {
    mods.defense[defender] *= 1 + 0.15 * sys.fort;
    mods.notes.push(`Befestigung ${sys.fort}: +${sys.fort * 15} % Verteidigung`);
  }

  // Ohne Nachschub: in Reichweite eines versorgten eigenen Systems?
  const max = state.campaign.settings.supplyHop;
  for (const s of SIDES) {
    const ok = [...supplied[s]].some((id) => id === b.systemId || (state.graph[id] ?? []).some(([n, w]) => n === b.systemId && w <= max));
    if (!ok) {
      mods.attack[s] *= 0.85;
      mods.notes.push(`${SIDE_NAME[s]} ohne Nachschub -15 % Angriff`);
    }
  }

  return mods;
}

function fighters(units: Unit[], types: Map<string, UnitType>): Fighter[] {
  return units.map((u) => {
    const t = types.get(u.type);
    const xp = 1 + Math.min(u.xp, 100) / 500;
    return { unit: u, attack: (t?.attack ?? 5) * xp, defense: Math.max(1, (t?.defense ?? 5) * xp), start: u.strength };
  });
}

const total = (fs: Fighter[]) => fs.reduce((a, f) => a + f.unit.strength, 0);

/** Runden ausspielen (veraendert die Staerke der Einheiten) */
function simulate(
  sides: Record<Side, Fighter[]>,
  mods: BattleMods,
  defender: Side,
  seed: number,
): { winner: Side; rounds: Array<Record<Side, number>> } {
  const rand = rng(seed);
  const start: Record<Side, number> = { republik: total(sides.republik), kus: total(sides.kus) };
  const rounds: Array<Record<Side, number>> = [];

  for (let r = 0; r < MAX_ROUNDS; r++) {
    const dmg: Record<Side, number> = { republik: 0, kus: 0 };
    for (const s of SIDES) {
      const power = sides[s].reduce((a, f) => a + f.attack * f.unit.strength, 0) * mods.attack[s];
      dmg[otherSide(s)] = power * K * (0.85 + rand() * 0.3);
    }

    for (const s of SIDES) {
      const tot = total(sides[s]);
      if (tot <= 0) continue;
      for (const f of sides[s]) {
        const share = dmg[s] * (f.unit.strength / tot);
        f.unit.strength = Math.max(0, f.unit.strength - share / (f.defense * mods.defense[s]));
      }
    }

    const ratio: Record<Side, number> = {
      republik: start.republik > 0 ? total(sides.republik) / start.republik : 0,
      kus: start.kus > 0 ? total(sides.kus) / start.kus : 0,
    };
    rounds.push({ republik: Math.round(ratio.republik * 100), kus: Math.round(ratio.kus * 100) });

    const broken = SIDES.filter((s) => ratio[s] < BREAK_AT);
    if (broken.length === 1) return { winner: otherSide(broken[0]), rounds };
    if (broken.length === 2) {
      return { winner: ratio.republik === ratio.kus ? defender : ratio.republik > ratio.kus ? "republik" : "kus", rounds };
    }
  }

  const last = rounds[rounds.length - 1] ?? { republik: 100, kus: 100 };
  const winner = last.republik === last.kus ? defender : last.republik > last.kus ? "republik" : "kus";
  return { winner, rounds };
}

/** Naechstes eigenes System fuer den Rueckzug (ueber das Sprungnetz) */
function retreatTarget(state: CampaignState, side: Side, from: string): string | null {
  let best: string | null = null;
  let bestCost = Infinity;
  for (const s of state.systems.values()) {
    if (s.owner !== side || s.id === from || s.contested) continue;
    const p = pathCost(state.graph, from, s.id, Infinity);
    if (p && p.cost < bestCost) {
      bestCost = p.cost;
      best = s.id;
    }
  }
  return best;
}

function summary(units: Unit[], types: Map<string, UnitType>) {
  return {
    units: units.length,
    men: Math.round(units.filter((u) => !isShip(types, u)).reduce((a, u) => a + (types.get(u.type)?.men ?? 0) * u.strength, 0)),
    ships: units.filter((u) => isShip(types, u)).length,
  };
}

/**
 * Gefecht entscheiden: simulieren (manual leer) oder mit eingetragenem
 * Ergebnis (Spieler-Modus: Sieger und Verlust in Prozent je Seite).
 */
export async function decideBattle(
  state: CampaignState,
  b: Battle,
  types: Map<string, UnitType>,
  supplied: Record<Side, Set<string>>,
  ctx: BattleContext,
  manual?: { winner: Side; losses: Record<Side, number> },
): Promise<BattleResult> {
  const sys = state.systems.get(b.systemId);
  const name = sys?.name ?? b.systemId;
  const attacker = b.attacker;
  const defender = otherSide(attacker);
  const kindName = b.kind === "space" ? "Raumschlacht" : "Bodenkampf";
  const units = participants(state, b, types);
  const before = { republik: summary(units.republik, types), kus: summary(units.kus, types) };

  const finish = async (res: BattleResult) => {
    b.status = "done";
    b.result = res as unknown as Record<string, unknown>;
    await saveBattle(b);
    return res;
  };

  // Eine Seite ist gar nicht (mehr) da: kein Gefecht
  const missing = SIDES.filter((s) => units[s].length === 0);
  if (missing.length > 0 && !manual) {
    const winner: Side = missing.length === 2 ? defender : otherSide(missing[0]);
    const text = `${kindName} um ${name} entfiel - ${missing.map((s) => SIDE_NAME[s]).join(" und ")} nicht mehr vor Ort.`;
    for (const s of SIDES) ctx.notes[s].push(text);
    return finish({
      winner, attacker, defender, mode: b.mode, rounds: [], before, losses: { republik: 0, kus: 0 },
      destroyed: { republik: 0, kus: 0 }, retreatedTo: {}, cancelled: "abwesend", text,
    });
  }

  const startStrength = new Map<number, number>();
  for (const s of SIDES) for (const u of units[s]) startStrength.set(u.id, u.strength);

  let winner: Side;
  let rounds: Array<Record<Side, number>> = [];
  let modNotes: string[] | undefined;

  if (manual) {
    winner = manual.winner;
    for (const s of SIDES) {
      const keep = 1 - Math.min(Math.max(manual.losses[s], 0), 100) / 100;
      for (const u of units[s]) u.strength = u.strength * keep;
    }
  } else {
    const mods = modifiers(state, b, defender, supplied);
    modNotes = mods.notes;
    const sim = simulate({ republik: fighters(units.republik, types), kus: fighters(units.kus, types) }, mods, defender, b.seed || 1);
    winner = sim.winner;
    rounds = sim.rounds;
  }

  const loser = otherSide(winner);
  const losses: Record<Side, number> = { republik: 0, kus: 0 };
  for (const s of SIDES) {
    const st = units[s].reduce((a, u) => a + (startStrength.get(u.id) ?? 0), 0);
    const now = units[s].reduce((a, u) => a + u.strength, 0);
    losses[s] = st > 0 ? Math.round((1 - now / st) * 100) : 0;
  }

  // Erfahrung fuer Ueberlebende
  for (const s of SIDES) for (const u of units[s]) u.xp = Math.min(100, u.xp + (s === winner ? 10 : 5));

  // Rueckzug des Verlierers
  const retreatedTo: Partial<Record<Side, string | null>> = {};
  const lostAboard: Partial<Record<Side, number>> = {};
  const target = retreatTarget(state, loser, b.systemId);
  const retreating = units[loser].filter((u) => u.strength >= DESTROYED_BELOW);

  if (b.kind === "space") {
    // Truppen an Bord (im Orbit) ziehen mit den Schiffen ab - ohne Schiffe gehen sie unter
    const aboard = state.units.filter((u) => u.side === loser && u.systemId === b.systemId && u.status === "orbit" && u.strength > 0);
    if (retreating.length === 0 || !target) {
      for (const u of aboard) u.strength = 0;
      if (aboard.length > 0) lostAboard[loser] = aboard.length;
    } else {
      retreating.push(...aboard);
    }
  }

  if (retreating.length > 0) {
    if (target) {
      for (const u of retreating) {
        u.systemId = target;
        u.strength *= 0.9;
        u.status = "ready";
      }
      retreatedTo[loser] = target;
    } else {
      for (const u of retreating) u.strength = 0;
      retreatedTo[loser] = null;
    }
  }

  // Einnahme nach gewonnenem Bodenkampf des Angreifers
  let captured = false;
  if (b.kind === "ground" && winner === attacker && sys && sys.owner !== attacker) {
    const loserOwner = sys.owner;
    sys.owner = attacker;
    sys.fort = 0;
    ctx.changedSystems.add(sys.id);
    captured = true;
    if (loserOwner && state.campaign.hq[loserOwner] === sys.id) {
      ctx.notes[loserOwner].push(`Das Hauptquartier ${name} ist gefallen!`);
      ctx.notes[attacker].push(`Das gegnerische Hauptquartier ${name} ist gefallen!`);
    }
  }

  // Vernichtete entfernen, Geaenderte merken
  const destroyed: Record<Side, number> = { republik: 0, kus: 0 };
  for (const u of state.units) {
    if (u.systemId !== b.systemId && !retreating.includes(u)) continue;
    if (u.strength < DESTROYED_BELOW) {
      if (!ctx.removedUnits.has(u.id)) {
        destroyed[u.side]++;
        ctx.removedUnits.add(u.id);
      }
    } else if (startStrength.has(u.id) || retreating.includes(u)) {
      ctx.changedUnits.add(u.id);
    }
  }
  for (let i = state.units.length - 1; i >= 0; i--) {
    if (ctx.removedUnits.has(state.units[i].id)) state.units.splice(i, 1);
  }

  const parts = [
    `${kindName} um ${name}: ${SIDE_NAME[winner]} siegt${b.mode === "spieler" ? " (Spielerentscheid)" : ""}.`,
    `Verluste ${SIDE_NAME.republik} ${losses.republik} %, ${SIDE_NAME.kus} ${losses.kus} %.`,
  ];
  if (destroyed.republik + destroyed.kus > 0) parts.push(`Vernichtet: ${destroyed.republik} Republik, ${destroyed.kus} KUS.`);
  if (retreatedTo[loser]) parts.push(`${SIDE_NAME[loser]} zieht sich nach ${state.systems.get(retreatedTo[loser]!)?.name ?? "?"} zurück.`);
  if (retreatedTo[loser] === null) parts.push(`${SIDE_NAME[loser]} kann sich nirgendwohin zurückziehen und wird aufgerieben.`);
  if (lostAboard[loser]) parts.push(`${lostAboard[loser]} Einheit(en) an Bord gingen mit unter.`);
  if (captured) parts.push(`${name} ist eingenommen.`);
  const text = parts.join(" ");
  for (const s of SIDES) ctx.notes[s].push(text);

  return finish({
    winner, attacker, defender, mode: b.mode, rounds, before, losses, mods: modNotes, destroyed,
    retreatedTo, lostAboard, captured, text,
  });
}

/** Testhilfe: nur die Rundenrechnung (ohne Datenbank) */
export const _test = { simulate, rng };
