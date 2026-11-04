import Link from "next/link";
import { BrandMark, ThemeToggle } from "@/components/AppFrame";
import Icon from "@/components/Icon";
import { brandTitle, getBrand } from "@/lib/brand";
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

  const brand = getBrand();
  const frameBrand = {
    name: brand.name,
    community: brand.community,
    mark: brand.mark,
    logo: brand.logo,
  };

  return (
    <div className="login-page">
      <header className="login-top">
        <BrandMark brand={frameBrand} />
        <div className="sidebar-brand-text">
          <strong>{brand.name}</strong>
          {brand.community && <span>{brand.community}</span>}
        </div>
        <ThemeToggle />
      </header>

      <main className="login-main">
        <div className="login-box">
          <BrandMark brand={frameBrand} size="lg" />
          <h1>Anmelden</h1>
          <p className="lead">Melde dich mit deinem Steam-Konto an.</p>

          {params.error && (
            <div className="notice error" role="alert">
              {ERRORS[params.error] ?? "Bei der Anmeldung ist etwas schiefgegangen."}
            </div>
          )}

          {steamId && !hasAccess && (
            <div className="notice" role="status">
              <strong>Angemeldet, aber ohne Zugang.</strong> Deine SteamID{" "}
              <span className="mono">{steamId}</span> ist noch nicht freigeschaltet. Ein
              Administrator muss dich im Panel eintragen.
            </div>
          )}

          {hasAccess ? (
            <Link className="login-btn primary" href="/">
              Weiter zur Übersicht
              <Icon name="arrowRight" size={17} />
            </Link>
          ) : (
            <a className="login-btn primary" href="/api/auth/steam">
              <Icon name="login" size={17} />
              Mit Steam anmelden
            </a>
          )}

          {steamId && (
            <a className="login-btn secondary" href="/api/auth/logout">
              Abmelden
            </a>
          )}

          {!hasAccess && (
            <p className="fine">
              Zugang erhältst du, sobald ein Administrator deine SteamID im Panel einträgt.
            </p>
          )}
        </div>

        <div className="login-roles">
          <span>Rollen:</span>
          <b>Leser</b>
          <span aria-hidden="true">·</span>
          <b>Bearbeiter</b>
          <span aria-hidden="true">·</span>
          <b>Administrator</b>
        </div>
      </main>

      <footer className="login-foot">{brandTitle(brand)} · Anmeldung über Steam</footer>
    </div>
  );
}
