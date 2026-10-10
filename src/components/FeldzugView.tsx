"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { influenceGrid } from "./influenceGrid";
import { createLabeler } from "./mapLabels";
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
  fortifyCost: number;
  fortMax: number;
  hqBonus: number;
  traitBonus: number;
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
  known: { owner: Side | null; source: "sicht" | "bericht" | "annahme"; turn: number } | null;
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
  orders: Order[];
  battles: Array<{ id: number; turn: number; systemId: string; kind: string; attacker: Side; mode: string; status: string }>;
  supply: Partial<Record<Side, { total: number; supplied: number; cut: number; ids: string[] }>>;
}

interface Order {
  side: Side;
  slot: number;
  kind: string;
  data: { systemId?: string; to?: string; unitIds?: number[]; label?: string; cost?: number; distance?: number; path?: string[] };
  result: string;
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
  // Gewählte Einheiten (Rechtsklick aufs Ziel = Bewegungsbefehl)
  const [selectedUnits, setSelectedUnits] = useState<number[]>([]);

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
  const running = data?.campaign.status === "running";
  const planned = useMemo(() => {
    const set = new Set<number>();
    for (const o of data?.orders ?? []) if (o.kind === "move") for (const id of o.data.unitIds ?? []) set.add(id);
    return set;
  }, [data]);
  /** Gewählte Einheiten zum Ziel: je Ausgangssystem ein Befehl */
  const moveTo = async (target: string) => {
    const byFrom = new Map<string, number[]>();
    for (const u of data?.units ?? []) {
      if (!selectedUnits.includes(u.id) || u.systemId === target) continue;
      byFrom.set(u.systemId, [...(byFrom.get(u.systemId) ?? []), u.id]);
    }
    for (const [from, unitIds] of byFrom) await op("order", { order: { kind: "move", systemId: from, to: target, unitIds } });
  };
  // Nach dem Neuladen nur noch vorhandene Einheiten gewählt lassen
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.units.map((u) => u.id));
    setSelectedUnits((cur) => (cur.every((id) => ids.has(id)) ? cur : cur.filter((id) => ids.has(id))));
  }, [data]);

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
              {tab === "karte" && (setup || running) && (
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}>
                  Handeln als
                  <select value={actAs} onChange={(e) => {
                    setActAs(e.target.value as Side);
                    setSelectedUnits([]);
                  }} style={{ ...inputStyle, width: 140 }}>
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
              commandSide={(lead || mySide) && running ? actSide : null}
              selectedUnits={selectedUnits}
              onSelectUnits={setSelectedUnits}
              onMoveOrder={(target) => void moveTo(target)}
              supplied={running ? new Set(SIDES.flatMap((x) => data.supply[x]?.ids ?? [])) : null}
              onRegion={(ids) => void post({ op: "setRegion", id: campaignId, systemIds: ids }, refresh)}
              sidebar={
                lead && tab === "gebiet" ? (
                  <HqPanel data={data} selected={selected} busy={busy} onHq={(side, systemId) => void post({ op: "setHq", id: campaignId, side, systemId }, refresh)} />
                ) : selectedUnits.length > 0 ? (
                  <SelectionPanel data={data} selectedUnits={selectedUnits} busy={busy} op={op} onSelectUnits={setSelectedUnits} />
                ) : (
                  <SystemPanel
                    data={data}
                    selected={selected}
                    side={actSide}
                    canAct={!!(setup || running) && (lead || !!mySide)}
                    busy={busy}
                    op={op}
                    planned={planned}
                    onSelectUnits={setSelectedUnits}
                  />
                )
              }
            />
          )}
          {!galaxy && <div className="panel">Galaxie wird geladen…</div>}

          {(tab === "karte" || !lead) && running && (
            <TurnPanel data={data} side={actSide} lead={lead} busy={busy} op={op} onSelect={setSelected}
              onEndTurn={() => void post({ op: "endTurn", id: campaignId, turn: data.campaign.turn }, refresh)} />
          )}

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

const CATEGORY_GLYPH: Record<string, string> = { infantry: "I", heavy: "S", armor: "P", artillery: "A" };

