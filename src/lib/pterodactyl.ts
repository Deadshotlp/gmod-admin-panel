import { getActiveServer, type ServerConfig } from "./servers";

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

/**
 * Fehlerbeschreibung aus einer abgelehnten Antwort ziehen.
 *
 * Pterodactyl und Pelican antworten mit {"errors":[{"code":..., "detail":...}]}.
 * Genau dieses Feld unterscheidet die Ursachen voneinander - ohne es sieht jeder
 * 403 gleich aus. Kommt kein JSON zurück, steht meist ein Proxy davor.
 */
async function describeError(response: Response): Promise<string> {
  let code = "";
  let detail = "";

  try {
    const body = (await response.json()) as {
      errors?: Array<{ code?: string; detail?: string }>;
    };

    const first = body.errors?.[0];
    code = first?.code ?? "";
    detail = first?.detail ?? "";
  } catch {
    // Keine JSON-Antwort: dann kommt der Fehler nicht von Pterodactyl selbst,
    // sondern von etwas davor (Cloudflare, Reverse Proxy, WAF).
  }

  const parts = [`HTTP ${response.status}`];
  if (code !== "") parts.push(code);
  if (detail !== "") parts.push(detail);

  return parts.join(" - ");
}

/**
 * Die drei Ursachen, die hinter einem 401/403 der Client-API stecken. Der
 * Schlüssel selbst wird nie ausgegeben, nur seine Bauart.
 */
function rejectionHint(apiKey: string): string {
  if (apiKey.startsWith("ptla_")) {
    return (
      "Der hinterlegte Schlüssel ist ein Application-Key (ptla_). Die Client-API " +
      "nimmt nur Client-Keys an - zu finden unter Account-Einstellungen, nicht im " +
      "Admin-Bereich."
    );
  }

  return (
    "Mögliche Ursachen: (1) es ist ein Application-Key statt eines Client-Keys, " +
    "(2) am Schlüssel ist eine IP-Beschränkung gesetzt, die die IP des Panels " +
    "nicht enthält, (3) der Account ist nicht Besitzer des Servers und hat kein " +
    "Recht auf die Konsole."
  );
}

export async function isPterodactylConfigured(): Promise<boolean> {
  return (await getActiveServer()).pterodactyl !== null;
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
  server?: ServerConfig,
): Promise<CommandResult> {
  const target = server ?? (await getActiveServer());

  if (!target.pterodactyl) {
    return {
      ok: false,
      message: `Für "${target.label}" ist keine Pterodactyl-Anbindung hinterlegt`,
    };
  }

  const { url, apiKey, serverId } = target.pterodactyl;

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
      return {
        ok: false,
        message:
          `Pterodactyl lehnt den Zugriff ab (${await describeError(response)}). ` +
          rejectionHint(apiKey),
      };
    }

    if (response.status === 404) {
      return { ok: false, message: "Server-ID bei Pterodactyl nicht gefunden" };
    }

    if (response.status === 409) {
      return { ok: false, message: "Server läuft gerade nicht" };
    }

    return {
      ok: false,
      message: `Pterodactyl antwortete mit ${await describeError(response)}`,
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

/**
 * Zugangsdaten für den Konsolen-Websocket.
 *
 * Pterodactyl gibt dafür ein kurzlebiges Token aus, das der Browser direkt
 * benutzt. Der eigentliche API-Schlüssel bleibt hier und geht nie mit.
 */
export async function getConsoleSocket(
  server?: ServerConfig,
): Promise<{ ok: boolean; socket?: string; token?: string; message?: string }> {
  const target = server ?? (await getActiveServer());

  if (!target.pterodactyl) {
    return { ok: false, message: "Keine Pterodactyl-Anbindung hinterlegt" };
  }

  const { url, apiKey, serverId } = target.pterodactyl;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(
      `${url}/api/client/servers/${serverId}/websocket`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const described = await describeError(response);

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          message: `Pterodactyl lehnt den Zugriff ab (${described}). ${rejectionHint(apiKey)}`,
        };
      }

      return { ok: false, message: `Pterodactyl antwortete mit ${described}` };
    }

    const data = (await response.json()) as {
      data?: { socket?: string; token?: string };
    };

    if (!data.data?.socket || !data.data.token) {
      return { ok: false, message: "Unerwartete Antwort von Pterodactyl" };
    }

    return { ok: true, socket: data.data.socket, token: data.data.token };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      return { ok: false, message: "Pterodactyl antwortet nicht" };
    }

    return { ok: false, message: "Pterodactyl ist nicht erreichbar" };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Kurzer Selbsttest der Anbindung, ohne etwas am Server auszulösen.
 *
 * Fragt nur die Serverdaten ab. Das ist derselbe Rechteweg wie beim Absetzen
 * eines Befehls, hat aber keine Wirkung - taugt also für die Diagnose.
 */
export async function probePterodactyl(
  server?: ServerConfig,
): Promise<{ ok: boolean; detail: string }> {
  const target = server ?? (await getActiveServer());

  if (!target.pterodactyl) {
    return { ok: false, detail: "nicht konfiguriert" };
  }

  const { url, apiKey, serverId } = target.pterodactyl;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${url}/api/client/servers/${serverId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });

    if (response.ok) {
      return { ok: true, detail: "Schlüssel und Server-ID gültig" };
    }

    const described = await describeError(response);

    if (response.status === 401 || response.status === 403) {
      return { ok: false, detail: `${described}. ${rejectionHint(apiKey)}` };
    }

    if (response.status === 404) {
      return {
        ok: false,
        detail: `${described}. PTERODACTYL_SERVER_ID passt zu keinem Server dieses Accounts.`,
      };
    }

    return { ok: false, detail: described };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      return { ok: false, detail: "keine Antwort innerhalb von 10 Sekunden" };
    }

    return { ok: false, detail: "nicht erreichbar - stimmt PTERODACTYL_URL?" };
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

export function reloadServer(
  area: ReloadArea,
  server?: ServerConfig,
): Promise<CommandResult> {
  return sendConsoleCommand(`pd_reload ${area}`, server);
}
