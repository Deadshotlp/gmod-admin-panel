import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { query, transaction } from "./db";
import { getActiveServer } from "./servers";

/**
 * Sicherungen der Konfigurationstabellen.
 *
 * Vor jeder größeren Änderung wird der betroffene Bereich weggeschrieben. Das
 * kostet fast nichts und ist der Unterschied zwischen "ärgerlich" und
 * "Abend im Eimer", wenn ein Import oder eine Massenänderung schiefgeht.
 *
 * Bewusst als JSON-Dateien statt als mysqldump: das Panel hat keinen Zugriff
 * auf ein mysqldump-Binary im Container, und die Tabellen sind klein.
 */

const DIRECTORY = path.join(process.cwd(), "backups");

/** Welche Tabellen zu welchem Bereich gehören. */
export const BACKUP_SCOPES = {
  jobs: ["pd_jobs_units", "pd_jobs_subunits", "pd_jobs_jobs"],
  fortbildung: ["pd_fb_courses", "pd_fb_granted"],
  waffen: ["pd_wb_config", "pd_wb_categories", "pd_wb_weapons", "pd_wb_always"],
} as const;

export type BackupScope = keyof typeof BACKUP_SCOPES;

export interface BackupInfo {
  file: string;
  scope: string;
  serverId: string;
  createdAt: number;
  reason: string;
  rows: number;
  sizeBytes: number;
}

interface BackupFile {
  scope: string;
  serverId: string;
  createdAt: number;
  reason: string;
  tables: Record<string, Record<string, unknown>[]>;
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "");
}

export async function createBackup(
  scope: BackupScope,
  reason: string,
): Promise<BackupInfo | null> {
  const server = await getActiveServer();
  const tables: Record<string, Record<string, unknown>[]> = {};
  let rows = 0;

  for (const table of BACKUP_SCOPES[scope]) {
    try {
      const data = await query<Record<string, unknown>>(
        `SELECT * FROM \`${table}\``,
      );

      tables[table] = data;
      rows += data.length;
    } catch {
      // Fehlende Tabelle ist kein Grund, die Sicherung abzubrechen - der
      // Bereich ist dann eben noch nicht eingerichtet.
      tables[table] = [];
    }
  }

  const payload: BackupFile = {
    scope,
    serverId: server.id,
    createdAt: Math.floor(Date.now() / 1000),
    reason: reason.slice(0, 200),
    tables,
  };

  const file = `${safeName(server.id)}_${scope}_${payload.createdAt}.json`;

  try {
    await mkdir(DIRECTORY, { recursive: true });
    await writeFile(path.join(DIRECTORY, file), JSON.stringify(payload), "utf8");
  } catch (error) {
    // Eine fehlgeschlagene Sicherung darf die eigentliche Änderung nicht
    // verhindern - sonst steht das Panel bei vollem Datenträger still.
    console.error("[backup] Schreiben fehlgeschlagen:", error);
    return null;
  }

  const size = JSON.stringify(payload).length;

  return {
    file,
    scope,
    serverId: server.id,
    createdAt: payload.createdAt,
    reason: payload.reason,
    rows,
    sizeBytes: size,
  };
}

export async function listBackups(): Promise<BackupInfo[]> {
  try {
    const files = await readdir(DIRECTORY);
    const result: BackupInfo[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      try {
        const full = path.join(DIRECTORY, file);
        const info = await stat(full);
        const parsed = JSON.parse(await readFile(full, "utf8")) as BackupFile;

        result.push({
          file,
          scope: parsed.scope,
          serverId: parsed.serverId,
          createdAt: parsed.createdAt,
          reason: parsed.reason,
          rows: Object.values(parsed.tables).reduce(
            (sum, table) => sum + table.length,
            0,
          ),
          sizeBytes: info.size,
        });
      } catch {
        // Beschädigte Datei überspringen statt die ganze Liste zu verlieren.
      }
    }

    result.sort((a, b) => b.createdAt - a.createdAt);

    return result;
  } catch {
    return [];
  }
}

export async function readBackup(file: string): Promise<BackupFile | null> {
  // Nur Dateinamen, keine Pfade: sonst ließe sich mit ../ aus dem Ordner
  // herauslesen.
  if (file !== path.basename(file)) return null;

  try {
    const content = await readFile(path.join(DIRECTORY, file), "utf8");
    return JSON.parse(content) as BackupFile;
  } catch {
    return null;
  }
}

/**
 * Spielt eine Sicherung zurück. Ersetzt die Tabellen vollständig, in einer
 * Transaktion - ein Teilzustand wäre schlimmer als der aktuelle.
 */
export async function restoreBackup(
  file: string,
): Promise<{ ok: boolean; message: string }> {
  const backup = await readBackup(file);

  if (!backup) return { ok: false, message: "Sicherung nicht lesbar" };

  const scope = backup.scope as BackupScope;

  if (!BACKUP_SCOPES[scope]) {
    return { ok: false, message: "Unbekannter Bereich in der Sicherung" };
  }

  // Vor dem Zurückspielen den aktuellen Stand sichern - sonst ist der Weg
  // zurück versperrt, falls die Sicherung die falsche war.
  await createBackup(scope, `Automatisch vor dem Zurückspielen von ${file}`);

  try {
    await transaction(async (conn) => {
      for (const table of BACKUP_SCOPES[scope]) {
        const rows = backup.tables[table];
        if (!rows) continue;

        await conn.execute(`DELETE FROM \`${table}\``);

        for (const row of rows) {
          const columns = Object.keys(row);
          if (columns.length === 0) continue;

          const placeholders = columns.map(() => "?").join(", ");
          const names = columns.map((column) => `\`${column}\``).join(", ");

          await conn.execute(
            `INSERT INTO \`${table}\` (${names}) VALUES (${placeholders})`,
            columns.map((column) => row[column] as never),
          );
        }
      }
    });

    return { ok: true, message: "Sicherung zurückgespielt" };
  } catch (error) {
    return {
      ok: false,
      message: `Zurückspielen fehlgeschlagen: ${(error as Error).message}`,
    };
  }
}
