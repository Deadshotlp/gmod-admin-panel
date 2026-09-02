import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { getActiveServer } from "@/lib/servers";

export const dynamic = "force-dynamic";

/**
 * Bestand der installierten Waffen und Playermodels, für die Auswahllisten.
 *
 * Quelle ist pd_server_assets - dieselbe Tabelle, aus der die Ausrüstungsprüfung
 * unter Werkzeuge liest. Der Gamemode schreibt sie beim Start und auf
 * pd_assets_write hin neu.
 *
 * Bewusst ohne Filter und ohne Seitenweise: der Bestand liegt bei einigen
 * hundert Einträgen, das lädt der Browser einmal und sucht dann selbst darin.
 */

export interface AssetEntry {
  key: string;
  label: string;
}

export async function GET() {
  try {
    await requireUser("viewer");
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Datenbank nicht erreichbar" }, { status: 503 });
  }

  try {
    const server = await getActiveServer();

    const rows = await query<{
      asset_type: string;
      asset_key: string;
      label: string;
      updated_at: number;
    }>(
      "SELECT `asset_type`, `asset_key`, `label`, `updated_at` FROM `pd_server_assets` " +
        "WHERE `server_key` = ? ORDER BY `asset_key`",
      [server.serverKey],
    );

    if (rows.length === 0) {
      return NextResponse.json({
        available: false,
        updatedAt: 0,
        weapons: [],
        models: [],
        hint:
          "Der Server hat noch keinen Bestand gemeldet. Er entsteht etwa 20 Sekunden " +
          "nach dem Start; mit pd_assets_write in der Serverkonsole sofort.",
      });
    }

    const weapons: AssetEntry[] = [];
    const models: AssetEntry[] = [];
    let updatedAt = 0;

    for (const row of rows) {
      const entry = { key: row.asset_key, label: row.label || row.asset_key };

      if (row.asset_type === "weapon") weapons.push(entry);
      else if (row.asset_type === "model") models.push(entry);

      const time = Number(row.updated_at);
      if (time > updatedAt) updatedAt = time;
    }

    return NextResponse.json({ available: true, updatedAt, weapons, models });
  } catch (error) {
    // Tabelle fehlt noch - dann eben keine Liste, aber auch kein Fehler im UI.
    console.error("[assets] Laden fehlgeschlagen:", error);

    return NextResponse.json({
      available: false,
      updatedAt: 0,
      weapons: [],
      models: [],
      hint: "Die Tabelle pd_server_assets fehlt noch.",
    });
  }
}
