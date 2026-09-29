import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers/testdb.js';
import { startTestApp, createStaff, SCRAPE_SECRET as SECRET, NOW } from './helpers/app.js';
import { addStudent, ValidationError } from '../api/services/students.js';

const W1 = new Date('2026-09-29T19:00:00Z');

let t;
let app;
let admin;

before(async () => {
  t = await startTestDb();
  app = await startTestApp(t.db, {
    tickOptions: {
      sleep: async () => {},
      fetchProfile: async () => ({ status: 'ok', data: { solvedTotal: 99, solvedEasy: 1, solvedMedium: 1, solvedHard: 1, globalRank: 5, hrStars: null } }),
    },
  });
});
after(async () => {
  await app.stop();
  await t.stop();
});
beforeEach(async () => {
  app.clock.now = NOW;
  await t.db.query('truncate students, departments, staff restart identity cascade');
  await t.db.query("insert into departments (name, code) values ('Computer Science', 'CSE'), ('Information Technology', 'IT')");
  await createStaff(t.db, { username: 'admin', role: 'admin' });
  admin = app.client();
  await admin.login('admin');
});

const get = async (path) => {
  const res = await admin.get(path);
  return { status: res.status, body: res.body };
};

async function student({ roll, name, dept = 1, batch = 2028, lc, hr, lcSnap, hrSnap, lcState = 'active' }) {
  const { rows: [s] } = await t.db.query('insert into students (roll_no, name, dept_id, batch_year) values ($1, $2, $3, $4) returning id', [roll, name, dept, batch]);
  if (lc) await t.db.query('insert into platform_accounts (student_id, platform, username, state) values ($1, $2, $3, $4)', [s.id, 'leetcode', lc, lcState]);
  if (hr) await t.db.query('insert into platform_accounts (student_id, platform, username) values ($1, $2, $3)', [s.id, 'hackerrank', hr]);
  for (const [platform, snap, date = '2026-09-29'] of [['leetcode', lcSnap], ['hackerrank', hrSnap]]) {
    if (!snap) continue;
    const [total, rank, easy = 1, medium = 1, hard = 1, stars = null] = snap.values;
    await t.db.query(
      'insert into snapshots (student_id, platform, snap_date, solved_total, solved_easy, solved_medium, solved_hard, global_rank, hr_stars) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [s.id, platform, snap.date ?? date, total, easy, medium, hard, rank, stars],
    );
  }
  return s.id;
}

const lc = (...values) => ({ values });

test('leaderboard and departments require login', async () => {
  const anon = app.client();
  assert.equal((await anon.get('/api/leaderboard?platform=leetcode')).status, 401);
  assert.equal((await anon.get('/api/departments')).status, 401);
});

test('GET /health', async () => {
  assert.deepEqual(await get('/health'), { status: 200, body: { ok: true } });
});

test('leaderboard rejects invalid query parameters', async () => {
  for (const q of [
    '', '?platform=github', '?platform=leetcode&sort=fastest', '?platform=hackerrank&sort=rank',
    '?platform=leetcode&year=5', '?platform=leetcode&year=abc', '?platform=leetcode&limit=0', '?platform=leetcode&limit=101', '?platform=leetcode&deptId=x',
  ]) {
    const { status, body } = await get(`/api/leaderboard${q}`);
    assert.equal(status, 400, q);
    assert.equal(body.error.code, 'BAD_REQUEST', q);
  }
});

