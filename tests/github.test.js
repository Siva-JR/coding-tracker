import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers/testdb.js';
import { startTestApp, createStaff, NOW } from './helpers/app.js';
import { parseGithubUrl } from '../api/services/github.js';

let t;
let app;
let admin;

const fetchProfile = async (platform, username) => (
  username.startsWith('missing')
    ? { status: 'not_found' }
    : { status: 'ok', data: { solvedTotal: 10, solvedEasy: 5, solvedMedium: 3, solvedHard: 2, globalRank: platform === 'leetcode' ? 999 : null, hrStars: null } }
);

before(async () => {
  t = await startTestDb();
  app = await startTestApp(t.db, { fetchProfile });
});
after(async () => {
  await app.stop();
  await t.stop();
});
beforeEach(async () => {
  app.clock.now = NOW;
  await t.db.query('truncate students, departments, staff restart identity cascade');
  await t.db.query("insert into departments (name, code) values ('Computer Science', 'CSE')");
  await createStaff(t.db, { username: 'admin', role: 'admin' });
  admin = app.client();
  await admin.login('admin');
});

const base = (over = {}) => ({ name: 'Asha', rollNo: 'R1', deptId: 1, batchYear: 2028, leetcodeUrl: 'https://leetcode.com/u/asha/', ...over });
const stored = async () => (await t.db.query('select github_url from students order by id')).rows.map((r) => r.github_url);

test('github links are stored as given, prefixed with https:// only when the scheme is missing', () => {
  assert.deepEqual(parseGithubUrl('https://github.com/asha-dev'), { ok: true, url: 'https://github.com/asha-dev' });
  assert.deepEqual(parseGithubUrl('  github.com/asha-dev/  '), { ok: true, url: 'https://github.com/asha-dev/' });
  assert.deepEqual(parseGithubUrl('https://www.github.com/asha?tab=repositories'), { ok: true, url: 'https://www.github.com/asha?tab=repositories' });
  assert.deepEqual(parseGithubUrl(''), { ok: true, url: null });
  assert.deepEqual(parseGithubUrl(null), { ok: true, url: null });
  for (const bad of ['GitHub', 'https://github.com/', 'https://gitlab.com/asha', 'https://evilgithub.com/asha', 'not a link', `https://github.com/${'a'.repeat(300)}`]) {
    assert.equal(parseGithubUrl(bad).ok, false, bad);
  }
});

test('adding a student stores the github link and returns it', async () => {
  const res = await admin.post('/api/admin/students', base({ githubUrl: 'https://github.com/asha-dev' }));
  assert.equal(res.status, 201);
  assert.equal(res.body.student.githubUrl, 'https://github.com/asha-dev');
  assert.deepEqual(await stored(), ['https://github.com/asha-dev']);
  const list = await admin.get('/api/admin/students');
  assert.equal(list.body.items[0].githubUrl, 'https://github.com/asha-dev');
});

test('a student without a github link is fine and reads back as null', async () => {
  const res = await admin.post('/api/admin/students', base());
  assert.equal(res.status, 201);
  assert.equal(res.body.student.githubUrl, null);
});

test('a bad github link is rejected when adding by hand, and nothing is created', async () => {
  const res = await admin.post('/api/admin/students', base({ githubUrl: 'https://gitlab.com/asha' }));
  assert.equal(res.status, 422);
  assert.ok(res.body.error.errors.some((e) => e.startsWith('github:')));
  assert.deepEqual(await stored(), []);
});

test('editing sets, changes and clears the github link without touching other fields', async () => {
  const id = (await admin.post('/api/admin/students', base())).body.studentId;
  let res = await admin.patch(`/api/admin/students/${id}`, { githubUrl: 'github.com/asha-dev' });
  assert.equal(res.status, 200);
  assert.equal(res.body.student.githubUrl, 'https://github.com/asha-dev');
  assert.equal(res.body.student.name, 'Asha');
  res = await admin.patch(`/api/admin/students/${id}`, { name: 'Asha R' });
  assert.equal(res.body.student.githubUrl, 'https://github.com/asha-dev', 'unrelated edits keep the link');
  res = await admin.patch(`/api/admin/students/${id}`, { githubUrl: '' });
  assert.equal(res.body.student.githubUrl, null);
  res = await admin.patch(`/api/admin/students/${id}`, { githubUrl: 'nonsense' });
  assert.equal(res.status, 422);
});

