import type { CSSProperties } from "react";

/**
 * Name und Erscheinungsbild des Panels.
 *
 * Das Panel läuft bei verschiedenen Communities. Alles, was eine Community
 * erkennbar macht, kommt deshalb aus der .env - im Code steht nichts davon:
 *
 *   PANEL_NAME       Titel in Seitenleiste und Login (Standard: Serververwaltung)
 *   PANEL_COMMUNITY  Name der Community, steht unter dem Titel (optional)
 *   PANEL_MARK       Kürzel im Logo-Feld, 1-3 Zeichen (Standard: aus dem Namen)
 *   PANEL_LOGO       Logo-Datei unter public/, z. B. /logo.svg (optional)
 *   PANEL_ACCENT     Akzentfarbe als #rrggbb (Standard: Violett)
 *
 * Nur serverseitig lesen - der Browser bekommt die fertigen Werte als Props.
 */

export interface Brand {
  name: string;
  community: string;
  mark: string;
  logo: string | null;
  accent: string | null;
}

const DEFAULT_NAME = "Serververwaltung";

function env(name: string): string {
  const raw = process.env[name];
  return raw ? raw.trim() : "";
}

function initials(text: string): string {
  const words = text.split(/[\s\-_]+/).filter(Boolean);

  if (words.length === 0) return "SV";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

export function getBrand(): Brand {
  const name = env("PANEL_NAME") || DEFAULT_NAME;
  const community = env("PANEL_COMMUNITY");
  const markEnv = env("PANEL_MARK").slice(0, 3);
  const logo = env("PANEL_LOGO");
  const accent = env("PANEL_ACCENT");

  let mark = markEnv;

  if (!mark) {
    if (community) mark = initials(community);
    else if (name === DEFAULT_NAME) mark = "SV";
    else mark = initials(name);
  }

  return {
    name,
    community,
    mark,
    // Nur Pfade auf dem eigenen Server: die Content-Security-Policy lässt
    // fremde Bildquellen nicht zu.
    logo: logo.startsWith("/") && !logo.startsWith("//") ? logo : null,
    accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : null,
  };
}

/** Überschreibt die Akzentfarbe am Wurzelelement, falls gesetzt. */
export function accentStyle(brand: Brand): CSSProperties | undefined {
  if (!brand.accent) return undefined;

  return {
    "--accent": brand.accent,
    "--accent-fill": brand.accent,
    "--accent-tint": `color-mix(in srgb, ${brand.accent} 15%, transparent)`,
  } as CSSProperties;
}

/** Titel für Browser-Tab und Login. */
export function brandTitle(brand: Brand): string {
  return brand.community ? `${brand.name} · ${brand.community}` : brand.name;
}
