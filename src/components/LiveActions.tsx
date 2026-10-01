"use client";

import { useState } from "react";
import { Field, Notice, fetchWithTimeout, inputStyle, readJson } from "./ui";

/**
 * Eingriffe am laufenden Server: Durchsage, Ankündigung, DEFCON, Kick.
 *
 * Alles läuft über /api/server/command - dort sind die Aktionen fest
 * vorgegeben, geprüft und landen im Änderungsprotokoll. Nur für Admins.
 */

interface Player {
  steamId: string;
  name: string;
  charId: string;
}

const DEFCON_LABEL: Record<number, string> = {
  0: "0",
  1: "1",
  2: "2",
  3: "3",
  4: "4",
  5: "5",
};

export default function LiveActions({
  players,
  currentDefcon,
}: {
  players: Player[];
  currentDefcon?: number;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [sayText, setSayText] = useState("");
  const [annTitle, setAnnTitle] = useState("");
  const [annText, setAnnText] = useState("");
  const [annDuration, setAnnDuration] = useState(10);
  const [defconLevel, setDefconLevel] = useState<number>(currentDefcon ?? 5);
  const [defconText, setDefconText] = useState("");
  const [kickTarget, setKickTarget] = useState("");
  const [kickReason, setKickReason] = useState("");

  const run = async (label: string, body: Record<string, unknown>, success: string) => {
    setBusy(label);
    setMessage(null);

    try {
      const response = await fetchWithTimeout("/api/server/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const { data, error } = await readJson<{ ok: boolean; message?: string }>(response);

      if (error || !data?.ok) {
        setMessage({ ok: false, text: error ?? data?.message ?? "Fehlgeschlagen" });
        return false;
      }

      setMessage({ ok: true, text: success });
      return true;
    } catch {
      setMessage({ ok: false, text: "Anfrage fehlgeschlagen" });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const kickPlayer = players.find((player) => player.steamId === kickTarget);

  return (
    <>
      <h2>Live-Aktionen</h2>
      <div className="panel">
        {message && <Notice ok={message.ok}>{message.text}</Notice>}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 22,
          }}
        >
          <div>
            <div className="card-label" style={{ marginBottom: 8 }}>
              Durchsage (Chat + Hinweis)
            </div>
            <Field label="Text">
              <input
                value={sayText}
                maxLength={200}
                onChange={(event) => setSayText(event.target.value)}
                style={inputStyle}
              />
            </Field>
            <button
              disabled={busy !== null || sayText.trim() === ""}
              onClick={async () => {
                if (!confirm(`Durchsage an alle senden?\n\n${sayText}`)) return;
                if (await run("say", { action: "say", text: sayText.trim() }, "Durchsage gesendet."))
                  setSayText("");
              }}
            >
              {busy === "say" ? "…" : "Senden"}
            </button>
          </div>

          <div>
            <div className="card-label" style={{ marginBottom: 8 }}>
              Ankündigung (großes Fenster)
            </div>
            <Field label="Titel" hint="leer = Serverleitung">
              <input
                value={annTitle}
                maxLength={80}
                onChange={(event) => setAnnTitle(event.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Text">
              <textarea
                value={annText}
                maxLength={300}
                rows={3}
                onChange={(event) => setAnnText(event.target.value)}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </Field>
            <Field label="Anzeigedauer (Sekunden)">
              <input
                type="number"
                min={3}
                max={120}
                value={annDuration}
                onChange={(event) => setAnnDuration(Number(event.target.value) || 10)}
                style={inputStyle}
              />
            </Field>
            <button
              disabled={busy !== null || annText.trim() === ""}
              onClick={async () => {
                if (!confirm("Ankündigung an alle Spieler senden?")) return;
                if (
                  await run(
                    "announce",
                    {
                      action: "announce",
                      title: annTitle.trim(),
                      text: annText.trim(),
                      duration: Math.min(120, Math.max(3, Math.round(annDuration))),
                    },
                    "Ankündigung gesendet.",
                  )
                ) {
                  setAnnText("");
                }
              }}
            >
              {busy === "announce" ? "…" : "Ankündigen"}
            </button>
          </div>

          <div>
            <div className="card-label" style={{ marginBottom: 8 }}>
              DEFCON
            </div>
            <Field label="Stufe" hint={`aktuell: ${currentDefcon ?? "-"}`}>
              <select
                value={defconLevel}
                onChange={(event) => setDefconLevel(Number(event.target.value))}
                style={inputStyle}
              >
                {Object.entries(DEFCON_LABEL).map(([level, label]) => (
                  <option key={level} value={level}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Zusatztext (optional)">
              <input
                value={defconText}
                maxLength={150}
                onChange={(event) => setDefconText(event.target.value)}
                style={inputStyle}
              />
            </Field>
            <button
              disabled={busy !== null}
              onClick={async () => {
                if (!confirm(`DEFCON auf ${defconLevel} setzen?`)) return;
                await run(
                  "defcon",
                  { action: "defcon", level: defconLevel, text: defconText.trim() },
                  `DEFCON ${defconLevel} gesetzt.`,
                );
              }}
            >
              {busy === "defcon" ? "…" : "Setzen"}
            </button>
          </div>

          <div>
            <div className="card-label" style={{ marginBottom: 8 }}>
              Spieler kicken
            </div>
            <Field label="Spieler">
              <select
                value={kickTarget}
                onChange={(event) => setKickTarget(event.target.value)}
                style={inputStyle}
              >
                <option value="">— auswählen —</option>
                {players.map((player) => (
                  <option key={player.steamId} value={player.steamId}>
                    {player.name}
                    {player.charId ? ` (${player.charId})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Grund">
              <input
                value={kickReason}
                maxLength={120}
                onChange={(event) => setKickReason(event.target.value)}
                style={inputStyle}
              />
            </Field>
            <button
              disabled={busy !== null || !kickPlayer}
              onClick={async () => {
                if (!kickPlayer) return;
                if (!confirm(`${kickPlayer.name} vom Server kicken?`)) return;
                if (
                  await run(
                    "kick",
                    {
                      action: "kick",
                      steamId: kickPlayer.steamId,
                      reason: kickReason.trim() || undefined,
                    },
                    `${kickPlayer.name} wurde gekickt.`,
                  )
                ) {
                  setKickTarget("");
                  setKickReason("");
                }
              }}
            >
              {busy === "kick" ? "…" : "Kicken"}
            </button>
          </div>
        </div>

        <p className="subtitle" style={{ marginTop: 14, marginBottom: 0 }}>
          Jede Aktion landet mit deinem Namen im Änderungsprotokoll. Bans laufen
          weiterhin über SAM im Spiel.
        </p>
      </div>
    </>
  );
}
