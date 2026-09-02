import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import ArccwManager from "@/components/ArccwManager";

export const dynamic = "force-dynamic";

export default async function ArccwPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/arccw">
      <h1>ArcCW-Schaden</h1>
      <p className="subtitle">
        Schaden, Reichweiten und Durchschlag der ArcCW-Waffen. Die Addon-Dateien bleiben
        unangetastet — die Werte liegen daneben in der Datenbank und werden beim Speichern
        sofort auf dem laufenden Server angewendet.
      </p>

      <ArccwManager user={user} />
    </Shell>
  );
}
