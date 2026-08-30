import type { PoolConnection } from "mysql2/promise";
import { query, transaction } from "./db";
import type { ServerConfig } from "./servers";

/**
 * Zugriff auf den Jobbaum: Unit -> Subunit -> Job.
 *
 * Eine Eigenheit des Datenmodells, die hier zwingend eingehalten werden muss:
 * die Spalten `subunits.unit` und `jobs.unit` enthalten NICHT den Schlüssel des
 * Elternteils, sondern dessen ANZEIGENAMEN. Der Gamemode sucht darüber
 * (PD.JOBS.GetSubUnit(jobTbl.unit) in Waffenkiste und Umkleide). Wird eine
 * Einheit umbenannt, ohne diese Spiegel nachzuziehen, findet der Server die
 * Subunit nicht mehr und die Ausrüstung fällt weg.
 *
 * Deshalb schreibt jede Umbenennung hier auch die Kindeinträge mit.
 */

export interface JobColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface JobEntry {
  jobKey: string;
  name: string;
  salary: number;
  speed: number;
  position: number;
  showId: boolean;
  isDefault: boolean;
  equip: string[];
  model: string[];
  color: JobColor;
}

export interface SubunitEntry {
  subunitKey: string;
  name: string;
  isDefault: boolean;
  maxMembers: number;
  isMedic: boolean;
  isLeo: boolean;
  isEngineer: boolean;
  equip: string[];
  color: JobColor;
  jobs: JobEntry[];
}

export interface UnitEntry {
  unitKey: string;
  name: string;
  isDefault: boolean;
  equip: string[];
  color: JobColor;
  subunits: SubunitEntry[];
}

const WHITE: JobColor = { r: 255, g: 255, b: 255, a: 255 };

function toColor(row: Record<string, unknown>): JobColor {
  return {
    r: Number(row.color_r ?? 255),
    g: Number(row.color_g ?? 255),
    b: Number(row.color_b ?? 255),
    a: Number(row.color_a ?? 255),
  };
}

