"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Field, Notice, fetchWithTimeout, inputStyle, readJson } from "./ui";

interface Settings {
  max_chars: number;
  default_slots: number;
  slots_by_group: Record<string, number>;
  name_min: number;
  name_max: number;
  name_blacklist: string[];
  id_prefix: string;
  id_format: string;
  id_blocked: string[];
  background: string;
  discord: string;
  kollektion: string;
  default_job: string;
}

const DEFAULTS: Settings = {
  max_chars: 5,
  default_slots: 2,
  slots_by_group: {},
  name_min: 3,
  name_max: 20,
  name_blacklist: [],
  id_prefix: "CT-",
  id_format: "##-####",
  id_blocked: [],
  background: "",
  discord: "",
  kollektion: "",
  default_job: "",
};

/** Beispiel-ID wie im Spiel: erste Ziffer eines Blocks nie 0. */
function exampleId(format: string): string {
  let previousDigit = false;
  let out = "";
  let n = 4;

  for (const char of format) {
    if (char === "#") {
      out += String(previousDigit ? (n++ * 7) % 10 : ((n++ * 3) % 9) + 1);
      previousDigit = true;
    } else {
      out += char;
      previousDigit = false;
    }
  }

  return out;
}

function ListEditor({
  values,
  onChange,
  disabled,
  placeholder,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  disabled: boolean;
  placeholder: string;
}) {
  const [entry, setEntry] = useState("");

  const add = () => {
    const value = entry.trim();
    if (value === "" || values.includes(value)) return;
    onChange([...values, value]);
    setEntry("");
  };

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        {values.length === 0 && <span className="subtitle" style={{ margin: 0 }}>leer</span>}
        {values.map((value) => (
          <span
            key={value}
            className="mono"
            style={{
              padding: "5px 10px",
              background: "var(--bg-panel-light)",
              border: "1px solid var(--border)",
              borderRadius: 3,
              fontSize: 13,
            }}
          >
            {value}
            {!disabled && (
              <span
                onClick={() => onChange(values.filter((item) => item !== value))}
                style={{ marginLeft: 8, cursor: "pointer", color: "var(--red)" }}
              >
                ×
              </span>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <div style={{ display: "flex", gap: 8, maxWidth: 420 }}>
          <input
            value={entry}
            placeholder={placeholder}
            onChange={(event) => setEntry(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") add();
            }}
            style={inputStyle}
          />
          <button onClick={add}>Hinzufügen</button>
        </div>
      )}
    </>
  );
}

export default function CharakterManager({ user }: { user: PanelUser }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [configured, setConfigured] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [newGroup, setNewGroup] = useState("");

  const canEdit = user.role === "editor" || user.role === "admin";

  const load = useCallback(async () => {
    try {
      const response = await fetchWithTimeout("/api/charakter", { cache: "no-store" });
      const { data, error } = await readJson<{
        configured: boolean;
        hint?: string;
        settings?: Partial<Settings>;
      }>(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      setConfigured(data?.configured ?? true);
      setHint(data?.hint ?? null);
      if (data?.settings) setSettings({ ...DEFAULTS, ...data.settings });
    } catch {
      setMessage({ ok: false, text: "Einstellungen konnten nicht geladen werden" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const example = useMemo(
    () => (settings ? `${settings.id_prefix}${exampleId(settings.id_format)} Name` : ""),
    [settings],
  );

  const save = async () => {
    if (!settings) return;

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetchWithTimeout("/api/charakter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      const { data, error } = await readJson<{
        settings?: Partial<Settings>;
        reload?: { ok: boolean; message: string };
      }>(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      if (data?.settings) setSettings({ ...DEFAULTS, ...data.settings });

      setMessage({
        ok: Boolean(data?.reload?.ok),
        text: data?.reload?.ok
          ? "Gespeichert, der Server lädt die Charakter-Einstellungen neu."
          : `Gespeichert. Server nicht angestoßen: ${data?.reload?.message ?? "unbekannt"}`,
      });
    } catch {
      setMessage({ ok: false, text: "Anfrage fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="subtitle">Einstellungen werden geladen…</p>;

  if (!configured) return <div className="notice">{hint}</div>;
  if (!settings) return <div className="notice error">Keine Einstellungen erhalten.</div>;

  const patch = (changes: Partial<Settings>) => setSettings({ ...settings, ...changes });
  const num = (value: string, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  };

  const groups = Object.entries(settings.slots_by_group).sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}

      <h2>Charakter-ID</h2>
      <div className="panel" style={{ marginBottom: 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Präfix" hint="steht vor jeder ID in allen Anzeigen, z. B. CT-">
            <input
              value={settings.id_prefix}
              maxLength={16}
              disabled={!canEdit}
              onChange={(event) => patch({ id_prefix: event.target.value })}
              style={inputStyle}
            />
          </Field>

          <Field label="Format neuer IDs" hint="# = Ziffer, z. B. ##-#### ; gilt nur für neue Charaktere">
            <input
              className="mono"
              value={settings.id_format}
              maxLength={24}
              disabled={!canEdit}
              onChange={(event) => patch({ id_format: event.target.value })}
              style={inputStyle}
            />
          </Field>
        </div>

        <p className="subtitle" style={{ marginTop: 0 }}>
          Beispiel: <span className="mono">{example}</span>. Der Präfix wird nur angezeigt,
          gespeichert ist die ID ohne ihn - eine Änderung wirkt sofort auf alle.
        </p>

        <Field
          label="Gesperrte Nummern"
          hint="ganze IDs (z. B. 66-6666) oder einzelne Blöcke (z. B. 1138) - neue IDs treffen sie nie"
        >
          <ListEditor
            values={settings.id_blocked}
            onChange={(values) => patch({ id_blocked: values })}
            disabled={!canEdit}
            placeholder="z. B. 1138"
          />
        </Field>
      </div>

      <h2>Charaktere & Slots</h2>
      <div className="panel" style={{ marginBottom: 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Maximale Charaktere" hint="Obergrenze für alle Ränge">
            <input
              type="number"
              min={1}
              max={20}
              value={settings.max_chars}
              disabled={!canEdit}
              onChange={(event) => patch({ max_chars: num(event.target.value, 5) })}
              style={inputStyle}
            />
          </Field>

          <Field label="Slots ohne eigenen Eintrag" hint="für Benutzergruppen, die unten fehlen">
            <input
              type="number"
              min={0}
              max={20}
              value={settings.default_slots}
              disabled={!canEdit}
              onChange={(event) => patch({ default_slots: num(event.target.value, 2) })}
              style={inputStyle}
            />
          </Field>
        </div>

        <table>
          <thead>
            <tr>
              <th>Benutzergruppe (SAM-Rang)</th>
              <th style={{ width: 140 }}>Slots</th>
              <th style={{ width: 100 }} />
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, slots]) => (
              <tr key={group}>
                <td className="mono">{group}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={slots}
                    disabled={!canEdit}
                    onChange={(event) =>
                      patch({
                        slots_by_group: {
                          ...settings.slots_by_group,
                          [group]: num(event.target.value, 0),
                        },
                      })
                    }
                    style={inputStyle}
                  />
                </td>
                <td>
                  {canEdit && (
                    <button
                      style={{ padding: "4px 10px", fontSize: 13 }}
                      onClick={() => {
                        const next = { ...settings.slots_by_group };
                        delete next[group];
                        patch({ slots_by_group: next });
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
          <div style={{ display: "flex", gap: 8, marginTop: 12, maxWidth: 420 }}>
            <input
              className="mono"
              value={newGroup}
              placeholder="Gruppe, z. B. vip"
              onChange={(event) => setNewGroup(event.target.value)}
              style={inputStyle}
            />
            <button
              onClick={() => {
                const group = newGroup.trim();
                if (group === "" || group in settings.slots_by_group) return;
                patch({
                  slots_by_group: { ...settings.slots_by_group, [group]: settings.default_slots },
                });
                setNewGroup("");
              }}
            >
              Hinzufügen
            </button>
          </div>
        )}
      </div>

      <h2>Namen</h2>
      <div className="panel" style={{ marginBottom: 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Minimale Länge">
            <input
              type="number"
              min={1}
              max={64}
              value={settings.name_min}
              disabled={!canEdit}
              onChange={(event) => patch({ name_min: num(event.target.value, 3) })}
              style={inputStyle}
            />
          </Field>
          <Field label="Maximale Länge">
            <input
              type="number"
              min={1}
              max={64}
              value={settings.name_max}
              disabled={!canEdit}
              onChange={(event) => patch({ name_max: num(event.target.value, 20) })}
              style={inputStyle}
            />
          </Field>
        </div>

        <Field
          label="Gesperrte Wörter"
          hint="ein Name wird abgelehnt, wenn er eines davon enthält (Groß-/Kleinschreibung egal)"
        >
          <ListEditor
            values={settings.name_blacklist}
            onChange={(values) => patch({ name_blacklist: values })}
            disabled={!canEdit}
            placeholder="Wort"
          />
        </Field>
      </div>

      <h2>Charaktermenü</h2>
      <div className="panel" style={{ marginBottom: 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Hintergrundbild" hint="Materialpfad, z. B. mario/void_logo.png">
            <input
              className="mono"
              value={settings.background}
              disabled={!canEdit}
              onChange={(event) => patch({ background: event.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Standard-Job" hint="leer = Standard aus dem Jobbaum">
            <input
              className="mono"
              value={settings.default_job}
              disabled={!canEdit}
              onChange={(event) => patch({ default_job: event.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Discord-Link">
            <input
              value={settings.discord}
              disabled={!canEdit}
              onChange={(event) => patch({ discord: event.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Kollektions-Link">
            <input
              value={settings.kollektion}
              disabled={!canEdit}
              onChange={(event) => patch({ kollektion: event.target.value })}
              style={inputStyle}
            />
          </Field>
        </div>
      </div>

      {canEdit && (
        <div className="button-row" style={{ marginTop: 20 }}>
          <button className="primary" onClick={() => void save()} disabled={busy}>
            {busy ? "Wird gespeichert…" : "Alles speichern"}
          </button>
          <button onClick={() => void load()} disabled={busy}>
            Verwerfen und neu laden
          </button>
        </div>
      )}
    </>
  );
}
