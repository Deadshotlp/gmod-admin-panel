import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import UsersManager from "@/components/UsersManager";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/benutzer">
      <h1>Panel-Benutzer</h1>
      <p className="subtitle">Wer das Panel benutzen darf und mit welchen Rechten.</p>

      {user.role !== "admin" ? (
        <div className="notice">
          Dieser Bereich ist Administratoren vorbehalten.
        </div>
      ) : (
        <UsersManager me={user} />
      )}
    </Shell>
  );
}
