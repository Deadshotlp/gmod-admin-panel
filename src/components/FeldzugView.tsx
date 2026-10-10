"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Field, Notice, fetchWithTimeout, inputStyle, readJson } from "./ui";

/* ------------------------------------------------------------------------ */
/* Daten                                                                     */
/* ------------------------------------------------------------------------ */

type Side = "republik" | "kus";
const SIDES: Side[] = ["republik", "kus"];
const SIDE_NAME: Record<Side, string> = { republik: "Republik", kus: "KUS" };
const SIDE_COLOR: Record<Side, string> = { republik: "#4a8fe0", kus: "#d9583b" };
const CATEGORY_NAME: Record<string, string> = {
  infantry: "Infanterie", heavy: "Schwere Infanterie", armor: "Panzer", artillery: "Artillerie", ship: "Schiff",
};
const TRAIT_NAME: Record<string, string> = { shipyard: "Werft", foundry: "Fabrikwelt", clones: "Klonwelt", capital: "Hauptwelt" };
const STATUS_NAME: Record<string, string> = { setup: "Aufbau", running: "läuft", ended: "beendet" };

// Regionsnamen vereinheitlichen wie in der Strategieansicht
const REGION_ALIAS: Record<string, string> = {
  outer: "Outer Rim", mid: "Mid Rim", inner: "Inner Rim", core: "Core Worlds", expansion: "Expansion Region",
  wild: "Wild Space", unknown: "Unknown Regions", deep: "Deep Core", hutt: "Hutt Space", colonies: "Colonies",
};
const normRegion = (r: string) => {
  const t = (r ?? "").replace(/^\*+/, "").trim();
  return REGION_ALIAS[t.toLowerCase()] ?? t;
};

interface GalaxySystem {
  id: string;
  name: string;
  x: number;
  y: number;
  region: string;
  sector: string;
}
interface Galaxy {
  systems: GalaxySystem[];
  routes: Array<{ major: boolean; lines: number[][][] }>;
}

interface UnitType {
  key: string;
  side: Side;
  category: string;
  name: string;
  men: number;
  cost: number;
  buildTurns: number;
  attack: number;
  defense: number;
  speed: number;
  capacity: number;
  navalClass: string;
  buildAt: string;
  position: number;
}

interface Settings {
  startPoints: number;
  actionsPerTurn: number;
  occupyCostPerTier: number;
  incomePerTier: number;
  supplyHop: number;
  garrisonType: Record<Side, string>;
  defaultBattleMode: "ki" | "spieler";
  routeMajor: number;
  routeMinor: number;
  junctionDist: number;
}

interface ListData {
  isAdmin: boolean;
  campaigns: Array<{ id: number; name: string; status: string; turn: number; mySide: Side | null }>;
  unitTypes: UnitType[];
  panelUsers: Array<{ steamId: string; displayName: string }>;
  defaults: Settings;
}

interface ViewSystem {
  id: string;
  name: string;
  x: number;
  y: number;
  tier: number;
  traits: string[];
  owner: Side | null | "?";
  fort: number | null;
  contested: boolean;
  hq: Side | null;
  reachable: boolean;
}

interface ViewUnit {
  id: number;
  side: Side;
  type: string;
  systemId: string;
  strength: number;
  xp: number;
  status: string;
  name: string;
  category: string;
  men: number;
}

interface CampaignView {
  viewer: { kind: "admin" } | { kind: "side"; side: Side };
  campaign: { id: number; name: string; status: string; turn: number; settings: Settings };
  sides: Array<{ side: Side; points: number; ready: boolean; hq: string; systems: number; commanders: Array<{ steamId: string; name: string }> }>;
  systems: ViewSystem[];
  units: ViewUnit[];
  reports: Array<{ turn: number; side: string; kind: string; text: string; created_at: number }>;
  unitTypes: UnitType[];
}

type Tab = "karte" | "gebiet" | "kommandeure" | "einstellungen" | "katalog";

/* ------------------------------------------------------------------------ */
/* Hauptkomponente                                                           */
/* ------------------------------------------------------------------------ */

