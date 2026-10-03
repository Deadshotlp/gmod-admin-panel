"use client";

import { useCallback, useEffect, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Notice, fetchWithTimeout, inputStyle, readJson } from "./ui";

interface Spawnable {
  model: string;
  name: string;
  limit: number;
}

interface Packable {
  model: string;
  name: string;
  packTime: number;
  crateModel: string;
}

export default function KistenManager({ user }: { user: PanelUser }) {
  const [packables, setPackables] = useState<Packable[] | null>(null);
  const [spawnables, setSpawnables] = useState<Spawnable[]>([]);
  const [configured, setConfigured] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const canEdit = user.role === "editor" || user.role === "admin";

  const load = useCallback(async () => {
    try {
      const response = await fetchWithTimeout("/api/kisten", { cache: "no-store" });
      const { data, error } = await readJson<{
        configured: boolean;
        hint?: string;
        packables?: Packable[];
        spawnables?: Spawnable[];
      }>(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      setConfigured(data?.configured ?? true);
      setHint(data?.hint ?? null);
      if (data?.packables) setPackables(data.packables);
      if (data?.spawnables) setSpawnables(data.spawnables);
    } catch {
      setMessage({ ok: false, text: "Liste konnte nicht geladen werden" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!packables) return;

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetchWithTimeout("/api/kisten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packables, spawnables }),
      });

      const { data, error } = await readJson<{
        packables?: Packable[];
        spawnables?: Spawnable[];
        reload?: { ok: boolean; message: string };
      }>(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      if (data?.packables) setPackables(data.packables);
      if (data?.spawnables) setSpawnables(data.spawnables);

      setMessage({
        ok: Boolean(data?.reload?.ok),
        text: data?.reload?.ok
          ? "Gespeichert, der Server lädt die Packliste neu."
          : `Gespeichert. Server nicht angestoßen: ${data?.reload?.message ?? "unbekannt"}`,
      });
    } catch {
      setMessage({ ok: false, text: "Anfrage fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  const patch = (index: number, changes: Partial<Packable>) =>
    setPackables((previous) =>
      previous
        ? previous.map((entry, i) => (i === index ? { ...entry, ...changes } : entry))
        : previous,
    );

  if (loading) return <p className="subtitle">Packliste wird geladen…</p>;

  if (!configured) return <div className="notice">{hint}</div>;
  if (!packables) return <div className="notice error">Keine Liste erhalten.</div>;

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}

      <div className="panel" style={{ marginBottom: 22 }}>
        <p className="subtitle" style={{ marginTop: 0 }}>
          <b>Modell</b> ist der Pfad des Objekts, z. B.{" "}
          <span className="mono">models/…/zelt.mdl</span> (im Spiel: Objekt ansehen,
          Q-Menü → Rechtsklick → Modellpfad kopieren). <b>Packzeit</b> gilt für Ein- und
          Auspacken, 0 = sofort. <b>Kistenmodell</b> ist optional; leer nimmt die
          Standardkiste. Fest gespeicherte Objekte (Perma-Props) lassen sich nie packen.
        </p>

        <table>
          <thead>
            <tr>
              <th>Modell</th>
              <th style={{ width: 200 }}>Anzeigename</th>
              <th style={{ width: 110 }}>Packzeit (s)</th>
              <th>Kistenmodell</th>
              <th style={{ width: 100 }} />
            </tr>
          </thead>
          <tbody>
            {packables.map((entry, index) => (
              <tr key={index}>
                <td>
                  <input
                    className="mono"
                    value={entry.model}
                    disabled={!canEdit}
                    placeholder="models/…/objekt.mdl"
                    onChange={(event) => patch(index, { model: event.target.value })}
                    style={inputStyle}
                  />
                </td>
                <td>
                  <input
                    value={entry.name}
                    disabled={!canEdit}
                    placeholder="z. B. Zelt"
                    onChange={(event) => patch(index, { name: event.target.value })}
                    style={inputStyle}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    step={0.5}
                    value={entry.packTime}
                    disabled={!canEdit}
                    onChange={(event) =>
                      patch(index, { packTime: Number(event.target.value) || 0 })
                    }
                    style={inputStyle}
                  />
                </td>
                <td>
                  <input
                    className="mono"
                    value={entry.crateModel}
                    disabled={!canEdit}
                    placeholder="Standardkiste"
                    onChange={(event) => patch(index, { crateModel: event.target.value })}
                    style={inputStyle}
                  />
                </td>
                <td>
                  {canEdit && (
                    <button
                      style={{ padding: "4px 10px", fontSize: 13 }}
                      onClick={() => {
                        if (!confirm(`"${entry.name || entry.model}" entfernen?`)) return;

                        setPackables(packables.filter((_, i) => i !== index));
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

        {packables.length === 0 && (
          <p className="subtitle">Noch nichts eingetragen.</p>
        )}

        {canEdit && (
          <button
            style={{ marginTop: 12 }}
            onClick={() =>
              setPackables([
                ...packables,
                { model: "", name: "", packTime: 5, crateModel: "" },
              ])
            }
          >
            + Objekt
          </button>
        )}
      </div>

      <h2>Kistenlager</h2>
      <div className="panel" style={{ marginBottom: 22 }}>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Was Spieler am Entity <span className="mono">Kistenlager</span> (Spawnmenü →
          PD - Gamemode) als fertig gepackte Kiste holen können, z. B. Barrikaden.{" "}
          <b>Limit</b> zählt gepackte und aufgebaute Objekte pro Spieler, 0 = unbegrenzt.
          Steht das Modell auch oben in der Packliste, gelten dort Name, Packzeit und
          Kistenmodell, und aufgebaute Objekte lassen sich wieder einpacken und am Lager
          zurückgeben.
        </p>

        <table>
          <thead>
            <tr>
              <th>Modell</th>
              <th style={{ width: 200 }}>Anzeigename</th>
              <th style={{ width: 110 }}>Limit</th>
              <th style={{ width: 100 }} />
            </tr>
          </thead>
          <tbody>
            {spawnables.map((entry, index) => {
              const packable = packables.some((item) => item.model === entry.model);

              return (
                <tr key={index}>
                  <td>
                    <input
                      className="mono"
                      list="kisten-packables"
                      value={entry.model}
                      disabled={!canEdit}
                      placeholder="models/…/barrikade.mdl"
                      onChange={(event) =>
                        setSpawnables(
                          spawnables.map((item, i) =>
                            i === index ? { ...item, model: event.target.value } : item,
                          ),
                        )
                      }
                      style={inputStyle}
                    />
                    {entry.model !== "" && !packable && (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                        Nicht in der Packliste - lässt sich aufbauen, aber nicht wieder einpacken.
                      </div>
                    )}
                  </td>
                  <td>
                    <input
                      value={entry.name}
                      disabled={!canEdit}
                      placeholder="aus der Packliste"
                      onChange={(event) =>
                        setSpawnables(
                          spawnables.map((item, i) =>
                            i === index ? { ...item, name: event.target.value } : item,
                          ),
                        )
                      }
                      style={inputStyle}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={entry.limit}
                      disabled={!canEdit}
                      onChange={(event) =>
                        setSpawnables(
                          spawnables.map((item, i) =>
                            i === index
                              ? { ...item, limit: Math.max(0, Math.round(Number(event.target.value) || 0)) }
                              : item,
                          ),
                        )
                      }
                      style={inputStyle}
                    />
                  </td>
                  <td>
                    {canEdit && (
                      <button
                        style={{ padding: "4px 10px", fontSize: 13 }}
                        onClick={() => setSpawnables(spawnables.filter((_, i) => i !== index))}
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

        <datalist id="kisten-packables">
          {packables.map((item) => (
            <option key={item.model} value={item.model}>
              {item.name}
            </option>
          ))}
        </datalist>

        {spawnables.length === 0 && <p className="subtitle">Das Lager ist leer.</p>}

        {canEdit && (
          <button
            style={{ marginTop: 12 }}
            onClick={() => setSpawnables([...spawnables, { model: "", name: "", limit: 3 }])}
          >
            + Lager-Eintrag
          </button>
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
