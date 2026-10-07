import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import StrategieView from "@/components/StrategieView";

export const dynamic = "force-dynamic";

export default async function StrategiePage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/strategie" wide>
      <h1>Strategieansicht</h1>
      <p className="subtitle">
        Live-Lage der Raumflotte (alle 2 Sekunden vom Server): Galaxie mit Routen und laufenden Sprüngen, Systeme mit
        Himmelskörpern, Schiffen und ihren Wegpunkten. Links: auswählen oder Rahmen ziehen, Rechts: bewegen, angreifen,
        springen. Mittlere Maustaste: verschieben, Mausrad: zoomen.
      </p>

      <StrategieView user={user} />
    </Shell>
  );
}
