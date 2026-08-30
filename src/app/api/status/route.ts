import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { DB_ENV_KEYS, missingEnv } from "@/lib/env";
import {
  getOnlinePlayers,
  getServerStatus,
  heartbeatTablesExist,
} from "@/lib/serverStatus";
import { isPterodactylConfigured, pterodactylMissing } from "@/lib/pterodactyl";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser("viewer");
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }

  const dbMissing = missingEnv(...DB_ENV_KEYS);

  if (dbMissing.length > 0) {
    return NextResponse.json(
      {
        error: `Datenbank nicht konfiguriert (fehlt: ${dbMissing.join(", ")})`,
      },
      { status: 503 },
    );
  }

  try {
    if (!(await heartbeatTablesExist())) {
      return NextResponse.json({
        configured: false,
        hint:
          "Die Tabellen pd_server_status und pd_online_players fehlen noch. " +
          "Sie entstehen beim ersten Start des Gamemodes mit dem Modul admin/module/remote.",
        pterodactyl: {
          configured: isPterodactylConfigured(),
          missing: pterodactylMissing(),
        },
      });
    }

    const [status, players] = await Promise.all([
      getServerStatus(),
      getOnlinePlayers(),
    ]);

    return NextResponse.json({
      configured: true,
      status,
      players,
      pterodactyl: {
        configured: isPterodactylConfigured(),
        missing: pterodactylMissing(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Datenbank nicht erreichbar",
        detail: (error as Error).message,
      },
      { status: 503 },
    );
  }
}
