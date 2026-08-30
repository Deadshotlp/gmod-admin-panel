"use client";

import { useCallback, useEffect, useState } from "react";
import type { PanelUser } from "@/lib/auth";

interface JobColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface JobEntry {
  jobKey: string;
  name: string;
  salary: number;
  speed: number;
  position: number;
  showId: boolean;
  isDefault: boolean;
  equip: string[];
  model: string[];
  color: JobColor;
}

interface SubunitEntry {
  subunitKey: string;
  name: string;
  isDefault: boolean;
  maxMembers: number;
  isMedic: boolean;
  isLeo: boolean;
  isEngineer: boolean;
  equip: string[];
  color: JobColor;
  jobs: JobEntry[];
}

interface UnitEntry {
  unitKey: string;
  name: string;
  isDefault: boolean;
  equip: string[];
  color: JobColor;
  subunits: SubunitEntry[];
}

type Selection =
  | { level: "unit"; unitKey: string }
  | { level: "subunit"; unitKey: string; subunitKey: string }
  | { level: "job"; unitKey: string; subunitKey: string; jobKey: string }
  | null;

const WHITE: JobColor = { r: 255, g: 255, b: 255, a: 255 };

function colorToHex(color: JobColor): string {
  const hex = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");

  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

function hexToColor(hex: string, alpha: number): JobColor {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return { ...WHITE, a: alpha };

  const value = parseInt(match[1], 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
    a: alpha,
  };
}

/** Kommagetrennte Eingabe zu einer Liste, leere Einträge fliegen raus. */
function parseList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export default function JobsManager({ user }: { user: PanelUser }) {
  const [units, setUnits] = useState<UnitEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Selection>(null);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const canEdit = user.role === "editor" || user.role === "admin";

  const load = useCallback(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch("/api/jobs", {
        cache: "no-store",
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: { units?: UnitEntry[]; error?: string };

      try {
        parsed = JSON.parse(text) as { units?: UnitEntry[]; error?: string };
      } catch {
        setMessage({ ok: false, text: `Unerwartete Antwort (HTTP ${response.status})` });
        return;
      }

      if (parsed.error) {
        setMessage({ ok: false, text: parsed.error });
        return;
      }

      setUnits(parsed.units ?? []);
    } catch (error) {
      setMessage({
        ok: false,
        text:
          (error as Error).name === "AbortError"
            ? "Zeitüberschreitung beim Laden"
            : "Jobs konnten nicht geladen werden",
      });
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true);
      setMessage(null);

      try {
        const response = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const result = (await response.json()) as {
          ok?: boolean;
          units?: UnitEntry[];
          error?: string;
          detail?: unknown;
          reload?: { ok: boolean; message: string };
        };

        if (!response.ok || result.error) {
          setMessage({ ok: false, text: result.error ?? "Änderung fehlgeschlagen" });
          return false;
        }

        setUnits(result.units ?? []);

        // Gespeichert ist gespeichert - auch wenn der Server nicht erreicht wurde.
        setMessage({
          ok: Boolean(result.reload?.ok),
          text: result.reload?.ok
            ? "Gespeichert, der Server lädt die Jobs neu."
            : `Gespeichert. Der Server wurde aber nicht angestoßen: ${result.reload?.message ?? "unbekannt"}. Beim nächsten Neustart ist die Änderung aktiv.`,
        });

        return true;
      } catch {
        setMessage({ ok: false, text: "Anfrage fehlgeschlagen" });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const toggle = (key: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // --- Auswahl und Entwurf -------------------------------------------------

  const selectUnit = (unit: UnitEntry) => {
    setSelection({ level: "unit", unitKey: unit.unitKey });
    setDraft({
      name: unit.name,
      isDefault: unit.isDefault,
      equip: unit.equip.join(", "),
      color: colorToHex(unit.color),
    });
    setMessage(null);
  };

  const selectSubunit = (unit: UnitEntry, subunit: SubunitEntry) => {
    setSelection({
      level: "subunit",
      unitKey: unit.unitKey,
      subunitKey: subunit.subunitKey,
    });
    setDraft({
      name: subunit.name,
      isDefault: subunit.isDefault,
      maxMembers: subunit.maxMembers,
      isMedic: subunit.isMedic,
      isLeo: subunit.isLeo,
      isEngineer: subunit.isEngineer,
      equip: subunit.equip.join(", "),
      color: colorToHex(subunit.color),
    });
    setMessage(null);
  };

  const selectJob = (unit: UnitEntry, subunit: SubunitEntry, job: JobEntry) => {
    setSelection({
      level: "job",
      unitKey: unit.unitKey,
      subunitKey: subunit.subunitKey,
      jobKey: job.jobKey,
    });
    setDraft({
      name: job.name,
      isDefault: job.isDefault,
      salary: job.salary,
      speed: job.speed,
      position: job.position,
      showId: job.showId,
      equip: job.equip.join(", "),
      model: job.model.join(", "),
      color: colorToHex(job.color),
    });
    setMessage(null);
  };

  const newUnit = () => {
    setSelection({ level: "unit", unitKey: "" });
    setDraft({ name: "Neue Einheit", isDefault: false, equip: "", color: "#3a86d4" });
    setMessage(null);
  };

  const newSubunit = (unit: UnitEntry) => {
    setSelection({ level: "subunit", unitKey: unit.unitKey, subunitKey: "" });
    setDraft({
      name: "Neue Untereinheit",
      isDefault: false,
      maxMembers: 0,
      isMedic: false,
      isLeo: false,
      isEngineer: false,
      equip: "",
      color: "#3a86d4",
    });
    setMessage(null);
  };

  const newJob = (unit: UnitEntry, subunit: SubunitEntry) => {
    setSelection({
      level: "job",
      unitKey: unit.unitKey,
      subunitKey: subunit.subunitKey,
      jobKey: "",
    });
    setDraft({
      name: "Neuer Job",
      isDefault: false,
      salary: 0,
      speed: 100,
      position: subunit.jobs.length + 1,
      showId: false,
      equip: "",
      model: "",
      color: "#3a86d4",
    });
    setMessage(null);
  };

  const field = (name: string) => (draft?.[name] ?? "") as string | number;
  const flag = (name: string) => Boolean(draft?.[name]);
  const setField = (name: string, value: unknown) =>
    setDraft((previous) => ({ ...(previous ?? {}), [name]: value }));

  // --- Speichern und Löschen -----------------------------------------------

  const save = async () => {
    if (!selection || !draft) return;

    const color = hexToColor(String(draft.color ?? "#ffffff"), 255);

    if (selection.level === "unit") {
      await send({
        action: "saveUnit",
        ...(selection.unitKey ? { unitKey: selection.unitKey } : {}),
        input: {
          name: String(draft.name ?? ""),
          isDefault: flag("isDefault"),
          equip: parseList(String(draft.equip ?? "")),
          color,
        },
      });
    } else if (selection.level === "subunit") {
      await send({
        action: "saveSubunit",
        unitKey: selection.unitKey,
        ...(selection.subunitKey ? { subunitKey: selection.subunitKey } : {}),
        input: {
          name: String(draft.name ?? ""),
          isDefault: flag("isDefault"),
          maxMembers: Number(draft.maxMembers) || 0,
          isMedic: flag("isMedic"),
          isLeo: flag("isLeo"),
          isEngineer: flag("isEngineer"),
          equip: parseList(String(draft.equip ?? "")),
          color,
        },
      });
    } else {
      await send({
        action: "saveJob",
        unitKey: selection.unitKey,
        subunitKey: selection.subunitKey,
        ...(selection.jobKey ? { jobKey: selection.jobKey } : {}),
        input: {
          name: String(draft.name ?? ""),
          isDefault: flag("isDefault"),
          salary: Number(draft.salary) || 0,
          speed: Number(draft.speed) || 100,
          position: Number(draft.position) || 0,
          showId: flag("showId"),
          equip: parseList(String(draft.equip ?? "")),
          model: parseList(String(draft.model ?? "")),
          color,
        },
      });
    }

    setSelection(null);
    setDraft(null);
  };

  const remove = async () => {
    if (!selection) return;

    // Erst nachsehen, wie viele Charaktere daran hängen - das ist der
    // Unterschied zwischen einer harmlosen und einer folgenschweren Löschung.
    let affected = 0;

    try {
      const response = await fetch("/api/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitKey: selection.unitKey,
          ...(selection.level !== "unit" ? { subunitKey: selection.subunitKey } : {}),
          ...(selection.level === "job" ? { jobKey: selection.jobKey } : {}),
        }),
      });

      const result = (await response.json()) as { affected?: number };
      affected = result.affected ?? 0;
    } catch {
      affected = -1;
    }

    const warning =
      affected > 0
        ? `\n\nAchtung: ${affected} Charakter(e) sind darauf zugewiesen und verlieren ihre Zuordnung.`
        : affected < 0
          ? "\n\nDie Anzahl betroffener Charaktere konnte nicht ermittelt werden."
          : "";

    if (!confirm(`Wirklich löschen?${warning}`)) return;

    if (selection.level === "unit") {
      await send({ action: "deleteUnit", unitKey: selection.unitKey });
    } else if (selection.level === "subunit") {
      await send({
        action: "deleteSubunit",
        unitKey: selection.unitKey,
        subunitKey: selection.subunitKey,
      });
    } else {
      await send({
        action: "deleteJob",
        unitKey: selection.unitKey,
        subunitKey: selection.subunitKey,
        jobKey: selection.jobKey,
      });
    }

    setSelection(null);
    setDraft(null);
  };

  if (loading) return <p className="subtitle">Jobs werden geladen…</p>;

  const isNew =
    selection !== null &&
    ((selection.level === "unit" && selection.unitKey === "") ||
      (selection.level === "subunit" && selection.subunitKey === "") ||
      (selection.level === "job" && selection.jobKey === ""));

  return (
    <>
      {message && (
        <div className={`notice ${message.ok ? "ok" : "error"}`}>{message.text}</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 18 }}>
        {/* Baum */}
        <div className="panel" style={{ alignSelf: "start" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <strong style={{ fontSize: 13 }}>EINHEITEN</strong>
            {canEdit && (
              <button onClick={newUnit} style={{ padding: "4px 10px", fontSize: 13 }}>
                + Einheit
              </button>
            )}
          </div>

          {units.length === 0 && (
            <p className="subtitle" style={{ margin: 0 }}>
              Noch keine Einheiten angelegt.
            </p>
          )}

          {units.map((unit) => (
            <div key={unit.unitKey} style={{ marginBottom: 6 }}>
              <div
                onClick={() => selectUnit(unit)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  cursor: "pointer",
                  borderRadius: 3,
                  background:
                    selection?.level === "unit" && selection.unitKey === unit.unitKey
                      ? "var(--bg-hover)"
                      : "transparent",
                }}
              >
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(unit.unitKey);
                  }}
                  style={{ color: "var(--text-muted)", width: 12 }}
                >
                  {expanded.has(unit.unitKey) ? "▾" : "▸"}
                </span>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: colorToHex(unit.color),
                  }}
                />
                <span style={{ flex: 1 }}>{unit.name}</span>
                {unit.isDefault && (
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>STANDARD</span>
                )}
              </div>

              {expanded.has(unit.unitKey) && (
                <div style={{ marginLeft: 20 }}>
                  {unit.subunits.map((subunit) => (
                    <div key={subunit.subunitKey}>
                      <div
                        onClick={() => selectSubunit(unit, subunit)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "5px 8px",
                          cursor: "pointer",
                          borderRadius: 3,
                          fontSize: 14,
                          background:
                            selection?.level === "subunit" &&
                            selection.subunitKey === subunit.subunitKey
                              ? "var(--bg-hover)"
                              : "transparent",
                        }}
                      >
                        <span
                          onClick={(event) => {
                            event.stopPropagation();
                            toggle(`${unit.unitKey}/${subunit.subunitKey}`);
                          }}
                          style={{ color: "var(--text-muted)", width: 12 }}
                        >
                          {expanded.has(`${unit.unitKey}/${subunit.subunitKey}`) ? "▾" : "▸"}
                        </span>
                        <span style={{ flex: 1, color: "var(--text-dim)" }}>
                          {subunit.name}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {subunit.jobs.length}
                        </span>
                      </div>

                      {expanded.has(`${unit.unitKey}/${subunit.subunitKey}`) && (
                        <div style={{ marginLeft: 20 }}>
                          {subunit.jobs.map((job) => (
                            <div
                              key={job.jobKey}
                              onClick={() => selectJob(unit, subunit, job)}
                              style={{
                                padding: "4px 8px",
                                cursor: "pointer",
                                borderRadius: 3,
                                fontSize: 13,
                                color: "var(--text-muted)",
                                background:
                                  selection?.level === "job" &&
                                  selection.jobKey === job.jobKey
                                    ? "var(--bg-hover)"
                                    : "transparent",
                              }}
                            >
                              {job.position}. {job.name}
                            </div>
                          ))}

                          {canEdit && (
                            <div
                              onClick={() => newJob(unit, subunit)}
                              style={{
                                padding: "4px 8px",
                                cursor: "pointer",
                                fontSize: 13,
                                color: "var(--accent)",
                              }}
                            >
                              + Job
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {canEdit && (
                    <div
                      onClick={() => newSubunit(unit)}
                      style={{
                        padding: "5px 8px",
                        cursor: "pointer",
                        fontSize: 14,
                        color: "var(--accent)",
                      }}
                    >
                      + Untereinheit
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Bearbeiten */}
        <div className="panel">
          {!selection || !draft ? (
            <p className="subtitle" style={{ margin: 0 }}>
              Links einen Eintrag wählen oder einen neuen anlegen.
            </p>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>
                {isNew ? "Neu anlegen" : "Bearbeiten"} ·{" "}
                {selection.level === "unit"
                  ? "Einheit"
                  : selection.level === "subunit"
                    ? "Untereinheit"
                    : "Job"}
              </h2>

              <label className="card-label">Name</label>
              <input
                className="imperial-input"
                value={String(field("name"))}
                onChange={(event) => setField("name", event.target.value)}
                disabled={!canEdit}
                style={inputStyle}
              />

              <label className="card-label">Farbe</label>
              <input
                type="color"
                value={String(field("color"))}
                onChange={(event) => setField("color", event.target.value)}
                disabled={!canEdit}
                style={{ ...inputStyle, height: 38, padding: 2 }}
              />

              {selection.level === "subunit" && (
                <>
                  <label className="card-label">Maximale Mitglieder (0 = unbegrenzt)</label>
                  <input
                    type="number"
                    value={String(field("maxMembers"))}
                    onChange={(event) => setField("maxMembers", event.target.value)}
                    disabled={!canEdit}
                    style={inputStyle}
                  />

                  <div style={{ display: "flex", gap: 18, margin: "10px 0" }}>
                    {(
                      [
                        ["isMedic", "Sanitäter"],
                        ["isLeo", "Ordnungskraft"],
                        ["isEngineer", "Techniker"],
                      ] as const
                    ).map(([name, label]) => (
                      <label key={name} style={checkboxStyle}>
                        <input
                          type="checkbox"
                          checked={flag(name)}
                          onChange={(event) => setField(name, event.target.checked)}
                          disabled={!canEdit}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </>
              )}

              {selection.level === "job" && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    <div>
                      <label className="card-label">Gehalt</label>
                      <input
                        type="number"
                        value={String(field("salary"))}
                        onChange={(event) => setField("salary", event.target.value)}
                        disabled={!canEdit}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label className="card-label">Tempo</label>
                      <input
                        type="number"
                        value={String(field("speed"))}
                        onChange={(event) => setField("speed", event.target.value)}
                        disabled={!canEdit}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label className="card-label">Rangposition</label>
                      <input
                        type="number"
                        value={String(field("position"))}
                        onChange={(event) => setField("position", event.target.value)}
                        disabled={!canEdit}
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  <label style={{ ...checkboxStyle, margin: "10px 0" }}>
                    <input
                      type="checkbox"
                      checked={flag("showId")}
                      onChange={(event) => setField("showId", event.target.checked)}
                      disabled={!canEdit}
                    />
                    Kennnummer im Namen ausblenden
                  </label>

                  <label className="card-label">
                    Playermodels (kommagetrennt, Pfade wie models/…/xyz.mdl)
                  </label>
                  <textarea
                    value={String(field("model"))}
                    onChange={(event) => setField("model", event.target.value)}
                    disabled={!canEdit}
                    rows={3}
                    style={{ ...inputStyle, fontFamily: "Consolas, monospace", fontSize: 13 }}
                  />
                </>
              )}

              <label className="card-label">Ausrüstung (kommagetrennte Waffenklassen)</label>
              <textarea
                value={String(field("equip"))}
                onChange={(event) => setField("equip", event.target.value)}
                disabled={!canEdit}
                rows={3}
                style={{ ...inputStyle, fontFamily: "Consolas, monospace", fontSize: 13 }}
              />

              <label style={{ ...checkboxStyle, margin: "12px 0" }}>
                <input
                  type="checkbox"
                  checked={flag("isDefault")}
                  onChange={(event) => setField("isDefault", event.target.checked)}
                  disabled={!canEdit}
                />
                Standardauswahl auf dieser Ebene
              </label>

              {canEdit && (
                <div className="button-row" style={{ marginTop: 16 }}>
                  <button className="primary" onClick={() => void save()} disabled={busy}>
                    {busy ? "…" : "Speichern"}
                  </button>

                  {!isNew && (
                    <button onClick={() => void remove()} disabled={busy}>
                      Löschen
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setSelection(null);
                      setDraft(null);
                    }}
                    disabled={busy}
                  >
                    Abbrechen
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  marginBottom: 12,
  background: "var(--bg-panel-light)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text)",
  font: "inherit",
  fontSize: 14,
};

const checkboxStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  fontSize: 14,
  color: "var(--text-dim)",
  cursor: "pointer",
};
