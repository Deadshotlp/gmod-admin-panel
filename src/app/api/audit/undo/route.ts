import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { listAudit, writeAudit } from "@/lib/audit";
import { createBackup } from "@/lib/backups";
import { transaction } from "@/lib/db";
import { reloadServer } from "@/lib/pterodactyl";

export const dynamic = "force-dynamic";

/**
 * Änderung zurücknehmen.
 *
 * Das Protokoll enthält den Zustand vor der Änderung. Zurücknehmen heißt: diesen
 * Zustand wieder herstellen. Das geht nur für Bereiche, bei denen der komplette
 * Baum gesichert wurde - also Jobs und Fortbildungen.
 *
 * Bewusst KEIN schrittweises Rückgängigmachen: wurde nach der Änderung noch
 * etwas anderes angefasst, würde das mit zurückgedreht. Deshalb steht in der
 * Oberfläche, dass spätere Änderungen dabei verloren gehen.
 */

const UNDOABLE: Record<string, { scope: "jobs" | "fortbildung"; label: string }> = {
  "jobs.saveUnit": { scope: "jobs", label: "Einheit" },
  "jobs.saveSubunit": { scope: "jobs", label: "Untereinheit" },
  "jobs.saveJob": { scope: "jobs", label: "Job" },
  "jobs.deleteUnit": { scope: "jobs", label: "Einheit" },
  "jobs.deleteSubunit": { scope: "jobs", label: "Untereinheit" },
  "jobs.deleteJob": { scope: "jobs", label: "Job" },
  "fb.saveCourse": { scope: "fortbildung", label: "Fortbildung" },
  "fb.deleteCourse": { scope: "fortbildung", label: "Fortbildung" },
};

export function isUndoable(action: string): boolean {
  return action in UNDOABLE;
}

interface UnitRow {
  unitKey: string;
  name: string;
  isDefault: boolean;
  equip: string[];
  color: { r: number; g: number; b: number; a: number };
  subunits: Array<{
    subunitKey: string;
    name: string;
    isDefault: boolean;
    maxMembers: number;
    isMedic: boolean;
    isLeo: boolean;
    isEngineer: boolean;
    equip: string[];
    color: { r: number; g: number; b: number; a: number };
    jobs: Array<{
      jobKey: string;
      name: string;
      salary: number;
      speed: number;
      position: number;
      showId: boolean;
      isDefault: boolean;
      equip: string[];
      model: string[];
      color: { r: number; g: number; b: number; a: number };
    }>;
  }>;
}

