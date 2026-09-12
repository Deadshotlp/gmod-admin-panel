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
        Charaktere durchsuchen und bearbeiten: Name, Rang, Credits und Zuordnung.
        Spielzeit und Fortbildungen einsehen.
      </p>

      <SpielerManager user={user} />
    </Shell>
  );
}
