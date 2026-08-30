import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { getConsoleSocket } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Zugangsdaten für den Konsolen-Websocket.
 *
 * Pterodactyl gibt dafür ein kurzlebiges Token aus, mit dem der Browser sich
 * direkt verbindet. Der eigentliche API-Schlüssel bleibt serverseitig.
 *
 * Adminrecht ist Absicht: über die Konsole sieht man alles, was auf dem Server
 * passiert, inklusive Chat und Fehlermeldungen.
 */
export async function GET(request: Request) {
  try {
    await requireUser("admin");
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Nicht verfügbar" }, { status: 503 });
  }

  if (!checkRateLimit(rateLimitKey(request, "console-token"), 20, 60_000)) {
    return NextResponse.json({ error: "Zu viele Anfragen" }, { status: 429 });
  }

  const result = await getConsoleSocket();

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 502 });
  }

  return NextResponse.json({ socket: result.socket, token: result.token });
}
