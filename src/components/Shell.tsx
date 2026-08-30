import Link from "next/link";
import type { PanelUser } from "@/lib/auth";
import { getActiveServer, getServers } from "@/lib/servers";
import ServerSwitcher from "./ServerSwitcher";

/**
 * Rahmen mit Seitenleiste.
 */

const NAV: Array<{ href: string; label: string }> = [
  { href: "/", label: "Übersicht" },
  { href: "/jobs", label: "Jobs & Einheiten" },
  { href: "/fortbildungen", label: "Fortbildungen" },
  { href: "/waffen", label: "Waffen & Gewichte" },
  { href: "/spieler", label: "Spieler & Charaktere" },
  { href: "/werkzeuge", label: "Werkzeuge" },
  { href: "/audit", label: "Änderungsprotokoll" },
  { href: "/benutzer", label: "Panel-Benutzer" },
];

const ROLE_LABEL: Record<string, string> = {
  viewer: "Leser",
  editor: "Bearbeiter",
  admin: "Administrator",
};

export default async function Shell({
  user,
  current,
  children,
}: {
  user: PanelUser;
  current: string;
  children: React.ReactNode;
}) {
  const servers = getServers().map((server) => ({
    id: server.id,
    label: server.label,
  }));

  let activeId = servers[0]?.id ?? "";

  try {
    activeId = (await getActiveServer()).id;
  } catch {
    // Ohne Konfiguration bleibt es beim ersten Eintrag
  }

  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="sidebar-brand">
          <strong>Serververwaltung</strong>
          <span>Star Wars RP</span>
        </div>

        <ServerSwitcher servers={servers} activeId={activeId} />

        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item${current === item.href ? " active" : ""}`}
          >
            {item.label}
          </Link>
        ))}

        <div className="sidebar-foot">
          <div>{user.displayName}</div>
          <div>{ROLE_LABEL[user.role] ?? user.role}</div>
          <p style={{ marginTop: 8 }}>
            <a href="/api/auth/logout">Abmelden</a>
          </p>
        </div>
      </nav>

      <main className="main">{children}</main>
    </div>
  );
}
