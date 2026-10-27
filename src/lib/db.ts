import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { env } from './env';

// pg returns NUMERIC and BIGINT as strings by default - parse them to numbers.
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => parseInt(v, 10));

declare global {
  // eslint-disable-next-line no-var
  var __lcePool: Pool | undefined;
}

export function getPool(): Pool {
  if (!globalThis.__lcePool) {
    globalThis.__lcePool = new Pool({ connectionString: env.databaseUrl, max: 10 });
  }
  return globalThis.__lcePool;
}

/** Run a parameterised query (never string-concatenate user input into SQL). */
export async function query<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run `fn` inside a database transaction (BEGIN ... COMMIT / ROLLBACK).
 * The acting user is exposed to the triggers through `app.current_user_id`,
 * which is how the audit trigger knows WHO made a change.
 */
export async function withTx<T>(userId: number | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId == null ? '' : String(userId)]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function audit(
  client: PoolClient,
  userId: number | null,
  action: string,
  entityType: string,
  entityId: number | null,
  details: Record<string, unknown> = {},
) {
  await client.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)`,
    [userId, action, entityType, entityId, JSON.stringify(details)],
  );
}
