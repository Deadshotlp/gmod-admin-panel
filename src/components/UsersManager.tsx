"use client";

import { useCallback, useEffect, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Field, Notice, fetchWithTimeout, inputStyle, readJson } from "./ui";

interface Entry {
  steamId: string;
  displayName: string;
  role: "viewer" | "editor" | "admin";
}

const ROLE_LABEL: Record<string, string> = {
  viewer: "Leser",
  editor: "Bearbeiter",
  admin: "Administrator",
};

const ROLE_HINT: Record<string, string> = {
  viewer: "darf alles ansehen",
  editor: "darf Konfiguration ändern und neu laden lassen",
  admin: "zusätzlich Servereingriffe und Benutzerverwaltung",
};

export default function UsersManager({ me }: { me: PanelUser }) {
  const [users, setUsers] = useState<Entry[]>([]);
  const [bootstrap, setBootstrap] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [steamId, setSteamId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Entry["role"]>("viewer");

  const load = useCallback(async () => {
    try {
      const response = await fetchWithTimeout("/api/users", { cache: "no-store" });
      const { data, error } = await readJson<{ users: Entry[]; bootstrap: string[] }>(
        response,
      );

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      setUsers(data?.users ?? []);
      setBootstrap(data?.bootstrap ?? []);
    } catch {
      setMessage({ ok: false, text: "Benutzer konnten nicht geladen werden" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetchWithTimeout("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const { data, error } = await readJson<{ users: Entry[]; bootstrap: string[] }>(
        response,
      );

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      setUsers(data?.users ?? []);
      setBootstrap(data?.bootstrap ?? []);
      setMessage({ ok: true, text: "Gespeichert." });
      setSteamId("");
      setDisplayName("");
    } catch {
      setMessage({ ok: false, text: "Anfrage fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="subtitle">Benutzer werden geladen…</p>;

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}

      {bootstrap.length > 0 && (
        <div className="notice">
          <strong>Notzugang über die Umgebungsvariable:</strong>{" "}
          <span className="mono">{bootstrap.join(", ")}</span>
          <div style={{ marginTop: 4 }}>
            Diese Accounts sind immer Administrator, unabhängig von der Liste unten.
            Sie lassen sich hier nicht entfernen — dafür die{" "}
            <span className="mono">PANEL_BOOTSTRAP_STEAM_IDS</span> in der{" "}
            <span className="mono">.env</span> anpassen.
          </div>
        </div>
      )}

      <h2>Zugang vergeben</h2>
      <div className="panel" style={{ marginBottom: 24 }}>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Wer sich mit Steam anmeldet, bekommt <strong>keinen</strong> Zugang, solange er
          hier nicht eingetragen ist.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
          <Field label="SteamID64">
            <input
              value={steamId}
              onChange={(event) => setSteamId(event.target.value.trim())}
              placeholder="76561198…"
              style={inputStyle}
            />
          </Field>

          <Field label="Anzeigename">
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              style={inputStyle}
            />
          </Field>

          <Field label="Rolle" hint={ROLE_HINT[role]}>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as Entry["role"])}
              style={inputStyle}
            >
              <option value="viewer">Leser</option>
              <option value="editor">Bearbeiter</option>
              <option value="admin">Administrator</option>
            </select>
          </Field>

          <div style={{ marginBottom: 12 }}>
            <button
              className="primary"
              disabled={busy || !/^\d{17}$/.test(steamId) || displayName.trim() === ""}
              onClick={() =>
                void send({ action: "save", steamId, displayName, role })
              }
            >
              Eintragen
            </button>
          </div>
        </div>
      </div>

      <h2>Eingetragene Benutzer</h2>
      <div className="panel">
        {users.length === 0 ? (
          <p className="subtitle" style={{ margin: 0 }}>
            Noch niemand eingetragen. Aktuell kommt nur der Notzugang hinein.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>SteamID64</th>
                <th>Rolle</th>
                <th style={{ textAlign: "right" }}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {users.map((entry) => (
                <tr key={entry.steamId}>
                  <td style={{ color: "var(--text)" }}>
                    {entry.displayName}
                    {entry.steamId === me.steamId && (
                      <span style={{ color: "var(--text-muted)", fontSize: 12 }}> (du)</span>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {entry.steamId}
                  </td>
                  <td>
                    <select
                      value={entry.role}
                      disabled={busy}
                      onChange={(event) =>
                        void send({
                          action: "save",
                          steamId: entry.steamId,
                          displayName: entry.displayName,
                          role: event.target.value,
                        })
                      }
                      style={{ ...inputStyle, width: "auto", padding: "4px 8px" }}
                    >
                      <option value="viewer">Leser</option>
                      <option value="editor">Bearbeiter</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (!confirm(`Zugang für ${entry.displayName} entfernen?`)) return;
                        void send({ action: "remove", steamId: entry.steamId });
                      }}
                      style={{ padding: "4px 10px", fontSize: 13 }}
                    >
                      Entfernen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="subtitle" style={{ marginBottom: 0, marginTop: 14 }}>
          Rollen: {Object.entries(ROLE_LABEL).map(([key, label]) => `${label} — ${ROLE_HINT[key]}`).join(" · ")}
        </p>
      </div>
    </>
  );
}
