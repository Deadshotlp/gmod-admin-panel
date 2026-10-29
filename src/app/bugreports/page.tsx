import { redirect } from "next/navigation";
import { getCurrentUser, hasRole } from "@/lib/auth";
import Shell from "@/components/Shell";
import BugReportsManager from "@/components/BugReportsManager";

export const dynamic = "force-dynamic";

export default async function BugReportsPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/bugreports">
      <h1>Bug Reports</h1>
      <p className="subtitle">
        Gemeldet im Spiel über ESC → „Bug melden“ - mit Kontext, Eingabe-Protokoll der letzten zwei
        Minuten, Lua-Fehlern und optional Screenshot. Eintrag anklicken für Details.
      </p>

      {hasRole(user, "editor") ? (
        <BugReportsManager />
      ) : (
        <div className="notice">Bug Reports sind ab der Rolle Bearbeiter sichtbar.</div>
      )}
    </Shell>
  );
}
