import { query } from "./db";
import { getActiveServer } from "./servers";

/**
 * Bestand der tatsächlich installierten Waffen und Playermodels.
 *
 * Der Gamemode schreibt ihn beim Start in pd_server_assets (siehe
 * modules/admin/module/remote/sv_assets.lua). Damit lässt sich prüfen, ob ein
 * Eintrag in Jobs, Fortbildungen oder der Waffenkiste auf etwas verweist, das
 * es auf dem Server gar nicht gibt - der Klassiker unter den Tippfehlern.
 */

export interface AssetInventory {
  available: boolean;
  updatedAt: number;
  weapons: Set<string>;
  models: Set<string>;
}

export async function loadInventory(): Promise<AssetInventory> {
  const server = await getActiveServer();

  try {
    const rows = await query<{
      asset_type: string;
      asset_key: string;
      updated_at: number;
    }>(
      "SELECT `asset_type`, `asset_key`, `updated_at` FROM `pd_server_assets` WHERE `server_key` = ?",
      [server.serverKey],
    );

    if (rows.length === 0) {
      return {
        available: false,
        updatedAt: 0,
        weapons: new Set(),
        models: new Set(),
      };
    }

    const weapons = new Set<string>();
    const models = new Set<string>();
    let updatedAt = 0;

    for (const row of rows) {
      // Kleinschreibung: Modelpfade werden im Gamemode uneinheitlich notiert.
      if (row.asset_type === "weapon") weapons.add(row.asset_key.toLowerCase());
      else if (row.asset_type === "model") models.add(row.asset_key.toLowerCase());

      const time = Number(row.updated_at);
      if (time > updatedAt) updatedAt = time;
    }

    return { available: true, updatedAt, weapons, models };
  } catch {
    // Tabelle fehlt noch - dann eben keine Prüfung.
    return { available: false, updatedAt: 0, weapons: new Set(), models: new Set() };
  }
}

export interface UnknownEntry {
  type: "weapon" | "model";
  value: string;
  where: string;
}

/** Prüft eine Liste gegen den Bestand und meldet, was es nicht gibt. */
export function findUnknown(
  inventory: AssetInventory,
  entries: Array<{ type: "weapon" | "model"; value: string; where: string }>,
): UnknownEntry[] {
  if (!inventory.available) return [];

  const unknown: UnknownEntry[] = [];

  for (const entry of entries) {
    const pool = entry.type === "weapon" ? inventory.weapons : inventory.models;

    if (!pool.has(entry.value.toLowerCase())) {
      unknown.push(entry);
    }
  }

  return unknown;
}
