import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import FunkManager from "@/components/FunkManager";

export const dynamic = "force-dynamic";

export default async function FunkPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/funk">
      <h1>Funk</h1>
      <p className="subtitle">
        Feste Comlink-Kanäle und Sprachreichweiten. Nach dem Speichern lädt der Server
        die Werte neu; bestehende Kanal-Belegungen der Spieler bleiben erhalten.
      </p>

      <FunkManager user={user} />
    </Shell>
  );
}
