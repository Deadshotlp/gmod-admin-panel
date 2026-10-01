import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import FahrzeugeManager from "@/components/FahrzeugeManager";

export const dynamic = "force-dynamic";

export default async function FahrzeugePage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/fahrzeuge">
      <h1>Fahrzeuginventar</h1>
      <p className="subtitle">
        Welche Fahrzeuge ein Inventar haben, wie viele Plätze es hat und was eingeladen
        werden darf. Nach dem Speichern lädt der Server die Werte neu.
      </p>

      <FahrzeugeManager user={user} />
    </Shell>
  );
}
