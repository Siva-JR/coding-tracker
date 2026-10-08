import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers/testdb.js';
import { startTestApp, createStaff } from './helpers/app.js';

const CSE = 1;
const IT = 2;
const TODAY = '2026-09-30'; // helper clock: NOW is 2026-09-30 11:30 IST

let t;
let app;

before(async () => {
  t = await startTestDb();
  app = await startTestApp(t.db);
});
after(async () => {
  await app.stop();
  await t.stop();
});

const day = (offset) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - offset * 86400000).toISOString().slice(0, 10);

// series: [[daysAgo, total], ...] of LeetCode snapshots.
async function student({ roll, name, dept = CSE, batch = 2028, lc, series = [], state = 'active', lastOkDaysAgo = 0, lastError = null, attempts = 0 }) {
  const { rows: [s] } = await t.db.query('insert into students (roll_no, name, dept_id, batch_year) values ($1, $2, $3, $4) returning id', [roll, name, dept, batch]);
  if (lc) {
    const lastOk = series.length ? new Date(Date.parse(`${day(lastOkDaysAgo)}T06:00:00Z`)) : null;
    await t.db.query(
      "insert into platform_accounts (student_id, platform, username, state, last_ok_at, last_error, attempts) values ($1, 'leetcode', $2, $3, $4, $5, $6)",
      [s.id, lc, state, lastOk, lastError, attempts],
    );
  }
  for (const [ago, total] of series) {
    await t.db.query("insert into snapshots (student_id, platform, snap_date, solved_total, solved_easy, solved_medium, solved_hard, global_rank) values ($1, 'leetcode', $2, $3, $3, 0, 0, 1000)", [s.id, day(ago), total]);
  }
  return s.id;
}

beforeEach(async () => {
  await t.db.query('truncate students, departments, staff restart identity cascade');
  await t.db.query("insert into departments (name, code) values ('Computer Science', 'CSE'), ('Information Technology', 'IT')");
  await createStaff(t.db, { username: 'admin', role: 'admin' });
  await createStaff(t.db, { username: 'principal', scopes: [{}] });
  await createStaff(t.db, { username: 'hod.it', scopes: [{ deptId: IT }] });
});

async function as(username) {
  const c = app.client();
  await c.login(username);
  return c;
}

test('a single snapshot means no weekly change is claimed', async () => {
  await student({ roll: 'A', name: 'Ann', lc: 'ann', series: [[0, 37]] });
  const c = await as('admin');
  const { status, body } = await c.get('/api/stats');
  assert.equal(status, 200);
  assert.equal(body.kpis.totalStudents.value, 1);
  assert.equal(body.kpis.avgSolved.value, 37);
  assert.equal(body.kpis.activeStudents.value, 0);
  assert.equal(body.kpis.weekSolved.value, 0);
  assert.equal(body.historyDays, 0);
  assert.equal(body.kpis.activeStudents.spark, null);
  assert.deepEqual(body.timeline, [{ date: TODAY, leetcode: 37, hackerrank: null }]);
  const lb = await c.get('/api/leaderboard?platform=leetcode');
  assert.equal(lb.body.entries[0].weekGain, null);
  assert.equal(lb.body.total, 1);
});

test('weekly change, active students and averages come from real snapshots', async () => {
  await student({ roll: 'A', name: 'Ann', lc: 'ann', series: [[10, 100], [7, 110], [0, 130]] }); // +20 this week
  await student({ roll: 'B', name: 'Bob', lc: 'bob', series: [[10, 50], [7, 60], [0, 60]] });    // flat
  await student({ roll: 'C', name: 'Cat', lc: 'cat', series: [[9, 10], [0, 16]] });              // started 9 days ago, +6 since first snapshot
  const c = await as('admin');
  const { body } = await c.get('/api/stats');
  assert.equal(body.kpis.totalStudents.value, 3);
  assert.equal(body.kpis.activeStudents.value, 2);
  assert.equal(body.kpis.weekSolved.value, 26); // Ann 20 + Cat 6; Bob did not move
  assert.equal(body.kpis.avgSolved.value, Math.round((130 + 60 + 16) / 3));
  assert.equal(body.historyDays, 10);
  const lb = await c.get('/api/leaderboard?platform=leetcode');
  const gains = Object.fromEntries(lb.body.entries.map((e) => [e.name, e.weekGain]));
  assert.deepEqual(gains, { Ann: 20, Bob: 0, Cat: 6 });
});