/** Einheitensymbol über einem System (Treffer-Fläche für die Maus) */
interface Chip {
  x: number;
  y: number;
  w: number;
  h: number;
  systemId: string;
  side: Side;
  ids: number[];
  /** gehört der befehlenden Seite und ist nicht in Ausbildung */
  own: boolean;
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
  commandSide,
  selectedUnits,
  onSelectUnits,
  onMoveOrder,
  supplied,
}: {
  galaxy: Galaxy;
  data: CampaignView;
  regionEdit: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onRegion: (ids: string[]) => void;
  busy: boolean;
  sidebar: React.ReactNode;
  /** Seite, deren Einheiten man auswählen und bewegen kann (null = nur ansehen) */
  commandSide: Side | null;
  selectedUnits: number[];
  onSelectUnits: (ids: number[]) => void;
  onMoveOrder: (target: string) => void;
  supplied: Set<string> | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 1000, h: 640 });
  const [view, setView] = useState<ViewState>({ cx: 0, cy: 0, scale: 0.02 });
  // Verschieben mit rechter/mittlerer Maustaste
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean; button: number } | null>(null);
  const [box, setBox] = useState<null | { x0: number; y0: number; x1: number; y1: number }>(null);
  const chips = useRef<Chip[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  // Gebiet bearbeiten: gesammelte Auswahl
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [regionPick, setRegionPick] = useState("");

  const campaignIds = useMemo(() => new Set(data.systems.map((s) => s.id)), [data.systems]);
  const byId = useMemo(() => new Map(data.systems.map((s) => [s.id, s])), [data.systems]);
  const selectedSet = useMemo(() => new Set(selectedUnits), [selectedUnits]);
  const unitSystems = useMemo(() => new Set(data.units.map((u) => u.systemId)), [data.units]);

  // Frontlinie aus dem Lagebild (Sicht, Berichte, Annahmen)
  const grid = useMemo(() => {
    const owned = data.systems.filter((s) => s.known?.owner).map((s) => ({ x: s.x, y: s.y, f: s.known!.owner as string }));
    if (owned.length === 0) return null;
    const xs = data.systems.map((s) => s.x);
    const ys = data.systems.map((s) => s.y);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 200);
    return influenceGrid(owned, Math.max(10, Math.min(80, span / 160)), Math.max(150, data.campaign.settings.supplyHop * 0.7));
  }, [data.systems, data.campaign.settings.supplyHop]);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSelectUnits([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelectUnits]);

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

    // Frontlinie (Lagebild der Seite)
    if (grid && !regionEdit) {
      ctx.globalAlpha = 0.13;
      for (const st of grid.strips) {
        const [ax, ay] = toScreen(st.x, st.y + grid.cell);
        const [bx, by] = toScreen(st.x + st.w, st.y);
        if (bx < 0 || ax > w || by < 0 || ay > h) continue;
        ctx.fillStyle = SIDE_COLOR[st.f as Side] ?? "#888";
        ctx.fillRect(ax, ay, Math.max(bx - ax, 1), Math.max(by - ay, 1));
      }
      ctx.globalAlpha = 1;
      for (const fr of grid.fronts) {
        const [ax, ay] = toScreen(fr[0], fr[1]);
        const [bx, by] = toScreen(fr[2], fr[3]);
        if (Math.max(ax, bx) < 0 || Math.min(ax, bx) > w || Math.max(ay, by) < 0 || Math.min(ay, by) > h) continue;
        ctx.strokeStyle = fr[4] ? "rgba(255,90,70,0.9)" : "rgba(200,215,240,0.18)";
        ctx.lineWidth = fr[4] ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    }

    // Routen
    for (const r of galaxy.routes) {
      ctx.strokeStyle = r.major ? "rgba(90,140,220,0.4)" : "rgba(70,90,130,0.22)";
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

    // Geplante Bewegungen: Route über die Wegpunkte; gewählte Einheiten hervorgehoben
    const routeOf = (o: Order) => (o.data.path?.length ? o.data.path : [o.data.systemId ?? "", o.data.to ?? ""]).map((id) => byId.get(id)).filter((p): p is ViewSystem => !!p);
    const moves = regionEdit ? [] : data.orders.filter((o) => o.kind === "move");
    const isSel = (o: Order) => (o.data.unitIds ?? []).some((id) => selectedSet.has(id));
    for (const o of [...moves].sort((a, b) => Number(isSel(a)) - Number(isSel(b)))) {
      const pts = routeOf(o).map((p) => toScreen(p.x, p.y));
      if (pts.length < 2) continue;
      const sel = isSel(o);
      ctx.strokeStyle = sel ? "#ffffff" : SIDE_COLOR[o.side];
      ctx.globalAlpha = sel ? 1 : 0.75;
      ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.setLineDash(sel ? [] : [7, 5]);
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
      ctx.setLineDash([]);
      // Pfeilspitze am Ziel
      const [x1, y1] = pts[pts.length - 2];
      const [x2, y2] = pts[pts.length - 1];
      const ang = Math.atan2(y2 - y1, x2 - x1);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(x2 - Math.cos(ang) * 9, y2 - Math.sin(ang) * 9);
      ctx.lineTo(x2 - Math.cos(ang) * 21 - Math.sin(ang) * 6, y2 - Math.sin(ang) * 21 + Math.cos(ang) * 6);
      ctx.lineTo(x2 - Math.cos(ang) * 21 + Math.sin(ang) * 6, y2 - Math.sin(ang) * 21 - Math.cos(ang) * 6);
      ctx.fill();
      // Wegpunkte
      if (sel) {
        pts.slice(1, -1).forEach(([x, y], i) => {
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#06090e";
          ctx.font = "bold 9px sans-serif";
          ctx.fillText(String(i + 1), x - 3, y + 3);
          ctx.font = "12px sans-serif";
        });
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    }

    // Feldzug-Systeme: Farbe nach Lagebild
    for (const s of data.systems) {
      const [x, y] = toScreen(s.x, s.y);
      if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
      const r = 3 + s.tier;
      const k = s.known;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (k && k.source !== "annahme") {
        ctx.fillStyle = k.owner ? SIDE_COLOR[k.owner] : "#8a93a6";
        ctx.globalAlpha = (regionEdit ? 0.5 : 1) * (k.source === "bericht" ? 0.55 : 1);
      } else {
        ctx.fillStyle = "#2a2f3a";
      }
      ctx.fill();
      ctx.globalAlpha = 1;
      if (k?.source === "annahme" && k.owner) {
        // vermutlich feindlich
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = SIDE_COLOR[k.owner];
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
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
      if (supplied && s.owner && s.owner !== "?" && !supplied.has(s.id) && supplied.size > 0) {
        // Ohne Nachschubverbindung zum HQ
        ctx.strokeStyle = "#f0a030";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 3]);
        ctx.strokeRect(x - r - 2, y - r - 2, (r + 2) * 2, (r + 2) * 2);
        ctx.setLineDash([]);
      }
      if (s.contested) {
        ctx.strokeStyle = "rgba(255,70,60,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (s.id === selected || s.id === hover) {
        ctx.strokeStyle = s.id === selected ? "#ffffff" : "rgba(255,255,255,0.5)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    }

    // Einheiten über den Systemen
    const labels = createLabeler(ctx, w, h);
    const hits: Chip[] = [];
    if (!regionEdit) {
      const compact = view.scale < 0.05;
      const bySystem = new Map<string, ViewUnit[]>();
      for (const u of data.units) bySystem.set(u.systemId, [...(bySystem.get(u.systemId) ?? []), u]);
      ctx.font = "bold 11px sans-serif";
      for (const [sid, list] of bySystem) {
        const s = byId.get(sid);
        if (!s) continue;
        const [x, y] = toScreen(s.x, s.y);
        if (x < -80 || x > w + 80 || y < -40 || y > h + 40) continue;
        // Gruppen: Seite + Typ (+ in Ausbildung); kompakt: je Seite eine
        const groups = new Map<string, { side: Side; glyph: string; ship: boolean; ids: number[]; training: boolean; orbit: boolean }>();
        for (const u of list) {
          const training = u.status === "training";
          const orbit = u.status === "orbit";
          const key = compact ? `${u.side}|${training}` : `${u.side}|${u.type}|${training}|${orbit}`;
          const g = groups.get(key) ?? { side: u.side, glyph: compact ? "◆" : u.category === "ship" ? "▲" : CATEGORY_GLYPH[u.category] ?? "?", ship: u.category === "ship", ids: [], training, orbit: orbit && !compact };
          g.ids.push(u.id);
          groups.set(key, g);
        }
        const items = [...groups.values()].sort((a, b) => (a.side === b.side ? Number(b.ship) - Number(a.ship) : a.side === commandSide ? -1 : 1));
        const widths = items.map((g) => ctx.measureText(`${g.glyph} ${g.ids.length}`).width + 10);
        const total = widths.reduce((a, b) => a + b, 0) + (items.length - 1) * 3;
        let cx = x - total / 2;
        const cy = y - (3 + s.tier) - 22;
        items.forEach((g, i) => {
          const cw = widths[i];
          const own = g.side === commandSide && !g.training;
          const nSel = g.ids.filter((id) => selectedSet.has(id)).length;
          ctx.globalAlpha = g.training ? 0.5 : 1;
          ctx.fillStyle = "rgba(10,14,22,0.92)";
          ctx.fillRect(cx, cy, cw, 16);
          ctx.strokeStyle = nSel > 0 ? "#ffffff" : SIDE_COLOR[g.side];
          ctx.lineWidth = nSel > 0 ? 2 : 1;
          ctx.setLineDash((nSel > 0 && nSel < g.ids.length) || g.orbit ? [3, 2] : []);
          ctx.strokeRect(cx, cy, cw, 16);
          ctx.setLineDash([]);
          ctx.fillStyle = SIDE_COLOR[g.side];
          ctx.fillText(`${g.glyph} ${g.ids.length}`, cx + 5, cy + 12);
          ctx.globalAlpha = 1;
          labels.reserve(cx, cy, cx + cw, cy + 16);
          hits.push({ x: cx, y: cy, w: cw, h: 16, systemId: sid, side: g.side, ids: g.ids, own });
          cx += cw + 3;
        });
      }
      ctx.font = "12px sans-serif";
      ctx.lineWidth = 1;
    }
    chips.current = hits;

    // Namen: wichtige zuerst (Auswahl, HQ, Truppen, Systemwert), nur ohne Überlappung
    const rank = (s: ViewSystem) => (s.id === selected ? 1000 : 0) + (s.hq ? 500 : 0) + (unitSystems.has(s.id) ? 100 : 0) + s.tier * 10;
    for (const s of [...data.systems].sort((a, b) => rank(b) - rank(a))) {
      const [x, y] = toScreen(s.x, s.y);
      const r = 3 + s.tier;
      labels.place(s.name, x + r + 4, y + 4, regionEdit ? "rgba(223,230,242,0.6)" : "#dfe6f2");
    }
    // Übrige Galaxie blass (im Gebietsmodus die gewählten zuerst)
    if (regionEdit || view.scale > 0.05) {
      const rest = galaxy.systems.filter((s) => !campaignIds.has(s.id));
      if (regionEdit) rest.sort((a, b) => Number(pending.has(b.id)) - Number(pending.has(a.id)));
      for (const s of rest) {
        const [x, y] = toScreen(s.x, s.y);
        if (x < -5 || x > w + 5 || y < -5 || y > h + 5) continue;
        labels.place(s.name, x + 4, y + 4, regionEdit && pending.has(s.id) ? "rgba(240,200,80,0.85)" : "rgba(150,160,180,0.55)");
      }
    }

    if (box) {
      ctx.strokeStyle = regionEdit ? "rgba(240,200,80,0.9)" : "rgba(255,255,255,0.8)";
      ctx.strokeRect(Math.min(box.x0, box.x1), Math.min(box.y0, box.y1), Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
    }
  }, [galaxy, data, regionEdit, pending, selected, hover, view, size, box, toScreen, campaignIds, byId, selectedSet, unitSystems, supplied, grid, commandSide]);

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
  const chipAt = (x: number, y: number) => chips.current.find((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) ?? null;

  /** Klick (links, ohne Ziehen): Einheitensymbol wählen oder System */
  const leftClick = (x: number, y: number, shift: boolean) => {
    const chip = chipAt(x, y);
    if (chip && chip.own) {
      // Im selben System (oder mit Umschalt) ergänzt ein Klick die Auswahl,
      // ein zweiter Klick nimmt das Symbol wieder heraus; sonst neue Auswahl
      const sameSystem = data.units.some((u) => selectedSet.has(u.id) && u.systemId === chip.systemId);
      if (shift || sameSystem) {
        const all = chip.ids.every((id) => selectedSet.has(id));
        onSelectUnits(all ? selectedUnits.filter((id) => !chip.ids.includes(id)) : [...new Set([...selectedUnits, ...chip.ids])]);
      } else onSelectUnits(chip.ids);
      onSelect(chip.systemId);
      return;
    }
    const sys = chip ? byId.get(chip.systemId) ?? null : nearest(x, y);
    if (!shift) onSelectUnits([]);
    onSelect(sys?.id ?? null);
  };

  /** Rahmen: alle eigenen Einheiten in den Systemen im Rahmen */
  const boxSelect = (b: { x0: number; y0: number; x1: number; y1: number }, shift: boolean) => {
    const [ax, ay] = toWorld(Math.min(b.x0, b.x1), Math.max(b.y0, b.y1));
    const [bx, by] = toWorld(Math.max(b.x0, b.x1), Math.min(b.y0, b.y1));
    const inBox = new Set(data.systems.filter((s) => s.x >= ax && s.x <= bx && s.y >= ay && s.y <= by).map((s) => s.id));
    const ids = data.units.filter((u) => u.side === commandSide && u.status !== "training" && inBox.has(u.systemId)).map((u) => u.id);
    onSelectUnits(shift ? [...new Set([...selectedUnits, ...ids])] : ids);
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

  const canCommand = !!commandSide && data.campaign.status === "running";

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
              Klick: System wählen (für das HQ). Linke Maustaste ziehen: Systeme hinzufügen, mit Umschalt: entfernen. Rechte Maustaste: verschieben. Übernehmen setzt HQs
              und alle Käufe zurück.
            </div>
          </div>
        )}
        <div ref={wrapRef} className="panel" style={{ padding: 0, overflow: "hidden" }}>
          <canvas
            ref={canvasRef}
            width={size.w}
            height={size.h}
            style={{ width: "100%", display: "block", cursor: hover && selectedUnits.length > 0 && canCommand ? "crosshair" : "default" }}
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={(e) => {
              const [x, y] = canvasPos(e);
              if (e.button === 0) {
                setBox({ x0: x, y0: y, x1: x, y1: y });
                return;
              }
              e.preventDefault();
              drag.current = { x, y, cx: view.cx, cy: view.cy, moved: false, button: e.button };
            }}
            onMouseMove={(e) => {
              const [x, y] = canvasPos(e);
              const d = drag.current;
              if (d) {
                if (Math.abs(x - d.x) + Math.abs(y - d.y) > 5) d.moved = true;
                if (d.moved) setView({ ...view, cx: d.cx - (x - d.x) / view.scale, cy: d.cy + (y - d.y) / view.scale });
              }
              if (box) setBox({ ...box, x1: x, y1: y });
              const h = nearest(x, y)?.id ?? null;
              if (h !== hover) setHover(h);
            }}
            onMouseUp={(e) => {
              const [x, y] = canvasPos(e);
              if (e.button === 0 && box) {
                const moved = Math.abs(x - box.x0) + Math.abs(y - box.y0) >= 6;
                setBox(null);
                if (!moved) {
                  if (regionEdit) onSelect(nearest(x, y)?.id ?? null);
                  else leftClick(x, y, e.shiftKey);
                  return;
                }
                if (regionEdit) {
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
                } else boxSelect({ ...box, x1: x, y1: y }, e.shiftKey);
                return;
              }
              const d = drag.current;
              drag.current = null;
              // Rechtsklick ohne Ziehen: gewählte Einheiten dorthin
              if (d && !d.moved && e.button === 2 && canCommand && selectedUnits.length > 0 && !regionEdit) {
                const target = chipAt(x, y)?.systemId ?? nearest(x, y)?.id;
                if (target) onMoveOrder(target);
              }
            }}
            onMouseLeave={() => {
              drag.current = null;
              setBox(null);
              setHover(null);
            }}
            onDoubleClick={(e) => {
              // Doppelklick: alle eigenen Einheiten des Systems wählen
              if (regionEdit || !commandSide) return;
              const [x, y] = canvasPos(e);
              const sid = chipAt(x, y)?.systemId ?? nearest(x, y)?.id;
              if (!sid) return;
              const ids = data.units.filter((u) => u.side === commandSide && u.systemId === sid && u.status !== "training").map((u) => u.id);
              if (ids.length > 0) onSelectUnits(e.shiftKey ? [...new Set([...selectedUnits, ...ids])] : ids);
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
          {!regionEdit && (
            <>
              Links: Einheitensymbol wählen (weitere im selben System kommen dazu), Doppelklick: alle eigenen Einheiten des Systems, Rahmen
              ziehen: eigene Einheiten wählen (Umschalt: dazu) · Rechts: gewählte Einheiten zum Ziel schicken - Bodentruppen nehmen freie
              Schiffe als Transport mit · rechts ziehen: Karte verschieben · Esc: Auswahl aufheben
              <br />
            </>
          )}
          <span style={{ color: SIDE_COLOR.republik }}>●</span> Republik <span style={{ color: SIDE_COLOR.kus }}>●</span> KUS{" "}
          <span style={{ color: "#8a93a6" }}>●</span> neutral <span style={{ color: "#2a2f3a" }}>●</span> unbekannt · blass = alter Bericht ·
          gestrichelter Ring = vermutet · gestricheltes Symbol = an Bord im Orbit · <span style={{ color: "#ff5a46" }}>━</span> Front · ▲ Schiff, I/S/P/A Infanterie/Schwere/Panzer/Artillerie ·{" "}
          <span style={{ color: "#6fdc8c" }}>◌</span> besetzbar · □ Hauptquartier · <span style={{ color: "#f0a030" }}>⬚</span> ohne Nachschub
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
  planned,
  onSelectUnits,
}: {
  data: CampaignView;
  selected: string | null;
  side: Side;
  canAct: boolean;
  busy: boolean;
  op: (o: string, extra?: Record<string, unknown>) => Promise<unknown>;
  planned: Set<number>;
  onSelectUnits: (ids: number[]) => void;
}) {
  const sys = data.systems.find((s) => s.id === selected);
  const [buyType, setBuyType] = useState("");
  const [count, setCount] = useState(1);
  if (!sys) return <div className="panel">System auf der Karte anklicken.</div>;

  const running = data.campaign.status === "running";
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

  // Zug: Aktionen und freie Punkte
  const myOrders = data.orders.filter((o) => o.side === side);
  const free = points - myOrders.reduce((a, o) => a + (o.data.cost ?? 0), 0);
  const slotsLeft = settings.actionsPerTurn - myOrders.length;
  const order = (o: Record<string, unknown>) => op("order", { order: o });

  // Einheiten gruppiert nach Seite, Typ und Zustand
  const groups = new Map<string, ViewUnit[]>();
  for (const u of units) {
    const state = u.status === "training" ? "training" : planned.has(u.id) ? "planned" : u.status === "orbit" ? "orbit" : "ready";
    const k = `${u.side}|${u.type}|${state}`;
    groups.set(k, [...(groups.get(k) ?? []), u]);
  }
  const movable = (k: string) => running && canAct && k.startsWith(`${side}|`) && (k.endsWith("|ready") || k.endsWith("|orbit"));
  // Landeoperation: eigene Bodentruppen im Orbit, keine feindlichen Schiffe im System
  const inOrbit = units.filter((u) => u.side === side && u.status === "orbit" && !planned.has(u.id));
  const enemyShips = units.some((u) => u.side !== side && u.category === "ship");
  const landingPlanned = myOrders.some((o) => o.kind === "land" && o.data.systemId === sys.id);

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>{sys.name}</h3>
      <div style={{ fontSize: 14, lineHeight: 1.6 }}>
        Besitzer:{" "}
        <b style={{ color: sys.owner && sys.owner !== "?" ? SIDE_COLOR[sys.owner] : undefined }}>
          {sys.owner === "?" ? "unbekannt" : sys.owner ? SIDE_NAME[sys.owner] : "neutral"}
        </b>
        {sys.hq && <> · Hauptquartier {SIDE_NAME[sys.hq]}</>}
        {sys.contested && <b style={{ color: "#ff5a46" }}> · umkämpft</b>}
        <br />
        Systemwert {sys.tier} · Einkommen {sys.tier * settings.incomePerTier + sys.traits.length * settings.traitBonus}/Zug
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
        const state = k.split("|")[2];
        return (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, fontSize: 14, padding: "3px 0" }}>
            <span>
              <span style={{ color: SIDE_COLOR[u.side] }}>●</span> {list.length}× {u.name}
              <span style={{ color: "var(--text-muted)" }}>
                {" "}
                ({u.category === "ship" ? "Schiff" : `${Math.round(list.reduce((a, x) => a + x.men * x.strength, 0))} Mann`}
                {state === "training" ? ", in Bau" : state === "planned" ? ", hat Befehl" : state === "orbit" ? ", an Bord im Orbit" : ""})
              </span>
            </span>
            {canAct && !running && u.side === side && (
              <button style={{ padding: "2px 8px" }} disabled={busy} onClick={() => void op("sell", { unitId: list[list.length - 1].id })}>
                Auflösen
              </button>
            )}
            {(movable(k) || (running && canAct && k.startsWith(`${side}|`) && k.endsWith("|planned"))) && (
              <button style={{ padding: "2px 8px" }} onClick={() => onSelectUnits(list.map((x) => x.id))}>
                Auswählen
              </button>
            )}
          </div>
        );
      })}

      {canAct && running && (
        <>
          <h4>
            Befehle ({SIDE_NAME[side]}) · {Math.max(0, slotsLeft)} von {settings.actionsPerTurn} Aktionen frei · {free.toLocaleString("de-DE")} Punkte frei
          </h4>
          {slotsLeft <= 0 && <div className="subtitle">Alle Aktionen dieses Zugs sind verplant.</div>}
          {inOrbit.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {landingPlanned ? (
                <div className="subtitle">Landeoperation ist geplant.</div>
              ) : enemyShips ? (
                <div className="subtitle" style={{ color: "#f0a030" }}>
                  {inOrbit.length} Kompanie(n) im Orbit - Landung erst ohne feindliche Schiffe im System.
                </div>
              ) : (
                <button className="primary" disabled={busy || slotsLeft <= 0} onClick={() => void order({ kind: "land", systemId: sys.id })}>
                  Landeoperation durchführen ({inOrbit.length} Kompanie(n))
                </button>
              )}
            </div>
          )}
          {slotsLeft > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[...groups.keys()].some(movable) && (
                <>
                  <button
                    className="primary"
                    onClick={() => onSelectUnits(units.filter((u) => u.side === side && u.status !== "training").map((u) => u.id))}
                  >
                    Alle eigenen Einheiten hier auswählen
                  </button>
                  <div className="subtitle">Danach mit der rechten Maustaste auf das Ziel. Bodentruppen nehmen freie Schiffe als Transport mit.</div>
                </>
              )}
              {canOccupy && (
                <button disabled={busy || free < occupyCost} onClick={() => void order({ kind: "occupy", systemId: sys.id })}>
                  Besetzen ({occupyCost} Punkte, mit Garnison)
                </button>
              )}
              {sys.owner === side && (sys.fort ?? 0) < settings.fortMax && (
                <button disabled={busy || free < settings.fortifyCost} onClick={() => void order({ kind: "fortify", systemId: sys.id })}>
                  Befestigen auf Stufe {(sys.fort ?? 0) + 1} ({settings.fortifyCost} Punkte)
                </button>
              )}
              {sys.owner !== side && (
                <button disabled={busy} onClick={() => void order({ kind: "scout", systemId: sys.id })}>
                  Aufklären
                </button>
              )}
            </div>
          )}
        </>
      )}

      {canAct && !running && (
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
        </>
      )}

      {canAct && (running ? slotsLeft > 0 : true) && sys.owner === side && buildable.length > 0 && chosen && (
        <div style={{ marginTop: 8 }}>
          <Field label={running ? "Bauen / ausbilden (1 Aktion)" : "Einheit aufstellen"}>
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
            {running ? (
              <button className="primary" disabled={busy || free < chosen.cost * count} onClick={() => void order({ kind: "build", systemId: sys.id, type: chosen.key, count })}>
                In Auftrag geben ({chosen.cost * count} P)
              </button>
            ) : (
              <button className="primary" disabled={busy || points < chosen.cost * count} onClick={() => void op("buy", { systemId: sys.id, type: chosen.key, count })}>
                Kaufen ({chosen.cost * count} P)
              </button>
            )}
          </div>
          <div className="subtitle" style={{ marginTop: 6 }}>
            Angriff {chosen.attack} · Verteidigung {chosen.defense}
            {chosen.category === "ship" ? ` · Tempo ${chosen.speed} · Laderaum ${chosen.capacity}` : ""} · Bauzeit {chosen.buildTurns} Züge
            {!running && " (im Aufbau sofort bereit)"}
          </div>
        </div>
      )}
      {canAct && sys.owner === side && buildable.length === 0 && <div className="subtitle">Hier kann nichts gebaut werden (HQ, Werften, Fabrikwelten).</div>}
    </div>
  );
}

