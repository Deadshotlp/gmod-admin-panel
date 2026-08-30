import mysql from "mysql2/promise";
import { getActiveServer, type ServerConfig } from "./servers";

/**
 * Verbindungspools zu den Gamemode-Datenbanken.
 *
 * Je konfiguriertem Server ein Pool, gecacht auf globalThis: im Dev-Modus lädt
 * Next die Module bei jeder Änderung neu, und ohne diesen Cache sammeln sich
 * Pools an, bis MySQL mit "Too many connections" abbricht.
 *
 * Ohne ausdrückliche Angabe arbeiten alle Funktionen auf dem gerade gewählten
 * Server (Cookie), sodass die Aufrufer davon nichts wissen müssen.
 */

declare global {
  // eslint-disable-next-line no-var
  var __swrpPools: Map<string, mysql.Pool> | undefined;
}

function poolFor(server: ServerConfig): mysql.Pool {
  if (!globalThis.__swrpPools) globalThis.__swrpPools = new Map();

  const existing = globalThis.__swrpPools.get(server.id);
  if (existing) return existing;

  const pool = mysql.createPool({
    host: server.db.host,
    port: server.db.port,
    user: server.db.user,
    password: server.db.password,
    database: server.db.database,
    connectionLimit: server.db.connectionLimit,
    waitForConnections: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    connectTimeout: 10_000,
    charset: "utf8mb4",
    // Der Gamemode speichert Zeitstempel als BIGINT, keine DATETIME-Spalten.
    // Damit bleibt die Umrechnung in unserer Hand.
    dateStrings: true,
  });

  globalThis.__swrpPools.set(server.id, pool);

  return pool;
}

export async function getPool(server?: ServerConfig): Promise<mysql.Pool> {
  return poolFor(server ?? (await getActiveServer()));
}

const RETRYABLE = new Set([
  "ECONNRESET",
  "PROTOCOL_CONNECTION_LOST",
  "ETIMEDOUT",
  "EPIPE",
]);

/**
 * Führt eine Abfrage aus und wiederholt sie einmal, wenn die Verbindung
 * weggebrochen ist. Der MySQL-Server steht oft im LAN und schließt Verbindungen
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
  server?: ServerConfig,
): Promise<T[]> {
  const pool = await getPool(server);

  return withRetry(async () => {
    const [rows] = await pool.execute(sql, params);
    return rows as T[];
  });
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: SqlValue[] = [],
  server?: ServerConfig,
): Promise<T | null> {
  const rows = await query<T>(sql, params, server);
  return rows[0] ?? null;
}

export async function execute(
  sql: string,
  params: SqlValue[] = [],
  server?: ServerConfig,
): Promise<mysql.ResultSetHeader> {
  const pool = await getPool(server);

  return withRetry(async () => {
    const [result] = await pool.execute(sql, params);
    return result as mysql.ResultSetHeader;
  });
}

/** Mehrere Anweisungen als eine Transaktion. Bei Fehler wird zurückgerollt. */
export async function transaction<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>,
  server?: ServerConfig,
): Promise<T> {
  const pool = await getPool(server);
  const conn = await pool.getConnection();

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
