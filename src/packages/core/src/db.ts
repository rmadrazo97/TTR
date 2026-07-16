/**
 * Postgres access via `pg` (node-postgres). Plain SQL, no ORM.
 *
 * - `getPool()` returns a lazily-created singleton pool (from DATABASE_URL).
 * - `query()` runs a parameterised statement and returns typed rows.
 * - `withTx()` runs a function inside a BEGIN/COMMIT transaction, passing a client
 *   whose `.query` shares the connection (so repo helpers can enlist in the tx).
 */
import pg from 'pg';
import { loadConfig } from './config.js';

const { Pool } = pg;
export type { PoolClient } from 'pg';

let pool: pg.Pool | undefined;

/** Lazily create and return the shared connection pool. */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: loadConfig().databaseUrl });
  }
  return pool;
}

/** Close the pool (tests / graceful shutdown). Safe to call when never opened. */
export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}

/**
 * A minimal query executor — satisfied by both the pool and a checked-out client,
 * so repos can run against either the pool or an in-progress transaction.
 */
export interface Queryable {
  query<T extends pg.QueryResultRow = any>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<pg.QueryResult<T>>;
}

/** Run a parameterised query against the pool; returns the rows. */
export async function query<T = any>(sql: string, params?: readonly unknown[]): Promise<T[]> {
  const res = await getPool().query<pg.QueryResultRow>(sql, params as unknown[] | undefined);
  return res.rows as T[];
}

/**
 * Run `fn` inside a transaction. Commits on success, rolls back on any throw, and
 * always releases the client. `fn` receives a {@link Queryable} bound to the tx.
 */
export async function withTx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure; surface the original error
    }
    throw err;
  } finally {
    client.release();
  }
}
