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
 * Charakter-Einstellungen (pd_char_config, Schlüssel -> JSON-Wert).
 *
 * Die Tabelle legt das Gamemode-Modul _character/sh_char_config.lua an und
 * befüllt sie mit den bisherigen Werten aus sh_char.lua.
 */

const settingsSchema = z.object({
  max_chars: z.number().int().min(1).max(20),
  default_slots: z.number().int().min(0).max(20),
  slots_by_group: z.record(
    z.string().trim().min(1).max(64),
    z.number().int().min(0).max(20),
  ),
  name_min: z.number().int().min(1).max(64),
  name_max: z.number().int().min(1).max(64),
  name_blacklist: z.array(z.string().trim().min(1).max(64)).max(500),
  id_prefix: z.string().max(16),
  id_format: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[#A-Za-z0-9_-]+$/, "ID-Format: nur #, Buchstaben, Ziffern, - und _")
    .refine((value) => (value.match(/#/g) ?? []).length >= 3, {
      message: "ID-Format braucht mindestens 3 Ziffern (#)",
    }),
  id_blocked: z.array(z.string().trim().min(1).max(32)).max(1000),
  background: z.string().max(255),
  discord: z.string().max(255),
  kollektion: z.string().max(255),
  default_job: z.string().max(128),
});

type Settings = z.infer<typeof settingsSchema>;

async function tableExists(): Promise<boolean> {
  const rows = await query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM information_schema.tables " +
      "WHERE table_schema = DATABASE() AND table_name = 'pd_char_config'",
  );

  return Number(rows[0]?.c ?? 0) >= 1;
}

async function loadSettings(): Promise<Record<string, unknown>> {
  const rows = await query<{ config_key: string; config_value: string }>(
    "SELECT * FROM `pd_char_config`",
  );

  const out: Record<string, unknown> = {};

  for (const row of rows) {
    try {
      out[row.config_key] = JSON.parse(row.config_value);
    } catch {
      out[row.config_key] = row.config_value;
    }
  }

  // Leere Lua-Tabellen kommen als {} statt [] an.
  for (const key of ["name_blacklist", "id_blocked"]) {
    if (out[key] && !Array.isArray(out[key])) out[key] = Object.values(out[key] as object);
  }

  return out;
}

function fail(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[charakter] Fehler:", error);
  return NextResponse.json(
    { error: "Datenbank nicht erreichbar", detail: (error as Error).message },
    { status: 503 },
  );
}

export async function GET() {
  try {
    await requireUser("viewer");

    if (!(await tableExists())) {
      return NextResponse.json({
        configured: false,
        hint:
          "Die Tabelle pd_char_config fehlt. Sie entsteht beim ersten Start des " +
          "Gamemodes mit den aktualisierten Charakter-Einstellungen.",
      });
    }

    return NextResponse.json({ configured: true, settings: await loadSettings() });
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

  if (!checkRateLimit(rateLimitKey(request, "charakter-write"), 30, 60_000)) {
    return NextResponse.json({ error: "Zu viele Änderungen" }, { status: 429 });
  }

  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const parsed = settingsSchema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe",
        detail: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const input: Settings = parsed.data;

  if (input.name_min > input.name_max) {
    return NextResponse.json(
      { error: "Minimale Namenslänge ist größer als die maximale" },
      { status: 400 },
    );
  }

  try {
    const before = await loadSettings();

    await createBackup("charakter", `Automatisch vor dem Speichern durch ${user.displayName}`);

    await transaction(async (conn) => {
      for (const [key, value] of Object.entries(input)) {
        await conn.execute(
          "REPLACE INTO `pd_char_config` (`config_key`, `config_value`) VALUES (?, ?)",
          [key, JSON.stringify(value)],
        );
      }
    });

    const after = await loadSettings();

    await writeAudit({
      user,
      action: "charakter.save",
      targetType: "charakter",
      targetKey: "config",
      before,
      after,
    });

    const reload = await reloadServer("charakter");

    return NextResponse.json({
      ok: true,
      settings: after,
      reload: { ok: reload.ok, message: reload.message },
    });
  } catch (error) {
    console.error("[charakter] Schreiben fehlgeschlagen:", error);

    return NextResponse.json(
      { error: "Änderung fehlgeschlagen", detail: (error as Error).message },
      { status: 500 },
    );
  }
}
