import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { createBackup } from "@/lib/backups";
import { transaction } from "@/lib/db";
import { loadTree } from "@/lib/jobsDb";
import { reloadServer } from "@/lib/pterodactyl";
import { getServerById, getServers } from "@/lib/servers";

export const dynamic = "force-dynamic";

/**
 * Export und Import ganzer Jobbäume.
 *
 * Damit lässt sich eine Struktur sichern, zwischen Test- und Livesystem
 * übertragen oder als Vorlage weitergeben.
 *
 * Der Import ersetzt den Baum vollständig. Das ist Absicht: ein Zusammenführen
 * müsste bei gleichen Schlüsseln raten, und geraten wird bei Jobzuordnungen von
 * hunderten Charakteren besser nicht.
 */

const color = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
  a: z.number().int().min(0).max(255),
});

const key = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const list = z.array(z.string().min(1).max(190)).max(256);

const treeSchema = z.array(
  z.object({
    unitKey: key,
    name: z.string().min(1).max(128),
    isDefault: z.boolean(),
    equip: list,
    color,
    subunits: z.array(
      z.object({
        subunitKey: key,
        name: z.string().min(1).max(128),
        isDefault: z.boolean(),
        maxMembers: z.number().int().min(0).max(9999),
        isMedic: z.boolean(),
        isLeo: z.boolean(),
        isEngineer: z.boolean(),
        equip: list,
        color,
        jobs: z.array(
          z.object({
            jobKey: key,
            name: z.string().min(1).max(128),
            salary: z.number().int().min(0).max(1_000_000),
            speed: z.number().int().min(0).max(1000),
            position: z.number().int().min(0).max(9999),
            showId: z.boolean(),
            isDefault: z.boolean(),
            equip: list,
            model: list,
            color,
          }),
        ).max(200),
      }),
    ).max(200),
  }),
).max(100);

function fail(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[jobs/transfer] Fehler:", error);
  return NextResponse.json({ error: "Fehlgeschlagen" }, { status: 503 });
}

/** Export: den Baum des aktiven oder eines benannten Servers. */
export async function GET(request: Request) {
  try {
    await requireUser("viewer");
  } catch (error) {
    return fail(error);
  }

  const from = new URL(request.url).searchParams.get("von");
  const server = from ? getServerById(from) : null;

  if (from && !server) {
    return NextResponse.json({ error: "Unbekannter Server" }, { status: 400 });
  }

  try {
    const units = await loadTree(server ?? undefined);

    return NextResponse.json({
      exportedAt: Math.floor(Date.now() / 1000),
      serverId: server?.id ?? null,
      units,
    });
  } catch (error) {
    return fail(error);
  }
}

const importSchema = z.object({
  units: treeSchema,
  note: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  let user;

  try {
    // Ersetzt den kompletten Baum - Adminsache.
    user = await requireUser("admin");
  } catch (error) {
    return fail(error);
  }

  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const parsed = importSchema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Die Datei passt nicht zum erwarteten Aufbau",
        detail: parsed.error.issues.slice(0, 5),
      },
      { status: 400 },
    );
  }

  const units = parsed.data.units;

  // Doppelte Schlüssel würden beim Einfügen scheitern und einen halben Baum
  // hinterlassen - lieber vorher prüfen.
  const seen = new Set<string>();

  for (const unit of units) {
    if (seen.has(unit.unitKey)) {
      return NextResponse.json(
        { error: `Schlüssel ${unit.unitKey} kommt mehrfach vor` },
        { status: 400 },
      );
    }

    seen.add(unit.unitKey);

    for (const subunit of unit.subunits) {
      if (seen.has(subunit.subunitKey)) {
        return NextResponse.json(
          { error: `Schlüssel ${subunit.subunitKey} kommt mehrfach vor` },
          { status: 400 },
        );
      }

      seen.add(subunit.subunitKey);

      for (const job of subunit.jobs) {
        if (seen.has(job.jobKey)) {
          return NextResponse.json(
            { error: `Schlüssel ${job.jobKey} kommt mehrfach vor` },
            { status: 400 },
          );
        }

        seen.add(job.jobKey);
      }
    }
  }

  try {
    const before = await loadTree();

    await createBackup("jobs", `Automatisch vor dem Import durch ${user.displayName}`);

    await transaction(async (conn) => {
      await conn.execute("DELETE FROM `pd_jobs_jobs`");
      await conn.execute("DELETE FROM `pd_jobs_subunits`");
      await conn.execute("DELETE FROM `pd_jobs_units`");

      for (const unit of units) {
        await conn.execute(
          "INSERT INTO `pd_jobs_units` (`unit_key`, `name`, `is_default`, `equip_json`, " +
            "`color_r`, `color_g`, `color_b`, `color_a`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            unit.unitKey,
            unit.name,
            unit.isDefault ? 1 : 0,
            JSON.stringify(unit.equip),
            unit.color.r,
            unit.color.g,
            unit.color.b,
            unit.color.a,
          ],
        );

        for (const subunit of unit.subunits) {
          await conn.execute(
            "INSERT INTO `pd_jobs_subunits` (`unit_key`, `subunit_key`, `name`, `unit`, " +
              "`is_default`, `maxmembers`, `ismedic`, `isleo`, `isengineer`, `equip_json`, " +
              "`color_r`, `color_g`, `color_b`, `color_a`) " +
              "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              unit.unitKey,
              subunit.subunitKey,
              subunit.name,
              // Anzeigenamen-Spiegel, den der Gamemode zum Suchen braucht
              unit.name,
              subunit.isDefault ? 1 : 0,
              subunit.maxMembers,
              subunit.isMedic ? 1 : 0,
              subunit.isLeo ? 1 : 0,
              subunit.isEngineer ? 1 : 0,
              JSON.stringify(subunit.equip),
              subunit.color.r,
              subunit.color.g,
              subunit.color.b,
              subunit.color.a,
            ],
          );

          for (const job of subunit.jobs) {
            await conn.execute(
              "INSERT INTO `pd_jobs_jobs` (`unit_key`, `subunit_key`, `job_key`, `name`, `unit`, " +
                "`job_id`, `salary`, `speed`, `position`, `showid`, `is_default`, " +
                "`equip_json`, `model_json`, `color_r`, `color_g`, `color_b`, `color_a`) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                unit.unitKey,
                subunit.subunitKey,
                job.jobKey,
                job.name,
                subunit.name,
                job.jobKey,
                job.salary,
                job.speed,
                job.position,
                job.showId ? 1 : 0,
                job.isDefault ? 1 : 0,
                JSON.stringify(job.equip),
                JSON.stringify(job.model),
                job.color.r,
                job.color.g,
                job.color.b,
                job.color.a,
              ],
            );
          }
        }
      }
    });

    const after = await loadTree();

    await writeAudit({
      user,
      action: "jobs.import",
      targetType: "jobs",
      targetKey: "tree",
      before,
      after,
      note: parsed.data.note ?? `${units.length} Einheiten importiert`,
    });

    const reload = await reloadServer("jobs");

    return NextResponse.json({
      ok: true,
      units: after,
      reload: { ok: reload.ok, message: reload.message },
    });
  } catch (error) {
    console.error("[jobs/transfer] Import fehlgeschlagen:", error);

    return NextResponse.json(
      { error: "Import fehlgeschlagen", detail: (error as Error).message },
      { status: 500 },
    );
  }
}

/** Liste der Server, zwischen denen übertragen werden kann. */
export async function OPTIONS() {
  return NextResponse.json({
    servers: getServers().map((server) => ({ id: server.id, label: server.label })),
  });
}
