import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listAudit } from "@/lib/audit";
import Shell from "@/components/Shell";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  "jobs.saveUnit": "Einheit gespeichert",
  "jobs.saveSubunit": "Untereinheit gespeichert",
  "jobs.saveJob": "Job gespeichert",
  "jobs.deleteUnit": "Einheit gelöscht",
  "jobs.deleteSubunit": "Untereinheit gelöscht",
  "jobs.deleteJob": "Job gelöscht",
  "fb.saveCourse": "Fortbildung gespeichert",
  "fb.deleteCourse": "Fortbildung gelöscht",
  "fb.grant": "Fortbildung vergeben",
  "fb.revoke": "Fortbildung entzogen",
  "weapons.save": "Waffenkonfiguration gespeichert",
  "characters.setFaction": "Zuordnung geändert",
  "users.save": "Panel-Benutzer gespeichert",
  "users.remove": "Panel-Benutzer entfernt",
  "server.reload": "Daten neu geladen",
  "server.say": "Servernachricht",
  "server.kick": "Spieler entfernt",
  "server.defcon": "DEFCON gesetzt",
  "server.status": "Status abgefragt",
};

export default async function AuditPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  let entries: Awaited<ReturnType<typeof listAudit>> = [];
  let error: string | null = null;

  try {
    entries = await listAudit(150);
  } catch (caught) {
    error = (caught as Error).message;
  }

  return (
    <Shell user={user} current="/audit">
      <h1>Änderungsprotokoll</h1>
      <p className="subtitle">
        Wer hat wann was geändert. Die letzten 150 Einträge.
      </p>

      {error && <div className="notice error">Konnte nicht geladen werden: {error}</div>}

      <div className="panel">
        {entries.length === 0 && !error ? (
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
