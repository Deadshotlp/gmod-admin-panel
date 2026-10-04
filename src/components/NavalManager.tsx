"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Notice, dateFormat, fetchWithTimeout, inputStyle, readJson } from "./ui";

interface ShipClass {
  id: string;
  name: string;
  faction: string;
  model: string;
  lengthM: number;
  hull: number;
  data: string;
}

interface Faction {
  id: string;
  name: string;
  color: string;
  iff: string;
  player: boolean;
}

interface Relation {
  a: string;
  b: string;
  relation: "ally" | "neutral" | "hostile";
}

interface StarSystem {
  id: string;
  name: string;
  region: string;
  x: number;
  y: number;
  hidden: boolean;
  jumpable: boolean;
}

interface Data {
  settings: Record<string, unknown>;
  classes: ShipClass[];
  factions: Faction[];
  relations: Relation[];
  systems: StarSystem[];
  ships: Array<{
    id: number; server_key: string; name: string; class_id: string; faction_id: string;
    system_id: string; state: string; profile: string | null; updated_at: number;
  }>;
  log: Array<{ id: number; ts: number; ship_id: number; kind: string; author: string; text: string }>;
  consoles: Array<{ id: number; map: string; station: string; pos: string; locked: boolean }>;
}

type Tab = "settings" | "classes" | "factions" | "systems" | "runtime";

const TABS: Array<[Tab, string]> = [
  ["settings", "Einstellungen"],
  ["classes", "Schiffsklassen"],
  ["factions", "Fraktionen"],
  ["systems", "Systeme"],
  ["runtime", "Schiffe & Logbuch"],
];

/** Bekannte Einstellungen mit Erklärung; unbekannte erscheinen darunter roh. */
const SETTING_INFO: Array<[string, string, string]> = [
  ["hyper_base_time", "Kürzester Sprung", "Sekunden"],
  ["hyper_time_per_gu", "Sprungzeit pro Parsec", "Sekunden"],
  ["hyper_max_time", "Längster Sprung", "Sekunden"],
  ["route_speed_factor", "Faktor auf Hauptrouten", "0,5 = doppelt so schnell"],
  ["route_minor_factor", "Faktor auf Nebenrouten", ""],
  ["route_junction_dist", "Umstieg zwischen Routen bis", "Parsec"],
  ["nav_calc_base", "Kursberechnung mindestens", "Sekunden"],
  ["nav_calc_per_gu", "Kursberechnung pro Parsec", "Sekunden"],
  ["nav_calc_max", "Kursberechnung höchstens", "Sekunden"],
  ["nav_valid_seconds", "Kurslösung gültig für", "Sekunden"],
  ["nav_max_drift", "Kurslösung ungültig nach Flug von", "Meter"],
  ["jump_align_tolerance", "Erlaubte Abweichung beim Sprung", "Grad"],
  ["spool_time", "Hochfahren des Hyperantriebs", "Sekunden"],
  ["jump_anim_time", "Eintritt in den Hyperraum", "Sekunden"],
  ["exit_anim_time", "Austritt aus dem Hyperraum", "Sekunden"],
  ["mass_shadow_factor", "Massenschatten", "× Körperradius"],
  ["arrival_scatter", "Streuung beim Austritt", "Meter"],
  ["combat_damage_mult", "Kampf: Faktor auf allen Waffenschaden", "0,5 = Gefechte dauern doppelt so lange"],
  ["combat_shield_regen_mult", "Kampf: Nachladen der Schilde", "Faktor"],
  ["combat_wreck_time", "Kampf: Wrack sichtbar für", "Sekunden"],
  ["sensor_default", "Sensorreichweite (Standard)", "Meter"],
  ["near_ship_range", "Schiffe als Modell bis", "Meter"],
  ["render_scale", "Darstellungsmaßstab", "Meter pro Einheit"],
  ["render_far", "Darstellung: Fernbereich", "Einheiten"],
  ["autosave_interval", "Automatisch speichern alle", "Sekunden"],
  ["start_system", "Startsystem (ID, leer = Coruscant)", ""],
];

