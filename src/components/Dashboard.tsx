"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { ACTION_LABEL } from "./AuditList";
import Icon from "./Icon";
import LiveActions from "./LiveActions";
import { dateFormat, fetchWithTimeout, readJson } from "./ui";

interface ServerStatus {
  online: boolean;
  lastSeen: number | null;
  secondsSinceHeartbeat: number | null;
  map: string;
  gamemode: string;
  playerCount: number;
  maxPlayers: number;
  defcon: number;
  defconText: string;
  uptimeSeconds: number;
}

interface OnlinePlayer {
  steamId: string;
  charId: string;
  name: string;
  jobKey: string;
  unitKey: string;
  ping: number;
}

interface StatusResponse {
  configured?: boolean;
  hint?: string;
  status?: ServerStatus;
  players?: OnlinePlayer[];
  pterodactyl?: { configured: boolean; missing?: string[] };
  error?: string;
  detail?: string;
}

interface AuditHead {
  id: number;
  displayName: string;
  action: string;
  targetKey: string;
  note: string;
  createdAt: number;
}

const RELOAD_AREAS: Array<{ key: string; label: string }> = [
  { key: "jobs", label: "Jobs & Einheiten" },
  { key: "fortbildung", label: "Fortbildungen" },
  { key: "waffen", label: "Waffen & Gewichte" },
  { key: "fraktionen", label: "Fraktionsbaum" },
  { key: "armor", label: "Rüstungen" },
  { key: "spawns", label: "Spawnpunkte" },
  { key: "chars", label: "Charaktere" },
  { key: "fahrzeuge", label: "Fahrzeuginventar" },
  { key: "kisten", label: "Transportkisten" },
  { key: "funk", label: "Funk & Sprachreichweiten" },
  { key: "charakter", label: "Charakter-Einstellungen" },
  { key: "naval", label: "Raumflotte" },
  { key: "naval_galaxy", label: "Raumflotte: Galaxie" },
];

/** Spalten der Spielerliste (CSS-Grid). */
const PLAYER_COLS = "minmax(0, 1.7fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 84px";

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "-";

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;

  return `${seconds} s`;
}

