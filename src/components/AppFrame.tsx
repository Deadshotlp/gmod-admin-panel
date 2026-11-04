"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Icon, { type IconName } from "./Icon";
import { NAV, findNav } from "./nav";
import ServerSwitcher from "./ServerSwitcher";

/**
 * Rahmen im Browser: Seitenleiste, Kopfzeile, Schnellsuche und Farbschema.
 *
 * Farbschema und eingeklappte Seitenleiste stehen als Attribute am <html>
 * (data-theme, data-sidebar) und im localStorage. Das Startskript im Root-Layout
 * setzt sie vor dem ersten Zeichnen; hier werden sie nur umgeschaltet. So gibt
 * es weder Aufblitzen noch Unterschiede zwischen Server und Browser.
 */

export interface FrameBrand {
  name: string;
  community: string;
  mark: string;
  logo: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  viewer: "Leser",
  editor: "Bearbeiter",
  admin: "Administrator",
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function BrandMark({ brand, size }: { brand: FrameBrand; size?: "sm" | "lg" }) {
  const className = ["brand-mark", size ?? "", brand.logo ? "has-logo" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={className} aria-hidden="true">
      {brand.logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- Logo aus public/, beliebiges Format
        <img src={brand.logo} alt="" />
      ) : (
        brand.mark
      )}
    </span>
  );
}

export function ThemeToggle() {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="Hell oder dunkel umschalten"
      title="Hell oder dunkel umschalten"
      onClick={() => {
        const root = document.documentElement;
        const next = root.dataset.theme === "light" ? "dark" : "light";
        root.dataset.theme = next;

        try {
          localStorage.setItem("panel-theme", next);
        } catch {
          // Ohne Speicher gilt die Wahl nur bis zum Neuladen.
        }
      }}
    >
      <Icon name="sun" className="when-dark" />
      <Icon name="moon" className="when-light" />
    </button>
  );
}

function ServerPill() {
  const [state, setState] = useState<"unknown" | "online" | "offline">("unknown");

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        const data = (await response.json()) as { status?: { online?: boolean } };

        if (!alive) return;
        setState(data.status ? (data.status.online ? "online" : "offline") : "unknown");
      } catch {
        if (alive) setState("unknown");
      }
    };

    void load();
    const timer = setInterval(() => void load(), 30_000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const label = state === "online" ? "Online" : state === "offline" ? "Offline" : "Status offen";

  return (
    <span className={`status-pill ${state}`} title="Serverstatus, alle 30 Sekunden aktualisiert">
      <span className={`dot${state === "online" ? " pulse" : ""}`} />
      {label}
    </span>
  );
}

interface FlatItem {
  href: string;
  label: string;
  icon: IconName;
  group?: string;
}

