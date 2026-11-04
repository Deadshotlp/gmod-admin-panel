"use client";

import { useEffect, useState } from "react";
import Icon from "./Icon";
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

type Tab = "say" | "announce" | "defcon" | "kick";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "say", label: "Durchsage" },
  { key: "announce", label: "Ankündigung" },
  { key: "defcon", label: "DEFCON" },
  { key: "kick", label: "Kicken" },
];

const DEFCON_LEVELS = [0, 1, 2, 3, 4, 5];

export default function LiveActions({
  players,
  currentDefcon,
  onDone,
}: {
  players: Player[];
  currentDefcon?: number;
  onDone?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("say");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [sayText, setSayText] = useState("");
  const [annTitle, setAnnTitle] = useState("");
  const [annText, setAnnText] = useState("");
  const [annDuration, setAnnDuration] = useState(10);
  const [defconLevel, setDefconLevel] = useState<number>(currentDefcon ?? 5);
  const [defconTouched, setDefconTouched] = useState(false);
  const [defconText, setDefconText] = useState("");
  const [kickTarget, setKickTarget] = useState("");
  const [kickReason, setKickReason] = useState("");

  // Bis jemand selbst eine Stufe wählt, folgt die Auswahl dem Server.
  useEffect(() => {
    if (!defconTouched && currentDefcon !== undefined) setDefconLevel(currentDefcon);
  }, [currentDefcon, defconTouched]);

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
      onDone?.();
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
    <section className="section-card" aria-labelledby="dash-live">
      <div className="section-head">
        <h2 id="dash-live">Live-Aktionen</h2>
        <span className="badge sm warn">Nur Admins</span>
      </div>

      <div className="section-body">
        <div className="seg" style={{ marginBottom: 16 }}>
          {TABS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-pressed={tab === entry.key}
              onClick={() => {
                setTab(entry.key);
                setMessage(null);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {message && <Notice ok={message.ok}>{message.text}</Notice>}

        {tab === "say" && (
          <div className="form-stack">
            <p className="section-text" style={{ margin: 0 }}>
              Erscheint im Chat und als Hinweis bei allen Spielern.
            </p>
            <Field label="Text" hint="Höchstens 200 Zeichen">
              <input
                value={sayText}
                maxLength={200}
                placeholder="z. B. Serverneustart in 10 Minuten"
                onChange={(event) => setSayText(event.target.value)}
                style={inputStyle}
              />
            </Field>
            <div>
              <button
                type="button"
                className="primary with-icon"
                disabled={busy !== null || sayText.trim() === ""}
                onClick={async () => {
                  if (!confirm(`Durchsage an alle senden?\n\n${sayText}`)) return;
                  if (await run("say", { action: "say", text: sayText.trim() }, "Durchsage gesendet."))
                    setSayText("");
                }}
              >
                <Icon name="send" size={15} />
                {busy === "say" ? "Wird gesendet …" : "Senden"}
              </button>
            </div>
          </div>
        )}

        {tab === "announce" && (
          <div className="form-stack">
            <p className="section-text" style={{ margin: 0 }}>
              Öffnet bei allen Spielern ein großes Fenster.
            </p>
            <div className="form-row">
              <Field label="Titel" hint="leer = Serverleitung">
                <input
                  value={annTitle}
                  maxLength={80}
                  placeholder="Serverleitung"
                  onChange={(event) => setAnnTitle(event.target.value)}
                  style={inputStyle}
                />
              </Field>
              <Field label="Sekunden">
                <input
                  type="number"
                  min={3}
                  max={120}
                  value={annDuration}
                  onChange={(event) => setAnnDuration(Number(event.target.value) || 10)}
                  style={inputStyle}
                />
              </Field>
            </div>
            <Field label="Text">
              <textarea
                value={annText}
                maxLength={300}
                rows={3}
                placeholder="Was sollen alle sehen?"
                onChange={(event) => setAnnText(event.target.value)}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </Field>
            <div>
              <button
                type="button"
                className="primary with-icon"
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
                <Icon name="megaphone" size={15} />
                {busy === "announce" ? "Wird gesendet …" : "Ankündigen"}
              </button>
            </div>
          </div>
        )}

        {tab === "defcon" && (
          <div className="form-stack">
            <Field label="Stufe" hint={`aktuell: ${currentDefcon ?? "-"}`}>
              <div className="levels" role="group" aria-label="DEFCON-Stufe">
                {DEFCON_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={defconLevel === level}
                    aria-label={`DEFCON ${level}`}
                    onClick={() => {
                      setDefconLevel(level);
                      setDefconTouched(true);
                    }}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Zusatztext (optional)">
              <input
                value={defconText}
                maxLength={150}
                placeholder="z. B. Erhöhte Bereitschaft"
                onChange={(event) => setDefconText(event.target.value)}
                style={inputStyle}
              />
            </Field>
            <div>
              <button
                type="button"
                className="primary"
                disabled={busy !== null}
                onClick={async () => {
                  if (!confirm(`DEFCON auf ${defconLevel} setzen?`)) return;
                  if (
                    await run(
                      "defcon",
                      { action: "defcon", level: defconLevel, text: defconText.trim() },
                      `DEFCON ${defconLevel} gesetzt.`,
                    )
                  ) {
                    setDefconTouched(false);
                  }
                }}
              >
                {busy === "defcon" ? "Wird gesetzt …" : "DEFCON setzen"}
              </button>
            </div>
          </div>
        )}

        {tab === "kick" && (
          <div className="form-stack">
            <Field label="Spieler">
              <select
                value={kickTarget}
                onChange={(event) => setKickTarget(event.target.value)}
                style={inputStyle}
              >
                <option value="">Spieler wählen …</option>
                {players.map((player) => (
                  <option key={player.steamId} value={player.steamId}>
                    {player.name}
                    {player.charId ? ` · ${player.charId}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Grund" hint="Wird dem Spieler angezeigt">
              <input
                value={kickReason}
                maxLength={120}
                onChange={(event) => setKickReason(event.target.value)}
                style={inputStyle}
              />
            </Field>
            <div>
              <button
                type="button"
                className="danger with-icon"
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
                <Icon name="userX" size={15} />
                {busy === "kick" ? "Wird gekickt …" : "Spieler kicken"}
              </button>
            </div>
          </div>
        )}

        <p className="field-hint" style={{ marginTop: 18 }}>
          Jede Aktion landet mit deinem Namen im Änderungsprotokoll. Bans laufen weiterhin
          über SAM im Spiel.
        </p>
      </div>
    </section>
  );
}
