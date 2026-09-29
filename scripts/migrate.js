import { createPool } from '../api/db.js';
import { migrate } from '../api/migrate.js';

const db = createPool();
try {
  const ran = await migrate(db);
  console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date');
} finally {
  await db.end();
}
