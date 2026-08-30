import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import JobsManager from "@/components/JobsManager";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/jobs">
      <h1>Jobs &amp; Einheiten</h1>
      <p className="subtitle">
        Einheiten, Untereinheiten und Jobs. Änderungen gehen in die Datenbank, danach
        lädt der Server sie automatisch neu.
      </p>

      <JobsManager user={user} />
    </Shell>
  );
}
