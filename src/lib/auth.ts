import { execute, query, queryOne } from "./db";
import { bootstrapSteamIds } from "./env";
import { getSessionSteamId } from "./session";

/**
 * Berechtigungen des Panels.
 *
 * Der Gamemode hat keine Usergroup-Tabelle - Ränge kommen aus SAM, also aus
 * einem Addon außerhalb dieser Datenbank. Deshalb führt das Panel eine eigene
 * Benutzerliste.
 *
 * Wichtig: die Identität wird ausschließlich aus dem signierten Cookie
 * abgeleitet, nie aus einer Angabe des Clients.
 */

export type PanelRole = "viewer" | "editor" | "admin";

const ROLE_ORDER: Record<PanelRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

export interface PanelUser {
  steamId: string;
  displayName: string;
  role: PanelRole;
  /** true, wenn die Rolle aus PANEL_BOOTSTRAP_STEAM_IDS stammt. */
  isBootstrap: boolean;
}

let tablesReady = false;

export async function ensurePanelTables(): Promise<void> {
  if (tablesReady) return;

  await execute(
    "CREATE TABLE IF NOT EXISTS `pd_panel_users` (" +
      "`steamid64` VARCHAR(32) NOT NULL," +
      "`display_name` VARCHAR(128) NOT NULL DEFAULT ''," +
      "`role` VARCHAR(16) NOT NULL DEFAULT 'viewer'," +
      "`created_at` BIGINT NOT NULL DEFAULT 0," +
      "`created_by` VARCHAR(32) NOT NULL DEFAULT ''," +
      "PRIMARY KEY (`steamid64`)" +
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  );

  await execute(
    "CREATE TABLE IF NOT EXISTS `pd_panel_audit` (" +
      "`id` BIGINT NOT NULL AUTO_INCREMENT," +
      "`steamid64` VARCHAR(32) NOT NULL DEFAULT ''," +
      "`display_name` VARCHAR(128) NOT NULL DEFAULT ''," +
      "`action` VARCHAR(64) NOT NULL," +
      "`target_type` VARCHAR(64) NOT NULL DEFAULT ''," +
      "`target_key` VARCHAR(191) NOT NULL DEFAULT ''," +
      "`before_json` LONGTEXT NULL," +
      "`after_json` LONGTEXT NULL," +
      "`note` VARCHAR(255) NOT NULL DEFAULT ''," +
      "`created_at` BIGINT NOT NULL DEFAULT 0," +
      "PRIMARY KEY (`id`)," +
      "KEY `idx_created` (`created_at`)," +
      "KEY `idx_actor` (`steamid64`)" +
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  );

  tablesReady = true;
}

function isRole(value: unknown): value is PanelRole {
  return value === "viewer" || value === "editor" || value === "admin";
}

/** Der angemeldete Nutzer, oder null wenn niemand angemeldet ist. */
export async function getCurrentUser(): Promise<PanelUser | null> {
  const steamId = await getSessionSteamId();
  if (!steamId) return null;

  await ensurePanelTables();

  const row = await queryOne<{ display_name: string; role: string }>(
    "SELECT `display_name`, `role` FROM `pd_panel_users` WHERE `steamid64` = ?",
    [steamId],
  );

  // Bootstrap-IDs sind immer Admin. Sonst käme man bei leerer Tabelle nie rein.
  if (bootstrapSteamIds().includes(steamId)) {
    return {
      steamId,
      displayName: row?.display_name || steamId,
      role: "admin",
      isBootstrap: true,
    };
  }

  if (!row) return null;

  return {
    steamId,
    displayName: row.display_name || steamId,
    role: isRole(row.role) ? row.role : "viewer",
    isBootstrap: false,
  };
}

export function hasRole(user: PanelUser | null, minimum: PanelRole): boolean {
  if (!user) return false;
  return ROLE_ORDER[user.role] >= ROLE_ORDER[minimum];
}

/**
 * Für API-Routen: liefert den Nutzer oder wirft eine Antwort mit dem passenden
 * Statuscode. Der Aufrufer fängt das mit `authError()` ab.
 */
export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requireUser(minimum: PanelRole): Promise<PanelUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new AuthError(401, "Nicht angemeldet");
  }

  if (!hasRole(user, minimum)) {
    throw new AuthError(403, `Rolle ${minimum} erforderlich`);
  }

  return user;
}

export async function listPanelUsers(): Promise<PanelUser[]> {
  await ensurePanelTables();

  const rows = await query<{
    steamid64: string;
    display_name: string;
    role: string;
  }>("SELECT `steamid64`, `display_name`, `role` FROM `pd_panel_users` ORDER BY `role` DESC, `display_name`");

  return rows.map((row) => ({
    steamId: row.steamid64,
    displayName: row.display_name || row.steamid64,
    role: isRole(row.role) ? row.role : "viewer",
    isBootstrap: false,
  }));
}

/**
 * Aktualisiert den Anzeigenamen eines BEREITS eingetragenen Nutzers.
 *
 * Legt bewusst niemanden neu an: sonst bekäme jeder beliebige Steam-Account
 * durch bloßes Einloggen Leserechte auf die komplette Serverkonfiguration.
 * Neue Nutzer trägt ein Admin über die Benutzerverwaltung ein.
 */
export async function refreshDisplayName(
  steamId: string,
  displayName: string,
): Promise<void> {
  await ensurePanelTables();

  await execute(
    "UPDATE `pd_panel_users` SET `display_name` = ? WHERE `steamid64` = ?",
    [displayName.slice(0, 128), steamId],
  );
}

/** Trägt einen Nutzer mit Rolle ein. Nur für Admins. */
export async function upsertPanelUser(
  steamId: string,
  displayName: string,
  role: PanelRole,
  createdBy: string,
): Promise<void> {
  await ensurePanelTables();

  await execute(
    "INSERT INTO `pd_panel_users` (`steamid64`, `display_name`, `role`, `created_at`, `created_by`) " +
      "VALUES (?, ?, ?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE `display_name` = VALUES(`display_name`), `role` = VALUES(`role`)",
    [
      steamId,
      displayName.slice(0, 128),
      role,
      Math.floor(Date.now() / 1000),
      createdBy,
    ],
  );
}

export async function removePanelUser(steamId: string): Promise<void> {
  await ensurePanelTables();
  await execute("DELETE FROM `pd_panel_users` WHERE `steamid64` = ?", [steamId]);
}
