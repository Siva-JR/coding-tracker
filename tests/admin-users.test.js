import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers/testdb.js';
import { startTestApp, createStaff, DEFAULT_PASSWORD, NOW } from './helpers/app.js';

const CSE = 1;
const IT = 2;

let t;
let app;
let admin;

before(async () => {
  t = await startTestDb();
  app = await startTestApp(t.db);
});
after(async () => {
  await app.stop();
  await t.stop();
});
beforeEach(async () => {
  app.clock.now = NOW;
  await t.db.query('truncate students, departments, staff restart identity cascade');
  await t.db.query("insert into departments (name, code) values ('Computer Science', 'CSE'), ('Information Technology', 'IT')");
  await createStaff(t.db, { username: 'admin', role: 'admin', title: 'Administrator' });
  admin = app.client();
  await admin.login('admin');
});

const idOf = async (username) => (await t.db.query('select id from staff where username = $1', [username])).rows[0].id;
const create = (body) => admin.post('/api/admin/users', body);

test('lists users with their scopes', async () => {
  await createStaff(t.db, { username: 'hod.it', title: 'HOD IT', scopes: [{ deptId: IT }] });
  const res = await admin.get('/api/admin/users');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((u) => u.username), ['admin', 'hod.it']);
  assert.deepEqual(res.body[1].scopes, [{ deptId: IT, deptCode: 'IT', deptName: 'Information Technology', year: null }]);
  assert.ok(!JSON.stringify(res.body).match(/hash|tokenVersion/));
});

test('creating a viewer generates a one-time temporary password and forces a change', async () => {
  const res = await create({ username: 'HOD.CSE', displayTitle: 'HOD CSE', role: 'viewer', scopes: [{ deptId: CSE }] });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.username, 'hod.cse', 'usernames are stored lowercase');
  assert.equal(res.body.user.mustChangePassword, true);
  assert.deepEqual(res.body.user.scopes, [{ deptId: CSE, deptCode: 'CSE', deptName: 'Computer Science', year: null }]);
  assert.match(res.body.temporaryPassword, /^[A-Za-z0-9]{12}$/);

  const c = app.client();
  const login = await c.post('/api/auth/login', { username: 'hod.cse', password: res.body.temporaryPassword });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.mustChangePassword, true);
  assert.equal((await c.get('/api/departments')).body.error.code, 'PASSWORD_CHANGE_REQUIRED');
});

test('a supplied password is used and never echoed back', async () => {
  const res = await create({ username: 'coord.cse2', role: 'viewer', password: 'rmkec@123', scopes: [{ deptId: CSE, year: 2 }] });
  assert.equal(res.status, 201);
  assert.equal(res.body.temporaryPassword, undefined);
  assert.equal((await app.client().post('/api/auth/login', { username: 'coord.cse2', password: 'rmkec@123' })).status, 200);
});

test('creation validates username, password, role and scopes', async () => {
  const bad = async (body, pattern) => {
    const res = await create({ role: 'viewer', scopes: [{ deptId: CSE }], ...body });
    assert.equal(res.status, 400, JSON.stringify(body));
    if (pattern) assert.match(res.body.error.message, pattern);
  };
  await bad({ username: 'ab' }, /username/);
  await bad({ username: 'has space' }, /username/);
  await bad({ username: 'x'.repeat(33) }, /username/);
  await bad({ username: 'weakpw', password: 'short' }, /8 characters/);
  await bad({ username: 'sameasname', password: 'sameasname' }, /same as the username/);
  await bad({ username: 'noscopes', scopes: [] }, /at least one scope/);
  await bad({ username: 'noscopes2', scopes: undefined }, /at least one scope/);
  await bad({ username: 'adminscoped', role: 'admin', scopes: [{ deptId: CSE }] }, /cannot have scopes/);
  await bad({ username: 'ghostdept', scopes: [{ deptId: 999 }] }, /Unknown department/);
  await bad({ username: 'badyear', scopes: [{ deptId: CSE, year: 5 }] });
  await bad({ username: 'badrole', role: 'superuser' });
  assert.equal((await t.db.query("select count(*)::int as n from staff where username != 'admin'")).rows[0].n, 0, 'no partial users are left behind');
});

