/**
 * Galaktischer Feldzug - Tabellen und Laden/Speichern.
 *
 * Die Tabellen pd_fz_* legt das Panel selbst an (CREATE TABLE IF NOT EXISTS);
 * der Gameserver liest sie nur (gamemode modules/feldzug).
 */

import { execute, query, queryOne } from "@/lib/db";
import { DEFAULT_SETTINGS, DEFAULT_UNIT_TYPES } from "./types";
import type { CampaignStatus, CampaignSystem, HopGraph, Settings, Side, Unit, UnitType } from "./types";

let ready = false;

const TABLES = [
  `CREATE TABLE IF NOT EXISTS \`pd_fz_campaigns\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`name\` VARCHAR(128) NOT NULL,
    \`status\` VARCHAR(16) NOT NULL DEFAULT 'setup',
    \`turn\` INT NOT NULL DEFAULT 0,
    \`hq_republik\` VARCHAR(64) NOT NULL DEFAULT '',
    \`hq_kus\` VARCHAR(64) NOT NULL DEFAULT '',
    \`points_republik\` INT NOT NULL DEFAULT 0,
    \`points_kus\` INT NOT NULL DEFAULT 0,
    \`ready_republik\` TINYINT NOT NULL DEFAULT 0,
    \`ready_kus\` TINYINT NOT NULL DEFAULT 0,
    \`settings_json\` TEXT NOT NULL,
    \`graph_json\` MEDIUMTEXT NOT NULL,
    \`territory_backup\` MEDIUMTEXT NOT NULL,
    \`created_at\` BIGINT NOT NULL DEFAULT 0,
    \`updated_at\` BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS \`pd_fz_commanders\` (
    \`campaign_id\` INT UNSIGNED NOT NULL,
    \`steamid64\` VARCHAR(32) NOT NULL,
    \`side\` VARCHAR(16) NOT NULL,
    PRIMARY KEY (\`campaign_id\`, \`steamid64\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS \`pd_fz_systems\` (
    \`campaign_id\` INT UNSIGNED NOT NULL,
    \`system_id\` VARCHAR(64) NOT NULL,
    \`owner\` VARCHAR(16) NOT NULL DEFAULT '',
    \`tier\` TINYINT NOT NULL DEFAULT 1,
    \`traits\` VARCHAR(255) NOT NULL DEFAULT '',
    \`fort\` TINYINT NOT NULL DEFAULT 0,
    \`contested\` TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (\`campaign_id\`, \`system_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS \`pd_fz_unit_types\` (
    \`key\` VARCHAR(64) NOT NULL,
    \`side\` VARCHAR(16) NOT NULL,
    \`category\` VARCHAR(16) NOT NULL,
    \`name\` VARCHAR(128) NOT NULL,
    \`men\` INT NOT NULL DEFAULT 144,
    \`cost\` INT NOT NULL DEFAULT 100,
    \`build_turns\` INT NOT NULL DEFAULT 1,
    \`attack\` FLOAT NOT NULL DEFAULT 10,
    \`defense\` FLOAT NOT NULL DEFAULT 10,
    \`speed\` FLOAT NOT NULL DEFAULT 0,
    \`capacity\` INT NOT NULL DEFAULT 0,
    \`naval_class\` VARCHAR(64) NOT NULL DEFAULT '',
    \`build_at\` VARCHAR(16) NOT NULL DEFAULT 'hq',
    \`position\` INT NOT NULL DEFAULT 0,
    PRIMARY KEY (\`key\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS \`pd_fz_units\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`campaign_id\` INT UNSIGNED NOT NULL,
    \`side\` VARCHAR(16) NOT NULL,
    \`type\` VARCHAR(64) NOT NULL,
    \`system_id\` VARCHAR(64) NOT NULL,
    \`strength\` FLOAT NOT NULL DEFAULT 1,
    \`xp\` FLOAT NOT NULL DEFAULT 0,
    \`status\` VARCHAR(16) NOT NULL DEFAULT 'ready',
    \`ready_turn\` INT NOT NULL DEFAULT 0,
    \`fleet_id\` INT UNSIGNED NULL,
    \`naval_ship_id\` INT UNSIGNED NULL,
    PRIMARY KEY (\`id\`),
    KEY \`campaign\` (\`campaign_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS \`pd_fz_orders\` (
    \`campaign_id\` INT UNSIGNED NOT NULL,
    \`turn\` INT NOT NULL,
    \`side\` VARCHAR(16) NOT NULL,
    \`slot\` TINYINT NOT NULL,
    \`kind\` VARCHAR(24) NOT NULL,
    \`data_json\` TEXT NOT NULL,
    \`result\` TEXT NOT NULL,
    PRIMARY KEY (\`campaign_id\`, \`turn\`, \`side\`, \`slot\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS \`pd_fz_battles\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`campaign_id\` INT UNSIGNED NOT NULL,
    \`turn\` INT NOT NULL,
    \`system_id\` VARCHAR(64) NOT NULL,
    \`kind\` VARCHAR(16) NOT NULL DEFAULT 'ground',
    \`attacker\` VARCHAR(16) NOT NULL,
    \`mode\` VARCHAR(16) NOT NULL DEFAULT 'ki',
    \`status\` VARCHAR(16) NOT NULL DEFAULT 'open',
    \`seed\` INT UNSIGNED NOT NULL DEFAULT 0,
    \`result_json\` MEDIUMTEXT NOT NULL,
    \`scheduled_at\` BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`),
    KEY \`campaign\` (\`campaign_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS \`pd_fz_reports\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`campaign_id\` INT UNSIGNED NOT NULL,
    \`turn\` INT NOT NULL,
    \`side\` VARCHAR(16) NOT NULL,
    \`kind\` VARCHAR(24) NOT NULL DEFAULT 'info',
    \`text\` TEXT NOT NULL,
    \`created_at\` BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`),
    KEY \`campaign\` (\`campaign_id\`, \`side\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

export async function ensureFeldzugTables(): Promise<void> {
  if (ready) return;
  for (const sql of TABLES) await execute(sql);

  // Startkatalog, wenn leer
  const count = await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM `pd_fz_unit_types`");
  if (Number(count?.c ?? 0) === 0) {
    for (const t of DEFAULT_UNIT_TYPES) await saveUnitType(t);
  }
  ready = true;
}

const now = () => Math.floor(Date.now() / 1000);

function parse<T>(text: string | null | undefined, fallback: T): T {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

/* -------------------------------------------------------------------- */
/* Einheitenkatalog                                                      */
/* -------------------------------------------------------------------- */

export async function loadUnitTypes(): Promise<UnitType[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM `pd_fz_unit_types` ORDER BY `side`, `position`, `key`");
  return rows.map((r) => ({
    key: String(r.key),
    side: r.side as Side,
    category: r.category as UnitType["category"],
    name: String(r.name),
    men: Number(r.men),
    cost: Number(r.cost),
    buildTurns: Number(r.build_turns),
    attack: Number(r.attack),
    defense: Number(r.defense),
    speed: Number(r.speed),
    capacity: Number(r.capacity),
    navalClass: String(r.naval_class ?? ""),
    buildAt: String(r.build_at ?? "hq"),
    position: Number(r.position),
  }));
}

export async function saveUnitType(t: UnitType): Promise<void> {
  await execute(
    "REPLACE INTO `pd_fz_unit_types` (`key`, `side`, `category`, `name`, `men`, `cost`, `build_turns`, `attack`, `defense`, `speed`, `capacity`, `naval_class`, `build_at`, `position`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [t.key, t.side, t.category, t.name, t.men, t.cost, t.buildTurns, t.attack, t.defense, t.speed, t.capacity, t.navalClass, t.buildAt, t.position],
  );
}

export async function deleteUnitType(key: string): Promise<void> {
  await execute("DELETE FROM `pd_fz_unit_types` WHERE `key` = ?", [key]);
}

/* -------------------------------------------------------------------- */
/* Feldzug                                                               */
/* -------------------------------------------------------------------- */

export interface Campaign {
  id: number;
  name: string;
  status: CampaignStatus;
  turn: number;
  hq: Record<Side, string>;
  points: Record<Side, number>;
  ready: Record<Side, boolean>;
  settings: Settings;
}

export interface CampaignState {
  campaign: Campaign;
  systems: Map<string, CampaignSystem>;
  units: Unit[];
  commanders: Array<{ steamId: string; side: Side }>;
  graph: HopGraph;
}

export async function listCampaigns(): Promise<Campaign[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM `pd_fz_campaigns` ORDER BY `id` DESC");
  return rows.map(toCampaign);
}

function toCampaign(r: Record<string, unknown>): Campaign {
  return {
    id: Number(r.id),
    name: String(r.name),
    status: r.status as CampaignStatus,
    turn: Number(r.turn),
    hq: { republik: String(r.hq_republik ?? ""), kus: String(r.hq_kus ?? "") },
    points: { republik: Number(r.points_republik), kus: Number(r.points_kus) },
    ready: { republik: Number(r.ready_republik) === 1, kus: Number(r.ready_kus) === 1 },
    settings: { ...DEFAULT_SETTINGS, ...parse<Partial<Settings>>(String(r.settings_json ?? ""), {}) },
  };
}

export async function loadState(id: number): Promise<CampaignState | null> {
  const row = await queryOne<Record<string, unknown>>("SELECT * FROM `pd_fz_campaigns` WHERE `id` = ?", [id]);
  if (!row) return null;

  const [systemRows, unitRows, commanderRows] = await Promise.all([
    query<Record<string, unknown>>(
      "SELECT f.*, s.`name`, s.`gx`, s.`gy` FROM `pd_fz_systems` f JOIN `pd_naval_systems` s ON s.`id` = f.`system_id` WHERE f.`campaign_id` = ?",
      [id],
    ),
    query<Record<string, unknown>>("SELECT * FROM `pd_fz_units` WHERE `campaign_id` = ?", [id]),
    query<{ steamid64: string; side: string }>("SELECT `steamid64`, `side` FROM `pd_fz_commanders` WHERE `campaign_id` = ?", [id]),
  ]);

  const systems = new Map<string, CampaignSystem>();
  for (const r of systemRows) {
    systems.set(String(r.system_id), {
      id: String(r.system_id),
      name: String(r.name),
      x: Number(r.gx),
      y: Number(r.gy),
      owner: r.owner ? (String(r.owner) as Side) : null,
      tier: Number(r.tier),
      traits: String(r.traits ?? "").split(",").filter(Boolean),
      fort: Number(r.fort),
      contested: Number(r.contested) === 1,
    });
  }

  return {
    campaign: toCampaign(row),
    systems,
    units: unitRows.map((r) => ({
      id: Number(r.id),
      side: r.side as Side,
      type: String(r.type),
      systemId: String(r.system_id),
      strength: Number(r.strength),
      xp: Number(r.xp),
      status: r.status as Unit["status"],
      readyTurn: Number(r.ready_turn),
      fleetId: r.fleet_id == null ? null : Number(r.fleet_id),
      navalShipId: r.naval_ship_id == null ? null : Number(r.naval_ship_id),
    })),
    commanders: commanderRows.map((c) => ({ steamId: c.steamid64, side: c.side as Side })),
    graph: parse<HopGraph>(String(row.graph_json ?? ""), {}),
  };
}

export async function createCampaign(name: string, settings: Settings): Promise<number> {
  const result = await execute(
    "INSERT INTO `pd_fz_campaigns` (`name`, `settings_json`, `graph_json`, `territory_backup`, `points_republik`, `points_kus`, `created_at`, `updated_at`) " +
      "VALUES (?, ?, '{}', '', ?, ?, ?, ?)",
    [name, JSON.stringify(settings), settings.startPoints, settings.startPoints, now(), now()],
  );
  return Number((result as { insertId?: number }).insertId ?? 0);
}

export async function updateCampaign(c: Campaign): Promise<void> {
  await execute(
    "UPDATE `pd_fz_campaigns` SET `name` = ?, `status` = ?, `turn` = ?, `hq_republik` = ?, `hq_kus` = ?, `points_republik` = ?, `points_kus` = ?, " +
      "`ready_republik` = ?, `ready_kus` = ?, `settings_json` = ?, `updated_at` = ? WHERE `id` = ?",
    [c.name, c.status, c.turn, c.hq.republik, c.hq.kus, Math.round(c.points.republik), Math.round(c.points.kus),
      c.ready.republik ? 1 : 0, c.ready.kus ? 1 : 0, JSON.stringify(c.settings), now(), c.id],
  );
}

export async function saveGraph(id: number, graph: HopGraph): Promise<void> {
  await execute("UPDATE `pd_fz_campaigns` SET `graph_json` = ? WHERE `id` = ?", [JSON.stringify(graph), id]);
}

/** Gebiet ersetzen: Systeme ausserhalb fallen weg, neue kommen neutral dazu */
export async function setRegion(id: number, systems: Array<{ id: string; tier: number; traits: string[] }>): Promise<void> {
  await execute("DELETE FROM `pd_fz_systems` WHERE `campaign_id` = ?", [id]);
  for (let i = 0; i < systems.length; i += 200) {
    const chunk = systems.slice(i, i + 200);
    await execute(
      "INSERT INTO `pd_fz_systems` (`campaign_id`, `system_id`, `tier`, `traits`) VALUES " + chunk.map(() => "(?, ?, ?, ?)").join(", "),
      chunk.flatMap((s) => [id, s.id, s.tier, s.traits.join(",")]),
    );
  }
}

export async function saveSystem(id: number, s: CampaignSystem): Promise<void> {
  await execute(
    "UPDATE `pd_fz_systems` SET `owner` = ?, `tier` = ?, `traits` = ?, `fort` = ?, `contested` = ? WHERE `campaign_id` = ? AND `system_id` = ?",
    [s.owner ?? "", s.tier, s.traits.join(","), s.fort, s.contested ? 1 : 0, id, s.id],
  );
}

export async function insertUnit(id: number, u: Omit<Unit, "id">): Promise<number> {
  const result = await execute(
    "INSERT INTO `pd_fz_units` (`campaign_id`, `side`, `type`, `system_id`, `strength`, `xp`, `status`, `ready_turn`, `fleet_id`, `naval_ship_id`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, u.side, u.type, u.systemId, u.strength, u.xp, u.status, u.readyTurn, u.fleetId, u.navalShipId],
  );
  return Number((result as { insertId?: number }).insertId ?? 0);
}

export async function saveUnit(u: Unit): Promise<void> {
  await execute(
    "UPDATE `pd_fz_units` SET `system_id` = ?, `strength` = ?, `xp` = ?, `status` = ?, `ready_turn` = ?, `fleet_id` = ?, `naval_ship_id` = ? WHERE `id` = ?",
    [u.systemId, u.strength, u.xp, u.status, u.readyTurn, u.fleetId, u.navalShipId, u.id],
  );
}

export async function deleteUnit(unitId: number): Promise<void> {
  await execute("DELETE FROM `pd_fz_units` WHERE `id` = ?", [unitId]);
}

export async function setCommanders(id: number, list: Array<{ steamId: string; side: Side }>): Promise<void> {
  await execute("DELETE FROM `pd_fz_commanders` WHERE `campaign_id` = ?", [id]);
  for (const c of list) {
    await execute("INSERT INTO `pd_fz_commanders` (`campaign_id`, `steamid64`, `side`) VALUES (?, ?, ?)", [id, c.steamId, c.side]);
  }
}

export async function addReport(id: number, turn: number, side: Side, kind: string, text: string): Promise<void> {
  await execute("INSERT INTO `pd_fz_reports` (`campaign_id`, `turn`, `side`, `kind`, `text`, `created_at`) VALUES (?, ?, ?, ?, ?, ?)", [
    id, turn, side, kind, text, now(),
  ]);
}

export async function loadReports(id: number, side: Side | null, limit = 60) {
  return query<{ turn: number; side: string; kind: string; text: string; created_at: number }>(
    "SELECT `turn`, `side`, `kind`, `text`, `created_at` FROM `pd_fz_reports` WHERE `campaign_id` = ?" +
      (side ? " AND `side` = ?" : "") +
      " ORDER BY `id` DESC LIMIT " + Math.max(1, Math.min(500, limit)),
    side ? [id, side] : [id],
  );
}

export async function deleteCampaign(id: number): Promise<void> {
  for (const t of ["pd_fz_systems", "pd_fz_units", "pd_fz_commanders", "pd_fz_orders", "pd_fz_battles", "pd_fz_reports"]) {
    await execute(`DELETE FROM \`${t}\` WHERE \`campaign_id\` = ?`, [id]);
  }
  await execute("DELETE FROM `pd_fz_campaigns` WHERE `id` = ?", [id]);
}
