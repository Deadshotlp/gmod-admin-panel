import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import AuditList from "@/components/AuditList";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/audit">
      <h1>Änderungsprotokoll</h1>
      <p className="subtitle">
        Wer hat wann was geändert. Die letzten 150 Einträge, mit der Möglichkeit
        einzelne Änderungen zurückzunehmen.
      </p>

      <AuditList user={user} />
    </Shell>
  );
}