test('leetcode leaderboard defaults to problems solved with tie-breaks and positions', async () => {
  await student({ roll: 'A', name: 'Ann', lc: 'ann', lcSnap: lc(100, 5000, 50, 40, 10) });
  await student({ roll: 'B', name: 'Bob', lc: 'bob', lcSnap: lc(300, 900, 100, 150, 50) });
  await student({ roll: 'C', name: 'Cat', lc: 'cat', lcSnap: lc(100, 4000, 40, 40, 20) });

  const { status, body } = await get('/api/leaderboard?platform=leetcode');
  assert.equal(status, 200);
  assert.equal(body.sort, 'solved');
  assert.equal(body.year, 'all');
  assert.equal(body.asOf, '2026-09-29');
  assert.deepEqual(body.entries.map((e) => [e.position, e.name]), [[1, 'Bob'], [2, 'Cat'], [3, 'Ann']], 'tie on 100 broken by hard');
  assert.deepEqual(body.entries[0], {
    position: 1, studentId: body.entries[0].studentId, name: 'Bob', rollNo: 'B', deptCode: 'CSE',
    batchYear: 2028, yearOfStudy: 3, solved: { total: 300, easy: 100, medium: 150, hard: 50 },
    globalRank: 900, stars: null, profileUrl: 'https://leetcode.com/u/bob/',
  });
});

test('sort=rank orders by ascending global rank with missing ranks last', async () => {
  await student({ roll: 'A', name: 'Ann', lc: 'ann', lcSnap: lc(100, 5000) });
  await student({ roll: 'B', name: 'Bob', lc: 'bob', lcSnap: lc(300, null) });
  await student({ roll: 'C', name: 'Cat', lc: 'cat', lcSnap: lc(50, 900) });

  const { body } = await get('/api/leaderboard?platform=leetcode&sort=rank');
  assert.deepEqual(body.entries.map((e) => e.name), ['Cat', 'Ann', 'Bob']);
});

test('limit, year and department filters', async () => {
  await student({ roll: 'A', name: 'Ann', batch: 2028, lc: 'ann', lcSnap: lc(10, 1) });
  await student({ roll: 'B', name: 'Bob', batch: 2029, lc: 'bob', lcSnap: lc(20, 1) });
  await student({ roll: 'C', name: 'Cat', batch: 2028, dept: 2, lc: 'cat', lcSnap: lc(30, 1) });

  const names = async (q) => (await get(`/api/leaderboard?platform=leetcode${q}`)).body.entries.map((e) => e.name);
  assert.deepEqual(await names('&year=3'), ['Cat', 'Ann']);
  assert.deepEqual(await names('&year=2'), ['Bob']);
  assert.deepEqual(await names('&year=1'), []);
  assert.deepEqual(await names('&deptId=2'), ['Cat']);
  assert.deepEqual(await names('&year=3&deptId=1'), ['Ann']);
  assert.deepEqual(await names('&limit=2'), ['Cat', 'Bob']);
});

test('uses each student\'s latest snapshot', async () => {
  const id = await student({ roll: 'A', name: 'Ann', lc: 'ann', lcSnap: { values: [10, 100], date: '2026-09-20' } });
  await t.db.query("insert into snapshots (student_id, platform, snap_date, solved_total, global_rank) values ($1, 'leetcode', '2026-09-28', 25, 90)", [id]);
  const { body } = await get('/api/leaderboard?platform=leetcode');
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0].solved.total, 25);
});

test('excludes broken accounts and students that have no snapshot yet', async () => {
  await student({ roll: 'A', name: 'Ann', lc: 'ann', lcSnap: lc(10, 1) });
  await student({ roll: 'B', name: 'Bob', lc: 'bob', lcSnap: lc(20, 1), lcState: 'broken' });
  await student({ roll: 'C', name: 'Cat', lc: 'cat' });
  const { body } = await get('/api/leaderboard?platform=leetcode');
  assert.deepEqual(body.entries.map((e) => e.name), ['Ann']);
  assert.equal((await get('/api/leaderboard?platform=leetcode&deptId=2')).body.asOf, null);
});

