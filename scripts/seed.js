import { createPool } from '../api/db.js';
import { migrate } from '../api/migrate.js';
import { seedDefaults } from '../api/services/seed.js';

const password = process.env.SEED_PASSWORD;
if (!password) {
  console.error('Set SEED_PASSWORD in .env (the initial password for the seeded accounts)');
  process.exit(1);
}

const db = createPool();
try {
  await migrate(db);
  const { created, existing } = await seedDefaults(db, { password });
  console.log(`Created accounts: ${created.join(', ') || 'none'}`);
  if (existing.length) console.log(`Already existed (unchanged): ${existing.join(', ')}`);
} finally {
  await db.end();
}
