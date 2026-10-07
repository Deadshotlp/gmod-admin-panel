"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Notice, fetchWithTimeout, inputStyle, readJson } from "./ui";

/* ------------------------------------------------------------------------ */
/* Daten                                                                     */
/* ------------------------------------------------------------------------ */

interface Hardpoint {
  group?: string;
  type?: string;
  count?: number;
  x?: number;
  y?: number;
  yaw?: number;
  arcH?: number;
}

interface StaticData {
  factions: Array<{ id: string; name: string; color: string }>;
  classes: Array<{ id: string; name: string; lengthM: number; hull: number; hardpoints: Hardpoint[] }>;
  systems: Array<{ id: string; name: string; x: number; y: number; region: string }>;
  routes: Array<{ id: string; name: string; major: boolean; lines: number[][][] }>;
  mapHardpoints: Hardpoint[];
}

interface LiveShip {
  id: number;
  name: string;
  classId: string;
  factionId: string;
  systemId: string;
  state: string;
  map?: boolean;
  p: [number, number, number];
  f: [number, number, number];
  speed: number;
  hull: number;
  shield?: number;
  shieldsUp?: boolean;
  order?: string;
  roe?: string;
  target?: number;
  fleetId?: number;
  morale?: number;
  surrendered?: boolean;
  interdictor?: boolean;
  jump?: { from: string; to: string; eta?: number; total?: number };
  route?: { pts: number[][]; loop?: boolean; orbit?: { c: number[]; r: number }; jumpTo?: string; slot?: boolean };
}

interface Live {
  serverKey: string;
  updatedAt: number;
  time: number;
  paused: boolean;
  mapShipId?: number;
  alert: number;
  ships: LiveShip[];
  fleets: Array<{ id: number; name: string; flagshipId: number; formation: string; mode: string }>;
  comms: Array<{ t: number; from: string; to?: string; text: string; kind: string }>;
}

interface Body {
  id: string;
  parentId: string | null;
  type: string;
  name: string;
  orbit: { radius: number; phase: number; period: number; incl: number };
  radius: number;
}

const STATE_LABEL: Record<string, string> = {
  normal: "normal",
  spooling: "fährt hoch",
  jumping: "springt",
  hyperspace: "Hyperraum",
  exiting: "Austritt",
  disabled: "kampfunfähig",
  destroyed: "zerstört",
};
const ORDER_LABEL: Record<string, string> = { hold: "hält", move: "fliegt", patrol: "Patrouille", orbit: "Orbit", jump: "Sprung", attack: "Angriff" };
const ROE_LABEL: Record<string, string> = { hold: "Feuer halten", return: "Nur zurückschießen", free: "Feuer frei" };
const ALERT = [
  { label: "Normal", color: "#5ad282" },
  { label: "Alarmstufe Gelb", color: "#f0c83c" },
  { label: "Alarmstufe Rot", color: "#f0463c" },
];
const BODY_COLOR: Record<string, string> = { star: "#ffdc78", planet: "#78c8b4", moon: "#aab0b9" };

// Position eines Himmelskörpers (wie Naval.BodyPos im Gamemode)
function bodyPos(body: Body, byId: Map<string, Body>, now: number, depth = 0): [number, number, number] {
  let origin: [number, number, number] = [0, 0, 0];
  if (depth > 4) return origin;
  const parent = body.parentId ? byId.get(body.parentId) : undefined;
  if (parent) origin = bodyPos(parent, byId, now, depth + 1);
  const o = body.orbit;
  if (!o || o.radius <= 0) return origin;
  let angle = (o.phase * Math.PI) / 180;
  if (o.period > 0) angle += (now / o.period) * Math.PI * 2;
  const incl = (o.incl * Math.PI) / 180;
  return [origin[0] + Math.cos(angle) * o.radius, origin[1] + Math.sin(angle) * o.radius * Math.cos(incl), origin[2] + Math.sin(angle) * o.radius * Math.sin(incl)];
}

function km(m: number) {
  if (m >= 1e9) return `${(m / 1e9).toFixed(2)} Mio km`;
  if (m >= 1e4) return `${Math.round(m / 1000)} km`;
  return `${(m / 1000).toFixed(1)} km`;
}

/* ------------------------------------------------------------------------ */
/* Karte (Canvas mit Verschieben/Zoomen)                                     */
/* ------------------------------------------------------------------------ */

interface ViewState {
  cx: number;
  cy: number;
  scale: number; // Pixel je Einheit
}

function useCanvasView(initial: ViewState) {
  const [view, setView] = useState(initial);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  return { view, setView, drag };
}

/* ------------------------------------------------------------------------ */
/* Hauptkomponente                                                           */
/* ------------------------------------------------------------------------ */

