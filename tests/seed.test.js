import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers/testdb.js';
import { startTestApp } from './helpers/app.js';
import { seedDefaults } from '../api/services/seed.js';

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

test('seeds departments and the four accounts with the right scopes', async () => {
  const result = await seedDefaults(t.db, { password: 'rmkec@123' });
  assert.deepEqual(result, { created: ['admin', 'principal', 'vice.chairman', 'hod.it'], existing: [] });

  const users = {};
  for (const name of result.created) {
    const c = app.client();
    const login = await c.post('/api/auth/login', { username: name, password: 'rmkec@123' });
    assert.equal(login.status, 200, name);
    assert.equal(login.body.user.mustChangePassword, false, `${name} can use the seeded password right away`);
    users[name] = login.body.user;
  }

  assert.equal(users.admin.role, 'admin');
  assert.deepEqual(users.admin.scopes, []);
  for (const name of ['principal', 'vice.chairman']) {
    assert.deepEqual(users[name].scopes, [{ deptId: null, deptCode: null, deptName: null, year: null }], name);
  }
  assert.deepEqual(users['hod.it'].scopes.map((s) => [s.deptCode, s.year]), [['IT', null]]);
  assert.deepEqual(users.principal.displayTitle, 'Principal');
});

test('the HOD sees only IT and the principal sees all departments', async () => {
  const hod = app.client();
  await hod.login('hod.it', 'rmkec@123');
  assert.deepEqual((await hod.get('/api/departments')).body.map((d) => d.code), ['IT']);
  const principal = app.client();
  await principal.login('principal', 'rmkec@123');
  assert.deepEqual((await principal.get('/api/departments')).body.map((d) => d.code), ['CSE', 'IT', 'ECE']);
});

test('re-running the seed changes nothing, including passwords', async () => {
  const again = await seedDefaults(t.db, { password: 'SomethingElse99' });
  assert.deepEqual(again, { created: [], existing: ['admin', 'principal', 'vice.chairman', 'hod.it'] });
  assert.equal((await app.client().post('/api/auth/login', { username: 'admin', password: 'rmkec@123' })).status, 200);
  assert.equal((await app.client().post('/api/auth/login', { username: 'admin', password: 'SomethingElse99' })).status, 401);
  assert.equal((await t.db.query('select count(*)::int as n from staff_scopes')).rows[0].n, 3);
});

test('a weak seed password is refused', async () => {
  await assert.rejects(() => seedDefaults(t.db, { password: 'short' }), /Seed password rejected/);
});
