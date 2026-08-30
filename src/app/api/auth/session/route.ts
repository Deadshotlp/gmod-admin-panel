import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSessionSteamId } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Wer bin ich? Unterscheidet drei Fälle, damit die Oberfläche eine sinnvolle
 * Meldung zeigen kann: nicht angemeldet, angemeldet aber ohne Zugang, oder
 * angemeldet mit Rolle.
 */
export async function GET() {
  const steamId = await getSessionSteamId();

  if (!steamId) {
    return NextResponse.json({ state: "anonymous" });
  }

  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ state: "no_access", steamId });
    }

    return NextResponse.json({ state: "ok", user });
  } catch (error) {
    return NextResponse.json(
      { state: "error", message: (error as Error).message },
      { status: 503 },
    );
  }
}
