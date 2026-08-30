import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  listPanelUsers,
  removePanelUser,
  requireUser,
  upsertPanelUser,
} from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { bootstrapSteamIds } from "@/lib/env";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    steamId: z.string().regex(/^\d{17}$/, "Keine gültige SteamID64"),
    displayName: z.string().min(1).max(128),
    role: z.enum(["viewer", "editor", "admin"]),
  }),
  z.object({
    action: z.literal("remove"),
    steamId: z.string().regex(/^\d{17}$/),
  }),
]);

function fail(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[users] Fehler:", error);
  return NextResponse.json({ error: "Datenbank nicht erreichbar" }, { status: 503 });
}

export async function GET() {
  try {
    await requireUser("admin");

    return NextResponse.json({
      users: await listPanelUsers(),
      bootstrap: bootstrapSteamIds(),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  let actor;

  try {
    actor = await requireUser("admin");
  } catch (error) {
    return fail(error);
  }

  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe", detail: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;

  // Sich selbst die Rechte zu nehmen sperrt einen aus. Bootstrap-Accounts sind
  // davon nicht betroffen, die kommen über die Umgebungsvariable immer rein.
  if (
    data.steamId === actor.steamId &&
    !actor.isBootstrap &&
    (data.action === "remove" || data.role !== "admin")
  ) {
    return NextResponse.json(
      { error: "Du kannst dir nicht selbst die Adminrechte entziehen" },
      { status: 400 },
    );
  }

  try {
    if (data.action === "save") {
      await upsertPanelUser(data.steamId, data.displayName, data.role, actor.steamId);
    } else {
      await removePanelUser(data.steamId);
    }

    await writeAudit({
      user: actor,
      action: `users.${data.action}`,
      targetType: "panel_user",
      targetKey: data.steamId,
      after: data.action === "save" ? data : null,
    });

    return NextResponse.json({
      ok: true,
      users: await listPanelUsers(),
      bootstrap: bootstrapSteamIds(),
    });
  } catch (error) {
    return fail(error);
  }
}