test('profile health and attention reflect account state', async () => {
  await student({ roll: 'A', name: 'Ann', lc: 'ann', series: [[0, 10]] });
  await student({ roll: 'B', name: 'Bob', lc: 'bob', state: 'broken', lastError: 'Profile not found' });
  await student({ roll: 'C', name: 'Cat', lc: 'cat', series: [[6, 20]], lastOkDaysAgo: 6 });                           // stale: last ok 6 days ago
  await student({ roll: 'D', name: 'Dan', lc: 'dan', series: [[1, 5]], lastOkDaysAgo: 1, lastError: 'HTTP 429', attempts: 2 }); // transient error
  const c = await as('admin');
  const stats = (await c.get('/api/stats')).body;
  assert.deepEqual(stats.health.leetcode, { ok: 3, total: 4, pct: 75 });
  assert.equal(stats.health.hackerrank.total, 0);
  assert.equal(stats.needsAttention, 2);

  const a = (await c.get('/api/attention')).body;
  assert.deepEqual(a.broken.map((x) => [x.name, x.status]).sort(), [['Bob', 'not_found'], ['Dan', 'error']]);
  assert.deepEqual(a.stale.map((x) => x.name), ['Cat']);
  assert.equal(a.inactiveAvailable, false);
  assert.deepEqual(a.inactive, []);
});

test('inactive students are only reported once there is 30 days of history', async () => {
  await student({ roll: 'A', name: 'Ann', lc: 'ann', series: [[40, 10], [0, 10]] }); // no change in 40 days
  await student({ roll: 'B', name: 'Bob', lc: 'bob', series: [[40, 10], [0, 25]] });
  const a = (await (await as('admin')).get('/api/attention')).body;
  assert.equal(a.inactiveAvailable, true);
  assert.deepEqual(a.inactive.map((x) => x.name), ['Ann']);
});

test('activity lists milestones and surges from the last week only', async () => {
  await student({ roll: 'A', name: 'Ann', lc: 'ann', series: [[3, 95], [2, 101]] });            // crossed 100 two days ago
  await student({ roll: 'B', name: 'Bob', lc: 'bob', series: [[4, 20], [1, 26]] });              // +6 surge yesterday
  await student({ roll: 'C', name: 'Cat', lc: 'cat', series: [[20, 5], [15, 30]] });            // too old
  await student({ roll: 'D', name: 'Dan', lc: 'dan', series: [[2, 40], [1, 42]] });             // +2: not notable
  const events = (await (await as('admin')).get('/api/activity')).body;
  assert.deepEqual(events.map((e) => [e.name, e.kind, e.value, e.date]), [
    ['Bob', 'surge', 6, day(1)],
    ['Ann', 'milestone', 100, day(2)],
  ]);
});

test('scopes apply to stats, activity, attention, overview and student detail', async () => {
  const ann = await student({ roll: 'A', name: 'Ann', dept: CSE, lc: 'ann', series: [[0, 10]] });
  const ita = await student({ roll: 'I', name: 'Ivy', dept: IT, lc: 'ivy', series: [[0, 30]] });
  const it = await as('hod.it');
  assert.equal((await it.get('/api/stats')).body.kpis.totalStudents.value, 1);
  assert.equal((await it.get('/api/stats?deptId=1')).status, 403);
  assert.equal((await it.get('/api/attention?deptId=1')).status, 403);
  assert.equal((await it.get(`/api/students/${ann}`)).status, 404);
  assert.equal((await it.get(`/api/students/${ita}`)).status, 200);
  assert.deepEqual((await it.get('/api/departments/overview')).body.map((d) => d.code), ['IT']);

  const p = await as('principal');
  assert.equal((await p.get('/api/attention')).status, 403, 'the principal does not get the needs-attention lists');
  assert.equal((await it.get('/api/attention')).status, 200, 'a HoD does');
  assert.equal((await p.get('/api/stats')).body.kpis.totalStudents.value, 2);
  assert.deepEqual((await p.get('/api/departments/overview')).body.map((d) => [d.code, d.students, d.avgSolved]), [['CSE', 1, 10], ['IT', 1, 30]]);

  const anon = app.client();
  for (const path of ['/api/stats', '/api/activity', '/api/attention', '/api/departments/overview', `/api/students/${ann}`]) {
    assert.equal((await anon.get(path)).status, 401, path);
  }
});