const KIND_NAME: Record<string, string> = { move: "Verlegen", build: "Bauen", fortify: "Befestigen", scout: "Aufklären", occupy: "Besetzen", land: "Landen" };

/** Zug: geplante Befehle, Bereitschaft, Gefechte; Spielleitung beendet den Zug */
function TurnPanel({
  data,
  side,
  lead,
  busy,
  op,
  onSelect,
  onEndTurn,
}: {
  data: CampaignView;
  side: Side;
  lead: boolean;
  busy: boolean;
  op: (o: string, extra?: Record<string, unknown>) => Promise<unknown>;
  onSelect: (id: string) => void;
  onEndTurn: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const shown = lead ? SIDES : [side];
  const name = (id?: string) => data.systems.find((s) => s.id === id)?.name ?? id ?? "";
  const open = data.battles.filter((b) => b.status !== "done");

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16, alignItems: "flex-start" }}>
      {shown.map((s) => {
        const orders = data.orders.filter((o) => o.side === s);
        const info = data.sides.find((x) => x.side === s);
        const sup = data.supply[s];
        return (
          <div key={s} className="panel" style={{ flex: 1, minWidth: 320 }}>
            <h3 style={{ marginTop: 0, color: SIDE_COLOR[s] }}>
              Zug {data.campaign.turn} · Befehle {SIDE_NAME[s]} ({orders.length}/{data.campaign.settings.actionsPerTurn})
            </h3>
            {orders.length === 0 && <div className="subtitle">Noch keine Befehle. System auf der Karte wählen.</div>}
            {orders.map((o) => (
              <div key={o.slot} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, padding: "3px 0" }}>
                <span style={{ cursor: "pointer" }} onClick={() => o.data.systemId && onSelect(o.data.systemId)}>
                  <b>{o.slot}.</b> {KIND_NAME[o.kind] ?? o.kind}: {o.data.label ?? name(o.data.systemId)}
                  {o.data.cost ? <span style={{ color: "var(--text-muted)" }}> ({o.data.cost} P)</span> : null}
                  {o.data.distance ? <span style={{ color: "var(--text-muted)" }}> ({o.data.distance} pc)</span> : null}
                </span>
                <button style={{ padding: "2px 8px" }} disabled={busy} onClick={() => void op("orderRemove", { slot: o.slot, ...(lead ? { side: s } : {}) })}>
                  Entfernen
                </button>
              </div>
            ))}
            {sup && (
              <div className="subtitle" style={{ marginTop: 8 }}>
                Einkommen nächster Zug: +{sup.total} aus {sup.supplied} versorgten Systemen
                {sup.cut > 0 && <span style={{ color: "#f0a030" }}> · {sup.cut} ohne Nachschub</span>}
              </div>
            )}
            <div className="button-row" style={{ marginTop: 8 }}>
              <button className={info?.ready ? undefined : "primary"} disabled={busy} onClick={() => void op("ready", { ready: !info?.ready, ...(lead ? { side: s } : {}) })}>
                {info?.ready ? "Bereit zurücknehmen" : "Zug fertig geplant"}
              </button>
              <span className="subtitle" style={{ margin: 0, alignSelf: "center" }}>{info?.ready ? "bereit" : "plant noch"}</span>
            </div>
          </div>
        );
      })}

      <div className="panel" style={{ flex: 1, minWidth: 300 }}>
        <h3 style={{ marginTop: 0 }}>Gefechte</h3>
        {open.length === 0 && <div className="subtitle">Keine offenen Gefechte.</div>}
        {open.map((b) => (
          <div key={b.id} style={{ fontSize: 14, padding: "3px 0", cursor: "pointer" }} onClick={() => onSelect(b.systemId)}>
            <span style={{ color: "#ff5a46" }}>⚔</span> {name(b.systemId)} - {b.kind === "space" ? "Raumschlacht" : "Bodenkampf"}, {SIDE_NAME[b.attacker]} greift an
            <span style={{ color: "var(--text-muted)" }}> (seit Zug {b.turn}, {b.mode === "spieler" ? "Spieler" : "Simulation"})</span>
          </div>
        ))}
        {lead && (
          <>
            <h4>Spielleitung</h4>
            <p className="subtitle">
              Bereit: {data.sides.map((x) => `${SIDE_NAME[x.side]} ${x.ready ? "ja" : "nein"}`).join(", ")}. Beim Zugende werden alle Befehle
              gleichzeitig ausgewertet.
            </p>
            {!confirm ? (
              <button className="primary" disabled={busy} onClick={() => setConfirm(true)}>
                Zug {data.campaign.turn} beenden…
              </button>
            ) : (
              <div className="button-row">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setConfirm(false);
                    onEndTurn();
                  }}
                >
                  Jetzt auswerten{data.sides.some((x) => !x.ready) ? " (nicht alle bereit)" : ""}
                </button>
                <button onClick={() => setConfirm(false)}>Abbrechen</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Gewählte Einheiten: Zusammensetzung, geplante Route, Auswahl verkleinern */
function SelectionPanel({
  data,
  selectedUnits,
  busy,
  op,
  onSelectUnits,
}: {
  data: CampaignView;
  selectedUnits: number[];
  busy: boolean;
  op: (o: string, extra?: Record<string, unknown>) => Promise<unknown>;
  onSelectUnits: (ids: number[]) => void;
}) {
  const sel = new Set(selectedUnits);
  const units = data.units.filter((u) => sel.has(u.id));
  const name = (id?: string) => data.systems.find((s) => s.id === id)?.name ?? id ?? "";
  const groups = new Map<string, ViewUnit[]>();
  for (const u of units) groups.set(`${u.systemId}|${u.type}`, [...(groups.get(`${u.systemId}|${u.type}`) ?? []), u]);
  const orders = data.orders.filter((o) => o.kind === "move" && (o.data.unitIds ?? []).some((id) => sel.has(id)));
  const ships = units.filter((u) => u.category === "ship");
  const capacity = ships.reduce((a, u) => a + (data.unitTypes.find((t) => t.key === u.type)?.capacity ?? 0), 0);
  const ground = units.length - ships.length;
  const lead = data.viewer.kind === "admin";

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>{units.length} Einheit(en) gewählt</h3>
      {[...groups.entries()].map(([k, list]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, padding: "3px 0" }}>
          <span>
            <span style={{ color: SIDE_COLOR[list[0].side] }}>●</span> {list.length}× {list[0].name}
            <span style={{ color: "var(--text-muted)" }}> in {name(list[0].systemId)}</span>
          </span>
          <span className="button-row">
            <button style={{ padding: "2px 8px" }} title="Eine weniger" onClick={() => onSelectUnits(selectedUnits.filter((id) => id !== list[list.length - 1].id))}>
              −
            </button>
            <button style={{ padding: "2px 8px" }} title="Aus der Auswahl" onClick={() => onSelectUnits(selectedUnits.filter((id) => !list.some((u) => u.id === id)))}>
              ×
            </button>
          </span>
        </div>
      ))}
      <div className="subtitle" style={{ marginTop: 8 }}>
        {ships.length > 0 ? `Laderaum ${capacity} Kompanien, ${ground} Bodeneinheit(en) gewählt.` : ""}
        {ground > capacity && " Für fremde Systeme kommen freie Schiffe aus dem Ausgangssystem automatisch als Transport mit."}
      </div>

      <h4>Befehl</h4>
      {orders.length === 0 && <div className="subtitle">Rechtsklick auf ein Zielsystem. Jedes Ziel ist in einem Zug erreichbar.</div>}
      {orders.map((o) => (
        <div key={`${o.side}${o.slot}`} style={{ fontSize: 14, marginBottom: 8 }}>
          <b>Aktion {o.slot}:</b> {name(o.data.systemId)} → {name(o.data.to)}
          {o.data.distance ? <span style={{ color: "var(--text-muted)" }}> ({o.data.distance} pc)</span> : null}
          {(o.data.path?.length ?? 0) > 2 && (
            <div className="subtitle" style={{ margin: "2px 0" }}>
              Route: {(o.data.path ?? []).map((id) => name(id)).join(" → ")}
            </div>
          )}
          <button style={{ padding: "2px 8px", marginTop: 4 }} disabled={busy} onClick={() => void op("orderRemove", { slot: o.slot, ...(lead ? { side: o.side } : {}) })}>
            Befehl aufheben
          </button>
        </div>
      ))}
      {orders.length > 0 && <div className="subtitle">Neuer Rechtsklick leitet die gewählten Einheiten um.</div>}
      <button style={{ marginTop: 8 }} onClick={() => onSelectUnits([])}>
        Auswahl aufheben (Esc)
      </button>
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
  { key: "fortifyCost", label: "Befestigen: Kosten" },
  { key: "fortMax", label: "Höchste Befestigung" },
  { key: "hqBonus", label: "Einkommen: Bonus HQ" },
  { key: "traitBonus", label: "Einkommen: je Besonderheit" },
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