test('usernames are unique regardless of case', async () => {
  await create({ username: 'dupe.user', role: 'viewer', scopes: [{ deptId: CSE }] });
  const res = await create({ username: 'DUPE.user', role: 'viewer', scopes: [{ deptId: CSE }] });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'USERNAME_TAKEN');
});

test('duplicate scopes are collapsed and an all-access scope can be created', async () => {
  const res = await create({ username: 'princ', role: 'viewer', scopes: [{}, { deptId: null, year: null }, { deptId: CSE, year: 2 }, { deptId: CSE, year: 2 }] });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.scopes.length, 2);
});

test('editing scopes and title takes effect for the user', async () => {
  const { body: { user } } = await create({ username: 'flex', role: 'viewer', password: DEFAULT_PASSWORD, scopes: [{ deptId: CSE }] });
  const res = await admin.patch(`/api/admin/users/${user.id}`, { displayTitle: 'Coordinator', scopes: [{ deptId: IT, year: 3 }] });
  assert.equal(res.status, 200);
  assert.equal(res.body.displayTitle, 'Coordinator');
  assert.deepEqual(res.body.scopes.map((s) => [s.deptCode, s.year]), [['IT', 3]]);

  assert.equal((await admin.patch(`/api/admin/users/${user.id}`, { scopes: [] })).status, 400);
  assert.equal((await admin.patch(`/api/admin/users/${user.id}`, { displayTitle: null })).body.displayTitle, null);
  assert.equal((await admin.patch(`/api/admin/users/${user.id}`, {})).status, 200);
});

test('changing role clears or requires scopes and signs the user out', async () => {
  const { body: { user } } = await create({ username: 'promo', role: 'viewer', password: DEFAULT_PASSWORD, scopes: [{ deptId: CSE }] });
  await t.db.query('update staff set must_change_password = false where id = $1', [user.id]);
  const c = app.client();
  await c.login('promo');

  assert.equal((await admin.patch(`/api/admin/users/${user.id}`, { role: 'admin' })).status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 401, 'old session is revoked');
  const promoted = await admin.get('/api/admin/users');
  assert.deepEqual(promoted.body.find((u) => u.username === 'promo').scopes, []);

  assert.equal((await admin.patch(`/api/admin/users/${user.id}`, { role: 'viewer' })).status, 400, 'demoting needs scopes');
  const demoted = await admin.patch(`/api/admin/users/${user.id}`, { role: 'viewer', scopes: [{ deptId: IT }] });
  assert.equal(demoted.status, 200);
  assert.equal(demoted.body.role, 'viewer');
});

test('disabling ends the session and blocks login until re-enabled', async () => {
  const { body: { user } } = await create({ username: 'temp.user', role: 'viewer', password: DEFAULT_PASSWORD, scopes: [{ deptId: CSE }] });
  await t.db.query('update staff set must_change_password = false where id = $1', [user.id]);
  const c = app.client();
  await c.login('temp.user');

  assert.equal((await admin.patch(`/api/admin/users/${user.id}`, { disabled: true })).body.disabled, true);
  assert.equal((await c.get('/api/auth/me')).status, 401);
  assert.equal((await app.client().post('/api/auth/login', { username: 'temp.user', password: DEFAULT_PASSWORD })).status, 401);

  await admin.patch(`/api/admin/users/${user.id}`, { disabled: false });
  assert.equal((await app.client().post('/api/auth/login', { username: 'temp.user', password: DEFAULT_PASSWORD })).status, 200);
});

