"use client";

import { useCallback, useEffect, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Notice, fetchWithTimeout, inputStyle, readJson } from "./ui";

interface Vehicle {
  class: string;
  name: string;
  cargoSlots: number;
  bones: string;
}

interface Config {
  vehicles: Vehicle[];
  cargo: string[];
}

const chipStyle = {
  padding: "5px 10px",
  background: "var(--bg-panel-light)",
  border: "1px solid var(--border)",
  borderRadius: 3,
  fontSize: 13,
} as const;

export default function FahrzeugeManager({ user }: { user: PanelUser }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [configured, setConfigured] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [newCargo, setNewCargo] = useState("");

  const canEdit = user.role === "editor" || user.role === "admin";

  const load = useCallback(async () => {
    try {
      const response = await fetchWithTimeout("/api/fahrzeuge", { cache: "no-store" });
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
      const response = await fetchWithTimeout("/api/fahrzeuge", {
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
          ? "Gespeichert, der Server lädt das Fahrzeuginventar neu."
          : `Gespeichert. Server nicht angestoßen: ${data?.reload?.message ?? "unbekannt"}`,
      });
    } catch {
      setMessage({ ok: false, text: "Anfrage fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  const patchVehicle = (index: number, changes: Partial<Vehicle>) =>
    setConfig((previous) =>
      previous
        ? {
            ...previous,
            vehicles: previous.vehicles.map((vehicle, i) =>
              i === index ? { ...vehicle, ...changes } : vehicle,
            ),
          }
        : previous,
    );

  const moveVehicle = (index: number, direction: -1 | 1) =>
    setConfig((previous) => {
      if (!previous) return previous;

      const target = index + direction;
      if (target < 0 || target >= previous.vehicles.length) return previous;

      const vehicles = [...previous.vehicles];
      [vehicles[index], vehicles[target]] = [vehicles[target], vehicles[index]];

      return { ...previous, vehicles };
    });

  if (loading) return <p className="subtitle">Fahrzeuginventar wird geladen…</p>;

  if (!configured) return <div className="notice">{hint}</div>;
  if (!config) return <div className="notice error">Keine Konfiguration erhalten.</div>;

  const addCargo = () => {
    const value = newCargo.trim();
    if (value === "" || config.cargo.includes(value)) return;

    setConfig({ ...config, cargo: [...config.cargo, value].sort() });
    setNewCargo("");
  };

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}

      <h2>Fahrzeuge</h2>
      <div className="panel" style={{ marginBottom: 22 }}>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Nur eingetragene Fahrzeuge haben ein Inventar. <b>Klasse</b> ist die
          Entity-Klasse (z. B. <span className="mono">lvs_sw_transport</span>).{" "}
          <b>Bones</b> sind die Stellen am Modell, an denen im Interaktionsmenü
          &quot;Öffne Fahrzeug Inventar&quot; erscheint - mehrere mit Komma trennen.
          Die Bones eines Fahrzeugs listet im Spiel der Konsolenbefehl{" "}
          <span className="mono">List_bones</span>, während man das Fahrzeug ansieht.
        </p>

        <table>
          <thead>
            <tr>
              <th>Klasse</th>
              <th>Anzeigename</th>
              <th style={{ width: 100 }}>Slots</th>
              <th>Bones</th>
              <th style={{ width: 170 }} />
            </tr>
          </thead>
          <tbody>
            {config.vehicles.map((vehicle, index) => (
              <tr key={index}>
                <td>
                  <input
                    className="mono"
                    value={vehicle.class}
                    disabled={!canEdit}
                    onChange={(event) => patchVehicle(index, { class: event.target.value })}
                    style={inputStyle}
                  />
                </td>
                <td>
                  <input
                    value={vehicle.name}
                    disabled={!canEdit}
                    placeholder={vehicle.class}
                    onChange={(event) => patchVehicle(index, { name: event.target.value })}
                    style={inputStyle}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={vehicle.cargoSlots}
                    disabled={!canEdit}
                    onChange={(event) =>
                      patchVehicle(index, { cargoSlots: Number(event.target.value) || 1 })
                    }
                    style={inputStyle}
                  />
                </td>
                <td>
                  <input
                    className="mono"
                    value={vehicle.bones}
                    disabled={!canEdit}
                    placeholder="z. B. root"
                    onChange={(event) => patchVehicle(index, { bones: event.target.value })}
                    style={inputStyle}
                  />
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {canEdit && (
                    <>
                      <button
                        style={{ padding: "4px 8px", fontSize: 13 }}
                        onClick={() => moveVehicle(index, -1)}
                        disabled={index === 0}
                        title="Nach oben"
                      >
                        ↑
                      </button>{" "}
                      <button
                        style={{ padding: "4px 8px", fontSize: 13 }}
                        onClick={() => moveVehicle(index, 1)}
                        disabled={index === config.vehicles.length - 1}
                        title="Nach unten"
                      >
                        ↓
                      </button>{" "}
                      <button
                        style={{ padding: "4px 10px", fontSize: 13 }}
                        onClick={() => {
                          if (!confirm(`"${vehicle.name || vehicle.class}" entfernen?`)) return;

                          setConfig({
                            ...config,
                            vehicles: config.vehicles.filter((_, i) => i !== index),
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

        {canEdit && (
          <button
            style={{ marginTop: 12 }}
            onClick={() =>
              setConfig({
                ...config,
                vehicles: [
                  ...config.vehicles,
                  { class: "", name: "", cargoSlots: 4, bones: "root" },
                ],
              })
            }
          >
            + Fahrzeug
          </button>
        )}
      </div>

      <h2>Erlaubte Fracht</h2>
      <div className="panel" style={{ marginBottom: 22 }}>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Entity-Klassen, die sich in Fahrzeuge einladen lassen. Leichen gehen immer.
          Eingefrorene Objekte lassen sich nicht einladen.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {config.cargo.map((entry) => (
            <span key={entry} className="mono" style={chipStyle}>
              {entry}
              {canEdit && (
                <span
                  onClick={() =>
                    setConfig({ ...config, cargo: config.cargo.filter((item) => item !== entry) })
                  }
                  style={{ marginLeft: 8, cursor: "pointer", color: "var(--red)" }}
                >
                  ×
                </span>
              )}
            </span>
          ))}
        </div>

        {canEdit && (
          <div style={{ display: "flex", gap: 8, marginTop: 12, maxWidth: 420 }}>
            <input
              className="mono"
              value={newCargo}
              placeholder="Klasse, z. B. prop_physics"
              onChange={(event) => setNewCargo(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addCargo();
              }}
              style={inputStyle}
            />
            <button onClick={addCargo}>Hinzufügen</button>
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