export default function StrategieView({ user }: { user: PanelUser }) {
  const [stat, setStat] = useState<StaticData | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [log, setLog] = useState<Array<{ ts: number; kind: string; author: string; text: string }>>([]);
  const [mode, setMode] = useState<"galaxy" | "system">("system");
  const [systemId, setSystemId] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Body[]>([]);
  // Auswahl wie in einem Strategiespiel: Rahmen ziehen (Shift = dazu),
  // Rechtsklick = Befehl an alle gewählten
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [box, setBox] = useState<null | { x0: number; y0: number; x1: number; y1: number }>(null);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const [factionFilter, setFactionFilter] = useState("");
  const [showRoutes, setShowRoutes] = useState(true);
  // Karte füllt die Breite und die Fensterhöhe
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 1100, h: 720 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      setSize({ w: Math.max(400, Math.floor(el.clientWidth)), h: Math.max(480, Math.floor(window.innerHeight - top - 24)) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = user.role === "editor" || user.role === "admin";

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const galaxy = useCanvasView({ cx: 0, cy: 0, scale: 0.05 });
  const system = useCanvasView({ cx: 0, cy: 0, scale: 0 });
  const cur = mode === "galaxy" ? galaxy : system;

  // Feste Daten einmal, Lage alle 2 s
  useEffect(() => {
    void (async () => {
      const response = await fetchWithTimeout("/api/strategie?static=1", { cache: "no-store" });
      const { data, error } = await readJson<StaticData>(response);
      if (error) setMessage({ ok: false, text: error });
      if (data) setStat(data);
    })();
  }, []);

  const loadLive = useCallback(async () => {
    try {
      const response = await fetchWithTimeout("/api/strategie", { cache: "no-store" });
      const { data } = await readJson<{ live: Live | null; log: typeof log }>(response);
      if (data) {
        setLive(data.live);
        setLog(data.log);
      }
    } catch {
      /* naechster Versuch in 2 s */
    }
  }, []);

  useEffect(() => {
    void loadLive();
    const timer = setInterval(() => void loadLive(), 2000);
    return () => clearInterval(timer);
  }, [loadLive]);

  const mapShip = live?.ships.find((s) => s.map) ?? null;

  // Start: System des Map-Schiffs
  useEffect(() => {
    if (!systemId && mapShip) setSystemId(mapShip.systemId);
  }, [mapShip, systemId]);

  useEffect(() => {
    if (!systemId) return;
    void (async () => {
      const response = await fetchWithTimeout(`/api/strategie?system=${encodeURIComponent(systemId)}`, { cache: "no-store" });
      const { data } = await readJson<{ bodies: Body[] }>(response);
      setBodies(data?.bodies ?? []);
      system.setView((v) => ({ ...v, scale: 0 })); // neu einpassen
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId]);

  const systemsById = useMemo(() => new Map((stat?.systems ?? []).map((s) => [s.id, s])), [stat]);
  const factionColor = useCallback(
    (id: string) => stat?.factions.find((f) => f.id === id)?.color ?? "#cccccc",
    [stat],
  );
  const className = (id: string) => stat?.classes.find((c) => c.id === id)?.name ?? id;
  const factionName = (id: string) => stat?.factions.find((f) => f.id === id)?.name ?? id;

  const ships = useMemo(
    () => (live?.ships ?? []).filter((s) => s.state !== "destroyed" && (!factionFilter || s.factionId === factionFilter)),
    [live, factionFilter],
  );
  const selected = live?.ships.find((s) => s.id === selectedId) ?? null;

  // Beim ersten Galaxie-Aufruf auf das Map-Schiff zentrieren
  useEffect(() => {
    const sys = mapShip && systemsById.get(mapShip.systemId);
    if (sys && galaxy.view.cx === 0 && galaxy.view.cy === 0) galaxy.setView({ cx: sys.x, cy: sys.y, scale: 0.05 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapShip?.systemId, systemsById]);

  /* ---------------------------------------------------------------- */
  /* Befehle (über /api/flotte)                                         */
  /* ---------------------------------------------------------------- */

  const send = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetchWithTimeout("/api/flotte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const { data, error } = await readJson<{ ok: boolean; message: string }>(response);
      if (error) setMessage({ ok: false, text: error });
      else setMessage({ ok: Boolean(data?.ok), text: data?.ok ? success : data?.message ?? "Fehlgeschlagen" });
    } catch {
      setMessage({ ok: false, text: "Befehl fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  const sendMany = async (bodies: Array<Record<string, unknown>>, success: string) => {
    if (bodies.length === 0) return;
    setBusy(true);
    setMessage(null);
    let ok = 0;
    let lastError = "";
    for (const body of bodies) {
      try {
        const response = await fetchWithTimeout("/api/flotte", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const { data, error } = await readJson<{ ok: boolean; message: string }>(response);
        if (!error && data?.ok) ok++;
        else lastError = error ?? data?.message ?? "Fehlgeschlagen";
      } catch {
        lastError = "Befehl fehlgeschlagen";
      }
    }
    setBusy(false);
    setMessage(ok === bodies.length ? { ok: true, text: success } : { ok: false, text: `${ok}/${bodies.length} Befehle gesendet. ${lastError}` });
  };

  /* ---------------------------------------------------------------- */
  /* Zeichnen                                                           */
  /* ---------------------------------------------------------------- */

  const bodiesById = useMemo(() => new Map(bodies.map((b) => [b.id, b])), [bodies]);
  const now = live?.time ?? Date.now() / 1000;

  // Systemansicht einpassen (Körper und Schiffe)
  useEffect(() => {
    if (mode !== "system" || system.view.scale !== 0 || !canvasRef.current) return;
    const pts: Array<[number, number]> = bodies.map((b) => {
      const p = bodyPos(b, bodiesById, now);
      return [p[0], p[1]];
    });
    for (const s of ships) if (s.systemId === systemId) pts.push([s.p[0], s.p[1]]);
    if (pts.length === 0) return;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const cx = mapShip && mapShip.systemId === systemId ? mapShip.p[0] : (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = mapShip && mapShip.systemId === systemId ? mapShip.p[1] : (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(...pts.map((p) => Math.max(Math.abs(p[0] - cx), Math.abs(p[1] - cy))), 50000);
    const c = canvasRef.current;
    system.setView({ cx, cy, scale: (Math.min(c.width, c.height) * 0.45) / span });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, bodies, ships, systemId]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    const v = cur.view;
    const toScreen = (x: number, y: number): [number, number] => [w / 2 + (x - v.cx) * v.scale, h / 2 - (y - v.cy) * v.scale];

    ctx.fillStyle = "#06090e";
    ctx.fillRect(0, 0, w, h);
    ctx.font = "12px sans-serif";

    if (mode === "galaxy" && stat) {
      // Routen
      for (const r of stat.routes) {
        ctx.strokeStyle = r.major ? "rgba(90,140,220,0.6)" : "rgba(70,90,130,0.35)";
        ctx.lineWidth = 1;
        for (const line of r.lines) {
          ctx.beginPath();
          line.forEach((pt, i) => {
            const [x, y] = toScreen(pt[0], pt[1]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        }
      }
      // Alle Systeme blass, ab genug Zoom
      if (v.scale > 0.15) {
        ctx.fillStyle = "rgba(150,160,180,0.5)";
        for (const s of stat.systems) {
          const [x, y] = toScreen(s.x, s.y);
          if (x > -5 && x < w + 5 && y > -5 && y < h + 5) ctx.fillRect(x - 1, y - 1, 2, 2);
        }
      }
      // Systeme mit Schiffen
      const bySystem = new Map<string, LiveShip[]>();
      for (const s of ships) {
        if (s.state === "hyperspace") continue;
        const list = bySystem.get(s.systemId) ?? [];
        list.push(s);
        bySystem.set(s.systemId, list);
      }
      for (const [sid, list] of bySystem) {
        const sys = systemsById.get(sid);
        if (!sys) continue;
        const [x, y] = toScreen(sys.x, sys.y);
        const counts = new Map<string, number>();
        list.forEach((s) => counts.set(s.factionId, (counts.get(s.factionId) ?? 0) + 1));
        let i = 0;
        for (const [fid, n] of counts) {
          ctx.fillStyle = factionColor(fid);
          ctx.beginPath();
          ctx.arc(x + i * 9, y, 4 + Math.min(n, 8), 0, Math.PI * 2);
          ctx.fill();
          i++;
        }
        const hasMap = list.some((s) => s.map);
        ctx.fillStyle = hasMap ? "#5ad282" : "#dfe6f0";
        ctx.fillText(`${sys.name} (${list.length})`, x + 12 + i * 9, y + 4);
        if (sid === systemId) {
          ctx.strokeStyle = "#f0c83c";
          ctx.strokeRect(x - 12, y - 12, 24, 24);
        }
      }
      // Sprünge
      for (const s of ships) {
        if (!s.jump) continue;
        const a = systemsById.get(s.jump.from);
        const b = systemsById.get(s.jump.to);
        if (!a || !b) continue;
        const [x1, y1] = toScreen(a.x, a.y);
        const [x2, y2] = toScreen(b.x, b.y);
        ctx.strokeStyle = factionColor(s.factionId);
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (s.jump.total && s.jump.eta !== undefined) {
          const f = Math.min(1, Math.max(0, 1 - s.jump.eta / s.jump.total));
          ctx.fillStyle = factionColor(s.factionId);
          ctx.beginPath();
          ctx.arc(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillText(`${s.name} ${Math.round(s.jump.eta)} s`, x1 + (x2 - x1) * f + 6, y1 + (y2 - y1) * f - 6);
        }
      }
      ctx.fillStyle = "#8c96a5";
      ctx.fillText(`${(100 / v.scale).toFixed(0)} pc / 100 px`, 8, h - 10);
    }

    if (mode === "system") {
      // Umlaufbahnen
      for (const b of bodies) {
        if (b.orbit.radius <= 0) continue;
        const parent = b.parentId ? bodiesById.get(b.parentId) : undefined;
        const c0 = parent ? bodyPos(parent, bodiesById, now) : [0, 0, 0];
        const incl = (b.orbit.incl * Math.PI) / 180;
        ctx.strokeStyle = `rgba(255,255,255,${b.type === "moon" ? 0.18 : 0.28})`;
        ctx.beginPath();
        for (let i = 0; i <= 96; i++) {
          const a = (i / 96) * Math.PI * 2;
          const [x, y] = toScreen(c0[0] + Math.cos(a) * b.orbit.radius, c0[1] + Math.sin(a) * b.orbit.radius * Math.cos(incl));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Körper
      for (const b of bodies) {
        const p = bodyPos(b, bodiesById, now);
        const [x, y] = toScreen(p[0], p[1]);
        const r = Math.max(b.radius * v.scale, 3);
        ctx.fillStyle = BODY_COLOR[b.type] ?? "#999";
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(x, y, Math.min(r, 4000), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (b.type !== "moon" || r > 4) ctx.fillText(b.name, x + r + 4, y - 4);
      }
      // Wegpunkte der Schiffe (Befehle, Patrouille, Orbit, Umwege, Formationsplatz)
      if (showRoutes) {
        for (const s of ships) {
          if (s.systemId !== systemId || !s.route) continue;
          const sel = selectedIds.includes(s.id);
          const color = factionColor(s.factionId);
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.globalAlpha = sel ? 0.95 : 0.45;
          ctx.lineWidth = sel ? 1.6 : 1;
          ctx.setLineDash(s.route.slot ? [2, 4] : [7, 5]);
          const pts = s.route.pts ?? [];
          if (pts.length > 0) {
            ctx.beginPath();
            let [px, py] = toScreen(s.p[0], s.p[1]);
            ctx.moveTo(px, py);
            for (const pt of pts) {
              [px, py] = toScreen(pt[0], pt[1]);
              ctx.lineTo(px, py);
            }
            if (s.route.loop && pts.length > 1) {
              const [fx, fy] = toScreen(pts[0][0], pts[0][1]);
              ctx.lineTo(fx, fy);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            pts.forEach((pt, i) => {
              const [x, y] = toScreen(pt[0], pt[1]);
              ctx.fillRect(x - 3, y - 3, 6, 6);
              if (sel && pts.length > 1) ctx.fillText(String(i + 1), x + 6, y + 4);
            });
          }
          if (s.route.orbit) {
            const [ox, oy] = toScreen(s.route.orbit.c[0], s.route.orbit.c[1]);
            ctx.setLineDash([4, 6]);
            ctx.beginPath();
            ctx.arc(ox, oy, Math.max(4, s.route.orbit.r * v.scale), 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          if (s.route.jumpTo) {
            const [x, y] = toScreen(s.p[0], s.p[1]);
            ctx.fillText(`→ ${systemsById.get(s.route.jumpTo)?.name ?? s.route.jumpTo}`, x + 12, y + 14);
          }
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1;
        }
      }

      // Schiffe
      const inSystem = ships.filter((s) => s.systemId === systemId && s.state !== "hyperspace");
      for (const s of inSystem) {
        const [x, y] = toScreen(s.p[0], s.p[1]);
        const len = Math.hypot(s.f[0], s.f[1]) || 1;
        const dx = s.f[0] / len;
        const dy = -s.f[1] / len;
        ctx.fillStyle = factionColor(s.factionId);
        ctx.beginPath();
        ctx.moveTo(x + dx * 9, y + dy * 9);
        ctx.lineTo(x - dx * 6 - dy * 5, y - dy * 6 + dx * 5);
        ctx.lineTo(x - dx * 6 + dy * 5, y - dy * 6 - dx * 5);
        ctx.closePath();
        ctx.fill();
        if (selectedIds.includes(s.id)) {
          ctx.strokeStyle = "#f0c83c";
          ctx.strokeRect(x - 12, y - 12, 24, 24);
        }
        // Ziellinie
        const target = s.target ? inSystem.find((t) => t.id === s.target) : undefined;
        if (target) {
          const [tx, ty] = toScreen(target.p[0], target.p[1]);
          ctx.strokeStyle = "rgba(240,70,60,0.6)";
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(tx, ty);
          ctx.stroke();
        }
        ctx.fillStyle = s.map ? "#5ad282" : "#dfe6f0";
        ctx.fillText(`${s.map ? "★ " : ""}${s.name}${s.surrendered ? " [kapituliert]" : ""}`, x + 12, y - 8);
      }
      ctx.fillStyle = "#8c96a5";
      ctx.fillText(`100 px = ${km(100 / Math.max(v.scale, 1e-12))}`, 8, h - 10);
    }

    if (box) {
      ctx.strokeStyle = "#f0c83c";
      ctx.fillStyle = "rgba(240,200,60,0.08)";
      const bx = Math.min(box.x0, box.x1);
      const by = Math.min(box.y0, box.y1);
      ctx.fillRect(bx, by, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
      ctx.strokeRect(bx, by, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
    }

    ctx.fillStyle = "#8c96a5";
    ctx.font = "12px sans-serif";
    ctx.fillText(
      mode === "system"
        ? "Links: auswählen / Rahmen ziehen (Shift = dazu) · Rechts: bewegen / Feind angreifen · Mitte ziehen: verschieben"
        : "Links: System öffnen · Rechts: gewählte Schiffe dorthin springen · Mitte ziehen: verschieben",
      8,
      18,
    );
  }, [mode, cur.view, stat, ships, bodies, bodiesById, now, selectedIds, systemId, systemsById, factionColor, box, showRoutes, size]);

  /* ---------------------------------------------------------------- */
  /* Maus                                                               */
  /* ---------------------------------------------------------------- */

  const toWorld = (sx: number, sy: number): [number, number] => {
    const c = canvasRef.current!;
    const v = cur.view;
    return [v.cx + (sx - c.width / 2) / v.scale, v.cy - (sy - c.height / 2) / v.scale];
  };

  const canvasPos = (event: React.MouseEvent): [number, number] => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return [((event.clientX - rect.left) * c.width) / rect.width, ((event.clientY - rect.top) * c.height) / rect.height];
  };

  const nearest = (sx: number, sy: number) => {
    const c = canvasRef.current!;
    const v = cur.view;
    const screen = (x: number, y: number) => [c.width / 2 + (x - v.cx) * v.scale, c.height / 2 - (y - v.cy) * v.scale];
    if (mode === "system") {
      let best: LiveShip | null = null;
      let bestD = 14;
      for (const s of ships) {
        if (s.systemId !== systemId) continue;
        const [x, y] = screen(s.p[0], s.p[1]);
        const d = Math.hypot(x - sx, y - sy);
        if (d < bestD) {
          best = s;
          bestD = d;
        }
      }
      return { ship: best, system: null as null | { id: string; name: string } };
    }
    let best: { id: string; name: string } | null = null;
    let bestD = 12;
    for (const s of stat?.systems ?? []) {
      const [x, y] = screen(s.x, s.y);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return { ship: null, system: best };
  };

  // Befehlbare Schiffe der Auswahl (das Map-Schiff steuern die Spieler)
  const commandable = () => (live?.ships ?? []).filter((x) => selectedIds.includes(x.id) && !x.map && x.state !== "destroyed");

  const leftClick = (sx: number, sy: number, shift: boolean) => {
    const hit = nearest(sx, sy);
    if (mode === "galaxy") {
      if (hit.system) setSystemId(hit.system.id);
      return;
    }
    if (hit.ship) {
      const id = hit.ship.id;
      setSelectedIds((list) => (shift ? (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]) : [id]));
    } else if (!shift) {
      setSelectedIds([]);
    }
  };

  const boxSelect = (b: { x0: number; y0: number; x1: number; y1: number }, shift: boolean) => {
    if (mode !== "system") return;
    const c = canvasRef.current!;
    const v = cur.view;
    const minX = Math.min(b.x0, b.x1);
    const maxX = Math.max(b.x0, b.x1);
    const minY = Math.min(b.y0, b.y1);
    const maxY = Math.max(b.y0, b.y1);
    const inBox = ships
      .filter((x) => x.systemId === systemId && x.state !== "hyperspace")
      .filter((x) => {
        const px = c.width / 2 + (x.p[0] - v.cx) * v.scale;
        const py = c.height / 2 - (x.p[1] - v.cy) * v.scale;
        return px >= minX && px <= maxX && py >= minY && py <= maxY;
      })
      .map((x) => x.id);
    setSelectedIds((list) => (shift ? [...new Set([...list, ...inBox])] : inBox));
  };

  const rightClick = (sx: number, sy: number) => {
    if (!canEdit) return;
    const group = commandable();
    if (group.length === 0) {
      setMessage({ ok: false, text: "Keine befehlbaren Schiffe gewählt (Links ziehen = Rahmen)" });
      return;
    }
    const hit = nearest(sx, sy);

    if (mode === "galaxy") {
      if (!hit.system) return;
      const target = hit.system;
      void sendMany(
        group.filter((x) => x.systemId !== target.id).map((x) => ({ action: "order", id: x.id, type: "jump", systemId: target.id })),
        `${group.length} Schiff(e) springen nach ${target.name}`,
      );
      return;
    }

    // Auf ein Schiff einer anderen Fraktion: angreifen
    if (hit.ship && !selectedIds.includes(hit.ship.id)) {
      const target = hit.ship;
      const attackers = group.filter((x) => x.factionId !== target.factionId);
      if (attackers.length > 0) {
        void sendMany(
          attackers.map((x) => ({ action: "order", id: x.id, type: "attack", targetId: target.id })),
          `${attackers.length} Schiff(e) greifen ${target.name} an`,
        );
        return;
      }
    }

    // Sonst bewegen (nur im System des Map-Schiffs: Befehle sind relativ zu ihm)
    if (!mapShip || mapShip.systemId !== systemId) {
      setMessage({ ok: false, text: "Bewegen geht nur im System des Map-Schiffs" });
      return;
    }
    const [wx, wy] = hit.ship ? [hit.ship.p[0], hit.ship.p[1]] : toWorld(sx, sy);
    // Mehrere Schiffe nebeneinander statt auf einen Punkt (Raster, 4 km Abstand)
    const cols = Math.ceil(Math.sqrt(group.length));
    void sendMany(
      group.map((x, i) => {
        const ox = ((i % cols) - (cols - 1) / 2) * 4000;
        const oy = (Math.floor(i / cols) - (Math.ceil(group.length / cols) - 1) / 2) * 4000;
        return {
          action: "order",
          id: x.id,
          type: "move",
          x: (wx + ox - mapShip.p[0]) / 1000,
          y: (wy + oy - mapShip.p[1]) / 1000,
          z: (x.p[2] - mapShip.p[2]) / 1000,
        };
      }),
      `${group.length} Schiff(e) fliegen los`,
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedIds([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------------------------------------------------------------- */
  /* Ausgabe                                                            */
  /* ---------------------------------------------------------------- */

  const stale = live ? Date.now() / 1000 - live.updatedAt : Infinity;
  const fleetOf = (s: LiveShip) => live?.fleets.find((f) => f.id === s.fleetId);
  const cls = selected ? stat?.classes.find((c) => c.id === selected.classId) : undefined;
  const hardpoints = selected ? (selected.map && stat?.mapHardpoints.length ? stat.mapHardpoints : cls?.hardpoints ?? []) : [];
  const shipsHere = ships.filter((s) => s.systemId === systemId);

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}

      <div className="button-row" style={{ marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button className={mode === "system" ? "primary" : undefined} onClick={() => setMode("system")}>
          Systemkarte
        </button>
        <button className={mode === "galaxy" ? "primary" : undefined} onClick={() => setMode("galaxy")}>
          Galaxiekarte
        </button>
        <button onClick={() => mapShip && setSystemId(mapShip.systemId)} disabled={!mapShip}>
          Zum Map-Schiff
        </button>
        <select value={factionFilter} onChange={(e) => setFactionFilter(e.target.value)} style={{ ...inputStyle, maxWidth: 220 }}>
          <option value="">Alle Fraktionen</option>
          {stat?.factions.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}>
          <input type="checkbox" checked={showRoutes} onChange={(e) => setShowRoutes(e.target.checked)} /> Wegpunkte
        </label>
        {live && (
          <span style={{ color: ALERT[live.alert]?.color ?? "#ccc", fontWeight: 600 }}>{ALERT[live.alert]?.label}</span>
        )}
        <span className="subtitle" style={{ margin: 0 }}>
          {!live
            ? "Keine Live-Daten"
            : stale > 10
              ? `Stand vor ${Math.round(stale)} s (Server schläft oder ist aus)`
              : `Live · ${systemsById.get(systemId ?? "")?.name ?? "-"}${live.paused ? " · PAUSIERT" : ""}`}
        </span>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div ref={wrapRef} className="panel" style={{ flex: 1, minWidth: 560, padding: 0, overflow: "hidden" }}>
          <canvas
            ref={canvasRef}
            width={size.w}
            height={size.h}
            style={{ width: "100%", display: "block", cursor: "default" }}
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={(e) => {
              const [x, y] = canvasPos(e);
              if (e.button === 1) {
                // Mitte: Karte verschieben
                e.preventDefault();
                cur.drag.current = { x, y, cx: cur.view.cx, cy: cur.view.cy, moved: false };
              } else if (e.button === 0) {
                setBox({ x0: x, y0: y, x1: x, y1: y });
              }
            }}
            onMouseMove={(e) => {
              const [x, y] = canvasPos(e);
              const d = cur.drag.current;
              if (d) {
                d.moved = true;
                cur.setView({ ...cur.view, cx: d.cx - (x - d.x) / cur.view.scale, cy: d.cy + (y - d.y) / cur.view.scale });
              }
              if (box) setBox({ ...box, x1: x, y1: y });
            }}
            onMouseUp={(e) => {
              const [x, y] = canvasPos(e);
              if (e.button === 1) {
                cur.drag.current = null;
                return;
              }
              if (e.button === 2) {
                rightClick(x, y);
                return;
              }
              if (e.button === 0 && box) {
                const moved = Math.abs(box.x1 - box.x0) + Math.abs(box.y1 - box.y0) > 6;
                if (moved) boxSelect({ ...box, x1: x, y1: y }, e.shiftKey);
                else leftClick(x, y, e.shiftKey);
                setBox(null);
              }
            }}
            onMouseLeave={() => {
              cur.drag.current = null;
              setBox(null);
            }}
            onWheel={(e) => {
              const [x, y] = canvasPos(e);
              const [wx, wy] = toWorld(x, y);
              const scale = cur.view.scale * (e.deltaY < 0 ? 1.25 : 0.8);
              const c = canvasRef.current!;
              cur.setView({ scale, cx: wx - (x - c.width / 2) / scale, cy: wy + (y - c.height / 2) / scale });
            }}
          />
        </div>

        <div style={{ flex: "0 0 380px", minWidth: 320, maxHeight: size.h, overflowY: "auto" }}>
          <div className="panel" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>
              {selected ? `${selected.map ? "★ " : ""}${selected.name}` : selectedIds.length > 1 ? `${selectedIds.length} Schiffe gewählt` : "Schiffe wählen"}
            </h3>
            {selectedIds.length > 0 && canEdit && (
              <div className="button-row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
                <button
                  disabled={busy}
                  onClick={() => void sendMany(commandable().map((x) => ({ action: "order", id: x.id, type: "hold" })), "Halten")}
                >
                  Halten
                </button>
                <button
                  disabled={busy}
                  onClick={() => void sendMany(commandable().map((x) => ({ action: "order", id: x.id, type: "jumpnear" })), "Springen zum Map-Schiff")}
                >
                  Zum Map-Schiff
                </button>
                {selectedIds.length > 1 && (
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) void sendMany(commandable().map((x) => ({ action: "roe", id: x.id, roe: e.target.value })), "Feuerverhalten gesetzt");
                      e.target.value = "";
                    }}
                    style={{ ...inputStyle, maxWidth: 200 }}
                  >
                    <option value="">Feuerbefehl für alle…</option>
                    {Object.entries(ROE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            {selectedIds.length > 1 && (
              <div style={{ fontSize: 13, marginBottom: 6 }}>
                {(live?.ships ?? [])
                  .filter((x) => selectedIds.includes(x.id))
                  .map((x) => (
                    <div key={x.id} style={{ display: "flex", gap: 8 }}>
                      <span style={{ flex: 1 }}>
                        {x.map ? "★ " : ""}
                        {x.name}
                      </span>
                      <span className="subtitle" style={{ margin: 0 }}>
                        {x.hull} %
                      </span>
                    </div>
                  ))}
              </div>
            )}
            {selected && (
              <>
                <p className="subtitle" style={{ marginTop: 0 }}>
                  {className(selected.classId)} · {factionName(selected.factionId)} · {systemsById.get(selected.systemId)?.name ?? selected.systemId}
                </p>
                <Bar label="Hülle" value={selected.hull} color={selected.hull > 50 ? "#5ad282" : selected.hull > 25 ? "#f0c83c" : "#f0463c"} />
                {selected.shield !== undefined && (
                  <Bar label={`Schilde${selected.shieldsUp ? "" : " (unten)"}`} value={selected.shield} color="#6eb4ff" />
                )}
                {selected.morale !== undefined && <Bar label="Moral" value={selected.morale} color="#b48cff" />}
                <p style={{ margin: "6px 0", fontSize: 14 }}>
                  {STATE_LABEL[selected.state] ?? selected.state} · {selected.speed} m/s
                  {selected.order ? ` · ${ORDER_LABEL[selected.order] ?? selected.order}` : ""}
                  {selected.roe ? ` · ${ROE_LABEL[selected.roe] ?? selected.roe}` : ""}
                  {selected.jump ? ` · → ${systemsById.get(selected.jump.to)?.name ?? selected.jump.to}${selected.jump.eta !== undefined ? ` in ${selected.jump.eta} s` : ""}` : ""}
                  {fleetOf(selected) ? ` · Flotte ${fleetOf(selected)?.name}` : ""}
                  {selected.target ? ` · Ziel: ${live?.ships.find((t) => t.id === selected.target)?.name ?? "#" + selected.target}` : ""}
                  {selected.surrendered ? " · kapituliert" : ""}
                  {selected.interdictor ? " · Abfangfeld" : ""}
                </p>

                {canEdit && !selected.map && (
                  <select
                    value={selected.roe ?? "return"}
                    onChange={(e) => void send({ action: "roe", id: selected.id, roe: e.target.value }, "Feuerverhalten gesetzt")}
                    style={inputStyle}
                  >
                    {Object.entries(ROE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}

                {hardpoints.length > 0 && cls && <HardpointSchema hardpoints={hardpoints} />}
              </>
            )}
          </div>

          <div className="panel" style={{ marginBottom: 12, maxHeight: 260, overflowY: "auto" }}>
            <div className="card-label">Schiffe im System ({shipsHere.length})</div>
            {shipsHere.map((s) => (
              <div
                key={s.id}
                onClick={(e) =>
                  setSelectedIds((list) => (e.shiftKey ? (list.includes(s.id) ? list.filter((x) => x !== s.id) : [...list, s.id]) : [s.id]))
                }
                style={{ cursor: "pointer", padding: "2px 0", display: "flex", gap: 8, alignItems: "center", fontWeight: selectedIds.includes(s.id) ? 600 : undefined }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 5, background: factionColor(s.factionId), display: "inline-block" }} />
                <span style={{ flex: 1 }}>
                  {s.map ? "★ " : ""}
                  {s.name}
                </span>
                <span className="subtitle" style={{ margin: 0 }}>
                  {s.hull} %
                </span>
              </div>
            ))}
          </div>

          <div className="panel" style={{ maxHeight: 300, overflowY: "auto" }}>
            <div className="card-label">Funk und Logbuch</div>
            {[...(live?.comms ?? []).map((c) => ({ t: c.t, text: `${c.from}${c.to ? " → " + c.to : ""}: ${c.text}`, kind: "comms" })),
              ...log.map((l) => ({ t: Number(l.ts), text: `${l.author ? l.author + ": " : ""}${l.text}`, kind: l.kind }))]
              .sort((a, b) => b.t - a.t)
              .slice(0, 40)
              .map((e, i) => (
                <div key={i} style={{ fontSize: 13, padding: "2px 0", color: e.kind === "comms" ? "#8cdcff" : e.kind === "damage" ? "#f0a050" : undefined }}>
                  <span className="subtitle" style={{ margin: 0 }}>
                    {new Date(e.t * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                  </span>{" "}
                  {e.text}
                </div>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ marginBottom: 4, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        <span>{value} %</span>
      </div>
      <div style={{ height: 6, background: "rgba(255,255,255,0.1)" }}>
        <div style={{ height: 6, width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
      </div>
    </div>
  );
}

// Draufsicht der Geschützstellungen: Bug oben, Feuerbögen als Fächer
function HardpointSchema({ hardpoints }: { hardpoints: Hardpoint[] }) {
  const W = 300;
  const H = 300;
  const s = 380; // Pixel je Schiffslänge
  const cx = W / 2;
  const cy = H / 2;
  const pos = (hp: Hardpoint) => [cx - (hp.y ?? 0) * s, cy - (hp.x ?? 0) * s];
  return (
    <>
      <div className="card-label" style={{ marginTop: 10 }}>
        Geschützstellungen ({hardpoints.length})
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: "#06090e" }}>
        <rect x={cx - 0.08 * s} y={cy - 0.5 * s} width={0.16 * s} height={s} fill="none" stroke="rgba(255,255,255,0.25)" />
        <text x={cx} y={12} fill="#8c96a5" fontSize={10} textAnchor="middle">
          Bug
        </text>
        {hardpoints.map((hp, i) => {
          const [x, y] = pos(hp);
          const arc = Math.min(hp.arcH ?? 90, 179);
          const dir = ((hp.yaw ?? 0) * Math.PI) / 180;
          const r = 45;
          // Richtung: yaw 0 = Bug (oben), + = links
          const pt = (a: number) => [x - Math.sin(a) * r, y - Math.cos(a) * r];
          const [x1, y1] = pt(dir - (arc * Math.PI) / 180);
          const [x2, y2] = pt(dir + (arc * Math.PI) / 180);
          const large = arc > 90 ? 1 : 0;
          return (
            <g key={i}>
              <path d={`M ${x} ${y} L ${x1} ${y1} A ${r} ${r} 0 ${large} 0 ${x2} ${y2} Z`} fill="rgba(255,120,90,0.12)" stroke="rgba(255,120,90,0.4)" />
              <circle cx={x} cy={y} r={3} fill="#ff7a5a">
                <title>{`${hp.group || hp.type} ×${hp.count ?? 1}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
    </>
  );
}
