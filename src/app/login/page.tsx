import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getSessionSteamId } from "@/lib/session";

const ERRORS: Record<string, string> = {
  invalid: "Steam hat die Anmeldung nicht bestätigt. Bitte erneut versuchen.",
  steam_unreachable: "Steam war nicht erreichbar. Bitte später erneut versuchen.",
  no_steamid: "Steam hat keine gültige ID zurückgegeben.",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const steamId = await getSessionSteamId();

  let hasAccess = false;

  if (steamId) {
    try {
      hasAccess = (await getCurrentUser()) !== null;
    } catch {
      hasAccess = false;
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-box">
        <h1>SWRP Serververwaltung</h1>
        <p className="subtitle">Anmeldung über Steam</p>

        {params.error && (
          <div className="notice error">
            {ERRORS[params.error] ?? "Bei der Anmeldung ist etwas schiefgegangen."}
          </div>
        )}

        {steamId && !hasAccess && (
          <div className="notice">
            <strong>Angemeldet, aber ohne Zugang.</strong>
            <br />
            Deine SteamID <span className="mono">{steamId}</span> ist noch nicht
            freigeschaltet. Ein Administrator muss dich im Panel eintragen.
          </div>
        )}

        {hasAccess ? (
          <Link className="nav-item" href="/">
            Weiter zur Übersicht
          </Link>
        ) : (
          <a href="/api/auth/steam">
            <button className="primary" style={{ width: "100%" }}>
              Mit Steam anmelden
            </button>
          </a>
        )}

        {steamId && (
          <p style={{ marginTop: 20 }}>
            <a href="/api/auth/logout">Abmelden</a>
          </p>
        )}
      </div>
    </div>
  );
}
