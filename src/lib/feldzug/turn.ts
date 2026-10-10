/**
 * Galaktischer Feldzug - Befehle und Zugauswertung (Paket 2).
 *
 * Jede Seite plant bis zu actionsPerTurn Befehle:
 *   move     Einheiten verlegen. Jedes Ziel ist in einem Zug erreichbar;
 *            die Route folgt dem Sprungnetz (gespeichert für die Karte).
 *            Schiffe nehmen Bodentruppen mit (je Kompanie 1 Laderaum),
 *            Bodentruppen allein nur in eigene Systeme.
 *   build    Einheiten bauen/ausbilden (fertig nach buildTurns Zügen)
 *   fortify  Befestigung +1
 *   scout    Aufklärung eines Systems (Bericht)
 *   occupy   neutrales System besetzen (wie im Aufbau, mit Garnison)
 *
 * Auswertung beim Zugende durch die Spielleitung, beide Seiten gleichzeitig:
 *   1. Bau, Befestigung, Besetzen   2. Bewegung   3. Lage: Eroberung oder
 *   Gefecht (Paket 3 entscheidet es)   4. Aufklärung   5. Ausbildung fertig
 *   6. Einkommen aus versorgten Systemen   7. Berichte, nächster Zug
 */

import {
  addReport,
  deleteUnit,
  insertBattle,
  insertUnit,
  loadBattles,
  saveOrder,
  saveSystem,
  saveIntel,
  saveUnit,
  updateCampaign,
} from "./db";
import type { CampaignState, Order, OrderKind } from "./db";
import { hopCost, pathCost } from "./routing";
import { RuleError, canBuildAt, connectedToSide, occupyCost, otherSide, visibleSystems } from "./rules";
import { SIDES, SIDE_NAME } from "./types";
import type { CampaignSystem, Side, Unit, UnitType } from "./types";

export interface OrderInput {
  kind: OrderKind;
  systemId?: string;
  to?: string;
  unitIds?: number[];
  type?: string;
  count?: number;
}

const isShip = (types: Map<string, UnitType>, u: Unit) => types.get(u.type)?.category === "ship";

/** Punkte, die die geplanten Befehle einer Seite kosten */
export function orderCost(o: Order): number {
  return Number(o.data.cost ?? 0);
}

/** Einheiten, die schon in einem Bewegungsbefehl stecken */
function plannedUnits(orders: Order[]): Set<number> {
  const set = new Set<number>();
  for (const o of orders) if (o.kind === "move") for (const id of (o.data.unitIds as number[]) ?? []) set.add(id);
  return set;
}

/**
 * Befehl prüfen und in die gespeicherte Form bringen. Wirft RuleError.
 * orders = bereits geplante Befehle dieser Seite (ohne den zu ersetzenden).
 */
