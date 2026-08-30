"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Field, Notice, fetchWithTimeout, inputStyle, readJson } from "./ui";

interface Category {
  name: string;
  position: number;
  maxItems: number;
}

interface Weapon {
  class: string;
  category: string;
  weight: number;
}

interface Config {
  maxWeight: number;
  defaultWeight: number;
  defaultCategory: string;
  categories: Category[];
  weapons: Weapon[];
  always: string[];
}

export default function WaffenManager({ user }: { user: PanelUser }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [configured, setConfigured] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [newClass, setNewClass] = useState("");

  const canEdit = user.role === "editor" || user.role === "admin";

  const load = useCallback(async () => {
    try {
      const response = await fetchWithTimeout("/api/waffen", { cache: "no-store" });
      const { data, error } = await readJson<{
        configured: boolean;
        hint?: string;
        config?: Config;
      }>(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      setConfigured(data?.configured ?? true);
      setHint(data?.hint ?? null);
      if (data?.config) setConfig(data.config);
    } catch {
      setMessage({ ok: false, text: "Konfiguration konnte nicht geladen werden" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!config) return;

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetchWithTimeout("/api/waffen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      const { data, error } = await readJson<{
        config?: Config;
        reload?: { ok: boolean; message: string };
      }>(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      if (data?.config) setConfig(data.config);

      setMessage({
        ok: Boolean(data?.reload?.ok),
        text: data?.reload?.ok
          ? "Gespeichert, der Server lädt die Waffenkonfiguration neu."
          : `Gespeichert. Server nicht angestoßen: ${data?.reload?.message ?? "unbekannt"}`,
      });
    } catch {
      setMessage({ ok: false, text: "Anfrage fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  const patch = (changes: Partial<Config>) =>
    setConfig((previous) => (previous ? { ...previous, ...changes } : previous));

  const visibleWeapons = useMemo(() => {
    if (!config) return [];

    const needle = filter.trim().toLowerCase();

    return config.weapons.filter(
      (weapon) =>
        needle === "" ||
        weapon.class.toLowerCase().includes(needle) ||
        weapon.category.toLowerCase().includes(needle),
    );
  }, [config, filter]);

  if (loading) return <p className="subtitle">Waffenkonfiguration wird geladen…</p>;

  if (!configured) return <div className="notice">{hint}</div>;
  if (!config) return <div className="notice error">Keine Konfiguration erhalten.</div>;

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}

      <h2>Grundwerte</h2>
      <div className="panel" style={{ marginBottom: 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <Field label="Tragelast in Kg">
            <input
              type="number"
              step="0.5"
              value={config.maxWeight}
              onChange={(event) => patch({ maxWeight: Number(event.target.value) })}
              disabled={!canEdit}
              style={inputStyle}
            />
          </Field>

          <Field label="Standardgewicht" hint="gilt für Waffen ohne eigenen Eintrag">
            <input
              type="number"
              step="0.5"
              value={config.defaultWeight}
              onChange={(event) => patch({ defaultWeight: Number(event.target.value) })}
              disabled={!canEdit}
              style={inputStyle}
            />
          </Field>

          <Field label="Auffangkategorie" hint="für Ausrüstung ohne Zuordnung">
            <select
              value={config.defaultCategory}
              onChange={(event) => patch({ defaultCategory: event.target.value })}
              disabled={!canEdit}
              style={inputStyle}
            >
              {config.categories.map((category) => (
                <option key={category.name} value={category.name}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <h2>Kategorien</h2>
      <div className="panel" style={{ marginBottom: 22 }}>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Die Reihenfolge bestimmt die Anzeige an der Kiste. Limit 0 heißt unbegrenzt.
        </p>

        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ width: 140 }}>Limit</th>
              <th style={{ width: 120, textAlign: "right" }}>Waffen</th>
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {config.categories.map((category, index) => (
              <tr key={`${category.name}-${index}`}>
                <td>
                  <input
                    value={category.name}
                    disabled={!canEdit}
                    onChange={(event) => {
                      const previousName = category.name;
                      const nextName = event.target.value;

                      // Umbenennen muss die Waffen mitnehmen, sonst zeigen sie
                      // auf eine Kategorie, die es nicht mehr gibt.
                      patch({
                        categories: config.categories.map((entry, i) =>
                          i === index ? { ...entry, name: nextName } : entry,
                        ),
                        weapons: config.weapons.map((weapon) =>
                          weapon.category === previousName
                            ? { ...weapon, category: nextName }
                            : weapon,
                        ),
                        defaultCategory:
                          config.defaultCategory === previousName
                            ? nextName
                            : config.defaultCategory,
                      });
                    }}
                    style={inputStyle}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={category.maxItems}
                    disabled={!canEdit}
                    onChange={(event) =>
                      patch({
                        categories: config.categories.map((entry, i) =>
                          i === index
                            ? { ...entry, maxItems: Number(event.target.value) || 0 }
                            : entry,
                        ),
                      })
                    }
                    style={inputStyle}
                  />
                </td>
                <td style={{ textAlign: "right" }}>
                  {config.weapons.filter((weapon) => weapon.category === category.name).length}
                </td>
                <td>
                  {canEdit && (
                    <button
                      style={{ padding: "4px 10px", fontSize: 13 }}
                      onClick={() => {
                        const count = config.weapons.filter(
                          (weapon) => weapon.category === category.name,
                        ).length;

                        if (
                          !confirm(
                            count > 0
                              ? `"${category.name}" entfernen? ${count} Waffe(n) landen in "${config.defaultCategory}".`
                              : `"${category.name}" entfernen?`,
                          )
                        )
                          return;

                        patch({
                          categories: config.categories.filter((_, i) => i !== index),
                          weapons: config.weapons.map((weapon) =>
                            weapon.category === category.name
                              ? { ...weapon, category: config.defaultCategory }
                              : weapon,
                          ),
                        });
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
          <button
            style={{ marginTop: 12 }}
            onClick={() =>
              patch({
                categories: [
                  ...config.categories,
                  {
                    name: `Kategorie ${config.categories.length + 1}`,
                    position: config.categories.length + 1,
                    maxItems: 0,
                  },
                ],
              })
            }
          >
            + Kategorie
          </button>
        )}
      </div>

      <h2>Immer dabei</h2>
      <div className="panel" style={{ marginBottom: 22 }}>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Diese Ausrüstung bekommt jeder beim Spawn. Sie wiegt nichts, taucht in der
          Kiste nicht als wählbar auf und lässt sich nicht ablegen.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {config.always.map((entry) => (
            <span
              key={entry}
              className="mono"
              style={{
                padding: "5px 10px",
                background: "var(--bg-panel-light)",
                border: "1px solid var(--border)",
                borderRadius: 3,
                fontSize: 13,
              }}
            >
              {entry}
              {canEdit && (
                <span
                  onClick={() =>
                    patch({ always: config.always.filter((item) => item !== entry) })
                  }
                  style={{ marginLeft: 8, cursor: "pointer", color: "var(--red)" }}
                >
                  ×
                </span>
              )}
            </span>
          ))}

          {config.always.length === 0 && (
            <span className="subtitle">Keine feste Ausrüstung eingetragen.</span>
          )}
        </div>

        {canEdit && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input
              value={newClass}
              onChange={(event) => setNewClass(event.target.value.trim())}
              placeholder="Waffenklasse, z. B. mhands"
              style={{ ...inputStyle, maxWidth: 280, fontFamily: "Consolas, monospace" }}
            />
            <button
              disabled={newClass === "" || config.always.includes(newClass)}
              onClick={() => {
                patch({ always: [...config.always, newClass] });
                setNewClass("");
              }}
            >
              Hinzufügen
            </button>
          </div>
        )}
      </div>

      <h2>Waffen und Gewichte</h2>
      <div className="panel">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Waffenklasse oder Kategorie filtern…"
          style={{ ...inputStyle, marginBottom: 14 }}
        />

        <p className="subtitle" style={{ marginTop: 0 }}>
          {visibleWeapons.length} von {config.weapons.length} Einträgen
        </p>

        <div style={{ maxHeight: 460, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Klasse</th>
                <th style={{ width: 200 }}>Kategorie</th>
                <th style={{ width: 130 }}>Gewicht (Kg)</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {visibleWeapons.map((weapon) => {
                const index = config.weapons.indexOf(weapon);

                return (
                  <tr key={weapon.class}>
                    <td className="mono" style={{ fontSize: 13, color: "var(--text)" }}>
                      {weapon.class}
                    </td>
                    <td>
                      <select
                        value={weapon.category}
                        disabled={!canEdit}
                        onChange={(event) =>
                          patch({
                            weapons: config.weapons.map((entry, i) =>
                              i === index ? { ...entry, category: event.target.value } : entry,
                            ),
                          })
                        }
                        style={{ ...inputStyle, padding: "4px 8px" }}
                      >
                        {config.categories.map((category) => (
                          <option key={category.name} value={category.name}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={weapon.weight}
                        disabled={!canEdit}
                        onChange={(event) =>
                          patch({
                            weapons: config.weapons.map((entry, i) =>
                              i === index
                                ? { ...entry, weight: Number(event.target.value) || 0 }
                                : entry,
                            ),
                          })
                        }
                        style={{ ...inputStyle, padding: "4px 8px" }}
                      />
                    </td>
                    <td>
                      {canEdit && (
                        <button
                          style={{ padding: "3px 9px", fontSize: 12 }}
                          onClick={() =>
                            patch({
                              weapons: config.weapons.filter((_, i) => i !== index),
                            })
                          }
                        >
                          Entfernen
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <input
              value={newClass}
              onChange={(event) => setNewClass(event.target.value.trim())}
              placeholder="Neue Waffenklasse"
              style={{ ...inputStyle, maxWidth: 280, fontFamily: "Consolas, monospace" }}
            />
            <button
              disabled={
                newClass === "" ||
                config.weapons.some((weapon) => weapon.class === newClass)
              }
              onClick={() => {
                patch({
                  weapons: [
                    ...config.weapons,
                    {
                      class: newClass,
                      category: config.defaultCategory,
                      weight: config.defaultWeight,
                    },
                  ],
                });
                setNewClass("");
              }}
            >
              Waffe hinzufügen
            </button>
          </div>
        )}
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
