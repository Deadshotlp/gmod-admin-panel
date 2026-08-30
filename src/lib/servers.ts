import { cookies } from "next/headers";

/**
 * Serververwaltung für mehrere Instanzen (Test und Live).
 *
 * Rückwärtskompatibel: sind keine zusätzlichen Server konfiguriert, entsteht
 * genau ein Eintrag aus den bisherigen DB_*- und PTERODACTYL_*-Variablen. Wer
 * nur einen Server betreibt, merkt von alldem nichts.
 *
 * Weitere Server über nummerierte Variablen:
 *   PANEL_SERVER_2_ID, _LABEL, _DB_HOST, _DB_PORT, _DB_USER, _DB_PASSWORD,
 *   _DB_NAME, _SERVER_KEY, _PTERODACTYL_URL, _PTERODACTYL_API_KEY,
 *   _PTERODACTYL_SERVER_ID
 */

const COOKIE_NAME = "swrp_server";

export interface ServerConfig {
  id: string;
  label: string;
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    connectionLimit: number;
  };
  serverKey: string;
  pterodactyl: { url: string; apiKey: string; serverId: string } | null;
}

function value(name: string, fallback = ""): string {
  const raw = process.env[name];
  return raw && raw.trim() !== "" ? raw.trim() : fallback;
}

function buildPterodactyl(
  url: string,
  apiKey: string,
  serverId: string,
): ServerConfig["pterodactyl"] {
  if (url === "" || apiKey === "" || serverId === "") return null;

  return { url: url.replace(/\/+$/, ""), apiKey, serverId };
}

let cached: ServerConfig[] | null = null;

export function getServers(): ServerConfig[] {
  if (cached) return cached;

  const list: ServerConfig[] = [];

  // Der erste Server kommt aus den bestehenden Variablen.
  const primaryDb = value("DB_NAME");

  if (primaryDb !== "") {
    list.push({
      id: value("SERVER_KEY", "main"),
      label: value("PANEL_SERVER_1_LABEL", "Hauptserver"),
      db: {
        host: value("DB_HOST", "127.0.0.1"),
        port: Number(value("DB_PORT", "3306")) || 3306,
        user: value("DB_USER"),
        password: value("DB_PASSWORD"),
        database: primaryDb,
        connectionLimit: Number(value("DB_CONNECTION_LIMIT", "5")) || 5,
      },
      serverKey: value("SERVER_KEY", "main"),
      pterodactyl: buildPterodactyl(
        value("PTERODACTYL_URL"),
        value("PTERODACTYL_API_KEY"),
        value("PTERODACTYL_SERVER_ID"),
      ),
    });
  }

  // Weitere Server, durchnummeriert ab 2. Die Suche endet beim ersten
  // Nummernblock ohne Datenbanknamen.
  for (let index = 2; index <= 10; index += 1) {
    const prefix = `PANEL_SERVER_${index}_`;
    const database = value(`${prefix}DB_NAME`);

    if (database === "") break;

    list.push({
      id: value(`${prefix}ID`, `server${index}`),
      label: value(`${prefix}LABEL`, `Server ${index}`),
      db: {
        host: value(`${prefix}DB_HOST`, "127.0.0.1"),
        port: Number(value(`${prefix}DB_PORT`, "3306")) || 3306,
        user: value(`${prefix}DB_USER`),
        password: value(`${prefix}DB_PASSWORD`),
        database,
        connectionLimit: Number(value(`${prefix}DB_CONNECTION_LIMIT`, "5")) || 5,
      },
      serverKey: value(`${prefix}SERVER_KEY`, value(`${prefix}ID`, `server${index}`)),
      pterodactyl: buildPterodactyl(
        value(`${prefix}PTERODACTYL_URL`),
        value(`${prefix}PTERODACTYL_API_KEY`),
        value(`${prefix}PTERODACTYL_SERVER_ID`),
      ),
    });
  }

  cached = list;

  return list;
}

export function getServerById(id: string | undefined): ServerConfig | null {
  if (!id) return null;

  return getServers().find((server) => server.id === id) ?? null;
}

/** Der aktive Server aus dem Cookie, sonst der erste konfigurierte. */
export async function getActiveServer(): Promise<ServerConfig> {
  const servers = getServers();

  if (servers.length === 0) {
    throw new Error(
      "Kein Server konfiguriert. Mindestens DB_HOST, DB_USER, DB_PASSWORD und DB_NAME setzen.",
    );
  }

  try {
    const store = await cookies();
    const selected = getServerById(store.get(COOKIE_NAME)?.value);

    if (selected) return selected;
  } catch {
    // Außerhalb eines Requests gibt es kein Cookie - dann der erste Server.
  }

  return servers[0];
}

export async function setActiveServer(id: string): Promise<boolean> {
  if (!getServerById(id)) return false;

  const store = await cookies();

  store.set(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return true;
}

export function hasMultipleServers(): boolean {
  return getServers().length > 1;
}
