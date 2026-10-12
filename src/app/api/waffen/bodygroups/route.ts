import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { query, transaction } from "@/lib/db";
import { reloadServer } from "@/lib/pterodactyl";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Ausrüstung an Bodygroups binden (Gamemode modules/ausruestung).
 *
 * pd_gear_bodygroups  Item (Waffenklasse) -> Bodygroup-Name mit Werten ohne
 *                     Item, mit Item und aktiviert (z. B. Makrofernglas)
 * pd_gear_models      Bodygroups je Spieler-Model - schreibt der Server, sobald
 *                     jemand das Model trägt; Grundlage für die Auswahl hier
 *
 * Beide Tabellen legt der Gamemode an. Nach dem Speichern: pd_reload waffen.
 */

interface Binding {
  class: string;
  model: string;
  bodygroup: string;
  valueOff: number;
  valueOn: number;
  valueActive: number;
}

function fail(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[waffen/bodygroups] Fehler:", error);
  return NextResponse.json({ error: "Datenbank nicht erreichbar", detail: (error as Error).message }, { status: 503 });
}

function parse<T>(text: string | null | undefined, fallback: T): T {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function tablesExist(): Promise<boolean> {
  const rows = await query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM information_schema.tables " +
      "WHERE table_schema = DATABASE() AND table_name IN ('pd_gear_bodygroups', 'pd_gear_models')",
  );
  return Number(rows[0]?.c ?? 0) >= 2;
}

async function loadBindings(): Promise<Binding[]> {
  const rows = await query<{
    class: string;
    model: string;
    bodygroup: string;
    value_off: number;
    value_on: number;
    value_active: number;
  }>("SELECT * FROM `pd_gear_bodygroups` ORDER BY `position`, `id`");

  return rows.map((r) => ({
    class: r.class,
    model: r.model || "*",
    bodygroup: r.bodygroup,
    valueOff: Number(r.value_off),
    valueOn: Number(r.value_on),
    valueActive: Number(r.value_active),
  }));
}

export async function GET() {
  try {
    await requireUser("viewer");

    if (!(await tablesExist())) {
      return NextResponse.json({
        configured: false,
        hint: "Die Tabellen pd_gear_* fehlen. Sie entstehen beim nächsten Start des Gamemodes (Modul ausruestung).",
      });
    }

    const [bindings, models, weapons] = await Promise.all([
      loadBindings(),
      query<{ model: string; bodygroups: string }>("SELECT `model`, `bodygroups` FROM `pd_gear_models` ORDER BY `model`"),
      query<{ class: string }>("SELECT `class` FROM `pd_wb_weapons` ORDER BY `class`").catch(() => []),
    ]);

    return NextResponse.json({
      configured: true,
      bindings,
      models: models.map((m) => ({
        model: m.model,
        bodygroups: parse<Array<{ index: number; name: string; count: number }>>(m.bodygroups, []),
      })),
      classes: weapons.map((w) => w.class),
    });
  } catch (error) {
    return fail(error);
  }
}

const schema = z.object({
  bindings: z
    .array(
      z.object({
        class: z.string().min(1).max(128),
        model: z.string().min(1).max(191),
        bodygroup: z.string().min(1).max(64),
        valueOff: z.number().int().min(-1).max(255),
        valueOn: z.number().int().min(0).max(255),
        valueActive: z.number().int().min(-1).max(255),
      }),
    )
    .max(500),
});

export async function POST(request: Request) {
  let user;

  try {
    user = await requireUser("editor");
  } catch (error) {
    return fail(error);
  }

  if (!checkRateLimit(rateLimitKey(request, "gear-write"), 30, 60_000)) {
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
    return NextResponse.json({ error: "Ungültige Eingabe", detail: parsed.error.issues }, { status: 400 });
  }

  try {
    const before = await loadBindings();

    await transaction(async (conn) => {
      await conn.execute("DELETE FROM `pd_gear_bodygroups`");

      for (const [index, b] of parsed.data.bindings.entries()) {
        await conn.execute(
          "INSERT INTO `pd_gear_bodygroups` (`class`, `model`, `bodygroup`, `value_off`, `value_on`, `value_active`, `position`) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [b.class.trim(), b.model.trim().toLowerCase() || "*", b.bodygroup.trim(), b.valueOff, b.valueOn, b.valueActive, index + 1],
        );
      }
    });

    const after = await loadBindings();

    await writeAudit({ user, action: "gear.bodygroups.save", targetType: "waffenkiste", targetKey: "bodygroups", before, after });

    const reload = await reloadServer("waffen");

    return NextResponse.json({ ok: true, bindings: after, reload: { ok: reload.ok, message: reload.message } });
  } catch (error) {
    console.error("[waffen/bodygroups] Schreiben fehlgeschlagen:", error);
    return NextResponse.json({ error: "Änderung fehlgeschlagen", detail: (error as Error).message }, { status: 500 });
  }
}
