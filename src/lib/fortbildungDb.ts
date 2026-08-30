import { execute, query } from "./db";

/**
 * Zugriff auf die Fortbildungen. Die Tabellen legt das Gamemode-Modul
 * modules/fortbildung an, das Panel schreibt in dieselben.
 *
 * Verschachtelte Werte liegen dort als JSON in LONGTEXT-Spalten - so wie es der
 * Gamemode auch bei den Jobs macht.
 */

export interface CourseColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface BadgeBodygroup {
  model: string;
  index: number;
  value: number;
}

export interface Course {
  fbKey: string;
  name: string;
  description: string;
  position: number;
  color: CourseColor;
  equip: string[];
  model: string[];
  badge: { skin: number | null; bodygroups: BadgeBodygroup[] };
  access: { units: string[]; subunits: string[]; jobs: string[] };
  teach: string[];
  requires: string[];
  durationDays: number;
  maxHolders: number;
  /** Wie viele Charaktere besitzen sie aktuell (nicht abgelaufen). */
  holders: number;
}

export interface Grant {
  charId: string;
  fbKey: string;
  steamId: string;
  grantedAt: number;
  expiresAt: number;
  grantedBy: string;
  charName: string | null;
}

function toArray(value: unknown): string[] {
  if (typeof value !== "string" || value === "") return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

/**
 * access wird vom Gamemode als Map key->true geschrieben. Für das Panel ist eine
 * Liste handlicher, beim Schreiben wird wieder eine Map daraus.
 */
function toKeyList(value: unknown): string[] {
  if (typeof value !== "string" || value === "") return [];

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return [];

    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string");
    }

    return Object.entries(parsed as Record<string, unknown>)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => key);
  } catch {
    return [];
  }
}

function fromKeyList(values: string[]): Record<string, true> {
  const map: Record<string, true> = {};
  for (const value of values) map[value] = true;
  return map;
}

export async function tablesExist(): Promise<boolean> {
  const rows = await query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM information_schema.tables " +
      "WHERE table_schema = DATABASE() AND table_name IN ('pd_fb_courses', 'pd_fb_granted')",
  );

  return Number(rows[0]?.c ?? 0) >= 2;
}

export async function loadCourses(): Promise<Course[]> {
  const now = Math.floor(Date.now() / 1000);

  const [rows, counts] = await Promise.all([
    query<Record<string, unknown>>("SELECT * FROM `pd_fb_courses`"),
    query<{ fb_key: string; c: number }>(
      "SELECT `fb_key`, COUNT(*) AS c FROM `pd_fb_granted` " +
        "WHERE `expires_at` = 0 OR `expires_at` > ? GROUP BY `fb_key`",
      [now],
    ),
  ]);

  const holders = new Map(counts.map((row) => [row.fb_key, Number(row.c)]));

  const courses = rows.map<Course>((row) => {
    let badge: Course["badge"] = { skin: null, bodygroups: [] };

    try {
      const parsed = JSON.parse(String(row.badge_json ?? "{}")) as {
        skin?: number | null;
        bodygroups?: BadgeBodygroup[];
      };

      badge = {
        skin: typeof parsed.skin === "number" ? parsed.skin : null,
        bodygroups: Array.isArray(parsed.bodygroups)
          ? parsed.bodygroups.map((entry) => ({
              model: String(entry.model ?? "*"),
              index: Number(entry.index ?? 0),
              value: Number(entry.value ?? 0),
            }))
          : [],
      };
    } catch {
      // Kaputtes JSON soll nicht die ganze Liste kippen.
    }

    let access = { units: [] as string[], subunits: [] as string[], jobs: [] as string[] };

    try {
      const parsed = JSON.parse(String(row.access_json ?? "{}")) as Record<string, unknown>;

      access = {
        units: toKeyList(JSON.stringify(parsed.units ?? {})),
        subunits: toKeyList(JSON.stringify(parsed.subunits ?? {})),
        jobs: toKeyList(JSON.stringify(parsed.jobs ?? {})),
      };
    } catch {
      // wie oben
    }

    return {
      fbKey: String(row.fb_key),
      name: String(row.name ?? ""),
      description: String(row.description ?? ""),
      position: Number(row.position ?? 0),
      color: {
        r: Number(row.color_r ?? 255),
        g: Number(row.color_g ?? 255),
        b: Number(row.color_b ?? 255),
        a: Number(row.color_a ?? 255),
      },
      equip: toArray(row.equip_json),
      model: toArray(row.model_json),
      badge,
      access,
      teach: toArray(row.teach_json),
      requires: toArray(row.requires_json),
      durationDays: Number(row.duration_days ?? 0),
      maxHolders: Number(row.max_holders ?? 0),
      holders: holders.get(String(row.fb_key)) ?? 0,
    };
  });

  courses.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

  return courses;
}

