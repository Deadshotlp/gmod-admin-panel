import { execute, query } from "./db";
import { ensurePanelTables, type PanelUser } from "./auth";

/**
 * Änderungsprotokoll.
 *
 * Jede schreibende Aktion landet hier mit Vorher- und Nachher-Stand. Das ist
 * die Grundlage dafür, eine Änderung später nachvollziehen oder zurücknehmen zu
 * können - und der einzige Weg herauszufinden, wer eine Einheit umbenannt hat.
 */

export interface AuditEntry {
  id: number;
  steamId: string;
  displayName: string;
  action: string;
  targetType: string;
  targetKey: string;
  before: unknown;
  after: unknown;
  note: string;
  createdAt: number;
}

function safeJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;

  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function parseJson(value: string | null): unknown {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function writeAudit(options: {
  user: PanelUser | null;
  action: string;
  targetType?: string;
  targetKey?: string;
  before?: unknown;
  after?: unknown;
  note?: string;
}): Promise<void> {
  await ensurePanelTables();

  await execute(
    "INSERT INTO `pd_panel_audit` " +
      "(`steamid64`, `display_name`, `action`, `target_type`, `target_key`, `before_json`, `after_json`, `note`, `created_at`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      options.user?.steamId ?? "",
      options.user?.displayName ?? "System",
      options.action.slice(0, 64),
      (options.targetType ?? "").slice(0, 64),
      (options.targetKey ?? "").slice(0, 191),
      safeJson(options.before),
      safeJson(options.after),
      (options.note ?? "").slice(0, 255),
      Math.floor(Date.now() / 1000),
    ],
  );
}

export async function listAudit(limit = 50): Promise<AuditEntry[]> {
  await ensurePanelTables();

  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);

  const rows = await query<{
    id: number;
    steamid64: string;
    display_name: string;
    action: string;
    target_type: string;
    target_key: string;
    before_json: string | null;
    after_json: string | null;
    note: string;
    created_at: number;
  }>(
    // LIMIT lässt sich nicht als Platzhalter binden, deshalb oben hart begrenzt
    // und auf eine ganze Zahl gerundet.
    `SELECT * FROM \`pd_panel_audit\` ORDER BY \`created_at\` DESC, \`id\` DESC LIMIT ${safeLimit}`,
  );

  return rows.map((row) => ({
    id: Number(row.id),
    steamId: row.steamid64,
    displayName: row.display_name,
    action: row.action,
    targetType: row.target_type,
    targetKey: row.target_key,
    before: parseJson(row.before_json),
    after: parseJson(row.after_json),
    note: row.note,
    createdAt: Number(row.created_at),
  }));
}