test('the last active admin cannot be disabled or demoted, but any admin can once another exists', async () => {
  const adminId = await idOf('admin');
  const disable = await admin.patch(`/api/admin/users/${adminId}`, { disabled: true });
  assert.equal(disable.status, 409);
  assert.equal(disable.body.error.code, 'LAST_ADMIN');
  assert.equal((await admin.patch(`/api/admin/users/${adminId}`, { role: 'viewer', scopes: [{}] })).body.error.code, 'LAST_ADMIN');
  assert.equal((await admin.patch(`/api/admin/users/${adminId}`, { displayTitle: 'Still fine' })).status, 200);

  const { body: { user: second } } = await create({ username: 'admin2', role: 'admin', password: DEFAULT_PASSWORD });
  assert.equal((await admin.patch(`/api/admin/users/${second.id}`, { disabled: true })).status, 200);
  assert.equal((await admin.patch(`/api/admin/users/${adminId}`, { disabled: true })).body.error.code, 'LAST_ADMIN', 'disabled admins do not count');
});

test('two admins disabling each other at the same time cannot lock everyone out', async () => {
  await createStaff(t.db, { username: 'admin2', role: 'admin' });
  const other = app.client();
  await other.login('admin2');
  const [aId, bId] = [await idOf('admin'), await idOf('admin2')];

  const results = await Promise.all([
    admin.patch(`/api/admin/users/${bId}`, { disabled: true }),
    other.patch(`/api/admin/users/${aId}`, { disabled: true }),
  ]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal((await t.db.query("select count(*)::int as n from staff where role = 'admin' and not disabled")).rows[0].n, 1);
});

test('resetting a password returns it once, revokes sessions, forces a change and clears lockouts', async () => {
  const { body: { user } } = await create({ username: 'forgot', role: 'viewer', password: DEFAULT_PASSWORD, scopes: [{ deptId: CSE }] });
  await t.db.query('update staff set must_change_password = false where id = $1', [user.id]);
  const c = app.client();
  await c.login('forgot');
  for (let i = 0; i < 5; i++) await app.client().post('/api/auth/login', { username: 'forgot', password: 'bad-guess-1' });
  assert.equal((await app.client().post('/api/auth/login', { username: 'forgot', password: DEFAULT_PASSWORD })).status, 423);

  const reset = await admin.post(`/api/admin/users/${user.id}/reset-password`, {});
  assert.equal(reset.status, 200);
  assert.match(reset.body.temporaryPassword, /^[A-Za-z0-9]{12}$/);

  assert.equal((await c.get('/api/auth/me')).status, 401, 'old session revoked');
  assert.equal((await app.client().post('/api/auth/login', { username: 'forgot', password: DEFAULT_PASSWORD })).status, 401, 'old password no longer works');
  const login = await app.client().post('/api/auth/login', { username: 'forgot', password: reset.body.temporaryPassword });
  assert.equal(login.status, 200, 'lockout was cleared');
  assert.equal(login.body.user.mustChangePassword, true);
});

test('an admin can set a chosen password on reset; weak ones are rejected', async () => {
  const { body: { user } } = await create({ username: 'chosen', role: 'viewer', password: DEFAULT_PASSWORD, scopes: [{ deptId: CSE }] });
  assert.equal((await admin.post(`/api/admin/users/${user.id}/reset-password`, { password: 'tiny' })).status, 400);
  const ok = await admin.post(`/api/admin/users/${user.id}/reset-password`, { password: 'rmkec@123' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.temporaryPassword, undefined);
  assert.equal((await app.client().post('/api/auth/login', { username: 'chosen', password: 'rmkec@123' })).status, 200);
});

test('unknown or malformed ids', async () => {
  assert.equal((await admin.patch('/api/admin/users/9999', { disabled: true })).status, 404);
  assert.equal((await admin.post('/api/admin/users/9999/reset-password', {})).status, 404);
  assert.equal((await admin.patch('/api/admin/users/abc', {})).status, 400);
  assert.equal((await admin.post('/api/admin/users/abc/reset-password', {})).status, 400);
});

test('admins can add departments; codes are upper-cased and unique', async () => {
  const res = await admin.post('/api/admin/departments', { name: 'Mechanical Engineering', code: 'mech' });
  assert.equal(res.status, 201);
  assert.equal(res.body.code, 'MECH');
  assert.equal((await admin.post('/api/admin/departments', { name: 'Other Name', code: 'MECH' })).status, 409);
  assert.equal((await admin.post('/api/admin/departments', { name: 'Mechanical Engineering', code: 'ME2' })).status, 409);
  assert.equal((await admin.post('/api/admin/departments', { name: 'x', code: 'X' })).status, 400);
  assert.deepEqual((await admin.get('/api/departments')).body.map((d) => d.code), ['CSE', 'IT', 'MECH']);
});

test('a department can be renamed; students keep it, and clashes or empty changes are refused', async () => {
  const res = await admin.patch(`/api/admin/departments/${IT}`, { code: 'ict', name: 'Information and Communication Technology' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { id: IT, code: 'ICT', name: 'Information and Communication Technology' });
  assert.equal((await admin.patch(`/api/admin/departments/${IT}`, { code: 'ECA' })).body.name, 'Information and Communication Technology', 'only what is sent changes');
  assert.equal((await admin.patch(`/api/admin/departments/${IT}`, { code: 'CSE' })).status, 409);
  assert.equal((await admin.patch(`/api/admin/departments/${IT}`, {})).status, 400);
  assert.equal((await admin.patch('/api/admin/departments/9999', { code: 'ZZZ' })).status, 404);
  await createStaff(t.db, { username: 'hod.it', title: 'HOD IT', scopes: [{ deptId: IT }] });
  const hod = app.client();
  await hod.login('hod.it');
  assert.equal((await hod.patch(`/api/admin/departments/${IT}`, { code: 'HAX' })).status, 403);
});

test('an email address can be the username, is stored lowercase, and signs in in any case', async () => {
  const res = await create({ username: 'HoD.IT@RMKEC.AC.IN', displayTitle: 'HoD - IT', role: 'viewer', scopes: [{ deptId: IT }] });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.username, 'hod.it@rmkec.ac.in');
  assert.ok(res.body.temporaryPassword);

  const c = app.client();
  const login = await c.post('/api/auth/login', { username: ' Hod.It@rmkec.ac.in ', password: res.body.temporaryPassword });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.username, 'hod.it@rmkec.ac.in');
  assert.equal(login.body.user.mustChangePassword, true);

  const dup = await create({ username: 'hod.it@rmkec.ac.in', role: 'viewer', scopes: [{ deptId: IT }] });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'USERNAME_TAKEN');
});

