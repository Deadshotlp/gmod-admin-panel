import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { execute, query, queryOne } from "@/lib/db";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";
import { getActiveServer } from "@/lib/servers";

export const dynamic = "force-dynamic";

/**
 * Bug Reports aus pd_bugreports (Gamemode-Modul bugreport, ESC-Menü
 * "Bug melden"). Enthalten SteamID, Position und Eingabe-Protokoll - deshalb
 * ab Bearbeiter.
 *
 * GET              Liste (status, page) ohne Screenshot
 * GET ?id=N        ein Bericht mit Protokoll, Fehlern und Screenshot
 * POST {id, status, note}  Status/Notiz ändern
 */

const PAGE_SIZE = 50;
const STATUSES = ["offen", "in Arbeit", "erledigt", "abgelehnt"] as const;

function fail(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[bugreports] Fehler:", error);
  return NextResponse.json(
    { error: "Datenbank nicht erreichbar", detail: (error as Error).message },
    { status: 503 },
  );
}

async function tableExists(): Promise<boolean> {
  const rows = await query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM information_schema.tables " +
      "WHERE table_schema = DATABASE() AND table_name = 'pd_bugreports'",
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string" || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function GET(request: Request) {
  try {
    await requireUser("editor");
  } catch (error) {
    return fail(error);
  }

  if (!checkRateLimit(rateLimitKey(request, "bugreports-read"), 90, 60_000)) {
    return NextResponse.json({ error: "Zu viele Anfragen" }, { status: 429 });
  }

  try {
    if (!(await tableExists())) {
      return NextResponse.json({
        configured: false,
        hint:
          "Die Tabelle pd_bugreports fehlt noch. Sie entsteht beim nächsten Start des Gamemodes " +
          "mit dem Modul bugreport (Map-Neustart).",
      });
    }

    const url = new URL(request.url);
    const server = await getActiveServer();
    const id = Number(url.searchParams.get("id"));

    if (Number.isInteger(id) && id > 0) {
      const row = await queryOne<Record<string, unknown>>(
        "SELECT * FROM `pd_bugreports` WHERE `id` = ? AND `server_key` = ?",
        [id, server.serverKey],
      );

      if (!row) return NextResponse.json({ error: "Bericht nicht gefunden" }, { status: 404 });

      return NextResponse.json({
        configured: true,
        report: {
          id: Number(row.id),
          time: Number(row.created_at),
          steamid64: String(row.steamid64 ?? ""),
          player: String(row.player_name ?? ""),
          charId: String(row.char_id ?? ""),
          category: String(row.category ?? ""),
          title: String(row.title ?? ""),
          description: String(row.description ?? ""),
          status: String(row.status ?? "offen"),
          note: String(row.note ?? ""),
          context: parseJson(row.context_json, {}),
          log: parseJson(row.input_log, []),
          errors: parseJson(row.errors_json, {}),
          screenshot: row.screenshot ? `data:image/jpeg;base64,${String(row.screenshot)}` : null,
        },
      });
    }

    const status = url.searchParams.get("status") ?? "";
    const page = Math.max(1, Math.min(1000, Number(url.searchParams.get("page")) || 1));
    const where: string[] = ["`server_key` = ?"];
    const params: (string | number)[] = [server.serverKey];

    if ((STATUSES as readonly string[]).includes(status)) {
      where.push("`status` = ?");
      params.push(status);
    }

    const whereSql = where.join(" AND ");
    const [rows, total, counts] = await Promise.all([
      query<{
        id: number;
        created_at: number;
        player_name: string;
        category: string;
        title: string;
        status: string;
        has_shot: number;
      }>(
        "SELECT `id`, `created_at`, `player_name`, `category`, `title`, `status`, " +
          "(`screenshot` IS NOT NULL) AS has_shot FROM `pd_bugreports` " +
          `WHERE ${whereSql} ORDER BY \`created_at\` DESC, \`id\` DESC ` +
          `LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
        params,
      ),
      query<{ c: number }>(`SELECT COUNT(*) AS c FROM \`pd_bugreports\` WHERE ${whereSql}`, params),
      query<{ status: string; c: number }>(
        "SELECT `status`, COUNT(*) AS c FROM `pd_bugreports` WHERE `server_key` = ? GROUP BY `status`",
        [server.serverKey],
      ),
    ]);

    return NextResponse.json({
      configured: true,
      statuses: STATUSES,
      counts: Object.fromEntries(counts.map((row) => [row.status, Number(row.c)])),
      entries: rows.map((row) => ({
        id: Number(row.id),
        time: Number(row.created_at),
        player: row.player_name,
        category: row.category,
        title: row.title,
        status: row.status,
        hasShot: Number(row.has_shot) === 1,
      })),
      total: Number(total[0]?.c ?? 0),
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (error) {
    return fail(error);
  }
}

const updateSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(STATUSES),
  note: z.string().max(2000).default(""),
});

export async function POST(request: Request) {
  let user;

  try {
    user = await requireUser("editor");
  } catch (error) {
    return fail(error);
  }

  if (!checkRateLimit(rateLimitKey(request, "bugreports-write"), 60, 60_000)) {
    return NextResponse.json({ error: "Zu viele Änderungen" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" },
      { status: 400 },
    );
  }

  const input = parsed.data;

  try {
    const server = await getActiveServer();
    const before = await queryOne<{ status: string; note: string | null }>(
      "SELECT `status`, `note` FROM `pd_bugreports` WHERE `id` = ? AND `server_key` = ?",
      [input.id, server.serverKey],
    );

    if (!before) return NextResponse.json({ error: "Bericht nicht gefunden" }, { status: 404 });

    await execute("UPDATE `pd_bugreports` SET `status` = ?, `note` = ? WHERE `id` = ? AND `server_key` = ?", [
      input.status,
      input.note,
      input.id,
      server.serverKey,
    ]);

    await writeAudit({
      user,
      action: "bugreport.update",
      targetType: "bugreport",
      targetKey: String(input.id),
      before,
      after: { status: input.status, note: input.note },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
