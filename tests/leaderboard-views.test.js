import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers/testdb.js';
import { startTestApp, createStaff } from './helpers/app.js';

const CSE = 1;
const IT = 2;
let t;
let app;

before(async () => {
  t = await startTestDb();
  app = await startTestApp(t.db, {});
});
after(async () => {
  await app.stop();
  await t.stop();
});

// 12 students, solved totals 120, 110, ... 10. At the test clock batch 2028 = III Year, 2029 = II Year.
const PEOPLE = [
  ['Aarav', CSE, 2028], ['Bhavana', CSE, 2029], ['Chitra', IT, 2028], ['Dev', IT, 2029], ['Esha', CSE, 2028], ['Farid', IT, 2028],
  ['Gita', CSE, 2029], ['Hari', IT, 2029], ['Indu', CSE, 2028], ['Jai', IT, 2028], ['Kala', CSE, 2029], ['Lakshmi', IT, 2029],
];

beforeEach(async () => {
  await t.db.query('truncate students, departments, staff restart identity cascade');
  await t.db.query("insert into departments (name, code) values ('Computer Science', 'CSE'), ('Information Technology', 'IT')");
  for (const [i, [name, dept, batch]] of PEOPLE.entries()) {
    const { rows: [s] } = await t.db.query('insert into students (roll_no, name, dept_id, batch_year) values ($1, $2, $3, $4) returning id', [`REG${100 + i}`, name, dept, batch]);
    for (const platform of ['leetcode', 'hackerrank']) {
      await t.db.query('insert into platform_accounts (student_id, platform, username) values ($1, $2, $3)', [s.id, platform, `${name.toLowerCase()}_${platform}`]);
      await t.db.query("insert into snapshots (student_id, platform, snap_date, solved_total, solved_easy, solved_medium, solved_hard, global_rank, hr_stars) values ($1, $2, '2026-09-29', $3, 1, 1, 1, $4, 3)", [s.id, platform, 120 - i * 10, 1000 + i]);
    }
  }
  await createStaff(t.db, { username: 'admin', role: 'admin' });
  await createStaff(t.db, { username: 'hod.it', scopes: [{ deptId: IT }] });
});

const as = async (username) => { const c = app.client(); await c.login(username); return c; };
const board = async (c, query = '') => (await c.get(`/api/leaderboard?platform=leetcode${query}`)).body;
const names = (b) => b.entries.map((e) => e.name);

test('a search keeps each student at their real position in the ranking', async () => {
  const c = await as('admin');
  const b = await board(c, '&q=gita');
  assert.deepEqual(names(b), ['Gita']);
  assert.equal(b.entries[0].position, 7, 'Gita is 7th overall, not 1st');
  assert.equal(b.total, 1);
  assert.equal(b.scopeTotal, 12, 'scopeTotal counts everyone ranked, before the search');
  assert.equal(b.q, 'gita');
});

test('search matches name or reg no, ignores case, and ranks several matches in order', async () => {
  const c = await as('admin');
  assert.deepEqual(names(await board(c, '&q=REG101')), ['Bhavana']);
  assert.deepEqual(names(await board(c, '&q=bhav')), ['Bhavana']);
  const two = await board(c, '&q=a&limit=100');            // many names contain "a"
  assert.ok(two.entries.length > 3);
  assert.deepEqual(two.entries.map((e) => e.position), [...two.entries.map((e) => e.position)].sort((a, b) => a - b), 'still in rank order');
});

test('search follows the other filters: year, department, platform', async () => {
  const c = await as('admin');
  assert.deepEqual(names(await board(c, '&q=a&year=2&limit=100')).every((n) => ['Bhavana', 'Dev', 'Gita', 'Hari', 'Kala', 'Lakshmi'].includes(n)), true);
  const gitaIT = await board(c, `&q=gita&deptId=${IT}`);
  assert.deepEqual(names(gitaIT), [], 'Gita is in CSE');
  const hr = (await c.get('/api/leaderboard?platform=hackerrank&q=indu')).body;
  assert.equal(hr.entries[0].position, 9);
});

test('search cannot reach students outside the viewer\'s scopes', async () => {
  const it = await as('hod.it');
  assert.deepEqual(names(await board(it, '&q=gita')), [], 'Gita is a CSE student');
  const chitra = await board(it, '&q=chitra');
  assert.deepEqual(names(chitra), ['Chitra']);
  assert.equal(chitra.entries[0].position, 1, 'positions are within what the viewer can see: IT only');
  assert.equal(chitra.scopeTotal, 6);
});

test('Top 3 / 5 / 10 / 20 / everyone are just limits, and everyone fits in one request', async () => {
  const c = await as('admin');
  for (const [limit, expected] of [[3, 3], [5, 5], [10, 10], [20, 12], [1000, 12]]) {
    const b = await board(c, `&limit=${limit}`);
    assert.equal(b.entries.length, expected, `limit ${limit}`);
    assert.equal(b.total, 12);
    assert.deepEqual(b.entries.map((e) => e.position), Array.from({ length: expected }, (_, i) => i + 1));
  }
  assert.equal((await c.get('/api/leaderboard?platform=leetcode&limit=1001')).status, 400);
});

test('wildcard characters in the search are matched literally', async () => {
  const c = await as('admin');
  assert.deepEqual(names(await board(c, '&q=%25')), []);   // "%"
  assert.deepEqual(names(await board(c, '&q=_')), []);     // "_"
  assert.deepEqual(names(await board(c, '&q=%27%20or%201%3D1%20--')), []);
});