test('email-style usernames work with scopes, password reset and the lockout like any other', async () => {
  const made = await create({ username: 'hod.cse@rmkec.ac.in', role: 'viewer', password: 'Password123', scopes: [{ deptId: CSE }] });
  assert.equal(made.status, 201);
  const id = made.body.user.id;
  const c = app.client();
  assert.equal((await c.post('/api/auth/login', { username: 'hod.cse@rmkec.ac.in', password: 'Password123' })).status, 200);
  assert.deepEqual((await c.get('/api/departments')).status, 403, 'a forced password change comes first');

  const reset = await admin.post(`/api/admin/users/${id}/reset-password`, {});
  assert.equal(reset.status, 200);
  assert.equal((await app.client().post('/api/auth/login', { username: 'hod.cse@rmkec.ac.in', password: reset.body.temporaryPassword })).status, 200);

  const wrong = app.client();
  for (let i = 0; i < 5; i += 1) await wrong.post('/api/auth/login', { username: 'hod.cse@rmkec.ac.in', password: 'nope-nope' });
  assert.equal((await wrong.post('/api/auth/login', { username: 'hod.cse@rmkec.ac.in', password: reset.body.temporaryPassword })).status, 423);
});

test('usernames that are neither a short name nor a plausible email are refused', async () => {
  for (const username of ['a@b', '@rmkec.ac.in', 'hod@', 'two@@rmkec.ac.in', 'hod it@rmkec.ac.in', 'hod@rmkec', 'hod@.ac.in', 'hod@rmkec..in', 'hod@rm_kec.ac.in',
    `${'a'.repeat(65)}@rmkec.ac.in`, `hod@${'a'.repeat(100)}.ac.in`, 'tag<script>@rmkec.ac.in']) {
    const res = await create({ username, role: 'viewer', scopes: [{ deptId: IT }] });
    assert.equal(res.status, 400, username);
    assert.match(res.body.error.message, /username/, username);
  }
});
