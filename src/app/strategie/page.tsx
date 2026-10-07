import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import StrategieView from "@/components/StrategieView";

export const dynamic = "force-dynamic";

export default async function StrategiePage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/strategie">
      <h1>Strategieansicht</h1>
      <p className="subtitle">
        Live-Lage der Raumflotte (alle 2 Sekunden vom Server): Galaxie mit Routen und laufenden Sprüngen, Systeme mit
        Himmelskörpern und Schiffen. Ziehen = verschieben, Mausrad = zoomen, Klick = auswählen. Befehle wie im
        Flottenkommando.
      </p>

      <StrategieView user={user} />
    </Shell>
  );
}
