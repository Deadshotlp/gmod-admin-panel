import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { getServers, setActiveServer } from "@/lib/servers";

export const dynamic = "force-dynamic";

/** Zwischen konfigurierten Servern umschalten. */
export async function POST(request: Request) {
  try {
    await requireUser("viewer");
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Nicht verfügbar" }, { status: 503 });
  }

  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const parsed = z.object({ id: z.string().min(1).max(64) }).safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  if (!(await setActiveServer(parsed.data.id))) {
    return NextResponse.json({ error: "Unbekannter Server" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    servers: getServers().map((server) => ({ id: server.id, label: server.label })),
  });
}
