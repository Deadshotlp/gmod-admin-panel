"use client";

import { useCallback, useEffect, useState } from "react";
import type { PanelUser } from "@/lib/auth";
import { Notice, fetchWithTimeout, readJson } from "./ui";

interface Entry {
  id: number;
  displayName: string;
  steamId: string;
  action: string;
  targetType: string;
  targetKey: string;
  note: string;
  createdAt: number;
  hasDetail: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  "jobs.saveUnit": "Einheit gespeichert",
  "jobs.saveSubunit": "Untereinheit gespeichert",
  "jobs.saveJob": "Job gespeichert",
  "jobs.deleteUnit": "Einheit gelöscht",
  "jobs.deleteSubunit": "Untereinheit gelöscht",
  "jobs.deleteJob": "Job gelöscht",
  "jobs.import": "Jobbaum importiert",
  "jobs.undo": "Änderung zurückgenommen",
  "fortbildung.undo": "Änderung zurückgenommen",
  "fb.saveCourse": "Fortbildung gespeichert",
  "fb.deleteCourse": "Fortbildung gelöscht",
  "fb.grant": "Fortbildung vergeben",
  "fb.revoke": "Fortbildung entzogen",
  "weapons.save": "Waffenkonfiguration gespeichert",
  "users.save": "Panel-Benutzer gespeichert",
  "users.remove": "Panel-Benutzer entfernt",
  "backup.create": "Sicherung angelegt",
  "backup.restore": "Sicherung zurückgespielt",
  "server.reload": "Daten neu geladen",
  "server.say": "Servernachricht",
  "server.kick": "Spieler entfernt",
  "server.defcon": "DEFCON gesetzt",
  "server.status": "Status abgefragt",
};

// Nur diese Aktionen sichern einen vollständigen Vorher-Zustand.
const UNDOABLE = new Set([
  "jobs.saveUnit",
  "jobs.saveSubunit",
  "jobs.saveJob",
  "jobs.deleteUnit",
  "jobs.deleteSubunit",
  "jobs.deleteJob",
  "fb.saveCourse",
  "fb.deleteCourse",
]);

export default function AuditList({ user }: { user: PanelUser }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const canUndo = user.role === "editor" || user.role === "admin";

  const load = useCallback(async () => {
    try {
      const response = await fetchWithTimeout("/api/audit?limit=150", {
        cache: "no-store",
      });

      const { data, error } = await readJson<{ entries: Entry[] }>(response);

      if (error) setMessage({ ok: false, text: error });
      else setEntries(data?.entries ?? []);
    } catch {
      setMessage({ ok: false, text: "Protokoll konnte nicht geladen werden" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const undo = async (entry: Entry) => {
    if (
      !confirm(
        `"${ACTION_LABEL[entry.action] ?? entry.action}" von ${entry.displayName} zurücknehmen?\n\n` +
          "Achtung: Es wird der komplette Stand von VOR dieser Änderung wiederhergestellt. " +
          "Alles, was danach in diesem Bereich geändert wurde, geht dabei verloren.\n\n" +
          "Der aktuelle Stand wird vorher automatisch gesichert.",
      )
    )
      return;

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetchWithTimeout("/api/audit/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id }),
      });

      const { data, error } = await readJson<{
        message: string;
        reload?: { ok: boolean; message: string };
      }>(response);

      if (error) {
        setMessage({ ok: false, text: error });
        return;
      }

      setMessage({
        ok: true,
        text: `${data?.message ?? "Zurückgenommen."} ${
          data?.reload?.ok
            ? "Der Server lädt neu."
            : `Server nicht angestoßen: ${data?.reload?.message ?? "unbekannt"}`
        }`,
      });

      await load();
    } catch {
      setMessage({ ok: false, text: "Anfrage fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="subtitle">Protokoll wird geladen…</p>;

  return (
    <>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}

      <div className="panel">
        {entries.length === 0 ? (
          <p className="subtitle" style={{ margin: 0 }}>
            Noch keine Änderungen aufgezeichnet.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Zeitpunkt</th>
                <th>Wer</th>
                <th>Was</th>
                <th>Betroffen</th>
                <th>Hinweis</th>
                <th style={{ textAlign: "right" }}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {new Date(entry.createdAt * 1000).toLocaleString("de-DE")}
                  </td>
                  <td style={{ color: "var(--text)" }}>{entry.displayName}</td>
                  <td>{ACTION_LABEL[entry.action] ?? entry.action}</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {entry.targetKey || "-"}
                  </td>
                  <td style={{ fontSize: 13 }}>{entry.note || ""}</td>
                  <td style={{ textAlign: "right" }}>
                    {canUndo && UNDOABLE.has(entry.action) && entry.hasDetail && (
                      <button
                        disabled={busy}
                        style={{ padding: "3px 9px", fontSize: 12 }}
                        onClick={() => void undo(entry)}
                      >
                        Zurücknehmen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="subtitle" style={{ marginTop: 14 }}>
        Zurücknehmen stellt den kompletten Bereich auf den Stand vor der Änderung
        zurück — es ist kein schrittweises Rückgängigmachen. Spätere Änderungen im
        selben Bereich gehen dabei verloren. Vorher wird automatisch gesichert.
      </p>
    </>
  );
}
