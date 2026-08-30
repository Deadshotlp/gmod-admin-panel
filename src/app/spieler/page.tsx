import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import SpielerManager from "@/components/SpielerManager";

export const dynamic = "force-dynamic";

export default async function SpielerPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/spieler">
      <h1>Spieler &amp; Charaktere</h1>
      <p className="subtitle">
        Charaktere durchsuchen, Zuordnung, Spielzeit und Fortbildungen einsehen.
      </p>

      <SpielerManager />
    </Shell>
  );
}
