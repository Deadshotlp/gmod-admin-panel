"use client";

import { useCallback, useEffect, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Check, Field, Notice, dateFormat, fetchWithTimeout, inputStyle, readJson } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Action = { type: string; delay?: number; [key: string]: any };

interface Scenario {
  id?: number;
  name: string;
  description: string;
  enabled: boolean;
  trigger: string;
  data: Record<string, any>;
  actions: Action[];
  chance: number;
  cooldown: number;
  once: boolean;
  runs?: number;
  lastRun?: number;
}

interface Option {
  id: string;
  name: string;
}

const TRIGGERS: Array<[string, string]> = [
  ["manual", "Nur von Hand"],
  ["enter_system", "Ankunft in einem System"],
  ["orbit", "Orbit eines Himmelskörpers"],
  ["field", "Einflug in Asteroidenfeld / Nebel"],
  ["interval", "Zufällig alle X Minuten"],
  ["hull_below", "Hülle unter X %"],
];

const TERRITORY: Array<[string, string]> = [
  ["any", "egal"],
  ["own", "eigenes Gebiet"],
  ["hostile", "feindliches Gebiet"],
  ["none", "ohne Besitzer"],
  ["contested", "umkämpft"],
];

const ACTIONS: Array<[string, string]> = [
  ["spawn", "Schiffe erscheinen"],
  ["comms", "Funkspruch"],
  ["announce", "Durchsage an alle"],
  ["alert", "Alarmstufe"],
  ["damage", "Treffer am Map-Schiff"],
  ["supply", "Nachschubkisten liefern"],
  ["log", "Logbuch-Eintrag"],
];

const NEW_ACTION: Record<string, Action> = {
  spawn: { type: "spawn", classId: "", factionId: "", count: 1, name: "", distanceKm: 20, bearing: "front", arrive: "hyperspace", orders: "attack" },
  comms: { type: "comms", from: "", text: "", kind: "msg" },
  announce: { type: "announce", title: "", text: "" },
  alert: { type: "alert", level: 2 },
  damage: { type: "damage", percent: 3 },
  supply: { type: "supply", crates: { torpedo: 1, missile: 1, parts: 1, craft: 0 } },
  log: { type: "log", text: "" },
};

const EMPTY: Scenario = {
  name: "Neues Szenario",
  description: "",
  enabled: false,
  trigger: "manual",
  data: {},
  actions: [],
  chance: 1,
  cooldown: 3600,
  once: false,
};

const label = (list: Array<[string, string]>, key: string) => list.find(([k]) => k === key)?.[1] ?? key;

function Select({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle}>
      {options.map(([key, text]) => (
        <option key={key} value={key}>
          {text}
        </option>
      ))}
    </select>
  );
}

function Num({ value, onChange, step }: { value: number | undefined; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      step={step ?? 1}
      value={value ?? 0}
      onChange={(event) => onChange(Number(event.target.value))}
      style={inputStyle}
    />
  );
}

