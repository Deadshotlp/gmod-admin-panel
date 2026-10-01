import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { createBackup } from "@/lib/backups";
import { query, transaction } from "@/lib/db";
import { reloadServer } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Funk: feste Comlink-Kanäle und die vier Sprachreichweiten.
 *
 * Tabellen pd_comlink_channels und pd_voice_ranges legt das Gamemode-Modul
 * comlink beim Start an und befüllt sie mit den bisherigen Werten.
 *
 * Kanäle behalten im Spiel ihre Nummer über die id - bestehende Zeilen werden
 * deshalb aktualisiert statt gelöscht und neu angelegt.
 */

interface Channel {
  id: number | null;
  name: string;
  color: string;
  access: "all" | "admin" | "units";
  units: string;
}

interface Range {
  mode: number;
  name: string;
  range: number;
}

async function tablesExist(): Promise<boolean> {
  const rows = await query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM information_schema.tables " +
      "WHERE table_schema = DATABASE() AND table_name IN ('pd_comlink_channels', 'pd_voice_ranges')",
  );

  return Number(rows[0]?.c ?? 0) >= 2;
}

async function loadConfig(): Promise<{ channels: Channel[]; ranges: Range[]; units: string[] }> {
  const [channels, ranges] = await Promise.all([
    query<{ id: number; name: string; color: string; access: string; units: string }>(
      "SELECT * FROM `pd_comlink_channels` ORDER BY `position`, `id`",
    ),
    query<{ mode: number; name: string; range_units: number }>(
      "SELECT * FROM `pd_voice_ranges` ORDER BY `mode`",
    ),
  ]);

  // Einheiten und Untereinheiten als Auswahlhilfe; fehlen die Tabellen, egal.
  let units: string[] = [];

  try {
    const rows = await query<{ name: string }>(
      // Wie im Spiel: Anzeigename, sonst der Schlüssel.
      "SELECT COALESCE(NULLIF(`name`, ''), `unit_key`) AS name FROM `pd_jobs_units` " +
        "UNION SELECT COALESCE(NULLIF(`name`, ''), `subunit_key`) FROM `pd_jobs_subunits` ORDER BY `name`",
    );
    units = rows.map((row) => row.name).filter(Boolean);
  } catch {
    units = [];
  }

  return {
    channels: channels.map((row) => ({
      id: Number(row.id),
      name: row.name,
      color: row.color,
      access: row.access === "admin" || row.access === "units" ? row.access : "all",
      units: row.units,
    })),
    ranges: ranges.map((row) => ({
      mode: Number(row.mode),
      name: row.name,
      range: Number(row.range_units),
    })),
    units,
  };
}

const schema = z.object({
  channels: z
    .array(
      z.object({
        id: z.number().int().positive().nullable(),
        name: z.string().trim().min(1, "Kanalname fehlt").max(64),
        color: z.string().regex(/^\d{1,3},\d{1,3},\d{1,3}$/, "Farbe als r,g,b"),
        access: z.enum(["all", "admin", "units"]),
        units: z.string().max(1024),
      }),
    )
    .max(60),
  ranges: z
    .array(
      z.object({
        mode: z.number().int().min(1).max(4),
        name: z.string().trim().min(1).max(32),
        range: z.number().int().min(10).max(5000),
      }),
    )
    .length(4),
});

function fail(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[funk] Fehler:", error);
  return NextResponse.json(
    { error: "Datenbank nicht erreichbar", detail: (error as Error).message },
    { status: 503 },
  );
}

export async function GET() {
  try {
    await requireUser("viewer");

    if (!(await tablesExist())) {
      return NextResponse.json({
        configured: false,
        hint:
          "Die Tabellen pd_comlink_channels und pd_voice_ranges fehlen. Sie entstehen " +
          "beim ersten Start des Gamemodes mit dem aktualisierten Comlink.",
      });
    }

    return NextResponse.json({ configured: true, ...(await loadConfig()) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  let user;

  try {
    user = await requireUser("editor");
  } catch (error) {
    return fail(error);
  }

  if (!checkRateLimit(rateLimitKey(request, "funk-write"), 30, 60_000)) {
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
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe",
        detail: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const input = parsed.data;

  const modes = new Set(input.ranges.map((range) => range.mode));
  if (modes.size !== 4) {
    return NextResponse.json({ error: "Es braucht genau die Stufen 1 bis 4" }, { status: 400 });
  }

  for (const channel of input.channels) {
    const [r, g, b] = channel.color.split(",").map(Number);
    if ([r, g, b].some((value) => value > 255)) {
      return NextResponse.json({ error: `Ungültige Farbe bei ${channel.name}` }, { status: 400 });
    }

    if (channel.access === "units" && channel.units.trim() === "") {
      return NextResponse.json(
        { error: `"${channel.name}": bei "nur Einheiten" mindestens eine Einheit angeben` },
        { status: 400 },
      );
    }
  }

  try {
    const before = await loadConfig();

    await createBackup("funk", `Automatisch vor dem Speichern durch ${user.displayName}`);

    await transaction(async (conn) => {
      const keep: number[] = [];

      for (const [index, channel] of input.channels.entries()) {
        const units = channel.units
          .split(",")
          .map((unit) => unit.trim())
          .filter((unit) => unit !== "")
          .join(",");

        if (channel.id !== null) {
          const [result] = await conn.execute(
            "UPDATE `pd_comlink_channels` SET `name` = ?, `color` = ?, `access` = ?, `units` = ?, `position` = ? WHERE `id` = ?",
            [channel.name, channel.color, channel.access, units, index + 1, channel.id],
          );

          if ((result as { affectedRows?: number }).affectedRows) {
            keep.push(channel.id);
            continue;
          }
        }

        const [inserted] = await conn.execute(
          "INSERT INTO `pd_comlink_channels` (`name`, `color`, `access`, `units`, `position`) VALUES (?, ?, ?, ?, ?)",
          [channel.name, channel.color, channel.access, units, index + 1],
        );

        keep.push(Number((inserted as { insertId?: number }).insertId));
      }

      if (keep.length > 0) {
        await conn.execute(
          `DELETE FROM \`pd_comlink_channels\` WHERE \`id\` NOT IN (${keep.map(() => "?").join(", ")})`,
          keep,
        );
      } else {
        await conn.execute("DELETE FROM `pd_comlink_channels`");
      }

      for (const range of input.ranges) {
        await conn.execute(
          "REPLACE INTO `pd_voice_ranges` (`mode`, `name`, `range_units`) VALUES (?, ?, ?)",
          [range.mode, range.name, range.range],
        );
      }
    });

    const after = await loadConfig();

    await writeAudit({
      user,
      action: "funk.save",
      targetType: "funk",
      targetKey: "config",
      before: { channels: before.channels, ranges: before.ranges },
      after: { channels: after.channels, ranges: after.ranges },
    });

    const reload = await reloadServer("funk");

    return NextResponse.json({
      ok: true,
      ...after,
      reload: { ok: reload.ok, message: reload.message },
    });
  } catch (error) {
    console.error("[funk] Schreiben fehlgeschlagen:", error);

    return NextResponse.json(
      { error: "Änderung fehlgeschlagen", detail: (error as Error).message },
      { status: 500 },
    );
  }
}
