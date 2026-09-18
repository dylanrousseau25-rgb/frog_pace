import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";

let pool: Pool | null = null;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante: ${name}`);
  return value;
}

export function getDb() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: required("DB_USER"),
      password: required("DB_PASSWORD"),
      database: required("DB_NAME"),
      charset: "utf8mb4",
      timezone: "Z",
      dateStrings: true,
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 6),
      waitForConnections: true,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      decimalNumbers: true,
    });
  }
  return pool;
}

function maybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]")))) return value;
  try { return JSON.parse(text); } catch { return value; }
}

export function normalizeRow<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, maybeJson(value)])) as T;
}

export async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [result] = await getDb().execute<RowDataPacket[]>(sql, params);
  return result.map((row) => normalizeRow<T>(row as Record<string, unknown>));
}

export async function row<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await rows<T>(sql, params);
  return result[0] || null;
}

export async function execute(sql: string, params: unknown[] = []) {
  const [result] = await getDb().execute(sql, params);
  return result;
}

export async function transaction<T>(fn: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getDb().getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