function toStringArray(value: unknown): string[] {
  if (typeof value !== "string" || value === "") return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

/** Der Gamemode schreibt Arrays als JSON, leere Arrays als "[]". */
function fromStringArray(values: string[]): string {
  return JSON.stringify(values ?? []);
}

// server: optional, um den Baum eines anderen Servers zu lesen (Uebertragen
// zwischen Test und Live). Ohne Angabe der gerade gewaehlte Server.
export async function loadTree(server?: ServerConfig): Promise<UnitEntry[]> {
  const [units, subunits, jobs] = await Promise.all([
    query<Record<string, unknown>>("SELECT * FROM `pd_jobs_units`", [], server),
    query<Record<string, unknown>>("SELECT * FROM `pd_jobs_subunits`", [], server),
    query<Record<string, unknown>>("SELECT * FROM `pd_jobs_jobs`", [], server),
  ]);

  const tree: UnitEntry[] = units.map((row) => ({
    unitKey: String(row.unit_key),
    name: String(row.name ?? ""),
    isDefault: Number(row.is_default) === 1,
    equip: toStringArray(row.equip_json),
    color: toColor(row),
    subunits: [],
  }));

  const unitByKey = new Map(tree.map((unit) => [unit.unitKey, unit]));

  const subunitByKey = new Map<string, SubunitEntry>();

  for (const row of subunits) {
    const unit = unitByKey.get(String(row.unit_key));
    if (!unit) continue;

    const subunit: SubunitEntry = {
      subunitKey: String(row.subunit_key),
      name: String(row.name ?? ""),
      isDefault: Number(row.is_default) === 1,
      maxMembers: Number(row.maxmembers ?? 0),
      isMedic: Number(row.ismedic) === 1,
      isLeo: Number(row.isleo) === 1,
      isEngineer: Number(row.isengineer) === 1,
      equip: toStringArray(row.equip_json),
      color: toColor(row),
      jobs: [],
    };

    unit.subunits.push(subunit);
    subunitByKey.set(`${row.unit_key}/${row.subunit_key}`, subunit);
  }

  for (const row of jobs) {
    const subunit = subunitByKey.get(`${row.unit_key}/${row.subunit_key}`);
    if (!subunit) continue;

    subunit.jobs.push({
      jobKey: String(row.job_key),
      name: String(row.name ?? ""),
      salary: Number(row.salary ?? 0),
      speed: Number(row.speed ?? 100),
      position: Number(row.position ?? 0),
      showId: Number(row.showid) === 1,
      isDefault: Number(row.is_default) === 1,
      equip: toStringArray(row.equip_json),
      model: toStringArray(row.model_json),
      color: toColor(row),
    });
  }

  // Stabile Reihenfolge: Jobs nach position, alles andere nach Name.
  for (const unit of tree) {
    for (const subunit of unit.subunits) {
      subunit.jobs.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    }

    unit.subunits.sort((a, b) => a.name.localeCompare(b.name));
  }

  tree.sort((a, b) => a.name.localeCompare(b.name));

  return tree;
}

/**
 * Nächster freier Schlüssel. Der Gamemode vergibt "JOB_<n>" fortlaufend über
 * ALLE drei Ebenen hinweg (CheckIndex in admin/module/jobs/sv_jobs.lua), deshalb
 * wird hier auch über alle drei gesucht.
 */
export async function nextKey(): Promise<string> {
  const rows = await query<{ k: string }>(
    "SELECT `unit_key` AS k FROM `pd_jobs_units` " +
      "UNION SELECT `subunit_key` FROM `pd_jobs_subunits` " +
      "UNION SELECT `job_key` FROM `pd_jobs_jobs`",
  );

  let highest = 0;

  for (const row of rows) {
    const match = /^JOB_(\d+)$/.exec(String(row.k));
    if (!match) continue;

    const value = Number(match[1]);
    if (value > highest) highest = value;
  }

  return `JOB_${highest + 1}`;
}

// --- Schreibende Vorgänge ---------------------------------------------------

export interface UnitInput {
  name: string;
  isDefault: boolean;
  equip: string[];
  color: JobColor;
}

export interface SubunitInput extends UnitInput {
  maxMembers: number;
  isMedic: boolean;
  isLeo: boolean;
  isEngineer: boolean;
}

export interface JobInput extends UnitInput {
  salary: number;
  speed: number;
  position: number;
  showId: boolean;
  model: string[];
}

async function currentUnitName(
  conn: PoolConnection,
  unitKey: string,
): Promise<string | null> {
  const [rows] = await conn.execute(
    "SELECT `name` FROM `pd_jobs_units` WHERE `unit_key` = ?",
    [unitKey],
  );

  const row = (rows as Array<{ name: string }>)[0];
  return row ? String(row.name ?? "") : null;
}

export async function saveUnit(
  unitKey: string,
  input: UnitInput,
  isNew: boolean,
): Promise<void> {
  await transaction(async (conn) => {
    const previousName = isNew ? null : await currentUnitName(conn, unitKey);

    if (isNew) {
      await conn.execute(
        "INSERT INTO `pd_jobs_units` " +
          "(`unit_key`, `name`, `is_default`, `equip_json`, `color_r`, `color_g`, `color_b`, `color_a`) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          unitKey,
          input.name,
          input.isDefault ? 1 : 0,
          fromStringArray(input.equip),
          input.color.r,
          input.color.g,
          input.color.b,
          input.color.a,
        ],
      );
    } else {
      await conn.execute(
        "UPDATE `pd_jobs_units` SET `name` = ?, `is_default` = ?, `equip_json` = ?, " +
          "`color_r` = ?, `color_g` = ?, `color_b` = ?, `color_a` = ? WHERE `unit_key` = ?",
        [
          input.name,
          input.isDefault ? 1 : 0,
          fromStringArray(input.equip),
          input.color.r,
          input.color.g,
          input.color.b,
          input.color.a,
          unitKey,
        ],
      );
    }

    // Anzeigenamen-Spiegel in den Subunits nachziehen, siehe Kommentar oben.
    if (previousName !== null && previousName !== input.name) {
      await conn.execute(
        "UPDATE `pd_jobs_subunits` SET `unit` = ? WHERE `unit_key` = ?",
        [input.name, unitKey],
      );
    }

    if (input.isDefault) {
      await conn.execute(
        "UPDATE `pd_jobs_units` SET `is_default` = 0 WHERE `unit_key` <> ?",
        [unitKey],
      );
    }
  });
}

