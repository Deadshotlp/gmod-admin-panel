import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { getConsoleSocket, sendConsoleCommand } from "@/lib/pterodactyl";
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

/**
 * Freier Konsolenbefehl - nur für Admins und immer im Änderungsprotokoll.
 *
 * Admins haben über Pelican ohnehin Konsolenzugriff; hier bekommen sie ihn im
 * Panel, aber nachvollziehbar. Eine Zeile, keine Steuerzeichen.
 */
export async function POST(request: Request) {
  let user;

  try {
    user = await requireUser("admin");
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Nicht verfügbar" }, { status: 503 });
  }

  if (!checkRateLimit(rateLimitKey(request, "console-command"), 30, 60_000)) {
    return NextResponse.json({ error: "Zu viele Befehle" }, { status: 429 });
  }

  let body: { command?: unknown };

  try {
    body = (await request.json()) as { command?: unknown };
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const command =
    typeof body.command === "string"
      ? body.command.replace(/[\r\n\u0000-\u001f]+/g, " ").trim()
      : "";

  if (command === "" || command.length > 300) {
    return NextResponse.json({ error: "Befehl fehlt oder ist zu lang" }, { status: 400 });
  }

  const result = await sendConsoleCommand(command);

  await writeAudit({
    user,
    action: "server.console",
    targetType: "server",
    targetKey: command.split(" ")[0],
    after: { command },
    note: result.ok ? "zugestellt" : result.message,
  });

  return NextResponse.json(
    { ok: result.ok, message: result.message },
    { status: result.ok ? 200 : 502 },
  );
}
