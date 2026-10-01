import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import CharakterManager from "@/components/CharakterManager";

export const dynamic = "force-dynamic";

export default async function CharakterPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/charakter">
      <h1>Charakter-Einstellungen</h1>
      <p className="subtitle">
        ID-Format und -Präfix, Slots je Rang und Namensregeln. Einzelne Charaktere
        bearbeitest du unter „Spieler &amp; Charaktere“.
      </p>

      <CharakterManager user={user} />
    </Shell>
  );
}
