import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import FlotteManager from "@/components/FlotteManager";

export const dynamic = "force-dynamic";

export default async function FlottePage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/flotte">
      <h1>Flottenkommando</h1>
      <p className="subtitle">
        Alle Schiffe der Raumflotte: erzeugen, befehligen, umbenennen, löschen. Befehle gehen direkt an den Server;
        die Liste zeigt den zuletzt gespeicherten Stand (Aktualisieren speichert vorher). Live mit Karte: im Spiel
        unter Flottenkommando.
      </p>

      <FlotteManager user={user} />
    </Shell>
  );
}
