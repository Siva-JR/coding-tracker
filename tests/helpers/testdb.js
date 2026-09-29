import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import { createPool } from '../../api/db.js';
import { migrate } from '../../api/migrate.js';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

// Starts a throwaway real Postgres (no Docker, no root) and applies all migrations.
export async function startTestDb() {
  const dir = await mkdtemp(join(tmpdir(), 'ct-pg-'));
  const port = await freePort();
  const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  await server.createDatabase('test');

  const db = createPool(`postgres://postgres:postgres@127.0.0.1:${port}/test`, { max: 10 });
  await migrate(db);

  return {
    db,
    async stop() {
      await db.end();
      await server.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
