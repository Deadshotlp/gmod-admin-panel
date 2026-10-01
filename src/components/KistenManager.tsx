"use client";

import { useCallback, useEffect, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Notice, fetchWithTimeout, inputStyle, readJson } from "./ui";

interface Packable {
  model: string;
  name: string;
  packTime: number;
  crateModel: string;
}

export default function KistenManager({ user }: { user: PanelUser }) {
  const [packables, setPackables] = useState<Packable[] | null>(null);
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
      }>(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      setConfigured(data?.configured ?? true);
      setHint(data?.hint ?? null);
      if (data?.packables) setPackables(data.packables);
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
        body: JSON.stringify({ packables }),
      });

      const { data, error } = await readJson<{
        packables?: Packable[];
        reload?: { ok: boolean; message: string };
      }>(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      if (data?.packables) setPackables(data.packables);

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