export interface CourseInput {
  name: string;
  description: string;
  position: number;
  color: CourseColor;
  equip: string[];
  model: string[];
  badge: { skin: number | null; bodygroups: BadgeBodygroup[] };
  access: { units: string[]; subunits: string[]; jobs: string[] };
  teach: string[];
  requires: string[];
  durationDays: number;
  maxHolders: number;
}

export async function nextCourseKey(): Promise<string> {
  const rows = await query<{ fb_key: string }>("SELECT `fb_key` FROM `pd_fb_courses`");

  let highest = 0;

  for (const row of rows) {
    const match = /^FB_(\d+)$/.exec(String(row.fb_key));
    if (!match) continue;

    const value = Number(match[1]);
    if (value > highest) highest = value;
  }

  return `FB_${highest + 1}`;
}

export async function saveCourse(fbKey: string, input: CourseInput): Promise<void> {
  // Voraussetzung auf sich selbst würde die Fortbildung unerreichbar machen.
  const requires = input.requires.filter((entry) => entry !== fbKey);

  await execute(
    "REPLACE INTO `pd_fb_courses` " +
      "(`fb_key`, `name`, `description`, `position`, `color_r`, `color_g`, `color_b`, `color_a`, " +
      "`equip_json`, `model_json`, `badge_json`, `access_json`, `teach_json`, `requires_json`, " +
      "`duration_days`, `max_holders`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      fbKey,
      input.name,
      input.description,
      input.position,
      input.color.r,
      input.color.g,
      input.color.b,
      input.color.a,
      JSON.stringify(input.equip),
      JSON.stringify(input.model),
      JSON.stringify(input.badge),
      JSON.stringify({
        units: fromKeyList(input.access.units),
        subunits: fromKeyList(input.access.subunits),
        jobs: fromKeyList(input.access.jobs),
      }),
      JSON.stringify(input.teach),
      JSON.stringify(requires),
      input.durationDays,
      input.maxHolders,
    ],
  );
}

export async function deleteCourse(fbKey: string): Promise<void> {
  // Vergaben mitlöschen, sonst bleiben verwaiste Zeilen zurück. Die Kurshistorie
  // in pd_fb_sessions bleibt bewusst erhalten.
  await execute("DELETE FROM `pd_fb_granted` WHERE `fb_key` = ?", [fbKey]);
  await execute("DELETE FROM `pd_fb_courses` WHERE `fb_key` = ?", [fbKey]);
}

export async function loadGrants(fbKey?: string): Promise<Grant[]> {
  const params: string[] = [];
  let sql =
    "SELECT g.*, c.`char_name` FROM `pd_fb_granted` g " +
    "LEFT JOIN `pd_characters` c ON c.`char_id` = g.`char_id` ";

  if (fbKey) {
    sql += "WHERE g.`fb_key` = ? ";
    params.push(fbKey);
  }

  sql += "ORDER BY g.`granted_at` DESC LIMIT 500";

  const rows = await query<Record<string, unknown>>(sql, params);

  return rows.map((row) => ({
    charId: String(row.char_id),
    fbKey: String(row.fb_key),
    steamId: String(row.steamid64 ?? ""),
    grantedAt: Number(row.granted_at ?? 0),
    expiresAt: Number(row.expires_at ?? 0),
    grantedBy: String(row.granted_by ?? ""),
    charName: row.char_name ? String(row.char_name) : null,
  }));
}

export async function revokeGrant(charId: string, fbKey: string): Promise<void> {
  await execute("DELETE FROM `pd_fb_granted` WHERE `char_id` = ? AND `fb_key` = ?", [
    charId,
    fbKey,
  ]);
}

export async function grantCourse(
  charId: string,
  fbKey: string,
  steamId: string,
  durationDays: number,
  grantedBy: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  await execute(
    "REPLACE INTO `pd_fb_granted` " +
      "(`char_id`, `fb_key`, `steamid64`, `granted_at`, `expires_at`, `granted_by`, `session_id`) " +
      "VALUES (?, ?, ?, ?, ?, ?, 0)",
    [
      charId,
      fbKey,
      steamId,
      now,
      durationDays > 0 ? now + durationDays * 86400 : 0,
      grantedBy,
    ],
  );
}
