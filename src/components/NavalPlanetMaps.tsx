"use client";

import { useCallback, useEffect, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Field, Notice, fetchWithTimeout, inputStyle, readJson } from "./ui";

interface Entry {
  id: number;
  bodyId: string;
  bodyName: string;
  bodyType: string;
  systemName: string;
  map: string;
  name: string;
  description: string;
}

interface BodyHit {
  id: string;
  name: string;
  type: string;
  system_name: string;
}

const TYPE: Record<string, string> = { planet: "Planet", moon: "Mond", station: "Station" };

/** Maps je Planet/Mond/Station für das Umstationieren (Stufe 4f). */
export default function NavalPlanetMaps({ user }: { user: PanelUser }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<BodyHit[]>([]);
  const [body, setBody] = useState<BodyHit | null>(null);
  const [form, setForm] = useState({ map: "", name: "", description: "" });
  const [editId, setEditId] = useState<number | null>(null);
  const canEdit = user.role === "editor" || user.role === "admin";

  const load = useCallback(async () => {
    const response = await fetchWithTimeout("/api/naval/planetmaps", { cache: "no-store" });
    const { data, error } = await readJson<{ configured: boolean; hint?: string; entries: Entry[] }>(response);
    if (error || !data) {
      setMessage({ ok: false, text: error ?? "Fehler" });
      return;
    }
    setHint(data.configured ? null : data.hint ?? null);
    setEntries(data.entries ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (search.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      const response = await fetchWithTimeout(`/api/naval/scenarios?lookup=${encodeURIComponent(search)}`, { cache: "no-store" });
      const { data } = await readJson<{ bodies: BodyHit[] }>(response);
      setHits(data?.bodies ?? []);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const post = async (payload: unknown, okText: string) => {
    setBusy(true);
    try {
      const response = await fetchWithTimeout("/api/naval/planetmaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const { data, error } = await readJson<{ ok: boolean; reload?: { ok: boolean; message: string } }>(response);
      if (error) setMessage({ ok: false, text: error });
      else if (data?.reload && !data.reload.ok) setMessage({ ok: false, text: `${okText}, aber der Server hat nicht neu geladen: ${data.reload.message}` });
      else setMessage({ ok: true, text: okText });
      await load();
      return !error;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (editId) {
      if (await post({ op: "update", id: editId, ...form }, "Gespeichert")) {
        setEditId(null);
        setForm({ map: "", name: "", description: "" });
      }
    } else if (body) {
      if (await post({ op: "add", bodyId: body.id, ...form }, `${form.name || form.map} bei ${body.name} eingetragen`)) {
        setForm({ map: "", name: "", description: "" });
      }
    }
  };

  if (hint) return <Notice ok={false}>{hint}</Notice>;

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}
      <p className="subtitle" style={{ marginTop: 0 }}>
        Maps, auf die das Schiff umstationieren kann. Steht das Map-Schiff im Orbit des Körpers, zeigt die Konsole „Umstationierung" die
        Maps zur Auswahl. Nach der Freigabe fliegt ein Fahrzeug mit Spielern an den Rand der Map auf der Seite des Planeten, dann wechselt
        der Server die Map (alle gehen mit). Auf der Planeten-Map braucht es ebenfalls eine Konsole „Umstationierung" für den Rückflug.
        Die Map muss auf dem Gameserver installiert sein.
      </p>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div className="panel" style={{ flex: 1.4, minWidth: 420 }}>
          <table>
            <thead>
              <tr>
                <th>Körper</th>
                <th>Map</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} style={{ background: editId === e.id ? "var(--bg-panel-light)" : undefined }}>
                  <td>
                    <strong>{e.bodyName}</strong> <span className="subtitle">{TYPE[e.bodyType] ?? e.bodyType} · {e.systemName}</span>
                  </td>
                  <td>
                    {e.name || e.map}
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {e.map}
                      {e.description ? ` · ${e.description}` : ""}
                    </div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {canEdit && (
                      <>
                        <button
                          onClick={() => {
                            setEditId(e.id);
                            setBody(null);
                            setForm({ map: e.map, name: e.name, description: e.description });
                          }}
                        >
                          Bearbeiten
                        </button>{" "}
                        <button disabled={busy} onClick={() => confirm(`${e.name || e.map} entfernen?`) && void post({ op: "delete", id: e.id }, "Entfernt")}>
                          ✕
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && <p className="subtitle">Noch keine Planeten-Maps.</p>}
        </div>

        {canEdit && (
          <div className="panel" style={{ flex: 1, minWidth: 360 }}>
            <h3 style={{ marginTop: 0 }}>{editId ? "Eintrag bearbeiten" : "Map hinzufügen"}</h3>
            {!editId && (
              <Field label="Planet, Mond oder Station">
                {body ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <strong>{body.name}</strong>
                    <span className="subtitle">
                      {TYPE[body.type] ?? body.type} · {body.system_name}
                    </span>
                    <button onClick={() => setBody(null)}>ändern</button>
                  </div>
                ) : (
                  <>
                    <input placeholder="Suchen (ab 2 Zeichen)" value={search} onChange={(event) => setSearch(event.target.value)} style={inputStyle} />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {hits.map((h) => (
                        <button
                          key={h.id}
                          onClick={() => {
                            setBody(h);
                            setSearch("");
                          }}
                        >
                          {h.name} ({h.system_name})
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </Field>
            )}
            <Field label="Map (Dateiname ohne .bsp)" hint="z. B. rp_tatooine_dunesea">
              <input value={form.map} onChange={(event) => setForm({ ...form, map: event.target.value.trim() })} style={inputStyle} />
            </Field>
            <Field label="Anzeigename" hint="z. B. Mos Eisley">
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} style={inputStyle} maxLength={128} />
            </Field>
            <Field label="Beschreibung">
              <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} style={inputStyle} maxLength={255} />
            </Field>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="primary" disabled={busy || !form.map || (!editId && !body)} onClick={() => void submit()}>
                {editId ? "Speichern" : "Hinzufügen"}
              </button>
              {editId && (
                <button
                  onClick={() => {
                    setEditId(null);
                    setForm({ map: "", name: "", description: "" });
                  }}
                >
                  Abbrechen
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
