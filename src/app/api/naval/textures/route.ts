import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { execute, query } from "@/lib/db";
import { reloadServer } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Planeten-Texturen (Naval, Stufe 4b).
 *
 * pd_naval_textures: Texturen mit Vorschaubild (legt das Gamemode-Modul an,
 * gefüllt von _tools/naval_galaxy/textures.js aus dem SWU-Addon).
 * Überschreibungen je Himmelskörper stehen in pd_naval_settings unter
 * "texture_overrides" ({bodyId: {material, cloud}}), damit ein Neu-Import der
 * Galaxie sie nicht löscht; wirksam nach pd_reload naval_galaxy.
 *
 * GET ?preview=<id>   Vorschaubild (PNG)
 * GET ?q=<text>       Texturen + passende Planeten/Monde (max. 80)
 * POST {bodyId, material, cloud} | {bodyId, reset: true}
 */

type Override = { material?: string; cloud?: string };

async function loadOverrides(): Promise<Record<string, Override>> {
  const rows = await query<{ config_value: string }>(
    "SELECT `config_value` FROM `pd_naval_settings` WHERE `config_key` = 'texture_overrides'",
  );
  try {
    const parsed = JSON.parse(rows[0]?.config_value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function fail(error: unknown) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[naval/textures] Fehler:", error);
  return NextResponse.json({ error: "Datenbank nicht erreichbar", detail: (error as Error).message }, { status: 503 });
}

export async function GET(request: Request) {
  try {
    await requireUser("viewer");
    const params = new URL(request.url).searchParams;

    const previewId = params.get("preview");
    if (previewId) {
      const rows = await query<{ preview: string }>("SELECT `preview` FROM `pd_naval_textures` WHERE `id` = ?", [previewId]);
      if (!rows[0]) return new NextResponse("Nicht gefunden", { status: 404 });
      return new NextResponse(Buffer.from(rows[0].preview, "base64"), {
        headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" },
      });
    }

    const q = (params.get("q") ?? "").trim();
    const onlyOverrides = params.get("overrides") === "1";
    const overrides = await loadOverrides();

    const textures = await query<{ id: string; kind: string; planet_type: string; name: string }>(
      "SELECT `id`, `kind`, `planet_type`, `name` FROM `pd_naval_textures` ORDER BY `kind`, `planet_type`, `id`",
    ).catch(() => []);

    let bodies: Array<{ id: string; system_id: string; type: string; name: string; material: string; cloud_material: string; data: string; system_name: string }> = [];
    if (onlyOverrides) {
      const ids = Object.keys(overrides).slice(0, 200);
      if (ids.length) {
        bodies = await query(
          "SELECT b.`id`, b.`system_id`, b.`type`, b.`name`, b.`material`, b.`cloud_material`, b.`data`, s.`name` AS system_name " +
            "FROM `pd_naval_bodies` b LEFT JOIN `pd_naval_systems` s ON s.`id` = b.`system_id` " +
            `WHERE b.\`id\` IN (${ids.map(() => "?").join(", ")}) ORDER BY b.\`name\``,
          ids,
        );
      }
    } else if (q.length >= 2) {
      bodies = await query(
        "SELECT b.`id`, b.`system_id`, b.`type`, b.`name`, b.`material`, b.`cloud_material`, b.`data`, s.`name` AS system_name " +
          "FROM `pd_naval_bodies` b LEFT JOIN `pd_naval_systems` s ON s.`id` = b.`system_id` " +
          "WHERE b.`type` IN ('planet', 'moon') AND (b.`name` LIKE ? OR s.`name` LIKE ?) ORDER BY b.`name` LIMIT 80",
        [`%${q}%`, `%${q}%`],
      );
    }

    return NextResponse.json({
      textures: textures.map((t) => ({ id: t.id, kind: t.kind, type: t.planet_type, name: t.name })),
      overrideCount: Object.keys(overrides).length,
      bodies: bodies.map((b) => {
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(b.data || "{}");
        } catch {
          data = {};
        }
        const o = overrides[b.id] ?? null;
        return {
          id: b.id,
          name: b.name,
          bodyType: b.type,
          systemId: b.system_id,
          systemName: b.system_name ?? b.system_id,
          // wirksam: Überschreibung vor Grundwert
          material: o?.material ?? b.material,
          cloud: o && o.cloud !== undefined ? o.cloud : b.cloud_material || "",
          planetType: typeof data.planetType === "string" ? data.planetType : null,
          typeSource: typeof data.typeSource === "string" ? data.typeSource : null,
          climate: typeof data.climate === "string" ? data.climate : "",
          terrain: typeof data.terrain === "string" ? data.terrain : "",
          override: o,
        };
      }),
    });
  } catch (error) {
    return fail(error);
  }
}

const texturePath = z.string().regex(/^[a-z0-9_\-/]{1,160}$/);
const schema = z.union([
  z.object({ bodyId: z.string().max(160), reset: z.literal(true) }),
  z.object({ bodyId: z.string().max(160), material: texturePath, cloud: z.union([texturePath, z.literal("")]) }),
]);

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser("editor");
  } catch (error) {
    return fail(error);
  }

  if (!checkRateLimit(rateLimitKey(request, "naval-textures"), 30, 60_000)) {
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

  try {
    const body = await query<{ id: string; name: string }>("SELECT `id`, `name` FROM `pd_naval_bodies` WHERE `id` = ?", [input.bodyId]);
    if (!body[0]) return NextResponse.json({ error: "Himmelskörper nicht gefunden" }, { status: 404 });

    if (!("reset" in input)) {
      const ids = [input.material, ...(input.cloud ? [input.cloud] : [])];
      const known = await query<{ id: string }>(
        `SELECT \`id\` FROM \`pd_naval_textures\` WHERE \`id\` IN (${ids.map(() => "?").join(", ")})`,
        ids,
      );
      if (known.length !== ids.length) return NextResponse.json({ error: "Unbekannte Textur" }, { status: 400 });
    }

    const overrides = await loadOverrides();
    const before = overrides[input.bodyId] ?? null;
    if ("reset" in input) delete overrides[input.bodyId];
    else overrides[input.bodyId] = { material: input.material, cloud: input.cloud };

    await execute("REPLACE INTO `pd_naval_settings` (`config_key`, `config_value`) VALUES ('texture_overrides', ?)", [
      JSON.stringify(overrides),
    ]);

    await writeAudit({
      user,
      action: "naval.texture",
      targetType: "naval_body",
      targetKey: input.bodyId,
      before,
      after: overrides[input.bodyId] ?? null,
    });

    const reload = await reloadServer("naval_galaxy");
    return NextResponse.json({ ok: true, name: body[0].name, reload: { ok: reload.ok, message: reload.message } });
  } catch (error) {
    return fail(error);
  }
}