const REL_LABEL = { ally: "Verbündet", neutral: "Neutral", hostile: "Feindlich" } as const;
const REL_COLOR = { ally: "#4fa3ff", neutral: "#d8c95a", hostile: "#f05046" } as const;

function toHex(color: string): string {
  const [r, g, b] = color.split(",").map((value) => Math.min(255, Number(value) || 0));
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function fromHex(hex: string): string {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) || 0).join(",");
}

export default function NavalManager({ user }: { user: PanelUser }) {
  const [data, setData] = useState<Data | null>(null);
  const [configured, setConfigured] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab] = useState<Tab>("settings");

  // Bearbeitungsstände je Bereich
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [classes, setClasses] = useState<ShipClass[]>([]);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [systemChanges, setSystemChanges] = useState<Record<string, { hidden: boolean; jumpable: boolean }>>({});

  const canEdit = user.role === "editor" || user.role === "admin";

  const apply = (next: Data) => {
    setData(next);
    setSettings(next.settings);
    setClasses(next.classes);
    setFactions(next.factions);
    setRelations(next.relations);
    setSystemChanges({});
  };

  const load = useCallback(async () => {
    try {
      const response = await fetchWithTimeout("/api/naval", { cache: "no-store" });
      const { data: result, error } = await readJson<Data & { configured: boolean; hint?: string }>(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      setConfigured(result?.configured ?? true);
      setHint(result?.hint ?? null);
      if (result?.classes) apply(result);
    } catch {
      setMessage({ ok: false, text: "Raumflotte konnte nicht geladen werden" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetchWithTimeout("/api/naval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const { data: result, error } = await readJson<
        Partial<Data> & { ok?: boolean; message?: string; reload?: { ok: boolean; message: string } }
      >(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      if (result?.classes && data) apply({ ...data, ...(result as Data) });

      if (result?.reload) {
        setMessage({
          ok: result.reload.ok,
          text: result.reload.ok ? success : `Gespeichert. Server nicht angestoßen: ${result.reload.message}`,
        });
      } else {
        setMessage({ ok: Boolean(result?.ok), text: result?.message ?? success });
      }
    } catch {
      setMessage({ ok: false, text: "Anfrage fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="subtitle">Raumflotte wird geladen…</p>;
  if (!configured) return <div className="notice">{hint}</div>;
  if (!data) return <div className="notice error">Keine Daten erhalten.</div>;

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}

      <div className="button-row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? "primary" : undefined} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "settings" && (
        <SettingsTab
          settings={settings}
          canEdit={canEdit}
          busy={busy}
          onChange={setSettings}
          onSave={() => {
            const values: Record<string, number | string | boolean> = {};
            for (const [key, value] of Object.entries(settings)) {
              if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") values[key] = value;
            }
            void post({ section: "settings", settings: values }, "Gespeichert, der Server lädt die Raumflotte neu.");
          }}
          onAction={(action, text) => void post({ section: "action", action }, text)}
        />
      )}

      {tab === "classes" && (
        <ClassesTab
          classes={classes}
          factions={factions}
          canEdit={canEdit}
          busy={busy}
          onChange={setClasses}
          onSave={() => void post({ section: "classes", classes }, "Klassen gespeichert, der Server lädt neu.")}
        />
      )}

      {tab === "factions" && (
        <FactionsTab
          factions={factions}
          relations={relations}
          canEdit={canEdit}
          busy={busy}
          onChange={setFactions}
          onRelations={setRelations}
          onSave={() =>
            void post({ section: "factions", factions, relations }, "Fraktionen gespeichert, der Server lädt neu.")
          }
        />
      )}

      {tab === "systems" && (
        <SystemsTab
          systems={data.systems}
          changes={systemChanges}
          canEdit={canEdit}
          busy={busy}
          onChange={setSystemChanges}
          onSave={() =>
            void post(
              {
                section: "systems",
                changes: Object.entries(systemChanges).map(([id, value]) => ({ id, ...value })),
              },
              "Systeme gespeichert, der Server lädt die Galaxie neu.",
            )
          }
        />
      )}

      {tab === "runtime" && <RuntimeTab data={data} onReload={() => void load()} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function SettingsTab({
  settings,
  canEdit,
  busy,
  onChange,
  onSave,
  onAction,
}: {
  settings: Record<string, unknown>;
  canEdit: boolean;
  busy: boolean;
  onChange: (value: Record<string, unknown>) => void;
  onSave: () => void;
  onAction: (action: string, text: string) => void;
}) {
  const known = new Set(SETTING_INFO.map(([key]) => key));
  const other = Object.keys(settings).filter(
    (key) => !known.has(key) && !key.startsWith("mapcal_") && typeof settings[key] !== "object",
  );
  const calibrations = Object.entries(settings).filter(([key]) => key.startsWith("mapcal_"));

  const field = (key: string, label: string, unit: string) => {
    const value = settings[key];
    const numeric = typeof value === "number" || value === undefined;
    const readOnly = key === "galaxy_version" || key === "galaxy_unit";

    return (
      <tr key={key}>
        <td>
          {label}
          <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>{key}</div>
        </td>
        <td style={{ width: 200 }}>
          <input
            type={numeric ? "number" : "text"}
            step="any"
            value={value === undefined ? "" : String(value)}
            disabled={!canEdit || readOnly}
            onChange={(event) =>
              onChange({
                ...settings,
                [key]: numeric ? Number(event.target.value) : event.target.value,
              })
            }
            style={inputStyle}
          />
        </td>
        <td style={{ color: "var(--text-muted)", fontSize: 13 }}>{unit}</td>
      </tr>
    );
  };

  return (
    <>
      <div className="panel" style={{ marginBottom: 22 }}>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Tempo und Regeln der Raumflotte. Nach dem Speichern übernimmt der Server die Werte ohne Neustart.
        </p>
        <table>
          <tbody>
            {SETTING_INFO.filter(([key]) => key in settings || key === "start_system").map(([key, label, unit]) =>
              field(key, label, unit),
            )}
            {other.map((key) => field(key, key, ""))}
          </tbody>
        </table>

        {calibrations.length > 0 && (
          <p className="subtitle">
            Map-Kalibrierung (im Spiel mit <span className="mono">pd_naval_calibrate</span>):{" "}
            {calibrations.map(([key, value]) => (
              <span key={key} className="mono">
                {key.replace("mapcal_", "")}: {JSON.stringify(value)}{" "}
              </span>
            ))}
          </p>
        )}
      </div>

      {canEdit && (
        <div className="button-row" style={{ flexWrap: "wrap" }}>
          <button className="primary" onClick={onSave} disabled={busy}>
            {busy ? "Wird gespeichert…" : "Einstellungen speichern"}
          </button>
          <button onClick={() => onAction("pause", "Simulation umgeschaltet")} disabled={busy}>
            Simulation pausieren / fortsetzen
          </button>
          <button
            onClick={() => {
              if (!confirm("Galaxie aus data/naval/galaxy.json neu importieren? Eigene System-Änderungen gehen verloren."))
                return;
              onAction("import_galaxy", "Import angestoßen - Ergebnis in der Serverkonsole");
            }}
            disabled={busy}
          >
            Galaxie neu importieren
          </button>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function ClassesTab({
  classes,
  factions,
  canEdit,
  busy,
  onChange,
  onSave,
}: {
  classes: ShipClass[];
  factions: Faction[];
  canEdit: boolean;
  busy: boolean;
  onChange: (value: ShipClass[]) => void;
  onSave: () => void;
}) {
  const [open, setOpen] = useState<number | null>(null);

  const patch = (index: number, changes: Partial<ShipClass>) =>
    onChange(classes.map((cls, i) => (i === index ? { ...cls, ...changes } : cls)));

  const jsonError = (text: string): string | null => {
    try {
      const value = JSON.parse(text);
      return typeof value === "object" && value !== null && !Array.isArray(value) ? null : "kein Objekt";
    } catch (error) {
      return (error as Error).message;
    }
  };

  return (
    <>
      <div className="panel" style={{ marginBottom: 22 }}>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Schiffsklassen mit Modell, Länge und Hülle. Die Zusatzdaten (Antrieb, Hyperantrieb, Sensoren, später
          Schilde und Waffen) sind JSON, z. B. <span className="mono">{`{"move":{"maxSpeed":4000}}`}</span>.
          Klassen, die noch Schiffe benutzen, lassen sich nicht entfernen.
        </p>

        <table>
          <thead>
            <tr>
              <th style={{ width: 130 }}>ID</th>
              <th>Name</th>
              <th style={{ width: 150 }}>Fraktion</th>
              <th style={{ width: 100 }}>Länge (m)</th>
              <th style={{ width: 110 }}>Hülle</th>
              <th style={{ width: 170 }} />
            </tr>
          </thead>
          <tbody>
            {classes.map((cls, index) => (
              <Fragment key={index}>
                <tr>
                  <td className="mono">
                    <input
                      value={cls.id}
                      disabled={!canEdit}
                      onChange={(event) => patch(index, { id: event.target.value.toLowerCase() })}
                      style={inputStyle}
                    />
                  </td>
                  <td>
                    <input
                      value={cls.name}
                      disabled={!canEdit}
                      onChange={(event) => patch(index, { name: event.target.value })}
                      style={inputStyle}
                    />
                  </td>
                  <td>
                    <select
                      value={cls.faction}
                      disabled={!canEdit}
                      onChange={(event) => patch(index, { faction: event.target.value })}
                      style={inputStyle}
                    >
                      <option value="">-</option>
                      {factions.map((faction) => (
                        <option key={faction.id} value={faction.id}>
                          {faction.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      value={cls.lengthM}
                      disabled={!canEdit}
                      onChange={(event) => patch(index, { lengthM: Number(event.target.value) || 0 })}
                      style={inputStyle}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={cls.hull}
                      disabled={!canEdit}
                      onChange={(event) => patch(index, { hull: Number(event.target.value) || 0 })}
                      style={inputStyle}
                    />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      style={{ padding: "4px 10px", fontSize: 13 }}
                      onClick={() => setOpen(open === index ? null : index)}
                    >
                      Details
                    </button>{" "}
                    {canEdit && (
                      <button
                        style={{ padding: "4px 10px", fontSize: 13 }}
                        onClick={() => {
                          if (!confirm(`"${cls.name}" entfernen?`)) return;
                          onChange(classes.filter((_, i) => i !== index));
                        }}
                      >
                        Entfernen
                      </button>
                    )}
                  </td>
                </tr>
                {open === index && (
                  <tr>
                    <td colSpan={6}>
                      <div className="card-label">Modell</div>
                      <input
                        value={cls.model}
                        disabled={!canEdit}
                        onChange={(event) => patch(index, { model: event.target.value })}
                        style={{ ...inputStyle, marginBottom: 8 }}
                      />
                      <div className="card-label">
                        Zusatzdaten (JSON){" "}
                        {jsonError(cls.data) && (
                          <span style={{ color: "var(--danger, #f05046)" }}>- Fehler: {jsonError(cls.data)}</span>
                        )}
                      </div>
                      <textarea
                        value={cls.data}
                        disabled={!canEdit}
                        rows={10}
                        onChange={(event) => patch(index, { data: event.target.value })}
                        style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12 }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="button-row">
          <button
            onClick={() =>
              onChange([
                ...classes,
                { id: "neue_klasse", name: "Neue Klasse", faction: "", model: "models/", lengthM: 100, hull: 1000, data: "{}" },
              ])
            }
            disabled={busy}
          >
            Klasse hinzufügen
          </button>
          <button className="primary" onClick={onSave} disabled={busy}>
            {busy ? "Wird gespeichert…" : "Klassen speichern"}
          </button>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function FactionsTab({
  factions,
  relations,
  canEdit,
  busy,
  onChange,
  onRelations,
  onSave,
}: {
  factions: Faction[];
  relations: Relation[];
  canEdit: boolean;
  busy: boolean;
  onChange: (value: Faction[]) => void;
  onRelations: (value: Relation[]) => void;
  onSave: () => void;
}) {
  const patch = (index: number, changes: Partial<Faction>) =>
    onChange(factions.map((faction, i) => (i === index ? { ...faction, ...changes } : faction)));

  const relationOf = (a: string, b: string): Relation["relation"] =>
    relations.find((rel) => (rel.a === a && rel.b === b) || (rel.a === b && rel.b === a))?.relation ?? "neutral";

  const setRelation = (a: string, b: string, relation: Relation["relation"]) =>
    onRelations([
      ...relations.filter((rel) => !((rel.a === a && rel.b === b) || (rel.a === b && rel.b === a))),
      { a, b, relation },
    ]);

  return (
    <>
      <div className="panel" style={{ marginBottom: 22 }}>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Fraktionen mit Farbe (Taktik-Anzeige) und IFF-Kennung. <b>Spielerfraktion</b> markiert, auf wessen Seite die
          Spieler stehen.
        </p>
        <table>
          <thead>
            <tr>
              <th style={{ width: 130 }}>ID</th>
              <th>Name</th>
              <th style={{ width: 70 }}>Farbe</th>
              <th style={{ width: 90 }}>IFF</th>
              <th style={{ width: 110 }}>Spieler</th>
              <th style={{ width: 100 }} />
            </tr>
          </thead>
          <tbody>
            {factions.map((faction, index) => (
              <tr key={index}>
                <td>
                  <input
                    value={faction.id}
                    disabled={!canEdit}
                    onChange={(event) => patch(index, { id: event.target.value.toLowerCase() })}
                    style={inputStyle}
                  />
                </td>
                <td>
                  <input
                    value={faction.name}
                    disabled={!canEdit}
                    onChange={(event) => patch(index, { name: event.target.value })}
                    style={inputStyle}
                  />
                </td>
                <td>
                  <input
                    type="color"
                    value={toHex(faction.color)}
                    disabled={!canEdit}
                    onChange={(event) => patch(index, { color: fromHex(event.target.value) })}
                    style={{ width: 48, height: 34, border: "none", background: "none" }}
                  />
                </td>
                <td>
                  <input
                    value={faction.iff}
                    disabled={!canEdit}
                    onChange={(event) => patch(index, { iff: event.target.value })}
                    style={inputStyle}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={faction.player}
                    disabled={!canEdit}
                    onChange={(event) => patch(index, { player: event.target.checked })}
                  />
                </td>
                <td>
                  {canEdit && (
                    <button
                      style={{ padding: "4px 10px", fontSize: 13 }}
                      onClick={() => {
                        if (!confirm(`"${faction.name}" entfernen?`)) return;
                        onChange(factions.filter((_, i) => i !== index));
                      }}
                    >
                      Entfernen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit && (
          <div className="button-row" style={{ marginTop: 10 }}>
            <button
              onClick={() =>
                onChange([...factions, { id: "neue_fraktion", name: "Neue Fraktion", color: "200,200,200", iff: "", player: false }])
              }
            >
              Fraktion hinzufügen
            </button>
          </div>
        )}
      </div>

      <h2>Beziehungen</h2>
      <div className="panel" style={{ marginBottom: 22, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th />
              {factions.map((faction) => (
                <th key={faction.id}>{faction.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {factions.map((a, i) => (
              <tr key={a.id}>
                <td>
                  <b>{a.name}</b>
                </td>
                {factions.map((b, j) => (
                  <td key={b.id}>
                    {i === j ? (
                      <span style={{ color: "var(--text-muted)" }}>-</span>
                    ) : (
                      <select
                        value={relationOf(a.id, b.id)}
                        disabled={!canEdit}
                        onChange={(event) => setRelation(a.id, b.id, event.target.value as Relation["relation"])}
                        style={{ ...inputStyle, color: REL_COLOR[relationOf(a.id, b.id)] }}
                      >
                        {Object.entries(REL_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="button-row">
          <button className="primary" onClick={onSave} disabled={busy}>
            {busy ? "Wird gespeichert…" : "Fraktionen und Beziehungen speichern"}
          </button>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function GalaxyMap({ systems, selected, onSelect }: {
  systems: StarSystem[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const SIZE = 560;

  const bounds = useMemo(() => {
    let max = 1;
    for (const s of systems) max = Math.max(max, Math.abs(s.x), Math.abs(s.y));
    return max * 1.05;
  }, [systems]);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#06090e";
    ctx.fillRect(0, 0, SIZE, SIZE);

    for (const s of systems) {
      const x = SIZE / 2 + (s.x / bounds) * (SIZE / 2);
      const y = SIZE / 2 - (s.y / bounds) * (SIZE / 2);
      ctx.fillStyle = s.hidden ? "#444" : s.jumpable ? "#c8d7f0" : "#f05046";
      ctx.fillRect(x, y, s.id === selected ? 4 : 1.5, s.id === selected ? 4 : 1.5);
    }

    const sel = systems.find((s) => s.id === selected);
    if (sel) {
      const x = SIZE / 2 + (sel.x / bounds) * (SIZE / 2);
      const y = SIZE / 2 - (sel.y / bounds) * (SIZE / 2);
      ctx.strokeStyle = "#f0be46";
      ctx.strokeRect(x - 6, y - 6, 13, 13);
      ctx.fillStyle = "#f0be46";
      ctx.font = "13px sans-serif";
      ctx.fillText(sel.name, x + 10, y - 8);
    }
  }, [systems, selected, bounds]);

  return (
    <canvas
      ref={canvas}
      width={SIZE}
      height={SIZE}
      style={{ maxWidth: "100%", cursor: "crosshair", border: "1px solid var(--border)" }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const px = ((event.clientX - rect.left) / rect.width) * SIZE;
        const py = ((event.clientY - rect.top) / rect.height) * SIZE;
        const gx = ((px - SIZE / 2) / (SIZE / 2)) * bounds;
        const gy = (-(py - SIZE / 2) / (SIZE / 2)) * bounds;

        let best: StarSystem | null = null;
        let bestDist = Infinity;
        for (const s of systems) {
          const d = (s.x - gx) ** 2 + (s.y - gy) ** 2;
          if (d < bestDist) {
            best = s;
            bestDist = d;
          }
        }
        if (best) onSelect(best.id);
      }}
    />
  );
}

function SystemsTab({
  systems,
  changes,
  canEdit,
  busy,
  onChange,
  onSave,
}: {
  systems: StarSystem[];
  changes: Record<string, { hidden: boolean; jumpable: boolean }>;
  canEdit: boolean;
  busy: boolean;
  onChange: (value: Record<string, { hidden: boolean; jumpable: boolean }>) => void;
  onSave: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const merged = useMemo(
    () => systems.map((s) => (changes[s.id] ? { ...s, ...changes[s.id] } : s)),
    [systems, changes],
  );

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f
      ? merged.filter((s) => s.name.toLowerCase().includes(f) || s.region.toLowerCase().includes(f))
      : merged.filter((s) => s.id === selected || s.hidden || !s.jumpable);
    return list.slice(0, 200);
  }, [merged, filter, selected]);

  const toggle = (s: StarSystem, key: "hidden" | "jumpable") =>
    onChange({ ...changes, [s.id]: { hidden: s.hidden, jumpable: s.jumpable, [key]: !s[key] } });

  return (
    <>
      <div className="panel" style={{ marginBottom: 22 }}>
        <p className="subtitle" style={{ marginTop: 0 }}>
          {systems.length} Systeme. <b>Gesperrt</b> = kein Sprungziel (z. B. für Events), <b>Versteckt</b> = gar nicht
          angezeigt. Ohne Suche zeigt die Liste nur gesperrte und versteckte Systeme. Klick in die Karte wählt das
          nächste System.
        </p>

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
          <GalaxyMap systems={merged} selected={selected} onSelect={(id) => setSelected(id)} />

          <div style={{ flex: 1, minWidth: 320 }}>
            <input
              placeholder="System oder Region suchen…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              style={{ ...inputStyle, marginBottom: 10 }}
            />
            <table>
              <thead>
                <tr>
                  <th>System</th>
                  <th>Region</th>
                  <th style={{ width: 80 }}>Gesperrt</th>
                  <th style={{ width: 80 }}>Versteckt</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelected(s.id)}
                    style={{ background: s.id === selected ? "var(--bg-panel-light)" : undefined, cursor: "pointer" }}
                  >
                    <td>
                      {s.name}
                      {changes[s.id] && " *"}
                    </td>
                    <td style={{ color: "var(--text-muted)" }}>{s.region}</td>
                    <td>
                      <input type="checkbox" checked={!s.jumpable} disabled={!canEdit} onChange={() => toggle(s, "jumpable")} />
                    </td>
                    <td>
                      <input type="checkbox" checked={s.hidden} disabled={!canEdit} onChange={() => toggle(s, "hidden")} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="button-row">
          <button className="primary" onClick={onSave} disabled={busy || Object.keys(changes).length === 0}>
            {busy ? "Wird gespeichert…" : `${Object.keys(changes).length} Änderung(en) speichern`}
          </button>
          <button onClick={() => onChange({})} disabled={busy}>
            Verwerfen
          </button>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function RuntimeTab({ data, onReload }: { data: Data; onReload: () => void }) {
  const systemName = useMemo(() => {
    const map = new Map(data.systems.map((s) => [s.id, s.name]));
    return (id: string) => map.get(id) ?? id;
  }, [data.systems]);

  const className = (id: string) => data.classes.find((cls) => cls.id === id)?.name ?? id;
  const factionName = (id: string) => data.factions.find((f) => f.id === id)?.name ?? id;
  const shipName = (id: number) => data.ships.find((ship) => ship.id === id)?.name ?? `#${id}`;

  return (
    <>
      <div className="button-row" style={{ marginBottom: 12 }}>
        <button onClick={onReload}>Aktualisieren</button>
      </div>

      <h2>Schiffe</h2>
      <div className="panel" style={{ marginBottom: 22 }}>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Stand der letzten Speicherung des Servers (alle 60 s). Schiffe erzeugen und befehligen: Seite <a href="/flotte">Flottenkommando</a> oder im Spiel im
          Flottenkommando.
        </p>
        <table>
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th>Name</th>
              <th>Klasse</th>
              <th>Fraktion</th>
              <th>System</th>
              <th>Zustand</th>
              <th>Gespeichert</th>
            </tr>
          </thead>
          <tbody>
            {data.ships.map((ship) => (
              <tr key={`${ship.server_key}-${ship.id}`}>
                <td>{ship.id}</td>
                <td>
                  {ship.profile ? "★ " : ""}
                  {ship.name}
                </td>
                <td>{className(ship.class_id)}</td>
                <td>{factionName(ship.faction_id)}</td>
                <td>{systemName(ship.system_id)}</td>
                <td>{ship.state}</td>
                <td>{ship.updated_at ? dateFormat(ship.updated_at) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Logbuch</h2>
      <div className="panel" style={{ marginBottom: 22, maxHeight: 480, overflowY: "auto" }}>
        <table>
          <tbody>
            {data.log.map((row) => (
              <tr key={row.id}>
                <td style={{ whiteSpace: "nowrap", width: 150 }}>{dateFormat(row.ts)}</td>
                <td style={{ width: 140 }}>{shipName(row.ship_id)}</td>
                <td style={{ width: 90, color: "var(--text-muted)" }}>{row.kind}</td>
                <td>
                  {row.text}
                  {row.author && <span style={{ color: "var(--text-muted)" }}> - {row.author}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Konsolen</h2>
      <div className="panel">
        <p className="subtitle" style={{ marginTop: 0 }}>
          Aufstellen und Sperren im Spiel (Admin-Menü Raumflotte bzw. <span className="mono">pd_naval_console_*</span>).
        </p>
        <table>
          <thead>
            <tr>
              <th>Map</th>
              <th>Station</th>
              <th>Position</th>
              <th>Gesperrt</th>
            </tr>
          </thead>
          <tbody>
            {data.consoles.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.map}</td>
                <td>{c.station}</td>
                <td className="mono">{c.pos}</td>
                <td>{c.locked ? "ja" : "nein"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