export default function FeldzugView() {
  const [list, setList] = useState<ListData | null>(null);
  const [galaxy, setGalaxy] = useState<Galaxy | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [data, setData] = useState<CampaignView | null>(null);
  const [tab, setTab] = useState<Tab>("karte");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // Spielleitung handelt für eine Seite
  const [actAs, setActAs] = useState<Side>("republik");

  const loadList = useCallback(async () => {
    const { data: d, error } = await readJson<ListData>(await fetchWithTimeout("/api/feldzug", { cache: "no-store" }));
    if (error || !d) return setMessage({ ok: false, text: error ?? "Fehler" });
    setList(d);
    setCampaignId((cur) => cur ?? d.campaigns[0]?.id ?? null);
  }, []);

  const loadCampaign = useCallback(async (id: number) => {
    const { data: d, error } = await readJson<CampaignView>(await fetchWithTimeout(`/api/feldzug?id=${id}`, { cache: "no-store" }));
    if (error || !d) return setMessage({ ok: false, text: error ?? "Fehler" });
    setData(d);
  }, []);

  useEffect(() => {
    void loadList();
    void (async () => {
      const { data: g } = await readJson<Galaxy>(await fetchWithTimeout("/api/feldzug?static=1", { cache: "no-store" }, 60_000));
      if (g) setGalaxy(g);
    })();
  }, [loadList]);

  useEffect(() => {
    if (campaignId != null) void loadCampaign(campaignId);
    else setData(null);
  }, [campaignId, loadCampaign]);

  const post = async (body: Record<string, unknown>, after?: () => void) => {
    setBusy(true);
    try {
      const response = await fetchWithTimeout("/api/feldzug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }, 120_000);
      const { data: d, error } = await readJson<{ ok: boolean; message?: string; id?: number }>(response);
      if (error || !d) {
        setMessage({ ok: false, text: error ?? "Fehler" });
        return null;
      }
      setMessage({ ok: true, text: d.message || "Gespeichert" });
      after?.();
      return d;
    } finally {
      setBusy(false);
    }
  };

  const isAdmin = !!list?.isAdmin;
  const viewer = data?.viewer;
  const mySide: Side | null = viewer?.kind === "side" ? viewer.side : null;
  const lead = viewer?.kind === "admin";
  const actSide: Side = mySide ?? actAs;
  const setup = data?.campaign.status === "setup";

  const refresh = () => {
    if (campaignId != null) void loadCampaign(campaignId);
    void loadList();
  };
  /** Befehl im aktuellen Feldzug (Spielleitung mit gewählter Seite) */
  const op = (o: string, extra: Record<string, unknown> = {}) =>
    post({ op: o, id: campaignId, ...(lead ? { side: actAs } : {}), ...extra }, refresh);

  const [newName, setNewName] = useState("");

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}

      <div className="button-row" style={{ marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={campaignId ?? ""}
          onChange={(e) => {
            setCampaignId(e.target.value ? Number(e.target.value) : null);
            setSelected(null);
          }}
          style={{ ...inputStyle, maxWidth: 320 }}
        >
          {list?.campaigns.length === 0 && <option value="">Kein Feldzug</option>}
          {list?.campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({STATUS_NAME[c.status] ?? c.status}{c.status === "running" ? `, Zug ${c.turn}` : ""})
              {c.mySide ? ` - ${SIDE_NAME[c.mySide]}` : ""}
            </option>
          ))}
        </select>
        <button onClick={refresh} disabled={busy}>Aktualisieren</button>
        {isAdmin && (
          <>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name des neuen Feldzugs"
              style={{ ...inputStyle, maxWidth: 240 }}
            />
            <button
              disabled={busy || !newName.trim()}
              onClick={() =>
                void post({ op: "create", name: newName.trim() }, () => {
                  setNewName("");
                }).then((d) => {
                  if (d?.id) {
                    setCampaignId(d.id);
                    setTab("gebiet");
                  }
                  void loadList();
                })
              }
            >
              Neuer Feldzug
            </button>
          </>
        )}
      </div>

      {list && list.campaigns.length === 0 && !isAdmin && (
        <div className="panel">Du bist in keinem Feldzug als Kommandeur eingetragen.</div>
      )}

      {data && (
        <>
          <div className="cards" style={{ marginBottom: 12 }}>
            {data.sides.map((s) => (
              <div key={s.side} className="card" style={{ borderLeft: `4px solid ${SIDE_COLOR[s.side]}` }}>
                <div className="card-label">{SIDE_NAME[s.side]}{mySide === s.side ? " (deine Seite)" : ""}</div>
                <div className="card-value">{s.points.toLocaleString("de-DE")} Punkte</div>
                <div className="card-sub">
                  {s.systems} Systeme · HQ {data.systems.find((x) => x.id === s.hq)?.name ?? "fehlt"} ·{" "}
                  {s.ready ? "bereit" : "nicht bereit"}
                  <br />
                  Kommandeur: {s.commanders.map((c) => c.name).join(", ") || "-"}
                </div>
              </div>
            ))}
            <div className="card">
              <div className="card-label">Feldzug</div>
              <div className="card-value">{STATUS_NAME[data.campaign.status]}{data.campaign.status === "running" ? ` · Zug ${data.campaign.turn}` : ""}</div>
              <div className="card-sub">{data.systems.length} Systeme im Gebiet</div>
            </div>
          </div>

          {lead && (
            <div className="button-row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
              {(["karte", "gebiet", "kommandeure", "einstellungen", "katalog"] as Tab[]).map((t) => (
                <button key={t} className={tab === t ? "primary" : undefined} onClick={() => setTab(t)}>
                  {{ karte: "Karte", gebiet: "Gebiet & HQs", kommandeure: "Kommandeure", einstellungen: "Einstellungen", katalog: "Einheitenkatalog" }[t]}
                </button>
              ))}
              {tab === "karte" && setup && (
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}>
                  Handeln als
                  <select value={actAs} onChange={(e) => setActAs(e.target.value as Side)} style={{ ...inputStyle, width: 140 }}>
                    {SIDES.map((s) => <option key={s} value={s}>{SIDE_NAME[s]}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}

          {(tab === "karte" || tab === "gebiet" || !lead) && galaxy && (
            <CampaignMap
              galaxy={galaxy}
              data={data}
              regionEdit={lead && tab === "gebiet" && setup}
              selected={selected}
              onSelect={setSelected}
              busy={busy}
              onRegion={(ids) => void post({ op: "setRegion", id: campaignId, systemIds: ids }, refresh)}
              sidebar={
                lead && tab === "gebiet" ? (
                  <HqPanel data={data} selected={selected} busy={busy} onHq={(side, systemId) => void post({ op: "setHq", id: campaignId, side, systemId }, refresh)} />
                ) : (
                  <SystemPanel
                    data={data}
                    selected={selected}
                    side={actSide}
                    canAct={!!setup && (lead || !!mySide)}
                    busy={busy}
                    op={op}
                  />
                )
              }
            />
          )}
          {!galaxy && <div className="panel">Galaxie wird geladen…</div>}

          {(tab === "karte" || !lead) && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16, alignItems: "flex-start" }}>
              <ForcesPanel data={data} side={actSide} lead={lead} onSelect={setSelected} />
              <div className="panel" style={{ flex: 1, minWidth: 320 }}>
                <h3 style={{ marginTop: 0 }}>Berichte</h3>
                {setup && (lead || mySide) && (
                  <div className="button-row" style={{ marginBottom: 8 }}>
                    {(() => {
                      const me = data.sides.find((s) => s.side === actSide);
                      return (
                        <button className={me?.ready ? undefined : "primary"} disabled={busy} onClick={() => void op("ready", { ready: !me?.ready })}>
                          {me?.ready ? "Bereit zurücknehmen" : `Aufbau abgeschlossen (${SIDE_NAME[actSide]})`}
                        </button>
                      );
                    })()}
                  </div>
                )}
                <div style={{ maxHeight: 320, overflowY: "auto", fontSize: 13 }}>
                  {data.reports.length === 0 && <div className="subtitle">Noch keine Berichte.</div>}
                  {data.reports.map((r, i) => (
                    <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ color: "var(--text-muted)" }}>Zug {r.turn}{lead ? ` · ${SIDE_NAME[r.side as Side] ?? r.side}` : ""}:</span> {r.text}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {lead && tab === "kommandeure" && list && (
            <CommandersPanel data={data} users={list.panelUsers} busy={busy} onSave={(l) => void post({ op: "commanders", id: campaignId, list: l }, refresh)} />
          )}
          {lead && tab === "einstellungen" && (
            <SettingsPanel
              data={data}
              busy={busy}
              onSave={(s) => void post({ op: "settings", id: campaignId, settings: s }, refresh)}
              onRename={(name) => void post({ op: "rename", id: campaignId, name }, refresh)}
              onStart={() => void post({ op: "start", id: campaignId }, refresh)}
              onDelete={() =>
                void post({ op: "delete", id: campaignId }, () => {
                  setCampaignId(null);
                  setData(null);
                  void loadList();
                })
              }
            />
          )}
          {lead && tab === "katalog" && list && (
            <CatalogPanel types={list.unitTypes} busy={busy} onSave={(t) => void post({ op: "unitTypeSave", unitType: t }, refresh)} onDelete={(key) => void post({ op: "unitTypeDelete", key }, refresh)} />
          )}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Karte                                                                     */
/* ------------------------------------------------------------------------ */

interface ViewState {
  cx: number;
  cy: number;
  scale: number;
}

function CampaignMap({
  galaxy,
  data,
  regionEdit,
  selected,
  onSelect,
  onRegion,
  busy,
  sidebar,
}: {
  galaxy: Galaxy;
  data: CampaignView;
  regionEdit: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onRegion: (ids: string[]) => void;
  busy: boolean;
  sidebar: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 1000, h: 640 });
  const [view, setView] = useState<ViewState>({ cx: 0, cy: 0, scale: 0.02 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const [box, setBox] = useState<null | { x0: number; y0: number; x1: number; y1: number }>(null);
  // Gebiet bearbeiten: gesammelte Auswahl
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [regionPick, setRegionPick] = useState("");

  const campaignIds = useMemo(() => new Set(data.systems.map((s) => s.id)), [data.systems]);
  const byId = useMemo(() => new Map(data.systems.map((s) => [s.id, s])), [data.systems]);
  const unitsAt = useMemo(() => {
    const m = new Map<string, Record<Side, number>>();
    for (const u of data.units) {
      const e = m.get(u.systemId) ?? { republik: 0, kus: 0 };
      e[u.side] += u.men * u.strength;
      m.set(u.systemId, e);
    }
    return m;
  }, [data.units]);

  useEffect(() => {
    setPending(new Set(campaignIds));
  }, [campaignIds, regionEdit]);

  // Auf das Gebiet ausrichten (sonst ganze Galaxie)
  const fitted = useRef<number | null>(null);
  useEffect(() => {
    if (fitted.current === data.campaign.id && !regionEdit) return;
    const pts = data.systems.length > 1 ? data.systems : galaxy.systems;
    if (pts.length === 0) return;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const span = Math.max(x1 - x0, y1 - y0, 200);
    setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale: (Math.min(size.w, size.h) * 0.9) / span });
    fitted.current = data.campaign.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.campaign.id, data.systems.length, galaxy, regionEdit]);

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
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    c.addEventListener("wheel", stop, { passive: false });
    return () => c.removeEventListener("wheel", stop);
  }, []);

  const toScreen = useCallback(
    (x: number, y: number): [number, number] => [size.w / 2 + (x - view.cx) * view.scale, size.h / 2 - (y - view.cy) * view.scale],
    [size, view],
  );
  const toWorld = (sx: number, sy: number): [number, number] => [view.cx + (sx - size.w / 2) / view.scale, view.cy - (sy - size.h / 2) / view.scale];
  const canvasPos = (event: React.MouseEvent): [number, number] => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return [((event.clientX - rect.left) * c.width) / rect.width, ((event.clientY - rect.top) * c.height) / rect.height];
  };

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const { w, h } = size;
    ctx.fillStyle = "#06090e";
    ctx.fillRect(0, 0, w, h);
    ctx.font = "12px sans-serif";

    // Routen
    for (const r of galaxy.routes) {
      ctx.strokeStyle = r.major ? "rgba(90,140,220,0.45)" : "rgba(70,90,130,0.25)";
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

    // Galaxie blass (im Gebietsmodus: Auswahl hervorgehoben)
    for (const s of galaxy.systems) {
      const [x, y] = toScreen(s.x, s.y);
      if (x < -5 || x > w + 5 || y < -5 || y > h + 5) continue;
      if (regionEdit) {
        const on = pending.has(s.id);
        ctx.fillStyle = on ? "rgba(240,200,80,0.95)" : "rgba(150,160,180,0.35)";
        const r = on ? 2.5 : 1;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      } else if (!campaignIds.has(s.id) && view.scale > 0.05) {
        ctx.fillStyle = "rgba(150,160,180,0.25)";
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }

    // Feldzug-Systeme
    for (const s of data.systems) {
      const [x, y] = toScreen(s.x, s.y);
      if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
      const r = 3 + s.tier;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = s.owner === "?" ? "#2a2f3a" : s.owner ? SIDE_COLOR[s.owner] : "#8a93a6";
      ctx.globalAlpha = regionEdit ? 0.5 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (s.reachable) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = "#6fdc8c";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (s.hq) {
        ctx.strokeStyle = SIDE_COLOR[s.hq];
        ctx.lineWidth = 2;
        ctx.strokeRect(x - r - 4, y - r - 4, (r + 4) * 2, (r + 4) * 2);
      }
      if (s.contested) {
        ctx.strokeStyle = "rgba(255,70,60,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (s.id === selected) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      const forces = unitsAt.get(s.id);
      if (view.scale > 0.12 || s.hq || s.id === selected) {
        ctx.fillStyle = "#dfe6f2";
        ctx.fillText(s.name, x + r + 4, y - 2);
        if (forces) {
          let dx = 0;
          for (const side of SIDES) {
            if (!forces[side]) continue;
            ctx.fillStyle = SIDE_COLOR[side];
            const label = `${Math.round(forces[side])}`;
            ctx.fillText(label, x + r + 4 + dx, y + 12);
            dx += ctx.measureText(label).width + 6;
          }
        }
      }
    }

    if (box) {
      ctx.strokeStyle = "rgba(240,200,80,0.9)";
      ctx.strokeRect(Math.min(box.x0, box.x1), Math.min(box.y0, box.y1), Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
    }
  }, [galaxy, data, regionEdit, pending, selected, view, size, box, toScreen, campaignIds, unitsAt]);

  const nearest = (sx: number, sy: number) => {
    let best: ViewSystem | null = null;
    let bd = 14;
    for (const s of data.systems) {
      const [x, y] = toScreen(s.x, s.y);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  };

  const regions = useMemo(() => {
    const set = new Map<string, number>();
    for (const s of galaxy.systems) {
      for (const key of [`r:${normRegion(s.region)}`, s.sector ? `s:${s.sector}` : ""]) {
        if (key && key.length > 2) set.set(key, (set.get(key) ?? 0) + 1);
      }
    }
    return [...set.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [galaxy]);

  const applyGroup = (add: boolean) => {
    if (!regionPick) return;
    const [kind, name] = [regionPick.slice(0, 1), regionPick.slice(2)];
    const next = new Set(pending);
    for (const s of galaxy.systems) {
      if ((kind === "r" && normRegion(s.region) === name) || (kind === "s" && s.sector === name)) {
        if (add) next.add(s.id);
        else next.delete(s.id);
      }
    }
    setPending(next);
  };

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 560 }}>
        {regionEdit && (
          <div className="panel" style={{ marginBottom: 8 }}>
            <div className="button-row" style={{ flexWrap: "wrap", alignItems: "center" }}>
              <select value={regionPick} onChange={(e) => setRegionPick(e.target.value)} style={{ ...inputStyle, maxWidth: 300 }}>
                <option value="">Region oder Sektor…</option>
                {regions.map(([key, n]) => (
                  <option key={key} value={key}>
                    {key.startsWith("r:") ? "Region" : "Sektor"}: {key.slice(2)} ({n})
                  </option>
                ))}
              </select>
              <button onClick={() => applyGroup(true)} disabled={!regionPick}>Hinzufügen</button>
              <button onClick={() => applyGroup(false)} disabled={!regionPick}>Entfernen</button>
              <button onClick={() => setPending(new Set())}>Leeren</button>
              <button className="primary" disabled={busy || pending.size < 2} onClick={() => onRegion([...pending])}>
                Gebiet übernehmen ({pending.size} Systeme)
              </button>
            </div>
            <div className="subtitle" style={{ margin: "6px 0 0" }}>
              Linke Maustaste ziehen: Systeme hinzufügen, mit Umschalt: entfernen. Rechte Maustaste: verschieben. Übernehmen setzt HQs
              und alle Käufe zurück.
            </div>
          </div>
        )}
        <div ref={wrapRef} className="panel" style={{ padding: 0, overflow: "hidden" }}>
          <canvas
            ref={canvasRef}
            width={size.w}
            height={size.h}
            style={{ width: "100%", display: "block" }}
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={(e) => {
              const [x, y] = canvasPos(e);
              if (regionEdit && e.button === 0) {
                setBox({ x0: x, y0: y, x1: x, y1: y });
                return;
              }
              drag.current = { x, y, cx: view.cx, cy: view.cy, moved: false };
            }}
            onMouseMove={(e) => {
              const [x, y] = canvasPos(e);
              const d = drag.current;
              if (d) {
                if (Math.abs(x - d.x) + Math.abs(y - d.y) > 4) d.moved = true;
                if (d.moved) setView({ ...view, cx: d.cx - (x - d.x) / view.scale, cy: d.cy + (y - d.y) / view.scale });
              }
              if (box) setBox({ ...box, x1: x, y1: y });
            }}
            onMouseUp={(e) => {
              const [x, y] = canvasPos(e);
              if (box) {
                const [ax, ay] = toWorld(Math.min(box.x0, x), Math.max(box.y0, y));
                const [bx, by] = toWorld(Math.max(box.x0, x), Math.min(box.y0, y));
                const next = new Set(pending);
                for (const s of galaxy.systems) {
                  if (s.x >= ax && s.x <= bx && s.y >= ay && s.y <= by) {
                    if (e.shiftKey) next.delete(s.id);
                    else next.add(s.id);
                  }
                }
                setPending(next);
                setBox(null);
                return;
              }
              const d = drag.current;
              drag.current = null;
              if (d && !d.moved && e.button === 0) onSelect(nearest(x, y)?.id ?? null);
            }}
            onMouseLeave={() => {
              drag.current = null;
              setBox(null);
            }}
            onWheel={(e) => {
              const [x, y] = canvasPos(e);
              const [wx, wy] = toWorld(x, y);
              const scale = view.scale * (e.deltaY < 0 ? 1.25 : 0.8);
              setView({ scale, cx: wx - (x - size.w / 2) / scale, cy: wy + (y - size.h / 2) / scale });
            }}
          />
        </div>
        <div className="subtitle" style={{ marginTop: 6 }}>
          <span style={{ color: SIDE_COLOR.republik }}>●</span> Republik <span style={{ color: SIDE_COLOR.kus }}>●</span> KUS{" "}
          <span style={{ color: "#8a93a6" }}>●</span> neutral <span style={{ color: "#2a2f3a" }}>●</span> unbekannt ·{" "}
          <span style={{ color: "#6fdc8c" }}>◌</span> besetzbar · □ Hauptquartier · Größe = Systemwert · Zahlen = Mannstärke
          {byId.size === 0 && " · Noch kein Gebiet gewählt"}
        </div>
      </div>
      <div style={{ width: 360, maxWidth: "100%" }}>{sidebar}</div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Seitenleisten                                                             */
/* ------------------------------------------------------------------------ */

function SystemPanel({
  data,
  selected,
  side,
  canAct,
  busy,
  op,
}: {
  data: CampaignView;
  selected: string | null;
  side: Side;
  canAct: boolean;
  busy: boolean;
  op: (o: string, extra?: Record<string, unknown>) => Promise<unknown>;
}) {
  const sys = data.systems.find((s) => s.id === selected);
  const [buyType, setBuyType] = useState("");
  const [count, setCount] = useState(1);
  if (!sys) return <div className="panel">System auf der Karte anklicken.</div>;

  const units = data.units.filter((u) => u.systemId === sys.id);
  const settings = data.campaign.settings;
  const hq = data.sides.find((s) => s.side === side)?.hq;
  const isHq = hq === sys.id;
  const buildable = data.unitTypes.filter(
    (t) =>
      t.side === side &&
      (t.buildAt === "any" ||
        (t.buildAt === "shipyard" ? isHq || sys.traits.includes("shipyard") : isHq || sys.traits.includes("clones") || sys.traits.includes("foundry"))),
  );
  const chosen = buildable.find((t) => t.key === buyType) ?? buildable[0];
  const points = data.sides.find((s) => s.side === side)?.points ?? 0;
  const lead = data.viewer.kind === "admin";
  const occupyCost = sys.tier * settings.occupyCostPerTier;
  // Spielleitung: besetzbar, wenn neutral (Verbindung prüft der Server)
  const canOccupy = canAct && sys.owner === null && (sys.reachable || lead);

  // Einheiten gruppiert nach Seite und Typ
  const groups = new Map<string, ViewUnit[]>();
  for (const u of units) {
    const k = `${u.side}|${u.type}`;
    groups.set(k, [...(groups.get(k) ?? []), u]);
  }

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>{sys.name}</h3>
      <div style={{ fontSize: 14, lineHeight: 1.6 }}>
        Besitzer:{" "}
        <b style={{ color: sys.owner && sys.owner !== "?" ? SIDE_COLOR[sys.owner] : undefined }}>
          {sys.owner === "?" ? "unbekannt" : sys.owner ? SIDE_NAME[sys.owner] : "neutral"}
        </b>
        {sys.hq && <> · Hauptquartier {SIDE_NAME[sys.hq]}</>}
        <br />
        Systemwert {sys.tier} · Einkommen {sys.tier * settings.incomePerTier}/Zug
        {sys.fort != null && sys.fort > 0 && <> · Befestigung {sys.fort}</>}
        {sys.traits.length > 0 && (
          <>
            <br />
            {sys.traits.map((t) => TRAIT_NAME[t] ?? t).join(", ")}
          </>
        )}
      </div>

      <h4>Truppen</h4>
      {groups.size === 0 && <div className="subtitle">{sys.owner === "?" ? "Keine Aufklärung" : "Keine bekannten Einheiten"}</div>}
      {[...groups.entries()].map(([k, list]) => {
        const u = list[0];
        const own = u.side === side || lead;
        return (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, padding: "3px 0" }}>
            <span>
              <span style={{ color: SIDE_COLOR[u.side] }}>●</span> {list.length}× {u.name}
              <span style={{ color: "var(--text-muted)" }}> ({Math.round(list.reduce((a, x) => a + x.men * x.strength, 0))} Mann)</span>
            </span>
            {canAct && own && u.side === side && (
              <button style={{ padding: "2px 8px" }} disabled={busy} onClick={() => void op("sell", { unitId: list[list.length - 1].id })}>
                Auflösen
              </button>
            )}
          </div>
        );
      })}

      {canAct && (
        <>
          <h4>Aufbau ({SIDE_NAME[side]}, {points.toLocaleString("de-DE")} Punkte)</h4>
          {canOccupy && (
            <button className="primary" disabled={busy || points < occupyCost} onClick={() => void op("occupy", { systemId: sys.id })}>
              Besetzen ({occupyCost} Punkte, mit Garnison)
            </button>
          )}
          {sys.owner === null && !canOccupy && <div className="subtitle">Nicht mit eigenen Systemen verbunden.</div>}
          {sys.owner === side && !isHq && (
            <button disabled={busy} onClick={() => void op("release", { systemId: sys.id })} style={{ marginBottom: 8 }}>
              Aufgeben (+{occupyCost})
            </button>
          )}
          {sys.owner === side && buildable.length > 0 && chosen && (
            <div style={{ marginTop: 8 }}>
              <Field label="Einheit aufstellen">
                <select value={chosen.key} onChange={(e) => setBuyType(e.target.value)} style={inputStyle}>
                  {buildable.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name} - {t.cost} P ({t.category === "ship" ? "Schiff" : `${t.men} Mann`})
                    </option>
                  ))}
                </select>
              </Field>
              <div className="button-row">
                <input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} style={{ ...inputStyle, width: 80 }} />
                <button className="primary" disabled={busy || points < chosen.cost * count} onClick={() => void op("buy", { systemId: sys.id, type: chosen.key, count })}>
                  Kaufen ({chosen.cost * count} P)
                </button>
              </div>
              <div className="subtitle" style={{ marginTop: 6 }}>
                Angriff {chosen.attack} · Verteidigung {chosen.defense}
                {chosen.category === "ship" ? ` · Tempo ${chosen.speed} · Laderaum ${chosen.capacity}` : ""} · Bauzeit {chosen.buildTurns} Züge
              </div>
            </div>
          )}
          {sys.owner === side && buildable.length === 0 && <div className="subtitle">Hier kann nichts aufgestellt werden (HQ, Werften, Fabrikwelten).</div>}
        </>
      )}
    </div>
  );
}

