import { PTERODACTYL_ENV_KEYS, missingEnv, pterodactylEnv } from "./env";

/**
 * Anbindung an die Pterodactyl-Client-API.
 *
 * GMod nimmt keine eingehenden Verbindungen an. Der einzige Weg, den laufenden
 * Server von außen anzustoßen, führt über die Serverkonsole - und die erreichen
 * wir über das Hosting-Panel.
 *
 * Der API-Schlüssel bleibt serverseitig und wird nie an den Browser gegeben.
 */

export interface CommandResult {
  ok: boolean;
  /** Für die Anzeige im UI, bewusst auf Deutsch und ohne technische Details. */
  message: string;
}

export function isPterodactylConfigured(): boolean {
  return missingEnv(...PTERODACTYL_ENV_KEYS).length === 0;
}

export function pterodactylMissing(): string[] {
  return missingEnv(...PTERODACTYL_ENV_KEYS);
}

/**
 * Schickt einen Befehl an die Serverkonsole.
 *
 * Pterodactyl antwortet mit 204 und liefert KEINE Konsolenausgabe zurück - die
 * gibt es nur über den Websocket. Ein "ok" heißt hier also: der Befehl wurde
 * zugestellt, nicht: er hat funktioniert. Das Ergebnis prüft man über den
 * Heartbeat in pd_server_status.
 */
export async function sendConsoleCommand(
  command: string,
): Promise<CommandResult> {
  const missing = pterodactylMissing();

  if (missing.length > 0) {
    return {
      ok: false,
      message: `Pterodactyl ist nicht konfiguriert (fehlt: ${missing.join(", ")})`,
    };
  }

  const { url, apiKey, serverId } = pterodactylEnv();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(
      `${url}/api/client/servers/${serverId}/command`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ command }),
        signal: controller.signal,
        cache: "no-store",
      },
    );

    if (response.status === 204 || response.ok) {
      return { ok: true, message: "Befehl an den Server geschickt" };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: "Pterodactyl lehnt den API-Schlüssel ab" };
    }

    if (response.status === 404) {
      return { ok: false, message: "Server-ID bei Pterodactyl nicht gefunden" };
    }

    if (response.status === 409) {
      return { ok: false, message: "Server läuft gerade nicht" };
    }

    return {
      ok: false,
      message: `Pterodactyl antwortete mit ${response.status}`,
    };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      return { ok: false, message: "Pterodactyl antwortet nicht (Zeitüberschreitung)" };
    }

    return { ok: false, message: "Pterodactyl ist nicht erreichbar" };
  } finally {
    clearTimeout(timeout);
  }
}

/** Bereiche, die pd_reload auf dem Server kennt. */
export const RELOAD_AREAS = [
  "jobs",
  "fortbildung",
  "waffen",
  "fraktionen",
  "armor",
  "spawns",
  "all",
] as const;

export type ReloadArea = (typeof RELOAD_AREAS)[number];

export function isReloadArea(value: unknown): value is ReloadArea {
  return (
    typeof value === "string" && (RELOAD_AREAS as readonly string[]).includes(value)
  );
}

export function reloadServer(area: ReloadArea): Promise<CommandResult> {
  return sendConsoleCommand(`pd_reload ${area}`);
}