test('student detail returns both platforms, status and history', async () => {
  const id = await student({ roll: 'A', name: 'Ann', lc: 'ann', series: [[8, 5], [0, 12]] });
  await t.db.query("insert into platform_accounts (student_id, platform, username, state, last_error) values ($1, 'hackerrank', 'ann_h', 'broken', 'Profile not found')", [id]);
  const { status, body } = await (await as('admin')).get(`/api/students/${id}`);
  assert.equal(status, 200);
  assert.equal(body.name, 'Ann');
  assert.equal(body.yearOfStudy, 3);
  assert.equal(body.leetcode.total, 12);
  assert.equal(body.leetcode.weekGain, 7);
  assert.equal(body.leetcode.status, 'ok');
  assert.equal(body.hackerrank.status, 'not_found');
  assert.equal(body.hackerrank.total, null);
  assert.deepEqual(body.history.map((h) => [h.date, h.leetcode]), [[day(8), 5], [day(0), 12]]);
  assert.equal(body.firstSnapshot, day(8));
  assert.equal((await (await as('admin')).get('/api/students/9999')).status, 404);
});

test('a viewer with no students gets zeros, not an error', async () => {
  const c = await as('hod.it');
  const s = (await c.get('/api/stats')).body;
  assert.equal(s.kpis.totalStudents.value, 0);
  assert.deepEqual(s.timeline, []);
  assert.deepEqual((await c.get('/api/activity')).body, []);
});

test('missing links and profiles that do not exist come with everything needed to fix them', async () => {
  const ann = await student({ roll: 'A', name: 'Ann', lc: 'ann', series: [[0, 10]] });                       // no HackerRank link
  const bob = await student({ roll: 'B', name: 'Bob', lc: 'bob_typo', state: 'broken', lastError: 'Profile not found' });
  await t.db.query("insert into platform_accounts (student_id, platform, username) values ($1, 'hackerrank', 'bob_h')", [bob]);
  await t.db.query("update students set github_url = 'https://github.com/bob' where id = $1", [bob]);
  await student({ roll: 'C', name: 'Cat', lc: 'cat', series: [[1, 5]], lastOkDaysAgo: 1, lastError: 'HTTP 429', attempts: 2 }); // temporary error, no link missing from HR
  const a = (await (await as('admin')).get('/api/attention')).body;
  assert.deepEqual(a.missing.map((x) => [x.name, x.platforms]).sort(), [['Ann', ['hackerrank']], ['Cat', ['hackerrank']]]);
  const bobFix = a.fix.find((x) => x.studentId === bob);
  assert.deepEqual(
    [bobFix.rollNo, bobFix.deptCode, bobFix.batchYear, bobFix.leetcodeUrl, bobFix.hackerrankUrl, bobFix.githubUrl, bobFix.problems],
    ['B', 'CSE', 2028, 'https://leetcode.com/u/bob_typo/', 'https://www.hackerrank.com/profile/bob_h', 'https://github.com/bob', ['LeetCode: profile @bob_typo was not found']],
  );
  assert.deepEqual(a.fix.find((x) => x.studentId === ann).problems, ['HackerRank: no link']);
  assert.equal(a.fix.length, 3, 'Bob (not found), Ann and Cat (no HackerRank link)');
});
