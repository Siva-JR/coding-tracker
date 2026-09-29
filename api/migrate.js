import { readdir, readFile } from 'node:fs/promises';
import { withTransaction } from './db.js';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

export async function migrate(db) {
  await db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const applied = new Set((await db.query('select name from schema_migrations')).rows.map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
    await withTransaction(db, async (client) => {
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    ran.push(file);
  }
  return ran;
}