export async function saveSubunit(
  unitKey: string,
  subunitKey: string,
  input: SubunitInput,
  isNew: boolean,
): Promise<void> {
  await transaction(async (conn) => {
    const unitName = (await currentUnitName(conn, unitKey)) ?? "";

    let previousName: string | null = null;

    if (!isNew) {
      const [rows] = await conn.execute(
        "SELECT `name` FROM `pd_jobs_subunits` WHERE `unit_key` = ? AND `subunit_key` = ?",
        [unitKey, subunitKey],
      );
      const row = (rows as Array<{ name: string }>)[0];
      previousName = row ? String(row.name ?? "") : null;
    }

    const values = [
      input.name,
      unitName,
      input.isDefault ? 1 : 0,
      input.maxMembers,
      input.isMedic ? 1 : 0,
      input.isLeo ? 1 : 0,
      input.isEngineer ? 1 : 0,
      fromStringArray(input.equip),
      input.color.r,
      input.color.g,
      input.color.b,
      input.color.a,
    ];

    if (isNew) {
      await conn.execute(
        "INSERT INTO `pd_jobs_subunits` " +
          "(`unit_key`, `subunit_key`, `name`, `unit`, `is_default`, `maxmembers`, `ismedic`, `isleo`, " +
          "`isengineer`, `equip_json`, `color_r`, `color_g`, `color_b`, `color_a`) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [unitKey, subunitKey, ...values],
      );
    } else {
      await conn.execute(
        "UPDATE `pd_jobs_subunits` SET `name` = ?, `unit` = ?, `is_default` = ?, `maxmembers` = ?, " +
          "`ismedic` = ?, `isleo` = ?, `isengineer` = ?, `equip_json` = ?, " +
          "`color_r` = ?, `color_g` = ?, `color_b` = ?, `color_a` = ? " +
          "WHERE `unit_key` = ? AND `subunit_key` = ?",
        [...values, unitKey, subunitKey],
      );
    }

    if (previousName !== null && previousName !== input.name) {
      await conn.execute(
        "UPDATE `pd_jobs_jobs` SET `unit` = ? WHERE `unit_key` = ? AND `subunit_key` = ?",
        [input.name, unitKey, subunitKey],
      );
    }

    if (input.isDefault) {
      await conn.execute(
        "UPDATE `pd_jobs_subunits` SET `is_default` = 0 WHERE NOT (`unit_key` = ? AND `subunit_key` = ?)",
        [unitKey, subunitKey],
      );
    }
  });
}

