import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { execute, query } from "@/lib/db";
import { sendConsoleCommand } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Planeten-Maps (Naval, Stufe 4f): Maps, auf die das Schiff vom Orbit eines
 * Planeten, Mondes oder einer Station aus umstationieren kann.
 *
 * pd_naval_planet_maps legt das Gamemode-Modul an (sv_naval_relocate.lua).
 * Nach Änderungen: "pd_naval_planetmaps_reload".
 *
 * GET   alle Einträge mit Körper- und Systemnamen
 * POST  {op: "add", bodyId, map, name, description} | {op: "update", id, ...} | {op: "delete", id}
 */

interface Row {
  id: number;
  body_id: string;
  map: string;
  name: string;
  description: string;
  position: number;
  body_name: string | null;
  body_type: string | null;
  system_name: string | null;
}

function fail(error: unknown) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[naval/planetmaps] Fehler:", error);
  return NextResponse.json({ error: "Datenbank nicht erreichbar", detail: (error as Error).message }, { status: 503 });
}

export async function GET() {
  try {
    await requireUser("viewer");
    const exists = await query<{ c: number }>(
      "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'pd_naval_planet_maps'",
    );
    if (Number(exists[0]?.c ?? 0) === 0) {
      return NextResponse.json({
        configured: false,
        hint: "Die Tabelle pd_naval_planet_maps fehlt noch. Sie entsteht beim nächsten Map-Start mit dem Naval-Modul.",
      });
    }

    const rows = await query<Row>(
      "SELECT m.*, b.`name` AS body_name, b.`type` AS body_type, s.`name` AS system_name FROM `pd_naval_planet_maps` m " +
        "LEFT JOIN `pd_naval_bodies` b ON b.`id` = m.`body_id` LEFT JOIN `pd_naval_systems` s ON s.`id` = b.`system_id` " +
        "ORDER BY s.`name`, b.`name`, m.`position`, m.`id`",
    );

    return NextResponse.json({
      configured: true,
      entries: rows.map((r) => ({
        id: Number(r.id),
        bodyId: r.body_id,
        bodyName: r.body_name ?? r.body_id,
        bodyType: r.body_type ?? "",
        systemName: r.system_name ?? "",
        map: r.map,
        name: r.name,
        description: r.description,
      })),
    });
  } catch (error) {
    return fail(error);
  }
}

const fields = {
  map: z.string().regex(/^[A-Za-z0-9_\-.]{1,128}$/, "Ungültiger Map-Name (nur Buchstaben, Ziffern, _ - .)"),
  name: z.string().max(128),
  description: z.string().max(255),
};

const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), bodyId: z.string().min(1).max(64), ...fields }),
  z.object({ op: z.literal("update"), id: z.number().int().positive(), ...fields }),
  z.object({ op: z.literal("delete"), id: z.number().int().positive() }),
]);

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser("editor");
  } catch (error) {
    return fail(error);
  }

  if (!checkRateLimit(rateLimitKey(request, "naval-planetmaps"), 30, 60_000)) {
    return NextResponse.json({ error: "Zu viele Änderungen" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  }
  const input = parsed.data;
  const now = Math.floor(Date.now() / 1000);
  const map = "map" in input ? input.map.replace(/\.bsp$/i, "") : "";

  try {
    if (input.op === "add") {
      const body = await query<{ id: string; type: string }>("SELECT `id`, `type` FROM `pd_naval_bodies` WHERE `id` = ?", [input.bodyId]);
      if (!body[0]) return NextResponse.json({ error: "Himmelskörper nicht gefunden" }, { status: 404 });
      if (body[0].type === "star") return NextResponse.json({ error: "Auf Sternen kann man nicht landen" }, { status: 400 });
      await execute(
        "INSERT INTO `pd_naval_planet_maps` (`body_id`, `map`, `name`, `description`, `updated_at`) VALUES (?, ?, ?, ?, ?)",
        [input.bodyId, map, input.name, input.description, now],
      );
      await writeAudit({ user, action: "naval.planetmap.add", targetType: "naval_body", targetKey: input.bodyId, before: null, after: { map, name: input.name } });
    } else if (input.op === "update") {
      const before = await query<Row>("SELECT * FROM `pd_naval_planet_maps` WHERE `id` = ?", [input.id]);
      if (!before[0]) return NextResponse.json({ error: "Eintrag nicht gefunden" }, { status: 404 });
      await execute("UPDATE `pd_naval_planet_maps` SET `map` = ?, `name` = ?, `description` = ?, `updated_at` = ? WHERE `id` = ?", [
        map, input.name, input.description, now, input.id,
      ]);
      await writeAudit({ user, action: "naval.planetmap.update", targetType: "naval_planetmap", targetKey: String(input.id), before: before[0], after: { map, name: input.name, description: input.description } });
    } else {
      const before = await query<Row>("SELECT * FROM `pd_naval_planet_maps` WHERE `id` = ?", [input.id]);
      await execute("DELETE FROM `pd_naval_planet_maps` WHERE `id` = ?", [input.id]);
      await writeAudit({ user, action: "naval.planetmap.delete", targetType: "naval_planetmap", targetKey: String(input.id), before: before[0] ?? null, after: null });
    }

    const reload = await sendConsoleCommand("pd_naval_planetmaps_reload");
    return NextResponse.json({ ok: true, reload: { ok: reload.ok, message: reload.message } });
  } catch (error) {
    return fail(error);
  }
}
