/**
 * Galaktischer Feldzug - Sprungweiten zwischen Systemen.
 *
 * Gleiche Rechnung wie das Naval-System (gamemode sv_naval_routing.lua):
 * Stützpunkte der Hyperraumrouten als Graph, entlang einer Route kostet
 * jede Parsec routeMajor bzw. routeMinor, Umstiege zwischen Routen bis
 * junctionDist Parsec, abseits der Routen voll. Kosten = "effektive Parsec".
 *
 * buildHopGraph rechnet einmal beim Anlegen/Ändern eines Feldzugs für alle
 * Systeme des Gebiets die Kosten zu allen anderen bis maxHop und speichert
 * sie (pd_fz_campaigns.graph_json).
 */

import type { HopGraph, Settings } from "./types";

export interface RouteLine {
  major: boolean;
  lines: number[][][];
}

interface Node {
  i: number;
  x: number;
  y: number;
  edges: Array<{ to: number; cost: number }>;
  routes: Set<number>;
}

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

function buildGraph(routes: RouteLine[], s: Settings, bounds?: { x0: number; y0: number; x1: number; y1: number }): Node[] {
  const nodes: Node[] = [];
  const byKey = new Map<string, Node>();
  const inBounds = (x: number, y: number) => !bounds || (x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1);

  const node = (x: number, y: number, routeId: number) => {
    const key = `${Math.round(x * 10)}:${Math.round(y * 10)}`;
    let n = byKey.get(key);
    if (!n) {
      n = { i: nodes.length, x, y, edges: [], routes: new Set() };
      nodes.push(n);
      byKey.set(key, n);
    }
    n.routes.add(routeId);
    return n;
  };
  const link = (a: Node, b: Node, cost: number) => {
    if (a === b) return;
    a.edges.push({ to: b.i, cost });
    b.edges.push({ to: a.i, cost });
  };

  routes.forEach((route, id) => {
    const factor = route.major ? s.routeMajor : s.routeMinor;
    for (const line of route.lines) {
      let prev: Node | null = null;
      for (const p of line) {
        const x = Number(p[0]) || 0;
        const y = Number(p[1]) || 0;
        // Ausserhalb des Bereichs: Kette unterbrechen (spart Rechenzeit)
        if (!inBounds(x, y)) {
          prev = null;
          continue;
        }
        const n = node(x, y, id);
        if (prev) link(prev, n, dist(prev.x, prev.y, n.x, n.y) * factor);
        prev = n;
      }
    }
  });

  // Umstiege zwischen verschiedenen Routen
  const jd = s.junctionDist;
  const cells = new Map<string, Node[]>();
  const cell = (cx: number, cy: number) => `${cx}:${cy}`;
  for (const n of nodes) {
    const key = cell(Math.floor(n.x / jd), Math.floor(n.y / jd));
    const list = cells.get(key) ?? [];
    list.push(n);
    cells.set(key, list);
  }
  for (const n of nodes) {
    const cx = Math.floor(n.x / jd);
    const cy = Math.floor(n.y / jd);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const m of cells.get(cell(cx + dx, cy + dy)) ?? []) {
          if (m.i <= n.i) continue;
          let shared = false;
          for (const r of n.routes) if (m.routes.has(r)) shared = true;
          const d = dist(n.x, n.y, m.x, m.y);
          if (!shared && d <= jd) link(n, m, d);
        }
      }
    }
  }
  return nodes;
}

/** Binärer Heap für Dijkstra */
class Heap {
  private items: Array<[number, number]> = [];
  get size() {
    return this.items.length;
  }
  push(i: number, d: number) {
    const a = this.items;
    a.push([i, d]);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (a[p][1] <= a[k][1]) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && a[l][1] < a[m][1]) m = l;
        if (r < a.length && a[r][1] < a[m][1]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
}

export interface SystemPoint {
  id: string;
  x: number;
  y: number;
}

/**
 * Kosten (effektive Parsec) von jedem System zu jedem anderen bis maxHop.
 * Wie Naval.PlanJump: Einstieg und Ausstieg abseits der Routen kosten voll,
 * lohnt die Route nicht (> 97 % der Direktstrecke), wird direkt gesprungen.
 */
export function buildHopGraph(systems: SystemPoint[], routes: RouteLine[], settings: Settings, maxHop: number): HopGraph {
  if (systems.length === 0) return {};
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of systems) {
    x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y);
  }
  const margin = maxHop;
  const nodes = buildGraph(routes, settings, { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin });
  const graph: HopGraph = {};

  // Ausstiegspunkte je Ziel: nur Stützpunkte in Reichweite des Ziels
  const exits = new Map<string, Node[]>();
  for (const to of systems) exits.set(to.id, nodes.filter((n) => dist(n.x, n.y, to.x, to.y) <= maxHop));
  // Kein Ziel kann günstiger sein als die Direktstrecke mal dem besten Routenfaktor
  const minFactor = Math.min(1, settings.routeMajor, settings.routeMinor);

  for (const from of systems) {
    const d = new Float64Array(nodes.length).fill(Infinity);
    const done = new Uint8Array(nodes.length);
    const heap = new Heap();
    // Einstieg nur bei Punkten in Reichweite
    for (const n of nodes) {
      const e = dist(from.x, from.y, n.x, n.y);
      if (e <= maxHop) {
        d[n.i] = e;
        heap.push(n.i, e);
      }
    }
    while (heap.size > 0) {
      const [i, di] = heap.pop();
      if (done[i] || di > d[i] || di > maxHop) continue;
      done[i] = 1;
      for (const e of nodes[i].edges) {
        const nd = di + e.cost;
        if (nd < d[e.to]) {
          d[e.to] = nd;
          heap.push(e.to, nd);
        }
      }
    }

    const list: Array<[string, number]> = [];
    for (const to of systems) {
      if (to.id === from.id) continue;
      const direct = dist(from.x, from.y, to.x, to.y);
      if (direct * minFactor > maxHop) continue;
      let best = direct;
      for (const n of exits.get(to.id) ?? []) {
        if (d[n.i] === Infinity) continue;
        const c = d[n.i] + dist(n.x, n.y, to.x, to.y);
        if (c < best) best = c;
      }
      if (best > direct * 0.97) best = direct;
      if (best <= maxHop) list.push([to.id, Math.round(best * 10) / 10]);
    }
    list.sort((a, b) => a[1] - b[1]);
    graph[from.id] = list;
  }
  connectIslands(systems, graph);
  return graph;
}

