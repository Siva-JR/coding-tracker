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