export function validateOrder(
  state: CampaignState,
  side: Side,
  input: OrderInput,
  orders: Order[],
  types: Map<string, UnitType>,
): { kind: OrderKind; data: Record<string, unknown>; label: string } {
  const c = state.campaign;
  if (c.status !== "running") throw new RuleError("Der Feldzug läuft nicht");
  const sys = (id?: string): CampaignSystem => {
    const s = id ? state.systems.get(id) : undefined;
    if (!s) throw new RuleError("System gehört nicht zum Feldzuggebiet");
    return s;
  };
  const budget = c.points[side] - orders.reduce((a, o) => a + orderCost(o), 0);
  const needPoints = (cost: number) => {
    if (cost > budget) throw new RuleError(`Zu wenig Punkte (${cost} benötigt, ${budget} frei)`);
  };
  const sameTarget = (kind: OrderKind, id: string) => {
    if (orders.some((o) => o.kind === kind && o.data.systemId === id)) throw new RuleError("Für dieses System gibt es schon so einen Befehl");
  };

  switch (input.kind) {
    case "move": {
      const from = sys(input.systemId);
      const to = sys(input.to);
      if (from.id === to.id) throw new RuleError("Ziel ist der Ausgangsort");
      const ids = [...new Set(input.unitIds ?? [])];
      if (ids.length === 0) throw new RuleError("Keine Einheiten gewählt");
      const planned = plannedUnits(orders);
      const units = ids.map((id) => {
        const u = state.units.find((x) => x.id === id);
        if (!u || u.side !== side || u.systemId !== from.id) throw new RuleError("Einheit nicht im Ausgangssystem");
        if (u.status === "training") throw new RuleError("Einheit ist noch in Ausbildung");
        if (planned.has(u.id)) throw new RuleError("Einheit hat schon einen Befehl");
        return u;
      });
      const ships = units.filter((u) => isShip(types, u));
      const ground = units.filter((u) => !isShip(types, u));

      // Garnison: das letzte Bodenkontingent eines eigenen Systems bleibt
      if (from.owner === side && ground.length > 0) {
        const left = state.units.filter((u) => u.side === side && u.systemId === from.id && !isShip(types, u) && !ids.includes(u.id));
        if (left.length === 0) throw new RuleError("Mindestens eine Bodeneinheit bleibt als Garnison zurück");
      }

      if (ships.length > 0) {
        const capacity = ships.reduce((a, u) => a + (types.get(u.type)?.capacity ?? 0), 0);
        if (ground.length > capacity) throw new RuleError(`Zu wenig Laderaum (${capacity} Kompanien, ${ground.length} gewählt)`);
      } else if (to.owner !== side) {
        throw new RuleError("Bodentruppen ohne Schiffe nur in eigene Systeme (für Angriffe Schiffe mitschicken)");
      }
      // Route über das Sprungnetz; ohne Verbindung direkter Sprung
      const route = pathCost(state.graph, from.id, to.id, Infinity) ?? { cost: Math.hypot(to.x - from.x, to.y - from.y), path: [from.id, to.id] };
      const label = `${units.length} Einheit(en) ${from.name} → ${to.name}`;
      return {
        kind: "move",
        data: { systemId: from.id, to: to.id, unitIds: ids, distance: Math.round(route.cost), path: route.path, cost: 0 },
        label,
      };
    }

    case "build": {
      const at = sys(input.systemId);
      const type = types.get(input.type ?? "");
      if (!type || type.side !== side) throw new RuleError("Unbekannter Einheitentyp");
      const count = Math.max(1, Math.min(50, Math.floor(input.count ?? 1)));
      if (!canBuildAt(state, side, type, at)) {
        throw new RuleError(type.category === "ship" ? "Schiffe nur am Hauptquartier oder an Werften" : "Nur am Hauptquartier oder an Fabrikwelten");
      }
      const cost = type.cost * count;
      needPoints(cost);
      return { kind: "build", data: { systemId: at.id, type: type.key, count, cost }, label: `${count}× ${type.name} in ${at.name}` };
    }

    case "fortify": {
      const at = sys(input.systemId);
      if (at.owner !== side) throw new RuleError("Nur eigene Systeme");
      if (at.fort >= c.settings.fortMax) throw new RuleError("Höchste Befestigung erreicht");
      sameTarget("fortify", at.id);
      needPoints(c.settings.fortifyCost);
      return { kind: "fortify", data: { systemId: at.id, cost: c.settings.fortifyCost }, label: `${at.name} befestigen` };
    }

    case "scout": {
      const at = sys(input.systemId);
      sameTarget("scout", at.id);
      const max = c.settings.supplyHop;
      const near = [...state.systems.values()].some((s) => s.owner === side && hopCost(state.graph, s.id, at.id) <= max) ||
        state.units.some((u) => u.side === side && hopCost(state.graph, u.systemId, at.id) <= max);
      if (!near) throw new RuleError("Zu weit von eigenen Systemen und Truppen");
      return { kind: "scout", data: { systemId: at.id, cost: 0 }, label: `${at.name} aufklären` };
    }

    case "occupy": {
      const at = sys(input.systemId);
      if (at.owner) throw new RuleError("Nur neutrale Systeme");
      if (!connectedToSide(state, side, at.id)) throw new RuleError("Nicht mit eigenen Systemen verbunden");
      sameTarget("occupy", at.id);
      const cost = occupyCost(state, at);
      needPoints(cost);
      return { kind: "occupy", data: { systemId: at.id, cost }, label: `${at.name} besetzen` };
    }
  }
}

