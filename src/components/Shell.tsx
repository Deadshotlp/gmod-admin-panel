import Link from "next/link";
import type { PanelUser } from "@/lib/auth";

/**
 * Rahmen mit Seitenleiste. Bereiche, die noch nicht gebaut sind, stehen bewusst
 * schon in der Navigation - ausgegraut, damit sichtbar ist was noch kommt.
 */

const NAV: Array<{ href: string; label: string; ready: boolean }> = [
  { href: "/", label: "Übersicht", ready: true },
  { href: "/jobs", label: "Jobs & Einheiten", ready: false },
  { href: "/fortbildungen", label: "Fortbildungen", ready: false },
  { href: "/waffen", label: "Waffen & Gewichte", ready: false },
  { href: "/spieler", label: "Spieler & Charaktere", ready: false },
  { href: "/strafakten", label: "Strafakten", ready: false },
  { href: "/audit", label: "Änderungsprotokoll", ready: false },
  { href: "/benutzer", label: "Panel-Benutzer", ready: false },
];

const ROLE_LABEL: Record<string, string> = {
  viewer: "Leser",
  editor: "Bearbeiter",
  admin: "Administrator",
};

export default function Shell({
  user,
  current,
  children,
}: {
  user: PanelUser;
  current: string;
  children: React.ReactNode;
}) {
  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="sidebar-brand">
          <strong>Serververwaltung</strong>
          <span>Star Wars RP</span>
        </div>

        {NAV.map((item) =>
          item.ready ? (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${current === item.href ? " active" : ""}`}
            >
              {item.label}
            </Link>
          ) : (
            <span key={item.href} className="nav-item disabled">
              {item.label}
            </span>
          ),
        )}

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
