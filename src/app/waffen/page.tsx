import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import WaffenManager from "@/components/WaffenManager";
import AusruestungBodygroups from "@/components/AusruestungBodygroups";

export const dynamic = "force-dynamic";

export default async function WaffenPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/waffen">
      <h1>Waffen &amp; Gewichte</h1>
      <p className="subtitle">
        Kategorien, Tragelast und Gewichte der Waffenkiste. Nach dem Speichern lädt der
        Server die Werte neu und schickt sie an alle Spieler.
      </p>

      <WaffenManager user={user} />

      <h2 style={{ marginTop: 32 }}>Ausrüstung und Bodygroups</h2>
      <AusruestungBodygroups user={user} />
    </Shell>
  );
}
