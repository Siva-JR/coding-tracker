import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers/testdb.js';
import { startTestApp, createStaff, DEFAULT_PASSWORD, NOW } from './helpers/app.js';

const ORIGIN = 'http://localhost:5173';
let t;
let app;

before(async () => {
  t = await startTestDb();
  app = await startTestApp(t.db, { corsOrigins: [ORIGIN] });
});
after(async () => {
  await app.stop();
  await t.stop();
});
beforeEach(async () => {
  app.clock.now = NOW;
  await t.db.query('truncate staff, students, departments restart identity cascade');
  await t.db.query("insert into departments (name, code) values ('Computer Science', 'CSE'), ('Information Technology', 'IT')");
  await createStaff(t.db, { username: 'principal', title: 'Principal', scopes: [{}] });
});

test('login returns the user with scopes and sets an httpOnly session cookie', async () => {
  const c = app.client();
  const res = await c.post('/api/auth/login', { username: 'principal', password: DEFAULT_PASSWORD });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.user, {
    id: res.body.user.id, username: 'principal', displayTitle: 'Principal', role: 'viewer', mustChangePassword: false,
    scopes: [{ deptId: null, deptCode: null, deptName: null, year: null }],
  });
  assert.ok(!JSON.stringify(res.body).includes('tokenVersion') && !JSON.stringify(res.body).includes('hash'));
  const setCookie = res.headers.getSetCookie().join(' ');
  assert.match(setCookie, /session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.deepEqual((await c.get('/api/auth/me')).body.user.username, 'principal');
});

test('usernames are trimmed and case-insensitive', async () => {
  assert.equal((await app.client().post('/api/auth/login', { username: '  PrIncipal ', password: DEFAULT_PASSWORD })).status, 200);
});

test('unknown user, wrong password and disabled account are indistinguishable', async () => {
  await createStaff(t.db, { username: 'gone', disabled: true, scopes: [{}] });
  const attempts = [
    { username: 'nobody', password: 'whatever123' },
    { username: 'principal', password: 'wrong-password' },
    { username: 'gone', password: DEFAULT_PASSWORD },
  ];
  const results = [];
  for (const a of attempts) results.push(await app.client().post('/api/auth/login', a));
  for (const r of results) assert.deepEqual([r.status, r.body], [401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } }]);
});

test('bad login payloads are rejected as 400', async () => {
  assert.equal((await app.client().post('/api/auth/login', { username: 'principal' })).status, 400);
  assert.equal((await app.client().post('/api/auth/login', { username: 1, password: 2 })).status, 400);
});

test('five wrong passwords lock the account for 15 minutes, even for the right password', async () => {
  const c = app.client();
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/login', { username: 'principal', password: 'nope-nope' })).status, 401);

  const locked = await c.post('/api/auth/login', { username: 'principal', password: DEFAULT_PASSWORD });
  assert.equal(locked.status, 423);
  assert.equal(locked.body.error.code, 'LOCKED');
  assert.equal(locked.body.error.retryAfterSeconds, 900);

  app.clock.now = new Date(NOW.getTime() + 14 * 60000);
  assert.equal((await c.post('/api/auth/login', { username: 'principal', password: DEFAULT_PASSWORD })).status, 423);
  app.clock.now = new Date(NOW.getTime() + 16 * 60000);
  assert.equal((await c.post('/api/auth/login', { username: 'principal', password: DEFAULT_PASSWORD })).status, 200);
});

test('a successful login resets the failure counter', async () => {
  const c = app.client();
  for (let i = 0; i < 4; i++) await c.post('/api/auth/login', { username: 'principal', password: 'nope-nope' });
  assert.equal((await c.post('/api/auth/login', { username: 'principal', password: DEFAULT_PASSWORD })).status, 200);
  for (let i = 0; i < 4; i++) await c.post('/api/auth/login', { username: 'principal', password: 'nope-nope' });
  assert.equal((await c.post('/api/auth/login', { username: 'principal', password: DEFAULT_PASSWORD })).status, 200);
});

test('me requires a session; logout clears it; a tampered cookie is rejected', async () => {
  const c = app.client();
  assert.equal((await c.get('/api/auth/me')).status, 401);
  await c.login('principal');
  assert.equal((await c.get('/api/auth/me')).status, 200);
  assert.equal((await c.post('/api/auth/logout')).status, 204);
  assert.equal((await c.get('/api/auth/me')).status, 401);

  c.cookies.set('session', 'not.a.jwt');
  assert.equal((await c.get('/api/auth/me')).status, 401);
});

test('accounts that must change their password are blocked until they do', async () => {
  await createStaff(t.db, { username: 'fresh', mustChange: true, scopes: [{}] });
  const c = app.client();
  const login = await c.login('fresh');
  assert.equal(login.body.user.mustChangePassword, true);

  const blocked = await c.get('/api/departments');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await c.get('/api/auth/me')).status, 200);

  const change = (currentPassword, newPassword) => c.post('/api/auth/change-password', { currentPassword, newPassword });
  assert.equal((await change('wrong-current', 'BrandNewPass1')).body.error.code, 'WRONG_PASSWORD');
  assert.equal((await change(DEFAULT_PASSWORD, 'short')).body.error.code, 'WEAK_PASSWORD');
  assert.equal((await change(DEFAULT_PASSWORD, 'fresh')).status, 400);
  assert.equal((await change(DEFAULT_PASSWORD, DEFAULT_PASSWORD)).body.error.code, 'WEAK_PASSWORD');
  assert.equal((await change(DEFAULT_PASSWORD, 'BrandNewPass1')).status, 204);

  assert.equal((await c.get('/api/departments')).status, 200);
  assert.equal((await c.get('/api/auth/me')).body.user.mustChangePassword, false);
  assert.equal((await app.client().post('/api/auth/login', { username: 'fresh', password: DEFAULT_PASSWORD })).status, 401);
  assert.equal((await app.client().post('/api/auth/login', { username: 'fresh', password: 'BrandNewPass1' })).status, 200);
});

test('changing a password signs out every other session', async () => {
  const a = app.client();
  const b = app.client();
  await a.login('principal');
  await b.login('principal');
  assert.equal((await a.post('/api/auth/change-password', { currentPassword: DEFAULT_PASSWORD, newPassword: 'AnotherPass99' })).status, 204);
  assert.equal((await a.get('/api/auth/me')).status, 200, 'the session that changed it stays signed in');
  assert.equal((await b.get('/api/auth/me')).status, 401);
});

test('disabling an account ends its existing sessions immediately', async () => {
  const c = app.client();
  await c.login('principal');
  await t.db.query("update staff set disabled = true where username = 'principal'");
  assert.equal((await c.get('/api/auth/me')).status, 401);
});

test('state-changing requests must be JSON (CSRF guard)', async () => {
  const c = app.client();
  const res = await c.post('/api/auth/login', 'username=principal&password=x', { json: false, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 415);
  assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
  assert.equal((await c.get('/health')).status, 200);
});

test('CORS: only allow-listed origins get credentialed access', async () => {
  const preflight = await fetch(`${app.base}/api/auth/login`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');

  const evil = await fetch(`${app.base}/api/auth/login`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);

  const simple = await fetch(`${app.base}/health`, { headers: { Origin: ORIGIN } });
  assert.equal(simple.headers.get('access-control-allow-origin'), ORIGIN);
  const other = await fetch(`${app.base}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});
