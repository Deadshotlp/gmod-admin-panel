import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import KistenManager from "@/components/KistenManager";

export const dynamic = "force-dynamic";

export default async function KistenPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/kisten">
      <h1>Transportkisten</h1>
      <p className="subtitle">
        Große Objekte (z. B. Zelte), die sich im Spiel über das Interaktionsmenü in eine
        Kiste packen, transportieren und wieder aufbauen lassen. Nach dem Speichern lädt
        der Server die Liste neu.
      </p>

      <KistenManager user={user} />
    </Shell>
  );
}
