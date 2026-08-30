import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { DB_ENV_KEYS, missingEnv } from "@/lib/env";
import Shell from "@/components/Shell";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const dbMissing = missingEnv(...DB_ENV_KEYS, "SESSION_SECRET");

  // Ohne Konfiguration führt jeder weitere Schritt nur zu kryptischen Fehlern.
  if (dbMissing.length > 0) {
    return (
      <div className="login-wrap">
        <div className="login-box" style={{ textAlign: "left" }}>
          <h1>Einrichtung nötig</h1>
          <p className="subtitle">
            Diese Werte fehlen in der <span className="mono">.env</span>:
          </p>
          <ul className="mono">
            {dbMissing.map((key) => (
              <li key={key}>{key}</li>
            ))}
          </ul>
          <p className="subtitle" style={{ marginBottom: 0 }}>
            Vorlage: <span className="mono">.env.example</span>
          </p>
        </div>
      </div>
    );
  }

  let user;

  try {
    user = await getCurrentUser();
  } catch (error) {
    return (
      <div className="login-wrap">
        <div className="login-box" style={{ textAlign: "left" }}>
          <h1>Datenbank nicht erreichbar</h1>
          <p className="subtitle">
            Das Panel kommt nicht an <span className="mono">{process.env.DB_HOST}</span>.
            Die Datenbank liegt im lokalen Netz — läuft das Panel im selben Netz?
          </p>
          <p className="mono" style={{ color: "var(--text-muted)" }}>
            {(error as Error).message}
          </p>
        </div>
      </div>
    );
  }

  if (!user) redirect("/login");

  return (
    <Shell user={user} current="/">
      <h1>Übersicht</h1>
      <p className="subtitle">
        Live-Status des Servers und Nachladen der Konfiguration.
      </p>

      <Dashboard user={user} />
    </Shell>
  );
}
