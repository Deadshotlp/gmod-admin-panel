import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import NavalManager from "@/components/NavalManager";

export const dynamic = "force-dynamic";

export default async function RaumflottePage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/raumflotte">
      <h1>Raumflotte</h1>
      <p className="subtitle">
        Naval-System: Tempo und Regeln, Schiffsklassen, Fraktionen mit Beziehungen und die Galaxie. Schiffe im
        Spiel steuert man über das Admin-Menü unter Raumflotte.
      </p>

      <NavalManager user={user} />
    </Shell>
  );
}
