import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import LogsViewer from "@/components/LogsViewer";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/logs">
      <h1>Admin-Logs</h1>
      <p className="subtitle">
        Alles, was das Log-Modul im Spiel aufzeichnet - durchsuchbar nach Typ, Text und
        Zeitraum. Einträge werden 180 Tage aufbewahrt.
      </p>

      {user.role === "admin" ? (
        <LogsViewer />
      ) : (
        <div className="notice">Die Admin-Logs sind nur für Administratoren sichtbar.</div>
      )}
    </Shell>
  );
}