export async function saveJob(
  unitKey: string,
  subunitKey: string,
  jobKey: string,
  input: JobInput,
  isNew: boolean,
): Promise<void> {
  await transaction(async (conn) => {
    const [subRows] = await conn.execute(
      "SELECT `name` FROM `pd_jobs_subunits` WHERE `unit_key` = ? AND `subunit_key` = ?",
      [unitKey, subunitKey],
    );

    const subunitName = String(
      (subRows as Array<{ name: string }>)[0]?.name ?? "",
    );

    const values = [
      input.name,
      // Spiegel des Subunit-Anzeigenamens, siehe Kommentar oben
      subunitName,
      jobKey,
      input.salary,
      input.speed,
      input.position,
      input.showId ? 1 : 0,
      input.isDefault ? 1 : 0,
      fromStringArray(input.equip),
      fromStringArray(input.model),
      input.color.r,
      input.color.g,
      input.color.b,
      input.color.a,
    ];

    if (isNew) {
      await conn.execute(
        "INSERT INTO `pd_jobs_jobs` " +
          "(`unit_key`, `subunit_key`, `job_key`, `name`, `unit`, `job_id`, `salary`, `speed`, `position`, " +
          "`showid`, `is_default`, `equip_json`, `model_json`, `color_r`, `color_g`, `color_b`, `color_a`) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [unitKey, subunitKey, jobKey, ...values],
      );
    } else {
      await conn.execute(
        "UPDATE `pd_jobs_jobs` SET `name` = ?, `unit` = ?, `job_id` = ?, `salary` = ?, `speed` = ?, " +
          "`position` = ?, `showid` = ?, `is_default` = ?, `equip_json` = ?, `model_json` = ?, " +
          "`color_r` = ?, `color_g` = ?, `color_b` = ?, `color_a` = ? " +
          "WHERE `unit_key` = ? AND `subunit_key` = ? AND `job_key` = ?",
        [...values, unitKey, subunitKey, jobKey],
      );
    }

    if (input.isDefault) {
      await conn.execute(
        "UPDATE `pd_jobs_jobs` SET `is_default` = 0 " +
          "WHERE NOT (`unit_key` = ? AND `subunit_key` = ? AND `job_key` = ?)",
        [unitKey, subunitKey, jobKey],
      );
    }
  });
}

export async function deleteUnit(unitKey: string): Promise<void> {
  await transaction(async (conn) => {
    await conn.execute("DELETE FROM `pd_jobs_jobs` WHERE `unit_key` = ?", [unitKey]);
    await conn.execute("DELETE FROM `pd_jobs_subunits` WHERE `unit_key` = ?", [unitKey]);
    await conn.execute("DELETE FROM `pd_jobs_units` WHERE `unit_key` = ?", [unitKey]);
  });
}

export async function deleteSubunit(
  unitKey: string,
  subunitKey: string,
): Promise<void> {
  await transaction(async (conn) => {
    await conn.execute(
      "DELETE FROM `pd_jobs_jobs` WHERE `unit_key` = ? AND `subunit_key` = ?",
      [unitKey, subunitKey],
    );
    await conn.execute(
      "DELETE FROM `pd_jobs_subunits` WHERE `unit_key` = ? AND `subunit_key` = ?",
      [unitKey, subunitKey],
    );
  });
}

export async function deleteJob(
  unitKey: string,
  subunitKey: string,
  jobKey: string,
): Promise<void> {
  await query(
    "DELETE FROM `pd_jobs_jobs` WHERE `unit_key` = ? AND `subunit_key` = ? AND `job_key` = ?",
    [unitKey, subunitKey, jobKey],
  );
}

/**
 * Wie viele Charaktere hängen an diesem Knoten? Vor dem Löschen wichtig: die
 * Zuordnung steckt in pd_characters und würde sonst ins Leere zeigen.
 */
export async function countAffectedCharacters(
  unitKey: string,
  subunitKey?: string,
  jobKey?: string,
): Promise<number> {
  let sql = "SELECT COUNT(*) AS c FROM `pd_characters` WHERE `faction_unit` = ?";
  const params: string[] = [unitKey];

  if (subunitKey) {
    sql += " AND `faction_subunit` = ?";
    params.push(subunitKey);
  }

  if (jobKey) {
    sql += " AND `faction_job` = ?";
    params.push(jobKey);
  }

  const rows = await query<{ c: number }>(sql, params);

  return Number(rows[0]?.c ?? 0);
}

export { WHITE as DEFAULT_COLOR };
