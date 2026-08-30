import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { listAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireUser("viewer");
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[audit] Fehler:", error);
    return NextResponse.json({ error: "Datenbank nicht erreichbar" }, { status: 503 });
  }

  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);

  try {
    // Vorher/Nachher können ganze Jobbäume sein - die schickt niemand in eine
    // Übersichtsliste. Hier nur die Kopfdaten.
    const entries = (await listAudit(limit)).map((entry) => ({
      id: entry.id,
      displayName: entry.displayName,
      steamId: entry.steamId,
      action: entry.action,
      targetType: entry.targetType,
      targetKey: entry.targetKey,
      note: entry.note,
      createdAt: entry.createdAt,
      hasDetail: entry.before !== null || entry.after !== null,
    }));

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("[audit] Abfrage fehlgeschlagen:", error);
    return NextResponse.json({ error: "Abfrage fehlgeschlagen" }, { status: 503 });
  }
}
