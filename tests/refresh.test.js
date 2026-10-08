import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers/testdb.js';
import { startTestApp, createStaff } from './helpers/app.js';

const CSE = 1;
const IT = 2;

let t;
let app;
const calls = [];
const fetchProfile = async (platform, username) => {
  calls.push(`${platform}:${username}`);
  return { status: 'ok', data: { solvedTotal: 60, solvedEasy: 1, solvedMedium: 2, solvedHard: 3, globalRank: 99, hrStars: null } };
};

before(async () => { t = await startTestDb(); app = await startTestApp(t.db, { fetchProfile }); });
after(async () => { await app.stop(); await t.stop(); });

async function student(roll, dept, lastOk) {
  const { rows: [s] } = await t.db.query('insert into students (roll_no, name, dept_id, batch_year) values ($1, $2, $3, 2028) returning id', [roll, `S ${roll}`, dept]);
  await t.db.query("insert into platform_accounts (student_id, platform, username, last_ok_at) values ($1, 'leetcode', $2, $3)", [s.id, `u${roll}`, lastOk]);
  return s.id;
}
const as = async (username) => { const c = app.client(); await c.login(username); return c; };

beforeEach(async () => {
  calls.length = 0;
  await t.db.query('truncate students, departments, staff restart identity cascade');
  await t.db.query("insert into departments (name, code) values ('Computer Science', 'CSE'), ('Information Technology', 'IT')");
  await createStaff(t.db, { username: 'principal', scopes: [{}] });
  await createStaff(t.db, { username: 'hod.it', scopes: [{ deptId: IT }] });
});

test('a HoD can refresh only their own department; the principal can refresh everyone', async () => {
  const cse = await student('A', CSE, '2026-09-28T06:00:00Z');
  const it = await student('B', IT, '2026-09-29T06:00:00Z');

  const hod = await as('hod.it');
  const mine = (await hod.get('/api/refresh')).body;
  assert.deepEqual(mine.students.map((s) => s.id), [it]);
  assert.equal(mine.lastUpdatedAt, '2026-09-29T06:00:00.000Z');
  assert.equal((await hod.get('/api/refresh?deptId=1')).status, 403);
  assert.equal((await hod.post(`/api/refresh/students/${cse}`)).status, 404);
  assert.deepEqual(calls, [], 'nothing was fetched for a student outside the scope');
  assert.equal((await hod.post(`/api/refresh/students/${it}`)).status, 200);
  assert.deepEqual(calls, ['leetcode:uB']);

  const principal = await as('principal');
  const all = (await principal.get('/api/refresh')).body;
  assert.deepEqual(all.students.map((s) => s.id).sort(), [cse, it]);
  assert.equal(all.oldestAt, '2026-09-28T06:00:00.000Z');
  assert.equal((await principal.post(`/api/refresh/students/${cse}`)).status, 200);
});

test('last update is empty before anything was ever fetched, and sign-in is required', async () => {
  await student('C', CSE, null);
  const body = (await (await as('principal')).get('/api/refresh')).body;
  assert.equal(body.lastUpdatedAt, null);
  assert.equal(body.oldestAt, null);
  assert.equal((await app.client().get('/api/refresh')).status, 401);
});
