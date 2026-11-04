import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  // DATE columns come back as 'YYYY-MM-DD' strings instead of shifted JS Dates
  pg.types.setTypeParser(1082, (v: string) => v);
  return pool;
}

/**
 * Run `fn` inside a transaction as the given user, the same way Supabase's API does:
 * SET LOCAL ROLE authenticated + request.jwt.claim.sub. Row Level Security therefore
 * applies to every query the backend makes on a user's behalf (defence in depth on top
 * of the explicit ownership filters in each route).
 */
export async function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await client.query('set local role authenticated');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function dbHealthy(db: Db): Promise<boolean> {
  try {
    await db.query('select 1');
    return true;
  } catch {
    return false;
  }
}