test('CSV validate and import keep a good link and drop a bad one with a warning instead of failing the student', async () => {
  const rows = [
    base({ rollNo: 'A', githubUrl: 'https://github.com/good' }),
    base({ rollNo: 'B', leetcodeUrl: 'https://leetcode.com/u/bee/', githubUrl: 'GitHub' }),
    base({ rollNo: 'C', leetcodeUrl: 'https://leetcode.com/u/cee/' }),
  ];
  const v = await admin.post('/api/admin/students/validate', { rows });
  assert.equal(v.status, 200);
  assert.deepEqual(v.body.results.map((r) => r.ok), [true, true, true]);
  assert.equal(v.body.results[0].warnings.length, 0);
  assert.ok(v.body.results[1].warnings.some((w) => w.includes('GitHub link was not saved')));

  const imp = await admin.post('/api/admin/students/import', { rows });
  assert.equal(imp.status, 200);
  assert.equal(imp.body.created.length, 3);
  assert.deepEqual(imp.body.skipped, []);
  assert.ok(imp.body.created[1].warnings.length);
  assert.deepEqual(await stored(), ['https://github.com/good', null, null]);
});

test('the github link is not shown on leaderboards and is never fetched', async () => {
  await admin.post('/api/admin/students', base({ githubUrl: 'https://github.com/asha-dev' }));
  const lb = await admin.get('/api/leaderboard?platform=leetcode');
  assert.equal(lb.status, 200);
  assert.ok(!JSON.stringify(lb.body).includes('github'));
});

test('student detail includes the github link for viewers who can see the student', async () => {
  const id = (await admin.post('/api/admin/students', base({ githubUrl: 'https://github.com/asha-dev' }))).body.studentId;
  await createStaff(t.db, { username: 'principal', scopes: [{}] });
  const p = app.client();
  await p.login('principal');
  const res = await p.get(`/api/students/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.githubUrl, 'https://github.com/asha-dev');
});

test('the GitHub tab lists only students with a link, scoped, searchable and paged', async () => {
  await t.db.query("insert into departments (name, code) values ('Information Technology', 'IT')");
  const mk = async (name, roll, deptId, batch, gh) => (await admin.post('/api/admin/students', base({ name, rollNo: roll, deptId, batchYear: batch, leetcodeUrl: `https://leetcode.com/u/${roll}/`, ...(gh ? { githubUrl: gh } : {}) }))).status;
  assert.equal(await mk('Ann', 'A1', 1, 2028, 'https://github.com/ann'), 201);
  assert.equal(await mk('Bob', 'B1', 1, 2029, 'https://github.com/bob'), 201);
  assert.equal(await mk('Cat', 'C1', 1, 2028), 201);                                     // no link
  assert.equal(await mk('Dan', 'D1', 2, 2028, 'https://github.com/dan'), 201);           // other department
  await createStaff(t.db, { username: 'hod.it', scopes: [{ deptId: 2 }] });
  await createStaff(t.db, { username: 'coord', scopes: [{ deptId: 1, year: 3 }] });       // year 3 = batch 2028 at NOW

  const all = await admin.get('/api/github');
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.items.map((i) => i.name), ['Ann', 'Bob', 'Dan']);
  assert.equal(all.body.total, 3);
  assert.equal(all.body.scopeTotal, 4, 'scopeTotal counts everyone in scope, with or without a link');
  assert.deepEqual(Object.keys(all.body.items[0]).sort(), ['batchYear', 'deptCode', 'githubUrl', 'name', 'rollNo', 'studentId', 'yearOfStudy']);

  assert.deepEqual((await admin.get('/api/github?deptId=1&year=3')).body.items.map((i) => i.name), ['Ann']);
  assert.deepEqual((await admin.get('/api/github?q=bo')).body.items.map((i) => i.name), ['Bob']);
  const page = await admin.get('/api/github?limit=2&offset=2');
  assert.deepEqual(page.body.items.map((i) => i.name), ['Dan']);
  assert.equal(page.body.total, 3);

  const it = app.client(); await it.login('hod.it');
  assert.deepEqual((await it.get('/api/github')).body.items.map((i) => i.name), ['Dan']);
  assert.equal((await it.get('/api/github?deptId=1')).status, 403);
  const co = app.client(); await co.login('coord');
  assert.deepEqual((await co.get('/api/github')).body.items.map((i) => i.name), ['Ann']);
  assert.equal((await co.get('/api/github?year=2')).status, 403);

  assert.equal((await app.client().get('/api/github')).status, 401);
  assert.equal((await admin.get('/api/github?limit=0')).status, 400);
  assert.equal((await admin.get('/api/github?year=9')).status, 400);
});