/** Versorgte Systeme: über eigene Systeme mit dem HQ verbunden */
export function suppliedSystems(state: CampaignState, side: Side): Set<string> {
  const hq = state.campaign.hq[side];
  const out = new Set<string>();
  if (!hq || state.systems.get(hq)?.owner !== side) return out;
  const max = state.campaign.settings.supplyHop;
  const stack = [hq];
  out.add(hq);
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const [n, w] of state.graph[id] ?? []) {
      if (w > max || out.has(n) || state.systems.get(n)?.owner !== side) continue;
      out.add(n);
      stack.push(n);
    }
  }
  return out;
}

export function incomeOf(state: CampaignState, side: Side): { total: number; supplied: number; cut: number } {
  const s = state.campaign.settings;
  const supplied = suppliedSystems(state, side);
  let total = 0;
  for (const id of supplied) {
    const sys = state.systems.get(id)!;
    total += sys.tier * s.incomePerTier + sys.traits.length * s.traitBonus;
  }
  if (supplied.has(state.campaign.hq[side])) total += s.hqBonus;
  const owned = [...state.systems.values()].filter((x) => x.owner === side).length;
  return { total, supplied: supplied.size, cut: owned - supplied.size };
}

/**
 * Zug auswerten. Ändert state und schreibt alles in die Datenbank.
 * Liefert die Berichte je Seite (auch schon gespeichert).
 */
