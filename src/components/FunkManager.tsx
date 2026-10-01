"use client";

import { useCallback, useEffect, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Notice, fetchWithTimeout, inputStyle, readJson } from "./ui";

interface Channel {
  id: number | null;
  name: string;
  color: string;
  access: "all" | "admin" | "units";
  units: string;
}

interface Range {
  mode: number;
  name: string;
  range: number;
}

interface Config {
  channels: Channel[];
  ranges: Range[];
  units: string[];
}

const ACCESS_LABEL: Record<Channel["access"], string> = {
  all: "Alle",
  admin: "Nur Admins",
  units: "Nur Einheiten",
};

function toHex(color: string): string {
  const [r, g, b] = color.split(",").map((value) => Math.min(255, Number(value) || 0));
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function fromHex(hex: string): string {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) || 0).join(",");
}

export default function FunkManager({ user }: { user: PanelUser }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [configured, setConfigured] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const canEdit = user.role === "editor" || user.role === "admin";

  const load = useCallback(async () => {
    try {
      const response = await fetchWithTimeout("/api/funk", { cache: "no-store" });
      const { data, error } = await readJson<Config & { configured: boolean; hint?: string }>(
        response,
      );

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      setConfigured(data?.configured ?? true);
      setHint(data?.hint ?? null);
      if (data?.channels) {
        setConfig({ channels: data.channels, ranges: data.ranges, units: data.units ?? [] });
      }
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
      const response = await fetchWithTimeout("/api/funk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: config.channels, ranges: config.ranges }),
      });

      const { data, error } = await readJson<
        Config & { reload?: { ok: boolean; message: string } }
      >(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      if (data?.channels) {
        setConfig({ channels: data.channels, ranges: data.ranges, units: data.units ?? [] });
      }

      setMessage({
        ok: Boolean(data?.reload?.ok),
        text: data?.reload?.ok
          ? "Gespeichert, der Server lädt den Funk neu."
          : `Gespeichert. Server nicht angestoßen: ${data?.reload?.message ?? "unbekannt"}`,
      });
    } catch {
      setMessage({ ok: false, text: "Anfrage fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="subtitle">Funk wird geladen…</p>;

  if (!configured) return <div className="notice">{hint}</div>;
  if (!config) return <div className="notice error">Keine Konfiguration erhalten.</div>;

  const patchChannel = (index: number, changes: Partial<Channel>) =>
    setConfig({
      ...config,
      channels: config.channels.map((channel, i) =>
        i === index ? { ...channel, ...changes } : channel,
      ),
    });

  const moveChannel = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= config.channels.length) return;

    const channels = [...config.channels];
    [channels[index], channels[target]] = [channels[target], channels[index]];
    setConfig({ ...config, channels });
  };

  const patchRange = (mode: number, changes: Partial<Range>) =>
    setConfig({
      ...config,
      ranges: config.ranges.map((range) => (range.mode === mode ? { ...range, ...changes } : range)),
    });

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}

      <h2>Feste Kanäle</h2>
      <div className="panel" style={{ marginBottom: 22 }}>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Diese Kanäle stehen immer im Comlink. Einheitskanäle entstehen automatisch aus
          den Jobs, eigene Kanäle legen Spieler im Spiel an. Bei <b>Nur Einheiten</b> die
          Einheiten oder Untereinheiten mit Komma trennen.
        </p>

        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ width: 70 }}>Farbe</th>
              <th style={{ width: 160 }}>Zugriff</th>
              <th>Einheiten</th>
              <th style={{ width: 170 }} />
            </tr>
          </thead>
          <tbody>
            {config.channels.map((channel, index) => (
              <tr key={channel.id ?? `neu-${index}`}>
                <td>
                  <input
                    value={channel.name}
                    disabled={!canEdit}
                    onChange={(event) => patchChannel(index, { name: event.target.value })}
                    style={inputStyle}
                  />
                </td>
                <td>
                  <input
                    type="color"
                    value={toHex(channel.color)}
                    disabled={!canEdit}
                    onChange={(event) => patchChannel(index, { color: fromHex(event.target.value) })}
                    style={{ width: 48, height: 34, border: "none", background: "none" }}
                  />
                </td>
                <td>
                  <select
                    value={channel.access}
                    disabled={!canEdit}
                    onChange={(event) =>
                      patchChannel(index, { access: event.target.value as Channel["access"] })
                    }
                    style={inputStyle}
                  >
                    {Object.entries(ACCESS_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={channel.units}
                    disabled={!canEdit || channel.access !== "units"}
                    list="funk-units"
                    placeholder={channel.access === "units" ? "z. B. 501st, Medic" : "-"}
                    onChange={(event) => patchChannel(index, { units: event.target.value })}
                    style={inputStyle}
                  />
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {canEdit && (
                    <>
                      <button
                        style={{ padding: "4px 8px", fontSize: 13 }}
                        onClick={() => moveChannel(index, -1)}
                        disabled={index === 0}
                      >
                        ↑
                      </button>{" "}
                      <button
                        style={{ padding: "4px 8px", fontSize: 13 }}
                        onClick={() => moveChannel(index, 1)}
                        disabled={index === config.channels.length - 1}
                      >
                        ↓
                      </button>{" "}
                      <button
                        style={{ padding: "4px 10px", fontSize: 13 }}
                        onClick={() => {
                          if (!confirm(`"${channel.name}" entfernen?`)) return;
                          setConfig({
                            ...config,
                            channels: config.channels.filter((_, i) => i !== index),
                          });
                        }}
                      >
                        Entfernen
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <datalist id="funk-units">
          {config.units.map((unit) => (
            <option key={unit} value={unit} />
          ))}
        </datalist>

        {config.units.length > 0 && (
          <p className="subtitle" style={{ marginBottom: 0 }}>
            Vorhandene Einheiten: <span className="mono">{config.units.join(", ")}</span>
          </p>
        )}

        {canEdit && (
          <button
            style={{ marginTop: 12 }}
            onClick={() =>
              setConfig({
                ...config,
                channels: [
                  ...config.channels,
                  { id: null, name: "Neuer Kanal", color: "255,255,255", access: "all", units: "" },
                ],
              })
            }
          >
            + Kanal
          </button>
        )}
      </div>

      <h2>Sprachreichweiten</h2>
      <div className="panel" style={{ marginBottom: 22 }}>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Die vier Stufen, durch die Spieler im Spiel schalten. Reichweite in
          Spieleinheiten (etwa 52 Einheiten = 1 Meter); Stufe 2 ist der Standard.
        </p>

        <table>
          <thead>
            <tr>
              <th style={{ width: 70 }}>Stufe</th>
              <th>Name</th>
              <th style={{ width: 160 }}>Reichweite</th>
              <th style={{ width: 110, textAlign: "right" }}>≈ Meter</th>
            </tr>
          </thead>
          <tbody>
            {config.ranges.map((range) => (
              <tr key={range.mode}>
                <td>{range.mode}</td>
                <td>
                  <input
                    value={range.name}
                    disabled={!canEdit}
                    onChange={(event) => patchRange(range.mode, { name: event.target.value })}
                    style={inputStyle}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={10}
                    max={5000}
                    value={range.range}
                    disabled={!canEdit}
                    onChange={(event) =>
                      patchRange(range.mode, { range: Number(event.target.value) || 10 })
                    }
                    style={inputStyle}
                  />
                </td>
                <td style={{ textAlign: "right" }}>{Math.round(range.range / 52.5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
