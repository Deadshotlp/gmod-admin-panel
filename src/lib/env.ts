/**
 * Zentraler Zugriff auf die Umgebungsvariablen.
 *
 * Fehlende Werte werden hier gemeldet statt irgendwo tief in einer Route mit
 * einem unverständlichen Fehler aufzuschlagen. Nichts davon darf im Browser
 * landen - alle Aufrufer sind serverseitig.
 */

function required(name: string): string {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(
      `Umgebungsvariable ${name} fehlt. Trage sie in der .env ein (Vorlage: .env.example).`,
    );
  }

  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value || value.trim() === "") return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Prüft ohne zu werfen, ob ein Bereich konfiguriert ist. */
export function hasEnv(...names: string[]): boolean {
  return names.every((name) => {
    const value = process.env[name];
    return typeof value === "string" && value.trim() !== "";
  });
}

export function missingEnv(...names: string[]): string[] {
  return names.filter((name) => {
    const value = process.env[name];
    return !value || value.trim() === "";
  });
}

export const dbEnv = () => ({
  host: required("DB_HOST"),
  port: optionalNumber("DB_PORT", 3306),
  user: required("DB_USER"),
  password: required("DB_PASSWORD"),
  database: required("DB_NAME"),
  connectionLimit: optionalNumber("DB_CONNECTION_LIMIT", 5),
});

export const DB_ENV_KEYS = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];

export const sessionSecret = () => required("SESSION_SECRET");
export const steamApiKey = () => optional("STEAM_API_KEY", "");
export const panelUrl = () => optional("PANEL_URL", "http://localhost:3001");
export const serverKey = () => optional("SERVER_KEY", "main");

export const bootstrapSteamIds = (): string[] =>
  optional("PANEL_BOOTSTRAP_STEAM_IDS", "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d{17}$/.test(id));

export const pterodactylEnv = () => ({
  url: required("PTERODACTYL_URL").replace(/\/+$/, ""),
  apiKey: required("PTERODACTYL_API_KEY"),
  serverId: required("PTERODACTYL_SERVER_ID"),
});

export const PTERODACTYL_ENV_KEYS = [
  "PTERODACTYL_URL",
  "PTERODACTYL_API_KEY",
  "PTERODACTYL_SERVER_ID",
];
