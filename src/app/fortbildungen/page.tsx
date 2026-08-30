import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import FortbildungManager from "@/components/FortbildungManager";

export const dynamic = "force-dynamic";

export default async function FortbildungenPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/fortbildungen">
      <h1>Fortbildungen</h1>
      <p className="subtitle">
        Katalog verwalten und Inhaber einsehen. Vergaben hier übergehen die
        Zugangsbeschränkung bewusst — der reguläre Weg ist ein Kurs im Spiel.
      </p>

      <FortbildungManager user={user} />
    </Shell>
  );
}