test('hackerrank entries expose stars and problems solved only', async () => {
  await student({ roll: 'A', name: 'Ann', hr: 'ann_hr', hrSnap: { values: [137, 2305, null, null, null, 6] } });
  const { body } = await get('/api/leaderboard?platform=hackerrank');
  assert.deepEqual(body.entries[0].solved, { total: 137, easy: null, medium: null, hard: null });
  assert.equal(body.entries[0].stars, 6);
  assert.equal(body.entries[0].globalRank, null);
  assert.equal(body.entries[0].profileUrl, 'https://www.hackerrank.com/profile/ann_hr');
});

test('scrape tick requires the shared secret', async () => {
  const post = (headers = {}) => fetch(`${app.base}/internal/scrape/tick`, { method: 'POST', headers });
  assert.equal((await post()).status, 401);
  assert.equal((await post({ 'x-scrape-secret': 'wrong' })).status, 401);
  assert.equal((await post({ 'x-scrape-secret': SECRET + 'x' })).status, 401);
  const ok = await post({ 'x-scrape-secret': SECRET });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { skipped: 'outside_window' });
});

test('scrape tick inside a window scrapes accounts and the leaderboard reflects it', async () => {
  await student({ roll: 'A', name: 'Ann', lc: 'ann' });
  app.clock.now = W1;
  const res = await fetch(`${app.base}/internal/scrape/tick`, { method: 'POST', headers: { 'x-scrape-secret': SECRET } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).leetcode.ok, 1);
  const { body } = await get('/api/leaderboard?platform=leetcode');
  assert.equal(body.entries[0].solved.total, 99);
});

test('unknown routes and bad JSON return the error envelope', async () => {
  assert.deepEqual(await get('/nope'), { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Route not found' } } });
  const res = await fetch(`${app.base}/internal/scrape/tick`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(res.status, 400);
});

test('scrape tick refuses to run when no secret is configured', async () => {
  const bare = await startTestApp(t.db, { scrapeSecret: undefined });
  try {
    const res = await fetch(`${bare.base}/internal/scrape/tick`, { method: 'POST', headers: { 'x-scrape-secret': '' } });
    assert.equal(res.status, 503);
  } finally {
    await bare.stop();
  }
});

test('addStudent: creates the student and accounts from profile URLs', async () => {
  const result = await addStudent(t.db, {
    name: ' Siva ', rollNo: '21CS001', deptCode: 'cse', batchYear: '2028',
    leetcodeUrl: 'https://leetcode.com/u/2mNZWXqhCg/', hackerrankUrl: 'https://www.hackerrank.com/profile/siva_hr',
  });
  assert.deepEqual(result.accounts, [{ platform: 'leetcode', username: '2mNZWXqhCg', verified: 'skipped' }, { platform: 'hackerrank', username: 'siva_hr', verified: 'skipped' }]);
  const { rows } = await t.db.query('select s.name, s.dept_id, pa.platform, pa.username from students s join platform_accounts pa on pa.student_id = s.id order by pa.platform');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Siva');
});

test('addStudent: reports every validation problem, unknown departments and duplicates', async () => {
  await assert.rejects(
    () => addStudent(t.db, { name: '', rollNo: '', deptCode: 'CSE', batchYear: 'abc', leetcodeUrl: 'https://example.com/x' }),
    (err) => err instanceof ValidationError && err.errors.length === 4 && err.errors.some((e) => e.startsWith('leetcode:')),
  );
  await assert.rejects(() => addStudent(t.db, { name: 'A', rollNo: '1', deptCode: 'XYZ', batchYear: 2028, leetcodeUrl: 'https://leetcode.com/u/a' }), /unknown department/);
  await addStudent(t.db, { name: 'A', rollNo: '1', deptCode: 'CSE', batchYear: 2028, leetcodeUrl: 'https://leetcode.com/u/a' });
  await assert.rejects(() => addStudent(t.db, { name: 'B', rollNo: '1', deptCode: 'CSE', batchYear: 2028, leetcodeUrl: 'https://leetcode.com/u/b' }), /already exists/);
  assert.equal((await t.db.query('select count(*)::int as n from students')).rows[0].n, 1, 'failed inserts leave nothing behind');
});
