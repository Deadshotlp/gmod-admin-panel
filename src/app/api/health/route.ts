import { NextResponse } from "next/server";
import { DB_ENV_KEYS, missingEnv } from "@/lib/env";
import { getActiveServer } from "@/lib/servers";
import { getPool } from "@/lib/db";
import { getSessionSteamId } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Diagnose ohne Anmeldung.
 *
 * Prüft jeden Schritt einzeln mit eigener Zeitbegrenzung und meldet, wo es
 * hängt. Bewusst frei zugänglich, aber ohne jede inhaltliche Information: keine
 * Zugangsdaten, keine Namen, keine Serverdaten - nur ob ein Schritt geklappt hat
 * und wie lange er gedauert hat.
 */

interface Step {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

async function timed<T>(
  name: string,
  timeoutMs: number,
  fn: () => Promise<T>,
): Promise<{ step: Step; value: T | null }> {
  const started = Date.now();

  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Zeitüberschreitung nach ${timeoutMs} ms`)),
          timeoutMs,
        ),
      ),
    ]);

    return {
      step: { name, ok: true, ms: Date.now() - started },
      value,
    };
  } catch (error) {
    return {
      step: {
        name,
        ok: false,
        ms: Date.now() - started,
        detail: (error as Error).message,
      },
      value: null,
    };
  }
}

export async function GET() {
  const steps: Step[] = [];

  // 1. Konfiguration
  const missing = missingEnv(...DB_ENV_KEYS, "SESSION_SECRET");

  steps.push({
    name: "konfiguration",
    ok: missing.length === 0,
    ms: 0,
    detail: missing.length > 0 ? `fehlt: ${missing.join(", ")}` : undefined,
  });

  if (missing.length > 0) {
    return NextResponse.json({ ok: false, steps }, { status: 503 });
  }

  // 2. Session lesbar
  const session = await timed("session-cookie", 2_000, async () =>
    getSessionSteamId(),
  );
  steps.push({
    ...session.step,
    detail: session.value ? "angemeldet" : "nicht angemeldet",
  });

  // 3. Verbindung zur Datenbank
  const connection = await timed("db-verbindung", 12_000, async () => {
    const pool = await getPool();
    const conn = await pool.getConnection();
    try {
      await conn.ping();
    } finally {
      conn.release();
    }
    return true;
  });
  steps.push(connection.step);

  if (!connection.step.ok) {
    return NextResponse.json({ ok: false, steps }, { status: 503 });
  }

  // 4. Panel-Tabellen
  const panelTables = await timed("panel-tabellen", 12_000, async () => {
    const pool = await getPool();
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS c FROM information_schema.tables " +
        "WHERE table_schema = DATABASE() AND table_name IN ('pd_panel_users', 'pd_panel_audit')",
    );
    return Number((rows as Array<{ c: number }>)[0]?.c ?? 0);
  });
  steps.push({
    ...panelTables.step,
    detail: `${panelTables.value ?? 0} von 2 vorhanden`,
  });

  // 5. Heartbeat-Tabellen des Gamemodes
  const gameTables = await timed("gamemode-tabellen", 12_000, async () => {
    const pool = await getPool();
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS c FROM information_schema.tables " +
        "WHERE table_schema = DATABASE() AND table_name IN ('pd_server_status', 'pd_online_players')",
    );
    return Number((rows as Array<{ c: number }>)[0]?.c ?? 0);
  });
  steps.push({
    ...gameTables.step,
    detail:
      gameTables.value === 2
        ? "vorhanden"
        : "fehlen - das Gamemode-Modul admin/module/remote lief noch nie",
  });

  return NextResponse.json({
    ok: steps.every((step) => step.ok),
    serverKey: (await getActiveServer()).serverKey,
    steps,
  });
}
