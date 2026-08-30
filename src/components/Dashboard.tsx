"use client";

import { useCallback, useEffect, useState } from "react";
import type { PanelUser } from "@/lib/auth";

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
  pterodactyl?: { configured: boolean; missing: string[] };
  error?: string;
  detail?: string;
}

const RELOAD_AREAS: Array<{ key: string; label: string }> = [
  { key: "jobs", label: "Jobs & Einheiten" },
  { key: "fortbildung", label: "Fortbildungen" },
  { key: "fraktionen", label: "Fraktionsbaum" },
  { key: "armor", label: "Rüstungen" },
  { key: "spawns", label: "Spawnpunkte" },
  { key: "all", label: "Alles" },
];

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "-";

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;

  return `${seconds} s`;
}

export default function Dashboard({ user }: { user: PanelUser }) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      setData((await response.json()) as StatusResponse);
    } catch {
      setData({ error: "Panel konnte den Status nicht abrufen" });
    } finally {
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

  const sendCommand = useCallback(
    async (body: Record<string, unknown>, label: string) => {
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
          // Dem Server einen Moment geben, dann den frischen Stand holen.
          setTimeout(() => void load(), 2000);
        }
      } catch {
        setMessage({ ok: false, text: "Anfrage fehlgeschlagen" });
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  if (loading) {
    return <p className="subtitle">Status wird geladen…</p>;
  }

  if (data?.error) {
    return (
      <div className="notice error">
        <strong>{data.error}</strong>
        {data.detail && <div className="mono">{data.detail}</div>}
      </div>
    );
  }

  const status = data?.status;
  const canAct = user.role === "editor" || user.role === "admin";

  return (
    <>
      {data?.configured === false && (
        <div className="notice">
          <strong>Der Server hat sich noch nie gemeldet.</strong>
          <div>{data.hint}</div>
        </div>
      )}

      {data?.pterodactyl && !data.pterodactyl.configured && (
        <div className="notice">
          <strong>Pterodactyl ist nicht eingerichtet.</strong> Ohne diese
          Anbindung lässt sich der Server nicht zum Nachladen anstoßen. Fehlend:{" "}
          <span className="mono">{data.pterodactyl.missing.join(", ")}</span>
        </div>
      )}

      {message && (
        <div className={`notice ${message.ok ? "ok" : "error"}`}>
          {message.text}
        </div>
      )}

      <div className="cards">
        <div className="card">
          <div className="card-label">Server</div>
          <div className="card-value">
            <span className={`badge ${status?.online ? "online" : "offline"}`}>
              <span className="dot" />
              {status?.online ? "Online" : "Offline"}
            </span>
          </div>
          <div className="card-sub">
            {status?.secondsSinceHeartbeat !== null &&
            status?.secondsSinceHeartbeat !== undefined
              ? `letztes Lebenszeichen vor ${status.secondsSinceHeartbeat} s`
              : "noch kein Lebenszeichen"}
          </div>
        </div>

        <div className="card">
          <div className="card-label">Spieler</div>
          <div className="card-value">
            {status?.playerCount ?? 0}
            <span style={{ fontSize: 15, color: "var(--text-muted)" }}>
              {" "}
              / {status?.maxPlayers ?? 0}
            </span>
          </div>
          <div className="card-sub">{data?.players?.length ?? 0} in der Liste</div>
        </div>

        <div className="card">
          <div className="card-label">Karte</div>
          <div className="card-value" style={{ fontSize: 16 }}>
            {status?.map || "-"}
          </div>
          <div className="card-sub">{status?.gamemode || ""}</div>
        </div>

        <div className="card">
          <div className="card-label">DEFCON</div>
          <div className="card-value">{status?.defcon ?? "-"}</div>
          <div className="card-sub">{status?.defconText || "kein Zusatztext"}</div>
        </div>

        <div className="card">
          <div className="card-label">Laufzeit</div>
          <div className="card-value" style={{ fontSize: 18 }}>
            {formatDuration(status?.uptimeSeconds ?? 0)}
          </div>
          <div className="card-sub">seit dem letzten Start</div>
        </div>
      </div>

      <h2>Daten neu laden</h2>
      <div className="panel">
        <p className="subtitle" style={{ marginBottom: 14 }}>
          Schickt <span className="mono">pd_reload</span> an die Serverkonsole. Der
          Server liest den Bereich frisch aus der Datenbank und verteilt ihn an
          alle verbundenen Spieler — ohne Neustart.
        </p>

        <div className="button-row">
          {RELOAD_AREAS.map((area) => (
            <button
              key={area.key}
              disabled={!canAct || busy !== null}
              onClick={() =>
                void sendCommand(
                  { action: "reload", area: area.key },
                  `reload-${area.key}`,
                )
              }
            >
              {busy === `reload-${area.key}` ? "…" : area.label}
            </button>
          ))}

          <button
            disabled={!canAct || busy !== null}
            onClick={() => void sendCommand({ action: "status" }, "status")}
          >
            {busy === "status" ? "…" : "Status jetzt abfragen"}
          </button>
        </div>

        {!canAct && (
          <p className="subtitle" style={{ marginTop: 12, marginBottom: 0 }}>
            Als Leser kannst du nur zusehen.
          </p>
        )}
      </div>

      <h2>Spieler online</h2>
      <div className="panel">
        {!data?.players || data.players.length === 0 ? (
          <p className="subtitle" style={{ margin: 0 }}>
            Gerade ist niemand auf dem Server.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Charakter</th>
                <th>Job</th>
                <th>Einheit</th>
                <th style={{ textAlign: "right" }}>Ping</th>
              </tr>
            </thead>
            <tbody>
              {data.players.map((player) => (
                <tr key={player.steamId}>
                  <td style={{ color: "var(--text)" }}>{player.name}</td>
                  <td className="mono">{player.charId || "-"}</td>
                  <td className="mono">{player.jobKey || "-"}</td>
                  <td className="mono">{player.unitKey || "-"}</td>
                  <td style={{ textAlign: "right" }}>{player.ping} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
