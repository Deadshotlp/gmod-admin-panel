import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";
import { getActiveServer } from "@/lib/servers";

export const dynamic = "force-dynamic";

/**
 * Admin-Logs aus pd_admin_logs (schreibt das Gamemode-Modul admin/module/logs
 * gebündelt alle 30 Sekunden). Nur lesen, nur Admins - die Logs enthalten
 * Chat, Admin-Aktionen und Spielernamen.
 *
 * Filter (Query-Parameter): typ, q (Text), from/to (YYYY-MM-DD), page
 */

const PAGE_SIZE = 100;

function dayStart(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00`);
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

export async function GET(request: Request) {
  try {
    await requireUser("admin");
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Nicht verfügbar" }, { status: 503 });
  }

  if (!checkRateLimit(rateLimitKey(request, "logs-read"), 60, 60_000)) {
    return NextResponse.json({ error: "Zu viele Anfragen" }, { status: 429 });
  }

  try {
    const exists = await query<{ c: number }>(
      "SELECT COUNT(*) AS c FROM information_schema.tables " +
        "WHERE table_schema = DATABASE() AND table_name = 'pd_admin_logs'",
    );

    if (Number(exists[0]?.c ?? 0) === 0) {
      return NextResponse.json({
        configured: false,
        hint:
          "Die Tabelle pd_admin_logs fehlt. Sie entsteht beim ersten Start des Gamemodes " +
          "mit dem aktualisierten Log-Modul; Einträge kommen ab dann alle 30 Sekunden dazu.",
      });
    }

    const url = new URL(request.url);
    const typ = url.searchParams.get("typ") ?? "";
    const text = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const from = dayStart(url.searchParams.get("from"));
    const toStart = dayStart(url.searchParams.get("to"));
    const page = Math.max(1, Math.min(1000, Number(url.searchParams.get("page")) || 1));

    const server = await getActiveServer();
    const where: string[] = ["`server_key` = ?"];
    const params: (string | number)[] = [server.serverKey];

    if (typ !== "") {
      where.push("`typ` = ?");
      params.push(typ.slice(0, 64));
    }

    if (text !== "") {
      // LIKE-Platzhalter im Suchtext wörtlich nehmen.
      where.push("`text` LIKE ?");
      params.push(`%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
    }

    if (from !== null) {
      where.push("`created_at` >= ?");
      params.push(from);
    }

    if (toStart !== null) {
      where.push("`created_at` < ?");
      params.push(toStart + 86400);
    }

    const whereSql = where.join(" AND ");

    const [rows, total, types] = await Promise.all([
      query<{ id: number; created_at: number; typ: string; text: string; color: string }>(
        `SELECT \`id\`, \`created_at\`, \`typ\`, \`text\`, \`color\` FROM \`pd_admin_logs\` WHERE ${whereSql} ` +
          `ORDER BY \`created_at\` DESC, \`id\` DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
        params,
      ),
      query<{ c: number }>(
        `SELECT COUNT(*) AS c FROM \`pd_admin_logs\` WHERE ${whereSql}`,
        params,
      ),
      query<{ typ: string; c: number }>(
        "SELECT `typ`, COUNT(*) AS c FROM `pd_admin_logs` WHERE `server_key` = ? GROUP BY `typ` ORDER BY `typ`",
        [server.serverKey],
      ),
    ]);

    return NextResponse.json({
      configured: true,
      entries: rows.map((row) => ({
        id: Number(row.id),
        time: Number(row.created_at),
        typ: row.typ,
        text: row.text,
        color: row.color,
      })),
      total: Number(total[0]?.c ?? 0),
      page,
      pageSize: PAGE_SIZE,
      types: types.map((row) => ({ typ: row.typ, count: Number(row.c) })),
    });
  } catch (error) {
    console.error("[logs] Fehler:", error);
    return NextResponse.json(
      { error: "Datenbank nicht erreichbar", detail: (error as Error).message },
      { status: 503 },
    );
  }
}