export async function resolveTurn(state: CampaignState, orders: Order[], types: Map<string, UnitType>): Promise<Record<Side, string[]>> {
  const c = state.campaign;
  const turn = c.turn;
  const notes: Record<Side, string[]> = { republik: [], kus: [] };
  const name = (id: string) => state.systems.get(id)?.name ?? id;
  const changedSystems = new Set<string>();
  const changedUnits = new Set<number>();
  const result = async (o: Order, text: string) => {
    o.result = text;
    await saveOrder(c.id, turn, o);
  };
  const newUnit = async (side: Side, type: string, systemId: string, status: Unit["status"], readyTurn: number) => {
    const u: Omit<Unit, "id"> = { side, type, systemId, strength: 1, xp: 0, status, readyTurn, fleetId: null, navalShipId: null };
    const id = await insertUnit(c.id, u);
    state.units.push({ ...u, id });
  };

  // 1a. Besetzen - beide Seiten auf dasselbe System: keiner bekommt es
  const occupyOrders = orders.filter((o) => o.kind === "occupy");
  for (const o of occupyOrders) {
    const id = String(o.data.systemId);
    const sys = state.systems.get(id);
    const rival = occupyOrders.some((x) => x !== o && x.side !== o.side && x.data.systemId === id);
    const cost = Number(o.data.cost ?? 0);
    if (!sys || sys.owner) await result(o, "Fehlgeschlagen: System nicht mehr neutral");
    else if (rival) await result(o, "Fehlgeschlagen: die Gegenseite wollte es zur gleichen Zeit besetzen");
    else if (c.points[o.side] < cost) await result(o, "Fehlgeschlagen: zu wenig Punkte");
    else {
      c.points[o.side] -= cost;
      sys.owner = o.side;
      changedSystems.add(id);
      await newUnit(o.side, c.settings.garrisonType[o.side], id, "ready", 0);
      await result(o, `Besetzt (−${cost})`);
      notes[o.side].push(`${sys.name} besetzt, Garnison stationiert.`);
    }
  }

  // 1b. Bau und Ausbildung
  for (const o of orders.filter((x) => x.kind === "build")) {
    const type = types.get(String(o.data.type));
    const id = String(o.data.systemId);
    const sys = state.systems.get(id);
    const count = Number(o.data.count ?? 1);
    const cost = (type?.cost ?? 0) * count;
    if (!type || !sys || sys.owner !== o.side) await result(o, "Fehlgeschlagen: Bauort nicht mehr in eigener Hand");
    else if (c.points[o.side] < cost) await result(o, "Fehlgeschlagen: zu wenig Punkte");
    else {
      c.points[o.side] -= cost;
      // buildTurns 0 = sofort, sonst fertig zu Beginn von Zug turn + buildTurns
      const readyTurn = turn + type.buildTurns;
      for (let i = 0; i < count; i++) await newUnit(o.side, type.key, id, type.buildTurns > 0 ? "training" : "ready", readyTurn);
      await result(o, type.buildTurns > 0 ? `In Bau, fertig in Zug ${readyTurn} (−${cost})` : `Aufgestellt (−${cost})`);
      notes[o.side].push(`${count}× ${type.name} in ${sys.name} ${type.buildTurns > 0 ? `in Bau (fertig in Zug ${readyTurn})` : "aufgestellt"}.`);
    }
  }

  // 1c. Befestigen
  for (const o of orders.filter((x) => x.kind === "fortify")) {
    const sys = state.systems.get(String(o.data.systemId));
    const cost = Number(o.data.cost ?? 0);
    if (!sys || sys.owner !== o.side) await result(o, "Fehlgeschlagen: System nicht in eigener Hand");
    else if (sys.fort >= c.settings.fortMax) await result(o, "Höchste Befestigung schon erreicht");
    else if (c.points[o.side] < cost) await result(o, "Fehlgeschlagen: zu wenig Punkte");
    else {
      c.points[o.side] -= cost;
      sys.fort += 1;
      changedSystems.add(sys.id);
      await result(o, `Befestigung ${sys.fort} (−${cost})`);
      notes[o.side].push(`${sys.name} auf Befestigung ${sys.fort} ausgebaut.`);
    }
  }

  // 2. Bewegung (gleichzeitig)
  const arrivals = new Map<string, Set<Side>>();
  for (const o of orders.filter((x) => x.kind === "move")) {
    const from = String(o.data.systemId);
    const to = String(o.data.to);
    const ids = (o.data.unitIds as number[]) ?? [];
    const units = state.units.filter((u) => ids.includes(u.id) && u.side === o.side && u.systemId === from);
    if (units.length === 0) {
      await result(o, "Fehlgeschlagen: Einheiten nicht mehr dort");
      continue;
    }
    for (const u of units) {
      u.systemId = to;
      u.status = "ready";
      changedUnits.add(u.id);
    }
    const set = arrivals.get(to) ?? new Set<Side>();
    set.add(o.side);
    arrivals.set(to, set);
    await result(o, `${units.length} Einheit(en) in ${name(to)} angekommen`);
    notes[o.side].push(`${units.length} Einheit(en) von ${name(from)} nach ${name(to)} verlegt.`);
  }

  // 3. Lage je System: Eroberung oder Gefecht
  const openBattles = new Set((await loadBattles(c.id)).filter((b) => b.status !== "done").map((b) => b.systemId));
  for (const sys of state.systems.values()) {
    const here = state.units.filter((u) => u.systemId === sys.id);
    const present = SIDES.filter((s) => here.some((u) => u.side === s));
    if (present.length === 2) {
      if (!sys.contested) {
        sys.contested = true;
        changedSystems.add(sys.id);
      }
      if (!openBattles.has(sys.id)) {
        const bothShips = SIDES.every((s) => here.some((u) => u.side === s && isShip(types, u)));
        const movers = arrivals.get(sys.id);
        const attacker: Side = sys.owner ? otherSide(sys.owner) : movers && movers.size === 1 ? [...movers][0] : "republik";
        await insertBattle(c.id, {
          turn,
          systemId: sys.id,
          kind: bothShips ? "space" : "ground",
          attacker,
          mode: c.settings.defaultBattleMode,
          status: "open",
          seed: Math.floor(Math.random() * 2 ** 31),
          result: {},
          scheduledAt: 0,
        });
        openBattles.add(sys.id);
        for (const s of SIDES) notes[s].push(`Gefecht um ${sys.name}: ${bothShips ? "Raumschlacht" : "Bodenkampf"} (${SIDE_NAME[attacker]} greift an).`);
      }
      continue;
    }
    if (sys.contested && present.length < 2 && !openBattles.has(sys.id)) {
      sys.contested = false;
      changedSystems.add(sys.id);
    }
    // Eroberung: nur eine Seite mit Bodentruppen da, System gehört ihr nicht
    if (present.length === 1) {
      const side = present[0];
      const hasGround = here.some((u) => !isShip(types, u));
      if (hasGround && sys.owner !== side) {
        const loser = sys.owner;
        sys.owner = side;
        sys.fort = 0;
        changedSystems.add(sys.id);
        notes[side].push(`${sys.name} eingenommen.`);
        if (loser) {
          notes[loser].push(`${sys.name} verloren.`);
          if (c.hq[loser] === sys.id) {
            notes[loser].push(`Das Hauptquartier ${sys.name} ist gefallen!`);
            notes[side].push(`Das gegnerische Hauptquartier ${sys.name} ist gefallen!`);
          }
        }
      }
    }
  }

  // 4. Aufklärung (nach der Bewegung)
  for (const o of orders.filter((x) => x.kind === "scout")) {
    const sys = state.systems.get(String(o.data.systemId));
    if (!sys) continue;
    const enemy = state.units.filter((u) => u.systemId === sys.id && u.side !== o.side);
    const counts = new Map<string, number>();
    for (const u of enemy) {
      const t = types.get(u.type);
      counts.set(t?.name ?? u.type, (counts.get(t?.name ?? u.type) ?? 0) + 1);
    }
    const owner = sys.owner ? SIDE_NAME[sys.owner] : "neutral";
    const seen = enemy.length === 0 ? "keine gegnerischen Einheiten" : [...counts.entries()].map(([n, k]) => `${k}× ${n}`).join(", ");
    const text = `Aufklärung ${sys.name}: ${owner}, Befestigung ${sys.fort}; ${seen}.`;
    await result(o, text);
    notes[o.side].push(text);
  }

  // 5. Ausbildung fertig (zu Beginn des nächsten Zugs)
  const next = turn + 1;
  for (const u of state.units) {
    if (u.status === "training" && u.readyTurn <= next) {
      u.status = "ready";
      changedUnits.add(u.id);
      notes[u.side].push(`${types.get(u.type)?.name ?? u.type} in ${name(u.systemId)} einsatzbereit.`);
    }
  }

  // 6. Einkommen
  for (const side of SIDES) {
    const inc = incomeOf(state, side);
    c.points[side] += inc.total;
    notes[side].push(
      `Einkommen: +${inc.total} Punkte aus ${inc.supplied} versorgten Systemen` + (inc.cut > 0 ? ` (${inc.cut} ohne Nachschubverbindung zum HQ)` : "") + ".",
    );
  }

  // Aufklärungsstand: was jede Seite jetzt sieht, dazu die aufgeklärten Systeme
  for (const side of SIDES) {
    const ids = visibleSystems(state, side);
    for (const o of orders) if (o.kind === "scout" && o.side === side) ids.add(String(o.data.systemId));
    await recordIntel(state, side, ids, next);
  }

  // Speichern
  for (const id of changedSystems) await saveSystem(c.id, state.systems.get(id)!);
  for (const id of changedUnits) {
    const u = state.units.find((x) => x.id === id);
    if (u) await saveUnit(u);
  }
  for (const u of state.units.filter((x) => x.strength <= 0)) await deleteUnit(u.id);
  c.turn = next;
  c.ready = { republik: false, kus: false };
  await updateCampaign(c);
  for (const side of SIDES) {
    await addReport(c.id, turn, side, "turn", `Zug ${turn} ausgewertet. ` + notes[side].join(" "));
    await addReport(c.id, next, side, "turn", `Zug ${next} beginnt. ${c.points[side].toLocaleString("de-DE")} Punkte verfügbar.`);
  }
  return notes;
}

/** Besitzer der angegebenen Systeme als Aufklärungsstand der Seite speichern */
export async function recordIntel(state: CampaignState, side: Side, ids: Set<string>, turn: number): Promise<void> {
  const rows = [...ids]
    .map((id) => state.systems.get(id))
    .filter((s): s is CampaignSystem => !!s)
    .map((s) => ({ systemId: s.id, owner: s.owner, turn }));
  await saveIntel(state.campaign.id, side, rows);
}
