import pg from 'pg';

let pool;

export function createPool(connectionString = process.env.DATABASE_URL, options = {}) {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 10000, ...options });
}

export function getPool() {
  pool ??= createPool();
  return pool;
}

export async function withTransaction(db, fn) {
  const client = await db.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
