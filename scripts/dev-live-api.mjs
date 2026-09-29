// Dev-only: boots the real API on a throwaway embedded Postgres with sample data, on :3000,
// so the web app can be developed against it. Nothing is persisted.
//
// Profile checks and refreshes use the REAL LeetCode/HackerRank scrapers. For fully offline work,
// set FAKE_SCRAPER=1: numbers are then made up from the username and are NOT real.
//
//   npm run dev:api          then, in web/:  VITE_API_URL=/backend npm run dev
//   Sign in as admin / principal / vice.chairman / hod.it  with password  demo12345
import { startTestDb } from '../tests/helpers/testdb.js';
import { createApp } from '../api/app.js';
import { seedDefaults } from '../api/services/seed.js';

const PASSWORD = 'demo12345';
const port = Number(process.env.PORT || 3000);

const t = await startTestDb();
const db = t.db;
await seedDefaults(db, { password: PASSWORD });

const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

// Offline stand-in for the scrapers: deterministic fake numbers; names containing "notfound"
// simulate a profile that does not exist.
const fakeFetchProfile = async (platform, username) => {
  if (/notfound|invalid|missing/i.test(username)) return { status: 'not_found' };
  const n = hash(username);
  if (platform === 'leetcode') {
    const total = n % 420;
    return { status: 'ok', data: { solvedTotal: total, solvedEasy: Math.round(total * 0.6), solvedMedium: Math.round(total * 0.33), solvedHard: Math.round(total * 0.07), globalRank: 1_000_000 - total * 1500, hrStars: null } };
  }
  const total = n % 140;
  return { status: 'ok', data: { solvedTotal: total, solvedEasy: null, solvedMedium: null, solvedHard: null, globalRank: null, hrStars: Math.min(5, 1 + Math.floor(total / 30)) } };
};

const seedFetch = fakeFetchProfile; // seeded demo students always use made-up numbers
const names = ['Arun Kumar', 'Priya S', 'Karthik R', 'Divya K', 'Rahul M', 'Sneha V', 'Vikram P', 'Ananya N', 'Surya G', 'Meera D', 'Naveen T', 'Kavya B'];
const { rows: depts } = await db.query('select id from departments order by id');
for (const [i, n] of names.entries()) {
  const first = n.split(' ')[0].toLowerCase();
  const { rows: [s] } = await db.query(
    'insert into students (roll_no, name, dept_id, batch_year) values ($1, $2, $3, $4) returning id',
    [`R${101 + i}`, n, depts[i % depts.length].id, 2027 + (i % 4)],
  );
  await db.query("insert into platform_accounts (student_id, platform, username) values ($1, 'leetcode', $2), ($1, 'hackerrank', $3)", [s.id, `${first}${i}`, `${first}_${i}`]);
  const lc = (await seedFetch('leetcode', `${first}${i}`)).data;
  const hr = (await seedFetch('hackerrank', `${first}_${i}`)).data;
  const total = 400 - i * 25;
  await db.query(
    "insert into snapshots (student_id, platform, snap_date, solved_total, solved_easy, solved_medium, solved_hard, global_rank) values ($1, 'leetcode', current_date, $2, $3, $4, $5, $6)",
    [s.id, total, Math.round(total * 0.6), Math.round(total * 0.32), Math.round(total * 0.08), i % 5 === 4 ? null : 900000 / (total + 5) | 0],
  );
  await db.query("insert into snapshots (student_id, platform, snap_date, solved_total, hr_stars) values ($1, 'hackerrank', current_date, $2, $3)", [s.id, hr.solvedTotal, hr.hrStars]);
  void lc;
}

const app = createApp({
  db,
  sessionSecret: 'dev-only-'.padEnd(40, 'x'),
  scrapeSecret: 'dev',
  corsOrigins: ['http://localhost:5173'],
  ...(process.env.FAKE_SCRAPER ? { fetchProfile: fakeFetchProfile } : {}), // default: the real scraper
});
const server = app.listen(port, () => console.log(`Dev API on :${port}. Sign in as admin, principal, vice.chairman or hod.it with password ${PASSWORD}`));
const stop = async () => { server.close(); await t.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
