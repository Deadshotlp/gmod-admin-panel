import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Charakterübersicht.
 *
 * Bewusst nur lesend. Die Zuordnung zu einer Einheit lebt an zwei Orten: in den
 * Spalten faction_* von pd_characters UND in data/factions/players.json, aus der
 * PD.List seinen Fraktionsbaum baut. Zusätzlich schreibt PD.Char:SaveChar beim
 * Verlassen alle Zeilen einer SteamID neu - eine Änderung von hier würde dabei
 * überschrieben. Schreiben wird erst möglich, wenn die Mitgliedschaften nach SQL
 * gewandert sind.
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

export async function GET(request: Request) {
  try {
    await requireUser("viewer");
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[spieler] Fehler:", error);
    return NextResponse.json({ error: "Datenbank nicht erreichbar" }, { status: 503 });
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
