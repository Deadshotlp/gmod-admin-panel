import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import FeldzugView from "@/components/FeldzugView";

export const dynamic = "force-dynamic";

export default async function FeldzugPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/feldzug" wide>
      <h1>Galaktischer Feldzug</h1>
      <p className="subtitle">
        Rundenbasierte Strategie: Republik gegen KUS. Die Spielleitung wählt das Gebiet und die Hauptquartiere, die Kommandeure
        besetzen Systeme und stellen Truppen auf. Jede Seite sieht nur, was sie aufgeklärt hat. Linke Maustaste: System wählen,
        ziehen: verschieben, Mausrad: zoomen.
      </p>

      <FeldzugView />
    </Shell>
  );
}
