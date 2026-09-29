import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers/testdb.js';
import { startTestApp, createStaff, NOW } from './helpers/app.js';

const CSE = 1;
const IT = 2;

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

// At NOW (Sept 2026): batch 2028 = year 3, 2029 = year 2, 2030 = year 1.
async function seedStudents() {
  const rows = [
    ['Ann', CSE, 2028], ['Bob', CSE, 2029], ['Cat', CSE, 2030], ['Dan', IT, 2028], ['Eve', IT, 2030],
  ];
  for (const [i, [name, dept, batch]] of rows.entries()) {
    const { rows: [s] } = await t.db.query('insert into students (roll_no, name, dept_id, batch_year) values ($1, $2, $3, $4) returning id', [`R${i}`, name, dept, batch]);
    await t.db.query("insert into platform_accounts (student_id, platform, username) values ($1, 'leetcode', $2)", [s.id, name.toLowerCase()]);
    await t.db.query("insert into snapshots (student_id, platform, snap_date, solved_total, global_rank) values ($1, 'leetcode', '2026-09-29', $2, 100)", [s.id, 100 - i]);
  }
}

beforeEach(async () => {
  app.clock.now = NOW;
  await t.db.query('truncate students, departments, staff restart identity cascade');
  await t.db.query("insert into departments (name, code) values ('Computer Science', 'CSE'), ('Information Technology', 'IT')");
  await seedStudents();
  await createStaff(t.db, { username: 'admin', role: 'admin' });
  await createStaff(t.db, { username: 'principal', scopes: [{}] });
  await createStaff(t.db, { username: 'hod.it', scopes: [{ deptId: IT }] });
  await createStaff(t.db, { username: 'coord', scopes: [{ deptId: CSE, year: 2 }] });
  await createStaff(t.db, { username: 'multi', scopes: [{ deptId: CSE }, { deptId: IT, year: 1 }] });
  await createStaff(t.db, { username: 'allyear2', scopes: [{ year: 2 }] });
});

async function as(username) {
  const c = app.client();
  await c.login(username);
  return c;
}

const names = async (c, query = '') => {
  const res = await c.get(`/api/leaderboard?platform=leetcode${query}`);
  return res.status === 200 ? res.body.entries.map((e) => e.name).sort() : res.status;
};
const deptCodes = async (c) => (await c.get('/api/departments')).body.map((d) => d.code);

test('admin and an all-access viewer see everyone', async () => {
  for (const user of ['admin', 'principal']) {
    const c = await as(user);
    assert.deepEqual(await names(c), ['Ann', 'Bob', 'Cat', 'Dan', 'Eve'], user);
    assert.deepEqual(await deptCodes(c), ['CSE', 'IT'], user);
    assert.deepEqual(await names(c, `&deptId=${IT}&year=1`), ['Eve'], user);
  }
});

test('a department-scoped viewer only sees their department', async () => {
  const c = await as('hod.it');
  assert.deepEqual(await names(c), ['Dan', 'Eve'], 'no filters returns their department');
  assert.deepEqual(await names(c, `&deptId=${IT}`), ['Dan', 'Eve']);
  assert.deepEqual(await names(c, '&year=3'), ['Dan'], 'year filter still works inside the scope');
  assert.deepEqual(await names(c, `&deptId=${IT}&year=1`), ['Eve']);
  assert.equal(await names(c, `&deptId=${CSE}`), 403);
  assert.equal(await names(c, `&deptId=${CSE}&year=3`), 403);
  assert.deepEqual(await deptCodes(c), ['IT']);
});

test('a department + year scope sees only that year and cannot widen it', async () => {
  const c = await as('coord');
  assert.deepEqual(await names(c), ['Bob']);
  assert.deepEqual(await names(c, `&deptId=${CSE}&year=2`), ['Bob']);
  assert.deepEqual(await names(c, `&deptId=${CSE}`), ['Bob'], 'department without year is allowed but still limited to year 2');
  assert.deepEqual(await names(c, '&year=2'), ['Bob']);
  assert.equal(await names(c, `&deptId=${CSE}&year=3`), 403);
  assert.equal(await names(c, '&year=3'), 403);
  assert.equal(await names(c, `&deptId=${IT}`), 403);
  assert.equal(await names(c, `&deptId=${IT}&year=2`), 403);
  assert.deepEqual(await deptCodes(c), ['CSE']);
});

test('several scopes combine; each request must fit inside a single scope', async () => {
  const c = await as('multi');
  assert.deepEqual(await names(c), ['Ann', 'Bob', 'Cat', 'Eve'], 'all of CSE plus IT year 1');
  assert.deepEqual(await names(c, `&deptId=${IT}&year=1`), ['Eve']);
  assert.deepEqual(await names(c, `&deptId=${IT}`), ['Eve'], 'IT without a year is limited to year 1');
  assert.deepEqual(await names(c, `&deptId=${CSE}&year=3`), ['Ann']);
  assert.equal(await names(c, `&deptId=${IT}&year=3`), 403);
  assert.deepEqual(await deptCodes(c), ['CSE', 'IT']);
});

test('an all-departments, single-year scope', async () => {
  const c = await as('allyear2');
  assert.deepEqual(await names(c), ['Bob']);
  assert.deepEqual(await names(c, `&deptId=${IT}`), [], 'allowed (some IT students could be year 2) but there are none');
  assert.equal(await names(c, '&year=3'), 403);
  assert.deepEqual(await deptCodes(c), ['CSE', 'IT']);
});

test('a year scope follows the cohort: it moves up when the academic year rolls over in June', async () => {
  const c = await as('coord');
  assert.deepEqual(await names(c), ['Bob']);
  app.clock.now = new Date('2027-09-30T06:00:00Z');
  assert.deepEqual(await names(c), ['Cat'], 'the year-2 cohort is now batch 2030');
});

test('limit and sorting only ever operate inside the scope', async () => {
  const c = await as('hod.it');
  const res = await c.get('/api/leaderboard?platform=leetcode&limit=1');
  assert.deepEqual(res.body.entries.map((e) => e.name), ['Dan']);
});

test('anonymous requests are rejected everywhere', async () => {
  const anon = app.client();
  for (const [method, path] of [
    ['GET', '/api/leaderboard?platform=leetcode'], ['GET', '/api/departments'], ['GET', '/api/admin/users'],
    ['POST', '/api/admin/users'], ['PATCH', '/api/admin/users/1'], ['POST', '/api/admin/users/1/reset-password'], ['POST', '/api/admin/departments'],
  ]) {
    const res = await anon.request(method, path, {});
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test('viewers are forbidden from every admin route', async () => {
  for (const user of ['principal', 'hod.it', 'coord']) {
    const c = await as(user);
    for (const [method, path, body] of [
      ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users', { username: 'sneaky', role: 'admin' }],
      ['PATCH', '/api/admin/users/1', { role: 'admin' }],
      ['POST', '/api/admin/users/1/reset-password', {}],
      ['POST', '/api/admin/departments', { name: 'Nope', code: 'NP' }],
    ]) {
      const res = await c.request(method, path, body);
      assert.equal(res.status, 403, `${user} ${method} ${path}`);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    }
  }
  const { rows } = await t.db.query("select 1 from staff where username = 'sneaky'");
  assert.equal(rows.length, 0);
});

test('a disabled user cannot log in or use an existing session', async () => {
  const c = await as('principal');
  await t.db.query("update staff set disabled = true where username = 'principal'");
  assert.equal((await c.get('/api/departments')).status, 401);
  assert.equal((await app.client().post('/api/auth/login', { username: 'principal', password: 'Password123' })).status, 401);
});
