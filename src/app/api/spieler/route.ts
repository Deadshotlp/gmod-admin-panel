import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import {
  CharacterError,
  deleteCharacter,
  getCharacter,
  saveCharacter,
} from "@/lib/charactersDb";
import { query } from "@/lib/db";
import { reloadServer } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Charaktere einsehen und bearbeiten.
 *
 * Die Einheitenzuordnung steht nur noch in `pd_characters` - der Gamemode baut
 * seinen Fraktionsbaum daraus, die frühere `data/factions/players.json` gibt es
 * nicht mehr. Nach jeder Änderung lädt der Server die Charaktere mit
 * `pd_reload chars` neu und setzt verbundene Spieler sofort um.
 *
 * Eine Lücke bleibt: speichert der Server einen verbundenen Spieler genau
 * zwischen dem Schreiben hier und dem Nachladen (Verlassen, Geldbuchung),
 * gewinnt dessen Stand. Das Fenster ist so kurz wie der Weg über die
 * Serverkonsole.
 */

interface CharacterRow {
  steamid64: string;
  char_id: string;
  char_name: string;
  char_rank: string;
  char_money: number;
  char_playtime: number;
  char_lastplaytime: string;
  char_cratedate: string;
  faction_unit: string;
  faction_subunit: string;
  faction_job: string;
  job_name: string;
}

function failed(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[spieler] Fehler:", error);
  return NextResponse.json({ error: "Datenbank nicht erreichbar" }, { status: 503 });
}

export async function GET(request: Request) {
  try {
    await requireUser("viewer");
  } catch (error) {
    return failed(error);
  }

  const params = new URL(request.url).searchParams;
  const search = (params.get("suche") ?? "").trim();
  const charId = params.get("char");

  try {
    // Einzelansicht: Charakter plus seine Fortbildungen
    if (charId) {
      const [character] = await query<CharacterRow>(
        "SELECT * FROM `pd_characters` WHERE `char_id` = ? LIMIT 1",
        [charId],
      );

      if (!character) {
        return NextResponse.json({ error: "Charakter nicht gefunden" }, { status: 404 });
      }

      const now = Math.floor(Date.now() / 1000);

      const courses = await query<{
        fb_key: string;
        name: string;
        granted_at: number;
        expires_at: number;
      }>(
        "SELECT g.`fb_key`, c.`name`, g.`granted_at`, g.`expires_at` " +
          "FROM `pd_fb_granted` g LEFT JOIN `pd_fb_courses` c ON c.`fb_key` = g.`fb_key` " +
          "WHERE g.`char_id` = ? ORDER BY g.`granted_at` DESC",
        [charId],
      ).catch(() => []);

      return NextResponse.json({
        character,
        courses: courses.map((row) => ({
          fbKey: row.fb_key,
          name: row.name ?? row.fb_key,
          grantedAt: Number(row.granted_at ?? 0),
          expiresAt: Number(row.expires_at ?? 0),
          expired: Number(row.expires_at ?? 0) > 0 && Number(row.expires_at) <= now,
        })),
      });
    }

    // Liste. LIKE-Suche über Name und Kennung, Grenze fest bei 200.
    const rows = search
      ? await query<CharacterRow>(
          "SELECT * FROM `pd_characters` " +
            "WHERE `char_name` LIKE ? OR `char_id` LIKE ? OR `steamid64` LIKE ? " +
            "ORDER BY `char_playtime` DESC LIMIT 200",
          [`%${search}%`, `%${search}%`, `%${search}%`],
        )
      : await query<CharacterRow>(
          "SELECT * FROM `pd_characters` ORDER BY `char_playtime` DESC LIMIT 200",
        );

    const total = await query<{ c: number }>(
      "SELECT COUNT(*) AS c FROM `pd_characters`",
    );

    return NextResponse.json({
      characters: rows,
      total: Number(total[0]?.c ?? 0),
      limited: rows.length >= 200,
    });
  } catch (error) {
    console.error("[spieler] Abfrage fehlgeschlagen:", error);

    return NextResponse.json(
      { error: "Abfrage fehlgeschlagen", detail: (error as Error).message },
      { status: 503 },
    );
  }
}

const steamId = z.string().regex(/^\d{17}$/, "Ungültige SteamID64");
const charId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Ungültige Kennung");
const factionKey = z.string().min(1).max(128);

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    steamId,
    charId,
    input: z.object({
      name: z.string().trim().min(1, "Name fehlt").max(64),
      rank: z.string().trim().max(128),
      money: z.number().int().min(0).max(2_147_483_647),
      unitKey: factionKey,
      subunitKey: factionKey,
      jobKey: factionKey,
    }),
  }),
  z.object({ action: z.literal("delete"), steamId, charId }),
]);

export async function POST(request: Request) {
  let user;

  try {
    user = await requireUser("editor");
  } catch (error) {
    return failed(error);
  }

  if (!checkRateLimit(rateLimitKey(request, "spieler-write"), 60, 60_000)) {
    return NextResponse.json({ error: "Zu viele Änderungen" }, { status: 429 });
  }

  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const parsed = body.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe", detail: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const targetKey = `${data.steamId}/${data.charId}`;

  try {
    const before = await getCharacter(data.steamId, data.charId);

    if (!before) {
      return NextResponse.json({ error: "Charakter nicht gefunden" }, { status: 404 });
    }

    if (data.action === "save") {
      const after = await saveCharacter(data.steamId, data.charId, data.input);

      await writeAudit({
        user,
        action: "spieler.save",
        targetType: "character",
        targetKey,
        before,
        after,
      });

      // Gespeichert ist gespeichert - das Nachladen ist ein eigener Schritt.
      const reload = await reloadServer("chars");

      return NextResponse.json({
        ok: true,
        character: after,
        reload: { ok: reload.ok, message: reload.message },
      });
    }

    await deleteCharacter(data.steamId, data.charId);

    await writeAudit({
      user,
      action: "spieler.delete",
      targetType: "character",
      targetKey,
      before,
      after: null,
    });

    // Die Fortbildungen des Charakters sind mit gelöscht - beide Bereiche neu laden.
    const reload = await reloadServer("chars");
    await reloadServer("fortbildung");

    return NextResponse.json({
      ok: true,
      reload: { ok: reload.ok, message: reload.message },
    });
  } catch (error) {
    if (error instanceof CharacterError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[spieler] Schreiben fehlgeschlagen:", error);

    return NextResponse.json(
      { error: "Änderung fehlgeschlagen", detail: (error as Error).message },
      { status: 500 },
    );
  }
}