const FLAT: FlatItem[] = NAV.flatMap((section) =>
  section.items.map((item) => ({ ...item, group: section.group })),
);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const items = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return FLAT;

    return FLAT.filter((item) =>
      normalize(`${item.label} ${item.group ?? ""}`).includes(needle),
    );
  }, [query]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <div
      className="palette-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Bereich suchen">
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            placeholder="Bereich suchen …"
            aria-label="Bereich suchen"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[index] ? `palette-${index}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((value) => Math.min(items.length - 1, value + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((value) => Math.max(0, value - 1));
              } else if (event.key === "Enter" && items[index]) {
                event.preventDefault();
                go(items[index].href);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          />
          <span className="kbd">Esc</span>
        </div>

        {items.length === 0 ? (
          <div className="palette-empty">Kein Bereich gefunden.</div>
        ) : (
          <ul id="palette-list" role="listbox" className="palette-list">
            {items.map((item, position) => (
              <li key={item.href} role="none">
                <button
                  type="button"
                  id={`palette-${position}`}
                  role="option"
                  aria-selected={position === index}
                  className="palette-item"
                  onMouseEnter={() => setIndex(position)}
                  onClick={() => go(item.href)}
                >
                  <Icon name={item.icon} />
                  {item.label}
                  {item.group && <span className="group">{item.group}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function AppFrame({
  brand,
  user,
  servers,
  activeId,
  current,
  wide,
  children,
}: {
  brand: FrameBrand;
  user: { displayName: string; role: string };
  servers: Array<{ id: string; label: string }>;
  activeId: string;
  current: string;
  wide: boolean;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { group, item } = findNav(current);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleSidebar = () => {
    // Auf dem Handy klappt die Leiste als Schublade auf, sonst schmal/breit.
    if (window.matchMedia("(max-width: 900px)").matches) {
      setMenuOpen((open) => !open);
      return;
    }

    const root = document.documentElement;
    const collapsed = root.dataset.sidebar === "collapsed";

    if (collapsed) delete root.dataset.sidebar;
    else root.dataset.sidebar = "collapsed";

    try {
      localStorage.setItem("panel-sidebar", collapsed ? "open" : "collapsed");
    } catch {
      // Ohne Speicher gilt die Wahl nur bis zum Neuladen.
    }
  };

  return (
    <div className="layout" data-menu={menuOpen ? "open" : undefined}>
      <button
        type="button"
        className="scrim"
        aria-label="Menü schließen"
        tabIndex={menuOpen ? 0 : -1}
        onClick={() => setMenuOpen(false)}
      />

      <aside className="sidebar" aria-label="Hauptnavigation">
        <div className="sidebar-brand">
          <BrandMark brand={brand} />
          <div className="sidebar-brand-text">
            <strong>{brand.name}</strong>
            {brand.community && <span>{brand.community}</span>}
          </div>
          <button
            type="button"
            className="icon-btn ghost sidebar-close"
            aria-label="Menü schließen"
            onClick={() => setMenuOpen(false)}
          >
            <Icon name="x" />
          </button>
        </div>

        <ServerSwitcher servers={servers} activeId={activeId} />

        <nav className="sidebar-nav">
          {NAV.map((section, index) => (
            <div key={section.group ?? index} className="nav-group">
              {section.group && <div className="nav-group-title">{section.group}</div>}
              {section.items.map((entry) => {
                const active = current === entry.href;

                return (
                  <Link
                    key={entry.href}
                    href={entry.href}
                    title={entry.label}
                    aria-current={active ? "page" : undefined}
                    className={`nav-item${active ? " active" : ""}`}
                    onClick={() => setMenuOpen(false)}
                  >
                    <Icon name={entry.icon} />
                    <span className="nav-label">{entry.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="avatar" aria-hidden="true">
            {initialsOf(user.displayName)}
          </span>
          <div className="sidebar-user">
            <strong>{user.displayName}</strong>
            <span>{ROLE_LABEL[user.role] ?? user.role}</span>
          </div>
          <a
            className="icon-btn ghost"
            href="/api/auth/logout"
            aria-label="Abmelden"
            title="Abmelden"
          >
            <Icon name="logout" size={16} />
          </a>
        </div>
      </aside>

      <div className="frame">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn"
            aria-label="Navigation ein- oder ausblenden"
            title="Navigation ein- oder ausblenden"
            onClick={toggleSidebar}
          >
            <Icon name="panelLeft" className="only-desktop" />
            <Icon name="menu" className="only-mobile" />
          </button>

          <div className="topbar-brand">
            <BrandMark brand={brand} size="sm" />
            <span>{brand.name}</span>
          </div>

          <nav className="crumbs" aria-label="Pfad">
            {group && (
              <>
                <span>{group}</span>
                <span className="sep" aria-hidden="true">
                  /
                </span>
              </>
            )}
            <span className="current">{item?.label ?? "Übersicht"}</span>
          </nav>

          <div className="topbar-actions">
            <button type="button" className="search-trigger" onClick={() => setPaletteOpen(true)}>
              <Icon name="search" size={16} />
              <span>Bereich suchen …</span>
              <span className="kbd">Strg K</span>
            </button>
            <button
              type="button"
              className="icon-btn only-mobile"
              aria-label="Bereich suchen"
              onClick={() => setPaletteOpen(true)}
            >
              <Icon name="search" />
            </button>
            <ServerPill />
            <ThemeToggle />
          </div>
        </header>

        <main className={wide ? "main main-wide" : "main"}>{children}</main>
      </div>

      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