/** Schreibt einen kompletten Jobbaum zurück. */
async function restoreJobs(tree: UnitRow[]): Promise<void> {
  await transaction(async (conn) => {
    await conn.execute("DELETE FROM `pd_jobs_jobs`");
    await conn.execute("DELETE FROM `pd_jobs_subunits`");
    await conn.execute("DELETE FROM `pd_jobs_units`");

    for (const unit of tree) {
      await conn.execute(
        "INSERT INTO `pd_jobs_units` (`unit_key`, `name`, `is_default`, `equip_json`, " +
          "`color_r`, `color_g`, `color_b`, `color_a`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          unit.unitKey,
          unit.name,
          unit.isDefault ? 1 : 0,
          JSON.stringify(unit.equip ?? []),
          unit.color.r,
          unit.color.g,
          unit.color.b,
          unit.color.a,
        ],
      );

      for (const subunit of unit.subunits ?? []) {
        await conn.execute(
          "INSERT INTO `pd_jobs_subunits` (`unit_key`, `subunit_key`, `name`, `unit`, `is_default`, " +
            "`maxmembers`, `ismedic`, `isleo`, `isengineer`, `equip_json`, " +
            "`color_r`, `color_g`, `color_b`, `color_a`) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            unit.unitKey,
            subunit.subunitKey,
            subunit.name,
            unit.name,
            subunit.isDefault ? 1 : 0,
            subunit.maxMembers,
            subunit.isMedic ? 1 : 0,
            subunit.isLeo ? 1 : 0,
            subunit.isEngineer ? 1 : 0,
            JSON.stringify(subunit.equip ?? []),
            subunit.color.r,
            subunit.color.g,
            subunit.color.b,
            subunit.color.a,
          ],
        );

        for (const job of subunit.jobs ?? []) {
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
              JSON.stringify(job.equip ?? []),
              JSON.stringify(job.model ?? []),
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
}

interface CourseRow {
  fbKey: string;
  name: string;
  description: string;
  position: number;
  color: { r: number; g: number; b: number; a: number };
  equip: string[];
  model: string[];
  badge: unknown;
  access: { units: string[]; subunits: string[]; jobs: string[] };
  teach: string[];
  requires: string[];
  durationDays: number;
  maxHolders: number;
}

async function restoreCourses(courses: CourseRow[]): Promise<void> {
  const toMap = (values: string[] = {} as string[]) => {
    const map: Record<string, true> = {};
    for (const value of values ?? []) map[value] = true;
    return map;
  };

  await transaction(async (conn) => {
    await conn.execute("DELETE FROM `pd_fb_courses`");

    for (const course of courses) {
      await conn.execute(
        "INSERT INTO `pd_fb_courses` (`fb_key`, `name`, `description`, `position`, " +
          "`color_r`, `color_g`, `color_b`, `color_a`, `equip_json`, `model_json`, " +
          "`badge_json`, `access_json`, `teach_json`, `requires_json`, `duration_days`, `max_holders`) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          course.fbKey,
          course.name,
          course.description,
          course.position,
          course.color.r,
          course.color.g,
          course.color.b,
          course.color.a,
          JSON.stringify(course.equip ?? []),
          JSON.stringify(course.model ?? []),
          JSON.stringify(course.badge ?? {}),
          JSON.stringify({
            units: toMap(course.access?.units),
            subunits: toMap(course.access?.subunits),
            jobs: toMap(course.access?.jobs),
          }),
          JSON.stringify(course.teach ?? []),
          JSON.stringify(course.requires ?? []),
          course.durationDays,
          course.maxHolders,
        ],
      );
    }
  });
}

export async function POST(request: Request) {
  let user;

  try {
    user = await requireUser("editor");
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Datenbank nicht erreichbar" }, { status: 503 });
  }

  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const parsed = z.object({ id: z.number().int().positive() }).safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  try {
    // Der Eintrag wird über die letzten Protokollzeilen gesucht - weiter zurück
    // ist eine Rücknahme ohnehin nicht sinnvoll.
    const entries = await listAudit(200);
    const entry = entries.find((item) => item.id === parsed.data.id);

    if (!entry) {
      return NextResponse.json(
        { error: "Eintrag nicht gefunden oder zu alt" },
        { status: 404 },
      );
    }

    const config = UNDOABLE[entry.action];

    if (!config) {
      return NextResponse.json(
        { error: "Diese Änderung lässt sich nicht zurücknehmen" },
        { status: 400 },
      );
    }

    if (!Array.isArray(entry.before)) {
      return NextResponse.json(
        { error: "Zu dieser Änderung wurde kein Vorher-Zustand gesichert" },
        { status: 400 },
      );
    }

    await createBackup(config.scope, `Automatisch vor der Rücknahme von Eintrag ${entry.id}`);

    if (config.scope === "jobs") {
      await restoreJobs(entry.before as UnitRow[]);
    } else {
      await restoreCourses(entry.before as CourseRow[]);
    }

    await writeAudit({
      user,
      action: `${config.scope}.undo`,
      targetType: config.scope,
      targetKey: String(entry.id),
      note: `Rücknahme von "${entry.action}" durch ${entry.displayName}`,
    });

    const reload = await reloadServer(config.scope === "jobs" ? "jobs" : "fortbildung");

    return NextResponse.json({
      ok: true,
      message: `Zustand von vor der Änderung wiederhergestellt (${config.label}).`,
      reload: { ok: reload.ok, message: reload.message },
    });
  } catch (error) {
    console.error("[undo] fehlgeschlagen:", error);

    return NextResponse.json(
      { error: "Rücknahme fehlgeschlagen", detail: (error as Error).message },
      { status: 500 },
    );
  }
}
