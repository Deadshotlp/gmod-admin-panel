"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Notice, dateFormat, fetchWithTimeout, inputStyle, readJson } from "./ui";

interface BackupInfo {
  file: string;
  scope: string;
  serverId: string;
  createdAt: number;
  reason: string;
  rows: number;
  sizeBytes: number;
}

interface UnknownEntry {
  type: string;
  value: string;
  places: string[];
}

interface CheckResult {
  available: boolean;
  hint?: string;
  updatedAt?: number;
  checked?: number;
  installed?: { weapons: number; models: number };
  unknown?: UnknownEntry[];
}

const SCOPE_LABEL: Record<string, string> = {
  jobs: "Jobs & Einheiten",
  fortbildung: "Fortbildungen",
  waffen: "Waffen & Gewichte",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function WerkzeugeManager({ user }: { user: PanelUser }) {
  const isAdmin = user.role === "admin";

  const [check, setCheck] = useState<CheckResult | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Konsole
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const [consoleState, setConsoleState] = useState<"aus" | "verbinde" | "an" | "fehler">("aus");
  const socketRef = useRef<WebSocket | null>(null);
  const consoleEndRef = useRef<HTMLDivElement | null>(null);

  const loadCheck = useCallback(async () => {
    try {
      const response = await fetchWithTimeout("/api/pruefung", { cache: "no-store" });
      const { data, error } = await readJson<CheckResult>(response);

      if (error) setMessage({ ok: false, text: error });
      else setCheck(data);
    } catch {
      setMessage({ ok: false, text: "Prüfung konnte nicht geladen werden" });
    }
  }, []);

  const loadBackups = useCallback(async () => {
    try {
      const response = await fetchWithTimeout("/api/backups", { cache: "no-store" });
      const { data } = await readJson<{ backups: BackupInfo[] }>(response);

      setBackups(data?.backups ?? []);
    } catch {
      // Sicherungen sind Beiwerk auf dieser Seite
    }
  }, []);

  useEffect(() => {
    void loadCheck();
    void loadBackups();
  }, [loadCheck, loadBackups]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consoleLines]);

  // Verbindung beim Verlassen der Seite schließen
  useEffect(() => {
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  const sendBackup = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetchWithTimeout("/api/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const { data, error } = await readJson<{
        ok: boolean;
        message?: string;
        backups: BackupInfo[];
      }>(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      setBackups(data?.backups ?? []);
      setMessage({
        ok: data?.ok ?? true,
        text: data?.message ?? "Sicherung angelegt.",
      });
    } catch {
      setMessage({ ok: false, text: "Anfrage fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  const connectConsole = async () => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
      setConsoleState("aus");
      return;
    }

    setConsoleState("verbinde");
    setConsoleLines([]);

    try {
      const response = await fetchWithTimeout("/api/server/console", { cache: "no-store" });
      const { data, error } = await readJson<{ socket: string; token: string }>(response);

      if (error || !data) {
        setConsoleState("fehler");
        setMessage({ ok: false, text: error ?? "Keine Konsolenverbindung möglich" });
        return;
      }

      const socket = new WebSocket(data.socket);
      socketRef.current = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({ event: "auth", args: [data.token] }));
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as {
            event: string;
            args?: string[];
          };

          if (payload.event === "auth success") {
            setConsoleState("an");
            // Bisherige Ausgabe nachreichen, sonst startet man im Leeren
            socket.send(JSON.stringify({ event: "send logs", args: [null] }));
            return;
          }

          if (payload.event === "console output" && payload.args) {
            setConsoleLines((previous) => {
              // Nach oben begrenzen, sonst wächst die Seite endlos
              const next = [...previous, ...payload.args!];
              return next.slice(-500);
            });
          }

          if (payload.event === "token expiring" || payload.event === "token expired") {
            // Token läuft nach 10 Minuten ab - neues holen und weitermachen
            void fetchWithTimeout("/api/server/console", { cache: "no-store" })
              .then((res) => readJson<{ token: string }>(res))
              .then(({ data: fresh }) => {
                if (fresh?.token) {
                  socket.send(JSON.stringify({ event: "auth", args: [fresh.token] }));
                }
              })
              .catch(() => undefined);
          }
        } catch {
          // Unverständliche Nachricht überspringen
        }
      };

      socket.onerror = () => setConsoleState("fehler");

      socket.onclose = () => {
        socketRef.current = null;
        setConsoleState((previous) => (previous === "an" ? "aus" : previous));
      };
    } catch {
      setConsoleState("fehler");
    }
  };

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}

      <h2>Ausrüstungs-Prüfung</h2>
      <div className="panel" style={{ marginBottom: 24 }}>
        {!check ? (
          <p className="subtitle" style={{ margin: 0 }}>
            Wird geladen…
          </p>
        ) : !check.available ? (
          <p className="subtitle" style={{ margin: 0 }}>
            {check.hint}
          </p>
        ) : (
          <>
            <p className="subtitle" style={{ marginTop: 0 }}>
              {check.checked} Einträge geprüft gegen {check.installed?.weapons} installierte
              Waffen und {check.installed?.models} Models. Bestand vom{" "}
              {dateFormat(check.updatedAt ?? 0)}.
            </p>

            {(check.unknown?.length ?? 0) === 0 ? (
              <div className="notice ok" style={{ marginBottom: 0 }}>
                Alle Einträge verweisen auf vorhandene Waffen und Models.
              </div>
            ) : (
              <>
                <div className="notice" style={{ marginBottom: 14 }}>
                  <strong>{check.unknown?.length} Einträge zeigen ins Leere.</strong> Diese
                  Klassen sind auf dem Server nicht installiert — im Spiel bekommt der
                  Spieler dort nichts.
                </div>

                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>Art</th>
                      <th>Wert</th>
                      <th>Verwendet in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.unknown?.map((entry) => (
                      <tr key={`${entry.type}:${entry.value}`}>
                        <td>{entry.type === "weapon" ? "Waffe" : "Model"}</td>
                        <td className="mono" style={{ fontSize: 13, color: "var(--text)" }}>
                          {entry.value}
                        </td>
                        <td style={{ fontSize: 13 }}>{entry.places.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <button style={{ marginTop: 14 }} onClick={() => void loadCheck()}>
              Erneut prüfen
            </button>
          </>
        )}
      </div>

      <h2>Sicherungen</h2>
      <div className="panel" style={{ marginBottom: 24 }}>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Vor Import, Rücknahme und Zurückspielen wird automatisch gesichert. Hier
          lassen sich zusätzlich welche von Hand anlegen.
        </p>

        {isAdmin && (
          <div className="button-row" style={{ marginBottom: 16 }}>
            {Object.entries(SCOPE_LABEL).map(([scope, label]) => (
              <button
                key={scope}
                disabled={busy}
                onClick={() => void sendBackup({ action: "create", scope })}
              >
                {label} sichern
              </button>
            ))}
          </div>
        )}

        {backups.length === 0 ? (
          <p className="subtitle" style={{ margin: 0 }}>
            Noch keine Sicherungen vorhanden.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Zeitpunkt</th>
                <th>Bereich</th>
                <th>Server</th>
                <th style={{ textAlign: "right" }}>Zeilen</th>
                <th>Anlass</th>
                <th style={{ textAlign: "right" }}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
                <tr key={backup.file}>
                  <td style={{ whiteSpace: "nowrap" }}>{dateFormat(backup.createdAt)}</td>
                  <td>{SCOPE_LABEL[backup.scope] ?? backup.scope}</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {backup.serverId}
                  </td>
                  <td style={{ textAlign: "right" }}>{backup.rows}</td>
                  <td style={{ fontSize: 12 }}>{backup.reason}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <a
                      href={`/api/backups?datei=${encodeURIComponent(backup.file)}`}
                      style={{ marginRight: 10, fontSize: 13 }}
                    >
                      Laden
                    </a>
                    {isAdmin && (
                      <button
                        disabled={busy}
                        style={{ padding: "3px 9px", fontSize: 12 }}
                        onClick={() => {
                          if (
                            !confirm(
                              `Sicherung vom ${dateFormat(backup.createdAt)} zurückspielen?\n\n` +
                                `Der aktuelle Stand von "${SCOPE_LABEL[backup.scope] ?? backup.scope}" wird ersetzt. ` +
                                "Vorher wird er automatisch gesichert.",
                            )
                          )
                            return;

                          void sendBackup({ action: "restore", file: backup.file });
                        }}
                      >
                        Zurückspielen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="subtitle" style={{ marginBottom: 0, marginTop: 14 }}>
          Die Dateien liegen im Ordner <span className="mono">backups/</span> neben der
          Anwendung. Bei einem Neuaufbau des Containers sind sie weg — wichtige
          Sicherungen also herunterladen.
        </p>
      </div>

      {isAdmin && (
        <>
          <h2>Serverkonsole</h2>
          <div className="panel">
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <button onClick={() => void connectConsole()}>
                {socketRef.current ? "Trennen" : "Verbinden"}
              </button>

              <span className="subtitle" style={{ margin: 0 }}>
                {consoleState === "an"
                  ? "verbunden"
                  : consoleState === "verbinde"
                    ? "verbinde…"
                    : consoleState === "fehler"
                      ? "Verbindung fehlgeschlagen"
                      : "nicht verbunden"}
              </span>
            </div>

            <div
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: 12,
                height: 340,
                overflowY: "auto",
                fontFamily: "Consolas, monospace",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {consoleLines.length === 0 ? (
                <span style={{ color: "var(--text-muted)" }}>
                  Noch keine Ausgabe. Über „Verbinden" wird die laufende Konsole
                  mitgelesen.
                </span>
              ) : (
                consoleLines.map((line, index) => (
                  <div key={index} style={{ color: "var(--text-dim)" }}>
                    {line}
                  </div>
                ))
              )}
              <div ref={consoleEndRef} />
            </div>

            <p className="subtitle" style={{ marginBottom: 0, marginTop: 10 }}>
              Nur Mitlesen. Befehle laufen weiterhin über die Übersichtsseite, damit
              jede Aktion im Protokoll landet.
            </p>
          </div>
        </>
      )}
    </>
  );
}