function since(seconds: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - seconds));

  if (diff < 60) return "gerade eben";
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} min`;
  if (diff < 86_400) return `vor ${Math.floor(diff / 3600)} h`;

  return dateFormat(seconds);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/** Grün unter 80 ms, gelb bis 130 ms, darüber rot. */
function pingTone(ping: number): "ok" | "warn" | "bad" {
  if (ping < 80) return "ok";
  if (ping <= 130) return "warn";
  return "bad";
}

function RecentChanges({ version }: { version: number }) {
  const [entries, setEntries] = useState<AuditHead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const response = await fetchWithTimeout("/api/audit?limit=5", { cache: "no-store" });
        const { data, error: failure } = await readJson<{ entries: AuditHead[] }>(response);

        if (!alive) return;
        if (failure) setError(failure);
        else setEntries(data?.entries ?? []);
      } catch {
        if (alive) setError("Protokoll konnte nicht geladen werden");
      }
    })();

    return () => {
      alive = false;
    };
  }, [version]);

  return (
    <section className="section-card" aria-labelledby="dash-audit">
      <div className="section-head">
        <h2 id="dash-audit">Letzte Änderungen</h2>
        <Link href="/audit" className="push with-icon" style={{ fontSize: 13, fontWeight: 500 }}>
          Alle anzeigen
          <Icon name="arrowRight" size={14} />
        </Link>
      </div>

      {error ? (
        <div className="data-empty">{error}</div>
      ) : entries === null ? (
        <div className="data-empty">Wird geladen …</div>
      ) : entries.length === 0 ? (
        <div className="data-empty">Noch keine Änderungen.</div>
      ) : (
        entries.map((entry) => (
          <div key={entry.id} className="feed-row">
            <span className="feed-icon" aria-hidden="true">
              <Icon name="history" size={15} />
            </span>
            <div className="feed-main">
              <div className="feed-title">
                <strong>{entry.displayName || "Unbekannt"}</strong> ·{" "}
                {ACTION_LABEL[entry.action] ?? entry.action}
                {entry.targetKey && (
                  <>
                    {" "}
                    <span className="mono">{entry.targetKey}</span>
                  </>
                )}
              </div>
              <div className="feed-meta">
                {since(entry.createdAt)}
                {entry.note && ` · ${entry.note}`}
              </div>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

export default function Dashboard({ user }: { user: PanelUser }) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [lastReload, setLastReload] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [auditVersion, setAuditVersion] = useState(0);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    // Harte Zeitbegrenzung: ohne sie bleibt die Anzeige bei einer hängenden
    // Verbindung für immer im Ladezustand, ohne dass irgendwo etwas auftaucht.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch("/api/status", {
        cache: "no-store",
        signal: controller.signal,
      });

      const text = await response.text();

      // Bei einem Serverfehler liefert Next eine HTML-Seite statt JSON. Die
      // Rohantwort anzeigen ist hier hilfreicher als ein Parse-Fehler.
      let parsed: StatusResponse;

      try {
        parsed = JSON.parse(text) as StatusResponse;
      } catch {
        setData({
          error: `Unerwartete Antwort (HTTP ${response.status})`,
          detail: text.slice(0, 300),
        });
        return;
      }

      if (!response.ok && !parsed.error) {
        parsed.error = `Serverfehler (HTTP ${response.status})`;
      }

      setData(parsed);
    } catch (error) {
      const aborted = (error as Error).name === "AbortError";

      setData({
        error: aborted
          ? "Zeitüberschreitung: der Server hat 20 Sekunden nicht geantwortet"
          : "Das Panel konnte den Status nicht abrufen",
        detail: aborted
          ? "Meist hängt die Verbindung zur Datenbank. /api/health zeigt, welcher Schritt klemmt."
          : (error as Error).message,
      });
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    // Der Server schreibt alle 15 s einen Heartbeat, häufiger nachfragen bringt
    // nichts.
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const afterAction = useCallback(() => {
    // Dem Server einen Moment geben, dann den frischen Stand holen.
    setTimeout(() => void load(), 2000);
    setAuditVersion((value) => value + 1);
  }, [load]);

  const sendCommand = useCallback(
    async (body: Record<string, unknown>, label: string, areaKey?: string, areaLabel?: string) => {
      setBusy(label);
      setMessage(null);

      try {
        const response = await fetch("/api/server/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const result = (await response.json()) as {
          ok?: boolean;
          message?: string;
          error?: string;
        };

        setMessage({
          ok: Boolean(result.ok),
          text: result.message ?? result.error ?? "Unbekannte Antwort",
        });

        if (result.ok) {
          if (areaKey) {
            setDone((map) => ({ ...map, [areaKey]: true }));
            setLastReload(areaLabel ?? areaKey);
          }

          afterAction();
        }
      } catch {
        setMessage({ ok: false, text: "Anfrage fehlgeschlagen" });
      } finally {
        setBusy(null);
      }
    },
    [afterAction],
  );

  const players = useMemo(() => data?.players ?? [], [data]);

  const shownPlayers = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return players;

    return players.filter((player) =>
      `${player.name} ${player.charId} ${player.jobKey} ${player.unitKey}`
        .toLowerCase()
        .includes(needle),
    );
  }, [players, filter]);

  const status = data?.status;
  const canAct = user.role === "editor" || user.role === "admin";

  const header = (
    <div className="page-head">
      <div>
        <h1>Übersicht</h1>
        <p className="subtitle">Live-Status des Servers und Nachladen der Konfiguration.</p>
      </div>
      {canAct && (
        <div className="button-row">
          <button
            type="button"
            className="with-icon"
            disabled={busy !== null}
            onClick={() => void sendCommand({ action: "status" }, "status")}
          >
            <Icon name="activity" size={16} />
            {busy === "status" ? "Wird abgefragt …" : "Status abfragen"}
          </button>
          <button
            type="button"
            className="primary with-icon"
            disabled={busy !== null}
            onClick={() =>
              void sendCommand({ action: "reload", area: "all" }, "reload-all", "all", "Alles")
            }
          >
            <Icon
              name={busy === "reload-all" ? "spinner" : "refresh"}
              size={16}
              className={busy === "reload-all" ? "spin" : undefined}
            />
            Alles neu laden
          </button>
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <>
        {header}
        <p className="subtitle">Status wird geladen …</p>
      </>
    );
  }

  if (data?.error) {
    return (
      <>
        {header}
        <div className="notice error">
          <strong>{data.error}</strong>
          {data.detail && <div className="mono">{data.detail}</div>}
        </div>
      </>
    );
  }

  const defcon = status?.defcon;
  const defconTone =
    defcon === undefined ? "ok" : defcon <= 1 ? "bad" : defcon <= 3 ? "warn" : "ok";
  const defconFilled =
    defcon === undefined ? 0 : Math.min(5, Math.max(1, 6 - defcon));
  const playerShare =
    status && status.maxPlayers > 0
      ? Math.min(100, Math.round((status.playerCount / status.maxPlayers) * 100))
      : 0;

  return (
    <>
      {header}

      {data?.configured === false && (
        <div className="notice">
          <strong>Der Server hat sich noch nie gemeldet.</strong>
          <div>{data.hint}</div>
        </div>
      )}

      {data?.pterodactyl && !data.pterodactyl.configured && (
        <div className="notice">
          <strong>Pterodactyl ist nicht eingerichtet.</strong> Ohne diese
          Anbindung lässt sich der Server nicht zum Nachladen anstoßen.
          {(data.pterodactyl.missing?.length ?? 0) > 0 && (
            <>
              {" "}
              Fehlend: <span className="mono">{data.pterodactyl.missing?.join(", ")}</span>
            </>
          )}
        </div>
      )}

      {message && (
        <div className={`notice ${message.ok ? "ok" : "error"}`} role="status">
          {message.text}
        </div>
      )}

      <div className="kpis">
        <section className="kpi">
          <div className="kpi-label">
            <Icon name="server" size={16} />
            Server
          </div>
          <div className="kpi-value" style={{ color: status?.online ? undefined : "var(--bad)" }}>
            <span
              className={`dot${status?.online ? " pulse" : ""}`}
              style={{
                width: 10,
                height: 10,
                background: status?.online ? "var(--ok)" : "var(--bad)",
              }}
            />
            {status?.online ? "Online" : "Offline"}
          </div>
          <div className="kpi-sub tnum">
            {status?.secondsSinceHeartbeat !== null &&
            status?.secondsSinceHeartbeat !== undefined
              ? `Lebenszeichen vor ${status.secondsSinceHeartbeat} s`
              : "noch kein Lebenszeichen"}
          </div>
        </section>

        <section className="kpi">
          <div className="kpi-label">
            <Icon name="users" size={16} />
            Spieler
          </div>
          <div className="kpi-value">
            {status?.playerCount ?? 0}
            <small> / {status?.maxPlayers ?? 0}</small>
          </div>
          <div className="meter" aria-hidden="true">
            <span style={{ width: `${playerShare}%` }} />
          </div>
        </section>

        <section className="kpi">
          <div className="kpi-label">
            <Icon name="mapPin" size={16} />
            Karte
          </div>
          <div className="kpi-value mono" title={status?.map || undefined}>
            {status?.map || "-"}
          </div>
          <div className="kpi-sub">
            {status?.gamemode ? `Gamemode ${status.gamemode}` : "kein Gamemode gemeldet"}
          </div>
        </section>

        <section className="kpi">
          <div className="kpi-label">
            <Icon name="shieldAlert" size={16} />
            DEFCON
          </div>
          <div className="kpi-value">
            {defcon ?? "-"}
            <span className="segments" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((index) => (
                <span
                  key={index}
                  style={
                    index < defconFilled ? { background: `var(--${defconTone})` } : undefined
                  }
                />
              ))}
            </span>
          </div>
          <div className="kpi-sub" title={status?.defconText || undefined}>
            {status?.defconText || "kein Zusatztext"}
          </div>
        </section>

        <section className="kpi">
          <div className="kpi-label">
            <Icon name="clock" size={16} />
            Laufzeit
          </div>
          <div className="kpi-value">{formatDuration(status?.uptimeSeconds ?? 0)}</div>
          <div className="kpi-sub">seit dem letzten Start</div>
        </section>
      </div>

      <div className="dash-grid">
        <div className="dash-col">
          <section className="section-card" aria-labelledby="dash-online">
            <div className="section-head">
              <h2 id="dash-online">Spieler online</h2>
              <span className="badge sm tnum">{players.length}</span>
              <label className="search-field">
                <Icon name="search" size={16} />
                <input
                  type="search"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Name, Job oder Einheit …"
                  aria-label="Spieler filtern"
                />
              </label>
            </div>

            {players.length === 0 ? (
              <div className="data-empty" style={{ borderTop: "1px solid var(--border)" }}>
                Gerade ist niemand auf dem Server.
              </div>
            ) : (
              <div className="data-scroll">
                <div style={{ minWidth: 600, ["--cols" as string]: PLAYER_COLS }}>
                  <div className="data-head">
                    <span>Name</span>
                    <span>Charakter</span>
                    <span>Job</span>
                    <span>Einheit</span>
                    <span className="right">Ping</span>
                  </div>

                  {shownPlayers.map((player) => (
                    <div key={player.steamId} className="data-row">
                      <span className="who">
                        <span className="avatar sm" aria-hidden="true">
                          {initialsOf(player.name)}
                        </span>
                        <strong>{player.name}</strong>
                      </span>
                      <span className="mono">{player.charId || "-"}</span>
                      <span className="mono">{player.jobKey || "-"}</span>
                      <span className="mono">{player.unitKey || "-"}</span>
                      <span className="ping mono tnum">
                        <span className={`dot ${pingTone(player.ping)}`} aria-hidden="true" />
                        {player.ping} ms
                      </span>
                    </div>
                  ))}

                  {shownPlayers.length === 0 && (
                    <div className="data-empty">Kein Spieler passt zu dieser Suche.</div>
                  )}
                </div>
              </div>
            )}

            <div className="section-foot">
              <span>Aktualisiert sich alle 15 Sekunden</span>
              <span className="legend">
                <span>
                  <span className="dot ok" aria-hidden="true" />
                  unter 80 ms
                </span>
                <span>
                  <span className="dot warn" aria-hidden="true" />
                  bis 130 ms
                </span>
                <span>
                  <span className="dot bad" aria-hidden="true" />
                  darüber
                </span>
              </span>
            </div>
          </section>

          <RecentChanges version={auditVersion} />
        </div>

        <div className="dash-col">
          <section className="section-card" aria-labelledby="dash-reload">
            <div className="section-head">
              <h2 id="dash-reload">Daten neu laden</h2>
            </div>
            <div className="section-body">
              <p className="section-text">
                Schickt <span className="code">pd_reload</span> an die Serverkonsole. Der
                Server liest den Bereich frisch aus der Datenbank und verteilt ihn an alle
                verbundenen Spieler – ohne Neustart.
              </p>

              <div className="reload-grid">
                {RELOAD_AREAS.map((area) => {
                  const isBusy = busy === `reload-${area.key}`;
                  const isDone = !isBusy && done[area.key];

                  return (
                    <button
                      key={area.key}
                      type="button"
                      className={`reload-btn${isBusy ? " busy" : ""}${isDone ? " done" : ""}`}
                      disabled={!canAct || busy !== null}
                      title={area.label}
                      onClick={() =>
                        void sendCommand(
                          { action: "reload", area: area.key },
                          `reload-${area.key}`,
                          area.key,
                          area.label,
                        )
                      }
                    >
                      <span>{area.label}</span>
                      <Icon
                        name={isBusy ? "spinner" : isDone ? "check" : "refresh"}
                        size={14}
                        strokeWidth={isDone ? 2.25 : 1.75}
                        className={isBusy ? "spin" : undefined}
                      />
                    </button>
                  );
                })}
              </div>

              <div className="reload-foot">
                <Icon name="clock" size={14} />
                {!canAct
                  ? "Als Leser kannst du nur zusehen."
                  : lastReload
                    ? `Zuletzt neu geladen: ${lastReload}`
                    : "In dieser Sitzung noch nichts neu geladen."}
              </div>
            </div>
          </section>

          {user.role === "admin" && (
            <LiveActions players={players} currentDefcon={status?.defcon} onDone={afterAction} />
          )}
        </div>
      </div>
    </>
  );
}
