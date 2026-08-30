import { query, queryOne } from "./db";
import { getActiveServer } from "./servers";

/**
 * Live-Status des GMod-Servers.
 *
 * Der Server schreibt alle 15 Sekunden einen Heartbeat in pd_server_status und
 * ersetzt dabei seine Zeilen in pd_online_players (siehe
 * gamemode/modules/admin/module/remote/sv_remote.lua).
 */

/** Ab dieser Stille gilt der Server als offline. Vier verpasste Heartbeats. */
const OFFLINE_AFTER_SECONDS = 60;

export interface ServerStatus {
  online: boolean;
  lastSeen: number | null;
  secondsSinceHeartbeat: number | null;
  map: string;
  gamemode: string;
  playerCount: number;
  maxPlayers: number;
  defcon: number;
  defconText: string;
  uptimeSeconds: number;
}

export interface OnlinePlayer {
  steamId: string;
  charId: string;
  name: string;
  jobKey: string;
  unitKey: string;
  subunitKey: string;
  ping: number;
  since: number;
}

const EMPTY: ServerStatus = {
  online: false,
  lastSeen: null,
  secondsSinceHeartbeat: null,
  map: "",
  gamemode: "",
  playerCount: 0,
  maxPlayers: 0,
  defcon: 5,
  defconText: "",
  uptimeSeconds: 0,
};

export async function getServerStatus(): Promise<ServerStatus> {
  const row = await queryOne<{
    last_seen: number;
    map: string;
    gamemode: string;
    player_count: number;
    max_players: number;
    defcon: number;
    defcon_text: string;
    uptime: number;
  }>("SELECT * FROM `pd_server_status` WHERE `server_key` = ?", [(await getActiveServer()).serverKey]);

  if (!row) return EMPTY;

  const lastSeen = Number(row.last_seen);
  const age = Math.floor(Date.now() / 1000) - lastSeen;

  return {
    online: age <= OFFLINE_AFTER_SECONDS,
    lastSeen,
    secondsSinceHeartbeat: age,
    map: row.map ?? "",
    gamemode: row.gamemode ?? "",
    playerCount: Number(row.player_count) || 0,
    maxPlayers: Number(row.max_players) || 0,
    defcon: Number(row.defcon) || 5,
    defconText: row.defcon_text ?? "",
    uptimeSeconds: Number(row.uptime) || 0,
  };
}

export async function getOnlinePlayers(): Promise<OnlinePlayer[]> {
  const rows = await query<{
    steamid64: string;
    char_id: string;
    name: string;
    job_key: string;
    unit_key: string;
    subunit_key: string;
    ping: number;
    since: number;
  }>(
    "SELECT * FROM `pd_online_players` WHERE `server_key` = ? ORDER BY `name`",
    [(await getActiveServer()).serverKey],
  );

  return rows.map((row) => ({
    steamId: row.steamid64,
    charId: row.char_id ?? "",
    name: row.name ?? "",
    jobKey: row.job_key ?? "",
    unitKey: row.unit_key ?? "",
    subunitKey: row.subunit_key ?? "",
    ping: Number(row.ping) || 0,
    since: Number(row.since) || 0,
  }));
}

/**
 * Prüft, ob die Heartbeat-Tabellen überhaupt existieren. Vor dem ersten Start
 * des Gamemode-Moduls gibt es sie nicht - dann soll das Panel das erklären statt
 * einen SQL-Fehler zu zeigen.
 */
export async function heartbeatTablesExist(): Promise<boolean> {
  const rows = await query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM `information_schema`.`tables` " +
      "WHERE `table_schema` = DATABASE() AND `table_name` IN ('pd_server_status', 'pd_online_players')",
  );

  return Number(rows[0]?.c ?? 0) >= 2;
}