function HqPanel({ data, selected, busy, onHq }: { data: CampaignView; selected: string | null; busy: boolean; onHq: (side: Side, systemId: string) => void }) {
  const sys = data.systems.find((s) => s.id === selected);
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Hauptquartiere</h3>
      {SIDES.map((side) => (
        <div key={side} style={{ fontSize: 14, marginBottom: 4 }}>
          <span style={{ color: SIDE_COLOR[side] }}>●</span> {SIDE_NAME[side]}:{" "}
          {data.systems.find((s) => s.id === data.sides.find((x) => x.side === side)?.hq)?.name ?? "nicht gesetzt"}
        </div>
      ))}
      <p className="subtitle">System im Gebiet anklicken, dann als HQ festlegen. Ein neues HQ setzt die Käufe dieser Seite zurück.</p>
      {sys ? (
        <>
          <b>{sys.name}</b> (Systemwert {sys.tier})
          <div className="button-row" style={{ marginTop: 8 }}>
            {SIDES.map((side) => (
              <button key={side} disabled={busy || data.campaign.status !== "setup"} onClick={() => onHq(side, sys.id)}>
                HQ {SIDE_NAME[side]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="subtitle">Kein System gewählt.</div>
      )}
    </div>
  );
}

function ForcesPanel({ data, side, lead, onSelect }: { data: CampaignView; side: Side; lead: boolean; onSelect: (id: string) => void }) {
  const shown = lead ? SIDES : [side];
  return (
    <div className="panel" style={{ flex: 1, minWidth: 320 }}>
      <h3 style={{ marginTop: 0 }}>Streitkräfte</h3>
      {shown.map((s) => {
        const units = data.units.filter((u) => u.side === s);
        const bySys = new Map<string, ViewUnit[]>();
        for (const u of units) bySys.set(u.systemId, [...(bySys.get(u.systemId) ?? []), u]);
        const men = Math.round(units.reduce((a, u) => a + (u.category === "ship" ? 0 : u.men * u.strength), 0));
        const ships = units.filter((u) => u.category === "ship").length;
        return (
          <div key={s} style={{ marginBottom: 12 }}>
            <b style={{ color: SIDE_COLOR[s] }}>{SIDE_NAME[s]}</b>{" "}
            <span className="subtitle">
              {men.toLocaleString("de-DE")} Mann · {ships} Schiffe
            </span>
            <table style={{ fontSize: 13, marginTop: 4 }}>
              <tbody>
                {[...bySys.entries()].map(([sid, list]) => {
                  const counts = new Map<string, number>();
                  list.forEach((u) => counts.set(u.name, (counts.get(u.name) ?? 0) + 1));
                  return (
                    <tr key={sid} style={{ cursor: "pointer" }} onClick={() => onSelect(sid)}>
                      <td style={{ whiteSpace: "nowrap" }}>{data.systems.find((x) => x.id === sid)?.name ?? sid}</td>
                      <td>{[...counts.entries()].map(([n, c]) => `${c}× ${n}`).join(", ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Spielleitung                                                              */
/* ------------------------------------------------------------------------ */

function CommandersPanel({
  data,
  users,
  busy,
  onSave,
}: {
  data: CampaignView;
  users: Array<{ steamId: string; displayName: string }>;
  busy: boolean;
  onSave: (list: Array<{ steamId: string; side: Side }>) => void;
}) {
  const [list, setList] = useState<Array<{ steamId: string; side: Side }>>([]);
  const [pick, setPick] = useState<Record<Side, string>>({ republik: "", kus: "" });
  useEffect(() => {
    setList(data.sides.flatMap((s) => s.commanders.map((c) => ({ steamId: c.steamId, side: s.side }))));
  }, [data]);
  const name = (id: string) => users.find((u) => u.steamId === id)?.displayName ?? id;

  return (
    <div className="panel">
      <p className="subtitle" style={{ marginTop: 0 }}>
        Kommandeure sehen im Panel nur ihre eigene Seite (Nebel des Krieges) - auch wenn sie Admin sind. Sie müssen als Panel-Benutzer
        eingetragen sein (Rolle Leser genügt). Die Spielleitung sollte selbst kein Kommando haben.
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {SIDES.map((side) => (
          <div key={side} style={{ minWidth: 280 }}>
            <h4 style={{ color: SIDE_COLOR[side] }}>{SIDE_NAME[side]}</h4>
            {list.filter((c) => c.side === side).map((c) => (
              <div key={c.steamId} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "3px 0" }}>
                {name(c.steamId)}
                <button style={{ padding: "2px 8px" }} onClick={() => setList(list.filter((x) => x.steamId !== c.steamId))}>
                  Entfernen
                </button>
              </div>
            ))}
            <div className="button-row" style={{ marginTop: 6 }}>
              <select value={pick[side]} onChange={(e) => setPick({ ...pick, [side]: e.target.value })} style={inputStyle}>
                <option value="">Panel-Benutzer…</option>
                {users.filter((u) => !list.some((c) => c.steamId === u.steamId)).map((u) => (
                  <option key={u.steamId} value={u.steamId}>{u.displayName}</option>
                ))}
              </select>
              <button disabled={!pick[side]} onClick={() => {
                setList([...list, { steamId: pick[side], side }]);
                setPick({ ...pick, [side]: "" });
              }}>
                Hinzufügen
              </button>
            </div>
          </div>
        ))}
      </div>
      <button className="primary" style={{ marginTop: 12 }} disabled={busy} onClick={() => onSave(list)}>
        Kommandeure speichern
      </button>
    </div>
  );
}

const SETTING_FIELDS: Array<{ key: keyof Settings; label: string; hint?: string; step?: number }> = [
  { key: "startPoints", label: "Startpunkte je Seite" },
  { key: "actionsPerTurn", label: "Aktionen je Zug" },
  { key: "occupyCostPerTier", label: "Besetzen: Kosten je Systemwert" },
  { key: "incomePerTier", label: "Einkommen je Systemwert und Zug" },
  { key: "supplyHop", label: "Nachschub-/Besetzungsweite", hint: "Effektive Parsec je Sprung (Routen zählen ×0,5 bzw. ×0,7)" },
  { key: "routeMajor", label: "Faktor Hauptrouten", step: 0.05 },
  { key: "routeMinor", label: "Faktor Nebenrouten", step: 0.05 },
  { key: "junctionDist", label: "Umstieg zwischen Routen (pc)" },
];

function SettingsPanel({
  data,
  busy,
  onSave,
  onRename,
  onStart,
  onDelete,
}: {
  data: CampaignView;
  busy: boolean;
  onSave: (s: Settings) => void;
  onRename: (name: string) => void;
  onStart: () => void;
  onDelete: () => void;
}) {
  const [s, setS] = useState<Settings>(data.campaign.settings);
  const [name, setName] = useState(data.campaign.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setS(data.campaign.settings);
    setName(data.campaign.name);
  }, [data.campaign]);
  const setup = data.campaign.status === "setup";
  const missing = SIDES.filter((side) => !data.sides.find((x) => x.side === side)?.hq);

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div className="panel" style={{ flex: 1, minWidth: 360 }}>
        <h3 style={{ marginTop: 0 }}>Regeln</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0 16px" }}>
          {SETTING_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <input
                type="number"
                step={f.step ?? 1}
                value={s[f.key] as number}
                onChange={(e) => setS({ ...s, [f.key]: Number(e.target.value) })}
                style={inputStyle}
              />
            </Field>
          ))}
          {SIDES.map((side) => (
            <Field key={side} label={`Garnison ${SIDE_NAME[side]}`}>
              <select value={s.garrisonType[side]} onChange={(e) => setS({ ...s, garrisonType: { ...s.garrisonType, [side]: e.target.value } })} style={inputStyle}>
                {data.unitTypes.filter((t) => t.side === side && t.category !== "ship").map((t) => (
                  <option key={t.key} value={t.key}>{t.name} ({t.men} Mann)</option>
                ))}
              </select>
            </Field>
          ))}
          <Field label="Gefechte standardmäßig">
            <select value={s.defaultBattleMode} onChange={(e) => setS({ ...s, defaultBattleMode: e.target.value as Settings["defaultBattleMode"] })} style={inputStyle}>
              <option value="ki">simulieren (KI)</option>
              <option value="spieler">durch Spieler</option>
            </select>
          </Field>
        </div>
        <button className="primary" disabled={busy} onClick={() => onSave(s)}>Regeln speichern</button>
      </div>

      <div className="panel" style={{ width: 360 }}>
        <h3 style={{ marginTop: 0 }}>Feldzug</h3>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        </Field>
        <button disabled={busy || !name.trim()} onClick={() => onRename(name.trim())}>Umbenennen</button>

        {setup && (
          <>
            <h4>Start</h4>
            <p className="subtitle">
              {missing.length > 0 ? `Es fehlt das HQ: ${missing.map((m) => SIDE_NAME[m]).join(", ")}.` : "Beide HQs gesetzt."}{" "}
              Bereit: {data.sides.map((x) => `${SIDE_NAME[x.side]} ${x.ready ? "ja" : "nein"}`).join(", ")}.
            </p>
            <button className="primary" disabled={busy || missing.length > 0} onClick={onStart}>Feldzug starten (Zug 1)</button>
          </>
        )}

        <h4>Löschen</h4>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)}>Feldzug löschen…</button>
        ) : (
          <div className="button-row">
            <button className="primary" disabled={busy} onClick={onDelete}>Endgültig löschen</button>
            <button onClick={() => setConfirmDelete(false)}>Abbrechen</button>
          </div>
        )}
      </div>
    </div>
  );
}

const EMPTY_TYPE: UnitType = {
  key: "", side: "republik", category: "infantry", name: "", men: 144, cost: 300, buildTurns: 1, attack: 10, defense: 10,
  speed: 0, capacity: 0, navalClass: "", buildAt: "hq", position: 50,
};

function CatalogPanel({ types, busy, onSave, onDelete }: { types: UnitType[]; busy: boolean; onSave: (t: UnitType) => void; onDelete: (key: string) => void }) {
  const [edit, setEdit] = useState<UnitType | null>(null);
  const num = (k: keyof UnitType) => (
    <input
      type="number"
      value={edit![k] as number}
      onChange={(e) => setEdit({ ...edit!, [k]: Number(e.target.value) })}
      style={{ ...inputStyle, padding: "4px 6px" }}
    />
  );

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div className="panel" style={{ flex: 1, minWidth: 560, overflowX: "auto" }}>
        <div className="button-row" style={{ marginBottom: 8 }}>
          <button onClick={() => setEdit({ ...EMPTY_TYPE })}>Neuer Typ</button>
        </div>
        <table style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Seite</th><th>Name</th><th>Art</th><th>Mann</th><th>Kosten</th><th>Bau</th><th>Angr.</th><th>Vert.</th><th>Tempo</th><th>Laderaum</th><th>Ort</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.key} style={{ cursor: "pointer", background: edit?.key === t.key ? "var(--bg-panel-light)" : undefined }} onClick={() => setEdit({ ...t })}>
                <td style={{ color: SIDE_COLOR[t.side] }}>{SIDE_NAME[t.side]}</td>
                <td>{t.name}</td>
                <td>{CATEGORY_NAME[t.category] ?? t.category}</td>
                <td>{t.men}</td>
                <td>{t.cost}</td>
                <td>{t.buildTurns}</td>
                <td>{t.attack}</td>
                <td>{t.defense}</td>
                <td>{t.speed || "-"}</td>
                <td>{t.capacity || "-"}</td>
                <td>{t.buildAt === "shipyard" ? "Werft" : t.buildAt === "any" ? "überall" : "HQ/Fabrik"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <div className="panel" style={{ width: 360 }}>
          <h3 style={{ marginTop: 0 }}>{edit.name || "Neuer Typ"}</h3>
          <Field label="Schlüssel" hint="a-z, 0-9, _ - nicht mehr ändern, wenn Einheiten existieren">
            <input value={edit.key} onChange={(e) => setEdit({ ...edit, key: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Name">
            <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} style={inputStyle} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px" }}>
            <Field label="Seite">
              <select value={edit.side} onChange={(e) => setEdit({ ...edit, side: e.target.value as Side })} style={inputStyle}>
                {SIDES.map((s) => <option key={s} value={s}>{SIDE_NAME[s]}</option>)}
              </select>
            </Field>
            <Field label="Art">
              <select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} style={inputStyle}>
                {Object.entries(CATEGORY_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Mannstärke">{num("men")}</Field>
            <Field label="Kosten">{num("cost")}</Field>
            <Field label="Bauzüge">{num("buildTurns")}</Field>
            <Field label="Reihenfolge">{num("position")}</Field>
            <Field label="Angriff">{num("attack")}</Field>
            <Field label="Verteidigung">{num("defense")}</Field>
            <Field label="Tempo (eff. pc/Zug)">{num("speed")}</Field>
            <Field label="Laderaum (Kompanien)">{num("capacity")}</Field>
            <Field label="Gebaut an">
              <select value={edit.buildAt} onChange={(e) => setEdit({ ...edit, buildAt: e.target.value })} style={inputStyle}>
                <option value="hq">HQ / Fabrikwelt</option>
                <option value="shipyard">HQ / Werft</option>
                <option value="any">überall</option>
              </select>
            </Field>
            <Field label="Naval-Klasse">
              <input value={edit.navalClass} onChange={(e) => setEdit({ ...edit, navalClass: e.target.value })} style={inputStyle} />
            </Field>
          </div>
          <div className="button-row">
            <button className="primary" disabled={busy || !edit.key || !edit.name} onClick={() => onSave(edit)}>Speichern</button>
            {types.some((t) => t.key === edit.key) && (
              <button disabled={busy} onClick={() => onDelete(edit.key)}>Löschen</button>
            )}
            <button onClick={() => setEdit(null)}>Schließen</button>
          </div>
        </div>
      )}
    </div>
  );
}