/**
 * Inseln verbinden: Teile des Gebiets, die über maxHop nicht zusammenhängen,
 * bekommen je einen direkten Sprung zum nächsten System außerhalb (Borůvka).
 * So ist jedes System erreichbar; für den Nachschub zählen diese langen
 * Sprünge nicht, weil sie über supplyHop liegen.
 */
function connectIslands(systems: SystemPoint[], graph: HopGraph) {
  const index = new Map(systems.map((s, i) => [s.id, i]));
  for (let round = 0; round < 64; round++) {
    const comp = new Int32Array(systems.length).fill(-1);
    let count = 0;
    for (let i = 0; i < systems.length; i++) {
      if (comp[i] >= 0) continue;
      const stack = [i];
      comp[i] = count;
      while (stack.length > 0) {
        const k = stack.pop()!;
        for (const [n] of graph[systems[k].id] ?? []) {
          const j = index.get(n);
          if (j !== undefined && comp[j] < 0) {
            comp[j] = count;
            stack.push(j);
          }
        }
      }
      count++;
    }
    if (count <= 1) return;

    // Je Insel die kürzeste Verbindung nach draußen
    const best: Array<[number, number, number]> = Array.from({ length: count }, () => [Infinity, -1, -1]);
    for (let i = 0; i < systems.length; i++) {
      for (let j = i + 1; j < systems.length; j++) {
        if (comp[i] === comp[j]) continue;
        const d = dist(systems[i].x, systems[i].y, systems[j].x, systems[j].y);
        if (d < best[comp[i]][0]) best[comp[i]] = [d, i, j];
        if (d < best[comp[j]][0]) best[comp[j]] = [d, i, j];
      }
    }
    for (const [, i, j] of best) {
      if (i < 0) continue;
      const a = systems[i].id;
      const b = systems[j].id;
      if ((graph[a] ?? []).some(([n]) => n === b)) continue;
      const cost = Math.round(dist(systems[i].x, systems[i].y, systems[j].x, systems[j].y) * 10) / 10;
      (graph[a] ??= []).push([b, cost]);
      (graph[b] ??= []).push([a, cost]);
    }
  }
}

/** Kosten eines Sprungs (Infinity, wenn außerhalb des Netzes) */
export function hopCost(graph: HopGraph, from: string, to: string): number {
  if (from === to) return 0;
  const entry = graph[from]?.find(([id]) => id === to);
  return entry ? entry[1] : Infinity;
}

/** Günstigster Weg über mehrere Sprünge (je Sprung höchstens maxStep) */
export function pathCost(graph: HopGraph, from: string, to: string, maxStep: number): { cost: number; path: string[] } | null {
  if (from === to) return { cost: 0, path: [from] };
  const ids = Object.keys(graph);
  const index = new Map(ids.map((id, i) => [id, i]));
  const start = index.get(from);
  const goal = index.get(to);
  if (start === undefined || goal === undefined) return null;
  const best = new Float64Array(ids.length).fill(Infinity);
  const prev = new Int32Array(ids.length).fill(-1);
  const heap = new Heap();
  best[start] = 0;
  heap.push(start, 0);
  while (heap.size > 0) {
    const [i, c] = heap.pop();
    if (c > best[i]) continue;
    if (i === goal) break;
    for (const [n, w] of graph[ids[i]]) {
      if (w > maxStep) continue;
      const j = index.get(n);
      if (j === undefined) continue;
      const nc = c + w;
      if (nc < best[j]) {
        best[j] = nc;
        prev[j] = i;
        heap.push(j, nc);
      }
    }
  }
  if (best[goal] === Infinity) return null;
  const path = [to];
  for (let k = prev[goal]; k >= 0; k = prev[k]) path.unshift(ids[k]);
  return { cost: best[goal], path };
}