/** System oder Himmelskörper suchen; gespeichert wird die ID. */
function Lookup({ kind, value, onChange }: { kind: "systems" | "bodies"; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; name: string; system_name?: string; type?: string }>>([]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      const response = await fetchWithTimeout(`/api/naval/scenarios?lookup=${encodeURIComponent(q)}`, { cache: "no-store" });
      const { data } = await readJson<{ systems: Option[]; bodies: Array<{ id: string; name: string; system_name: string; type: string }> }>(response);
      setHits(data ? data[kind] : []);
    }, 300);
    return () => clearTimeout(timer);
  }, [q, kind]);

  return (
    <div>
      <div style={{ display: "flex", gap: 6 }}>
        <input value={value} readOnly placeholder="(beliebig)" style={{ ...inputStyle, flex: 1 }} />
        {value && <button onClick={() => onChange("")}>✕</button>}
      </div>
      <input placeholder="Suchen (ab 2 Zeichen)" value={q} onChange={(event) => setQ(event.target.value)} style={{ ...inputStyle, marginTop: 6 }} />
      {hits.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {hits.map((h) => (
            <button
              key={h.id}
              onClick={() => {
                onChange(h.id);
                setQ("");
              }}
            >
              {h.name}
              {h.system_name ? ` (${h.system_name})` : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionEditor({
  action,
  classes,
  factions,
  onChange,
}: {
  action: Action;
  classes: Option[];
  factions: Option[];
  onChange: (a: Action) => void;
}) {
  const set = (key: string, value: unknown) => onChange({ ...action, [key]: value });
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "0 12px" } as const;

  switch (action.type) {
    case "spawn":
      return (
        <div style={grid}>
          <Field label="Klasse">
            <Select value={action.classId} options={[["", "- wählen -"], ...classes.map((c): [string, string] => [c.id, c.name])]} onChange={(v) => set("classId", v)} />
          </Field>
          <Field label="Fraktion">
            <Select value={action.factionId ?? ""} options={[["", "wie Klasse"], ...factions.map((f): [string, string] => [f.id, f.name])]} onChange={(v) => set("factionId", v)} />
          </Field>
          <Field label="Anzahl">
            <Num value={action.count} onChange={(v) => set("count", v)} />
          </Field>
          <Field label="Name (leer = automatisch)">
            <input value={action.name ?? ""} onChange={(event) => set("name", event.target.value)} style={inputStyle} />
          </Field>
          <Field label="Abstand (km)">
            <Num value={action.distanceKm} step={0.5} onChange={(v) => set("distanceKm", v)} />
          </Field>
          <Field label="Richtung (vom Map-Schiff)">
            <Select
              value={action.bearing}
              options={[["front", "vorne"], ["back", "hinten"], ["left", "backbord"], ["right", "steuerbord"], ["above", "oben"], ["below", "unten"], ["random", "zufällig"]]}
              onChange={(v) => set("bearing", v)}
            />
          </Field>
          <Field label="Ankunft">
            <Select value={action.arrive} options={[["hyperspace", "aus dem Hyperraum"], ["here", "schon da"]]} onChange={(v) => set("arrive", v)} />
          </Field>
          <Field label="Verhalten">
            <Select
              value={action.orders}
              options={[["attack", "greift an"], ["hold", "hält Position"], ["patrol", "patrouilliert"], ["derelict", "Havarist (kapituliert, antriebslos)"]]}
              onChange={(v) => set("orders", v)}
            />
          </Field>
        </div>
      );
    case "comms":
      return (
        <>
          <div style={grid}>
            <Field label="Absender" hint="leer = erstes gespawntes Schiff">
              <input value={action.from ?? ""} onChange={(event) => set("from", event.target.value)} style={inputStyle} />
            </Field>
            <Field label="Art">
              <Select value={action.kind} options={[["msg", "Funkspruch"], ["distress", "Notruf"]]} onChange={(v) => set("kind", v)} />
            </Field>
          </div>
          <Field label="Text">
            <textarea value={action.text} onChange={(event) => set("text", event.target.value)} rows={2} style={inputStyle} maxLength={300} />
          </Field>
        </>
      );
    case "announce":
      return (
        <>
          <Field label="Titel (leer = Name des Szenarios)">
            <input value={action.title ?? ""} onChange={(event) => set("title", event.target.value)} style={inputStyle} />
          </Field>
          <Field label="Text">
            <textarea value={action.text} onChange={(event) => set("text", event.target.value)} rows={2} style={inputStyle} maxLength={300} />
          </Field>
        </>
      );
    case "alert":
      return (
        <Field label="Alarmstufe">
          <Select value={String(action.level)} options={[["0", "Normal"], ["1", "Gelb"], ["2", "Rot"]]} onChange={(v) => set("level", Number(v))} />
        </Field>
      );
    case "damage":
      return (
        <div style={grid}>
          <Field label="Schaden (% der Hülle, erst auf die Schilde)">
            <Num value={action.percent} step={0.5} onChange={(v) => set("percent", v)} />
          </Field>
          <Field label="Art">
            <Select
              value={action.weapon ?? "turbolaser"}
              options={[["turbolaser", "Turbolaser"], ["ion", "Ionen"], ["torpedo", "Torpedo"], ["missile", "Raketen"]]}
              onChange={(v) => set("weapon", v)}
            />
          </Field>
        </div>
      );
    case "supply":
      return (
        <div style={grid}>
          {[["torpedo", "Torpedokisten"], ["missile", "Raketenkisten"], ["parts", "Ersatzteile"], ["craft", "Ersatzmaschinen"]].map(([key, text]) => (
            <Field key={key} label={text}>
              <Num value={action.crates?.[key]} onChange={(v) => set("crates", { ...action.crates, [key]: v })} />
            </Field>
          ))}
        </div>
      );
    case "log":
      return (
        <Field label="Text">
          <input value={action.text} onChange={(event) => set("text", event.target.value)} style={inputStyle} maxLength={300} />
        </Field>
      );
    default:
      return null;
  }
}

/** Szenarien und Orbit-Events (Stufe 4e). */
export default function NavalScenarios({ user }: { user: PanelUser }) {
  const [list, setList] = useState<Scenario[]>([]);
  const [classes, setClasses] = useState<Option[]>([]);
  const [factions, setFactions] = useState<Option[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [edit, setEdit] = useState<Scenario | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const canEdit = user.role === "editor" || user.role === "admin";

  const load = useCallback(async () => {
    const response = await fetchWithTimeout("/api/naval/scenarios", { cache: "no-store" });
    const { data, error } = await readJson<{ configured: boolean; hint?: string; scenarios: Scenario[]; classes: Option[]; factions: Option[] }>(response);
    if (error || !data) {
      setMessage({ ok: false, text: error ?? "Fehler" });
      return;
    }
    if (!data.configured) {
      setHint(data.hint ?? null);
      return;
    }
    setHint(null);
    setList(data.scenarios);
    setClasses(data.classes);
    setFactions(data.factions);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (body: unknown, okText: string) => {
    setBusy(true);
    try {
      const response = await fetchWithTimeout("/api/naval/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const { data, error } = await readJson<{ ok: boolean; message?: string; reload?: { ok: boolean; message: string } }>(response);
      if (error) setMessage({ ok: false, text: error });
      else if (data?.reload && !data.reload.ok) setMessage({ ok: false, text: `${okText}, aber der Server hat nicht neu geladen: ${data.reload.message}` });
      else if (data && !data.ok) setMessage({ ok: false, text: data.message ?? "Server nicht erreichbar" });
      else setMessage({ ok: true, text: okText });
      await load();
      return !error;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!edit) return;
    const { runs: _runs, lastRun: _lastRun, ...scenario } = edit;
    void _runs;
    void _lastRun;
    if (await post({ op: "save", scenario }, "Gespeichert")) setEdit(null);
  };

  const setData = (key: string, value: unknown) => edit && setEdit({ ...edit, data: { ...edit.data, [key]: value } });
  const setAction = (i: number, a: Action) => edit && setEdit({ ...edit, actions: edit.actions.map((x, k) => (k === i ? a : x)) });
  const moveAction = (i: number, d: number) => {
    if (!edit) return;
    const actions = [...edit.actions];
    const j = i + d;
    if (j < 0 || j >= actions.length) return;
    [actions[i], actions[j]] = [actions[j], actions[i]];
    setEdit({ ...edit, actions });
  };

  if (hint) return <Notice ok={false}>{hint}</Notice>;

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}
      <p className="subtitle" style={{ marginTop: 0 }}>
        Ein Szenario hat einen Auslöser und eine Liste von Aktionen, die nacheinander ablaufen (jede mit Wartezeit davor). Orbit-Events sind
        Szenarien mit dem Auslöser „Orbit". Gespawnte Schiffe lassen sich mit „Szenario-Schiffe entfernen" wieder aufräumen.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {canEdit && (
          <button className="primary" onClick={() => setEdit({ ...EMPTY, data: {}, actions: [] })}>
            Neues Szenario
          </button>
        )}
        {canEdit && (
          <button disabled={busy} onClick={() => void post({ op: "stop" }, "Laufende Szenarien angehalten")}>
            Laufende anhalten
          </button>
        )}
        {canEdit && (
          <button disabled={busy} onClick={() => confirm("Alle Schiffe aus Szenarien entfernen?") && void post({ op: "cleanup" }, "Szenario-Schiffe entfernt")}>
            Szenario-Schiffe entfernen
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div className="panel" style={{ flex: 1, minWidth: 380 }}>
          <table>
            <thead>
              <tr>
                <th>Szenario</th>
                <th>Auslöser</th>
                <th>Läufe</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} style={{ background: edit?.id === s.id ? "var(--bg-panel-light)" : undefined }}>
                  <td style={{ cursor: "pointer" }} onClick={() => setEdit(JSON.parse(JSON.stringify(s)))}>
                    <strong style={{ color: s.enabled ? undefined : "var(--text-muted)" }}>{s.name}</strong>
                    {!s.enabled && <span className="subtitle"> (aus)</span>}
                    {s.description && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.description}</div>}
                  </td>
                  <td>
                    {label(TRIGGERS, s.trigger)}
                    {s.trigger !== "manual" && s.chance < 1 && <span className="subtitle"> · {Math.round(s.chance * 100)} %</span>}
                  </td>
                  <td title={`zuletzt: ${dateFormat(s.lastRun ?? 0)}`}>{s.runs}</td>
                  <td>
                    {canEdit && (
                      <button disabled={busy} onClick={() => void post({ op: "start", id: s.id }, `${s.name} gestartet`)}>
                        Start
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <p className="subtitle">Noch keine Szenarien.</p>}
        </div>

        <div className="panel" style={{ flex: 1.6, minWidth: 480 }}>
          {!edit ? (
            <p className="subtitle" style={{ margin: 0 }}>
              Links ein Szenario wählen oder ein neues anlegen.
            </p>
          ) : (
            <>
              <Field label="Name">
                <input value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} style={inputStyle} maxLength={128} />
              </Field>
              <Field label="Beschreibung">
                <input value={edit.description} onChange={(event) => setEdit({ ...edit, description: event.target.value })} style={inputStyle} maxLength={255} />
              </Field>
              <Check label="Aktiv (löst automatisch aus)" checked={edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} />

              <h3>Auslöser</h3>
              <Field label="Wann">
                <Select value={edit.trigger} options={TRIGGERS} onChange={(v) => setEdit({ ...edit, trigger: v, data: {} })} />
              </Field>
              {edit.trigger === "enter_system" && (
                <Field label="System" hint="leer = jedes System">
                  <Lookup kind="systems" value={edit.data.systemId ?? ""} onChange={(v) => setData("systemId", v)} />
                </Field>
              )}
              {edit.trigger === "orbit" && (
                <>
                  <Field label="Himmelskörper" hint="leer = jeder passende Körper">
                    <Lookup kind="bodies" value={edit.data.bodyId ?? ""} onChange={(v) => setData("bodyId", v)} />
                  </Field>
                  <Field label="Art des Körpers">
                    <Select value={edit.data.bodyType ?? ""} options={[["", "egal"], ["planet", "Planet"], ["moon", "Mond"], ["station", "Station"]]} onChange={(v) => setData("bodyType", v)} />
                  </Field>
                </>
              )}
              {edit.trigger === "field" && (
                <Field label="Feld">
                  <Select value={edit.data.kind ?? ""} options={[["", "egal"], ["asteroids", "Asteroidenfeld/-gürtel"], ["nebula", "Nebel"]]} onChange={(v) => setData("kind", v)} />
                </Field>
              )}
              {edit.trigger === "interval" && (
                <Field label="Alle wie viele Minuten würfeln">
                  <Num value={edit.data.minutes ?? 30} onChange={(v) => setData("minutes", v)} />
                </Field>
              )}
              {edit.trigger === "hull_below" && (
                <Field label="Hülle unter (%)">
                  <Num value={edit.data.percent ?? 50} onChange={(v) => setData("percent", v)} />
                </Field>
              )}
              {["enter_system", "orbit", "interval"].includes(edit.trigger) && (
                <Field label="Gebiet des Systems">
                  <Select value={edit.data.territory ?? "any"} options={TERRITORY} onChange={(v) => setData("territory", v)} />
                </Field>
              )}
              {edit.trigger !== "manual" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
                  <Field label="Wahrscheinlichkeit (%)">
                    <Num value={Math.round(edit.chance * 100)} onChange={(v) => setEdit({ ...edit, chance: Math.min(1, Math.max(0, v / 100)) })} />
                  </Field>
                  <Field label="Sperrzeit danach (Minuten)">
                    <Num value={Math.round(edit.cooldown / 60)} onChange={(v) => setEdit({ ...edit, cooldown: Math.max(0, Math.round(v * 60)) })} />
                  </Field>
                </div>
              )}
              <Check label="Nur ein einziges Mal" checked={edit.once} onChange={(v) => setEdit({ ...edit, once: v })} />

              <h3>Aktionen</h3>
              {edit.actions.map((a, i) => (
                <div key={i} className="panel" style={{ background: "var(--bg-panel-light)", marginBottom: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <strong style={{ flex: 1 }}>
                      {i + 1}. {label(ACTIONS, a.type)}
                    </strong>
                    <span style={{ fontSize: 13 }}>warten (s)</span>
                    <input
                      type="number"
                      value={a.delay ?? 0}
                      onChange={(event) => setAction(i, { ...a, delay: Number(event.target.value) })}
                      style={{ ...inputStyle, width: 80 }}
                    />
                    <button onClick={() => moveAction(i, -1)}>↑</button>
                    <button onClick={() => moveAction(i, 1)}>↓</button>
                    <button onClick={() => setEdit({ ...edit, actions: edit.actions.filter((_, k) => k !== i) })}>✕</button>
                  </div>
                  <ActionEditor action={a} classes={classes} factions={factions} onChange={(n) => setAction(i, n)} />
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                {ACTIONS.map(([key, text]) => (
                  <button key={key} onClick={() => setEdit({ ...edit, actions: [...edit.actions, JSON.parse(JSON.stringify(NEW_ACTION[key]))] })}>
                    + {text}
                  </button>
                ))}
              </div>

              {canEdit && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="primary" disabled={busy} onClick={() => void save()}>
                    Speichern
                  </button>
                  {edit.id && (
                    <button disabled={busy} onClick={() => void post({ op: "start", id: edit.id }, `${edit.name} gestartet`)}>
                      Jetzt starten
                    </button>
                  )}
                  <button onClick={() => setEdit(null)}>Abbrechen</button>
                  {edit.id && (
                    <button
                      disabled={busy}
                      style={{ marginLeft: "auto" }}
                      onClick={async () => {
                        if (confirm(`${edit.name} löschen?`) && (await post({ op: "delete", id: edit.id }, "Gelöscht"))) setEdit(null);
                      }}
                    >
                      Löschen
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
