import mysql from "mysql2/promise";
import { dbEnv } from "./env";

/**
 * Verbindungspool zur Gamemode-Datenbank.
 *
 * Der Pool hängt bewusst an globalThis: im Dev-Modus lädt Next die Module bei
 * jeder Änderung neu, und ohne diesen Cache sammeln sich Pools an, bis MySQL mit
 * "Too many connections" abbricht.
 */

declare global {
  // eslint-disable-next-line no-var
  var __swrpPool: mysql.Pool | undefined;
}

export function getPool(): mysql.Pool {
  if (!globalThis.__swrpPool) {
    const config = dbEnv();

    globalThis.__swrpPool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: config.connectionLimit,
      waitForConnections: true,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
      connectTimeout: 10_000,
      charset: "utf8mb4",
      // Der Gamemode speichert Zeitstempel als BIGINT, keine DATETIME-Spalten.
      // Damit bleibt die Umrechnung in unserer Hand.
      dateStrings: true,
    });
  }

  return globalThis.__swrpPool;
}

const RETRYABLE = new Set([
  "ECONNRESET",
  "PROTOCOL_CONNECTION_LOST",
  "ETIMEDOUT",
  "EPIPE",
]);

/**
 * Führt eine Abfrage aus und wiederholt sie einmal, wenn die Verbindung
 * weggebrochen ist. Der MySQL-Server steht im LAN und schließt Verbindungen
 * nach Leerlauf - ohne Retry schlägt dann die erste Anfrage nach einer Pause
 * grundlos fehl.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const code = (error as { code?: string }).code;

    if (!code || !RETRYABLE.has(code)) throw error;

    await new Promise((resolve) => setTimeout(resolve, 150));
    return fn();
  }
}

/** Was als Platzhalterwert in eine Abfrage darf. */
export type SqlValue = string | number | boolean | null | Date | Buffer;

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: SqlValue[] = [],
): Promise<T[]> {
  return withRetry(async () => {
    const [rows] = await getPool().execute(sql, params);
    return rows as T[];
  });
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: SqlValue[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(
  sql: string,
  params: SqlValue[] = [],
): Promise<mysql.ResultSetHeader> {
  return withRetry(async () => {
    const [result] = await getPool().execute(sql, params);
    return result as mysql.ResultSetHeader;
  });
}

/** Mehrere Anweisungen als eine Transaktion. Bei Fehler wird zurückgerollt. */
export async function transaction<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await getPool().getConnection();

  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
