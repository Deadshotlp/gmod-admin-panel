import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";
import { RELOAD_AREAS, sendConsoleCommand } from "@/lib/pterodactyl";

/**
 * Eingriffe am laufenden Server.
 *
 * Es wird bewusst KEIN freier Konsolenbefehl durchgereicht. Der Client wählt
 * eine Aktion aus einer festen Liste, die Argumente werden hier geprüft und der
 * Befehl serverseitig zusammengesetzt. Sonst wäre das eine Fernsteuerung für
 * beliebige Serverbefehle.
 */

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reload"),
    area: z.enum(RELOAD_AREAS),
  }),
  z.object({
    action: z.literal("status"),
  }),
  z.object({
    action: z.literal("say"),
    text: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal("kick"),
    steamId: z.string().regex(/^\d{17}$/, "Keine gültige SteamID64"),
    reason: z.string().max(120).optional(),
  }),
  z.object({
    action: z.literal("defcon"),
    level: z.number().int().min(0).max(5),
    text: z.string().max(150).optional(),
  }),
]);

/** Zeilenumbrüche und Anführungszeichen raus - sonst bricht der Befehl auf. */
function clean(value: string): string {
  return value.replace(/["\r\n]+/g, " ").trim();
}

export async function POST(request: Request) {
  let user;

  try {
    user = await requireUser("editor");
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }

  if (!checkRateLimit(rateLimitKey(request, "server-command"), 30, 60_000)) {
    return NextResponse.json({ error: "Zu viele Befehle" }, { status: 429 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe", detail: parsed.error.issues },
      { status: 400 },
    );
  }

  const input = parsed.data;

  // Eingriffe am laufenden Server sind Adminsache, reines Nachladen nicht.
  const needsAdmin =
    input.action === "say" || input.action === "kick" || input.action === "defcon";

  if (needsAdmin) {
    try {
      user = await requireUser("admin");
    } catch (error) {
      if (error instanceof AuthError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }

      throw error;
    }
  }

  let command: string;

  switch (input.action) {
    case "reload":
      command = `pd_reload ${input.area}`;
      break;
    case "status":
      command = "pd_status";
      break;
    case "say":
      command = `pd_admin_say ${clean(input.text)}`;
      break;
    case "kick":
      command = `pd_admin_kick ${input.steamId} ${clean(input.reason ?? "Kein Grund angegeben")}`;
      break;
    case "defcon":
      command = `pd_defcon ${input.level} ${clean(input.text ?? "")}`.trim();
      break;
  }

  const result = await sendConsoleCommand(command);

  await writeAudit({
    user,
    action: `server.${input.action}`,
    targetType: "server",
    targetKey: input.action === "reload" ? input.area : input.action,
    after: input,
    note: result.ok ? "zugestellt" : result.message,
  });

  return NextResponse.json(
    { ok: result.ok, message: result.message, command },
    { status: result.ok ? 200 : 502 },
  );
}
