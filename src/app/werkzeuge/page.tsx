import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import WerkzeugeManager from "@/components/WerkzeugeManager";

export const dynamic = "force-dynamic";

export default async function WerkzeugePage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/werkzeuge">
      <h1>Werkzeuge</h1>
      <p className="subtitle">
        Prüfung auf fehlende Ausrüstung, Sicherungen und die laufende Serverkonsole.
      </p>

      <WerkzeugeManager user={user} />
    </Shell>
  );
}
