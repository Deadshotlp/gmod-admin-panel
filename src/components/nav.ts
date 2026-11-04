import type { IconName } from "./Icon";

/**
 * Seitenleiste in Gruppen; Reihenfolge = Häufigkeit der Nutzung. Dieselbe
 * Liste speist die Schnellsuche (Strg + K).
 */

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export interface NavSection {
  group?: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  { items: [{ href: "/", label: "Übersicht", icon: "dashboard" }] },
  {
    group: "Spieler",
    items: [
      { href: "/spieler", label: "Spieler & Charaktere", icon: "users" },
      { href: "/jobs", label: "Jobs & Einheiten", icon: "network" },
      { href: "/fortbildungen", label: "Fortbildungen", icon: "cap" },
      { href: "/charakter", label: "Charakter-Einstellungen", icon: "userCog" },
    ],
  },
  {
    group: "Raumflotte",
    items: [
      { href: "/strategie", label: "Strategieansicht", icon: "map" },
      { href: "/feldzug", label: "Galaktischer Feldzug", icon: "flag" },
      { href: "/flotte", label: "Flottenkommando", icon: "rocket" },
      { href: "/raumflotte", label: "Raumflotte: Konfiguration", icon: "sliders" },
    ],
  },
  {
    group: "Ausrüstung & Fahrzeuge",
    items: [
      { href: "/waffen", label: "Waffen & Gewichte", icon: "crosshair" },
      { href: "/arccw", label: "ArcCW-Schaden", icon: "gauge" },
      { href: "/fahrzeuge", label: "Fahrzeuginventar", icon: "truck" },
      { href: "/kisten", label: "Transportkisten", icon: "package" },
    ],
  },
  {
    group: "Kommunikation",
    items: [{ href: "/funk", label: "Funk", icon: "radio" }],
  },
  {
    group: "Verwaltung",
    items: [
      { href: "/bugreports", label: "Bug Reports", icon: "bug" },
      { href: "/logs", label: "Admin-Logs", icon: "scroll" },
      { href: "/audit", label: "Änderungsprotokoll", icon: "history" },
      { href: "/werkzeuge", label: "Werkzeuge & Sicherungen", icon: "wrench" },
      { href: "/benutzer", label: "Panel-Benutzer", icon: "shieldUser" },
    ],
  },
];

/** Gruppe und Eintrag zu einem Pfad, für die Brotkrume. */
export function findNav(href: string): { group?: string; item?: NavItem } {
  for (const section of NAV) {
    const item = section.items.find((entry) => entry.href === href);
    if (item) return { group: section.group, item };
  }

  return {};
}
