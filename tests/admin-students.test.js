import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers/testdb.js';
import { startTestApp, createStaff, NOW } from './helpers/app.js';
import { validateRows } from '../api/services/students.js';

const CSE = 1;
const IT = 2;

let t;
let app;
let admin;
const calls = [];

// Names starting with "missing" do not exist, "flaky" fails temporarily, everything else is fine.
const fetchProfile = async (platform, username) => {
  calls.push(`${platform}:${username}`);
  if (username.startsWith('missing')) return { status: 'not_found' };
  if (username.startsWith('flaky')) return { status: 'error', error: 'HTTP 429', retryable: true };
  return {
    status: 'ok',
    data: { solvedTotal: 50 + username.length, solvedEasy: 1, solvedMedium: 2, solvedHard: 3, globalRank: platform === 'leetcode' ? 1234 : null, hrStars: platform === 'hackerrank' ? 4 : null },
  };
};

before(async () => {
  t = await startTestDb();
  app = await startTestApp(t.db, { fetchProfile });
});
after(async () => {
  await app.stop();
  await t.stop();
});
beforeEach(async () => {
  calls.length = 0;
  app.clock.now = NOW;
  await t.db.query('truncate students, departments, staff restart identity cascade');
  await t.db.query("insert into departments (name, code) values ('Computer Science', 'CSE'), ('Information Technology', 'IT')");
  await createStaff(t.db, { username: 'admin', role: 'admin' });
  admin = app.client();
  await admin.login('admin');
});

const lc = (name) => `https://leetcode.com/u/${name}/`;
const hr = (name) => `https://www.hackerrank.com/profile/${name}`;
const student = (over = {}) => ({ name: 'Asha', rollNo: 'CSE001', deptId: CSE, batchYear: 2028, leetcodeUrl: lc('asha'), hackerrankUrl: hr('asha_hr'), ...over });
const add = (over) => admin.post('/api/admin/students', student(over));
const count = async (sql = 'students') => (await t.db.query(`select count(*)::int as n from ${sql}`)).rows[0].n;
const leaderboard = async (platform = 'leetcode') => (await admin.get(`/api/leaderboard?platform=${platform}`)).body.entries;

test('adding a student verifies both profiles, creates accounts and shows on the leaderboard at once', async () => {
  const res = await add();
  assert.equal(res.status, 201);
  assert.equal(res.body.student.rollNo, 'CSE001');
  assert.equal(res.body.student.deptCode, 'CSE');
  assert.equal(res.body.student.yearOfStudy, 3);
  assert.deepEqual(res.body.accounts.map((a) => [a.platform, a.username, a.verified]), [['leetcode', 'asha', 'ok'], ['hackerrank', 'asha_hr', 'ok']]);
  assert.equal(res.body.accounts[0].stats.solvedTotal, 54);
  assert.deepEqual(res.body.warnings, []);
  assert.equal((await leaderboard('leetcode'))[0].name, 'Asha');
  assert.equal((await leaderboard('hackerrank'))[0].stars, 4);
});

test('a department code and numeric or padded values are accepted', async () => {
  const res = await admin.post('/api/admin/students', { name: '  Ravi ', rollNo: 12345, deptCode: 'it', batchYear: '2029', leetcodeUrl: lc('ravi') });
  assert.equal(res.status, 201);
  assert.equal(res.body.student.name, 'Ravi');
  assert.equal(res.body.student.rollNo, '12345');
  assert.equal(res.body.student.deptCode, 'IT');
  assert.equal(res.body.student.batchYear, 2029);
  assert.deepEqual(res.body.student.accounts.map((a) => a.platform), ['leetcode']);
});

test('a temporary fetch failure adds the student with a warning and no snapshot', async () => {
  const res = await add({ leetcodeUrl: lc('flaky_lc') });
  assert.equal(res.status, 201);
  assert.equal(res.body.accounts[0].verified, 'unverified');
  assert.equal(res.body.accounts[1].verified, 'ok');
  assert.equal(res.body.warnings.length, 1);
  assert.match(res.body.warnings[0], /flaky_lc/);
  assert.deepEqual(await leaderboard('leetcode'), []);
  assert.equal((await t.db.query("select state from platform_accounts where username = 'flaky_lc'")).rows[0].state, 'active');
});

test('a profile that does not exist is rejected and nothing is saved', async () => {
  const res = await add({ leetcodeUrl: lc('missing_user'), hackerrankUrl: hr('missing_two') });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  assert.equal(res.body.error.errors.length, 2);
  assert.equal(await count(), 0);
  assert.equal(await count('platform_accounts'), 0);
});

test('every validation problem is reported together', async () => {
  const res = await admin.post('/api/admin/students', { name: '', rollNo: '', deptId: 99, batchYear: 'abc', leetcodeUrl: 'https://example.com/x' });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.errors.length, 5);
  assert.deepEqual(calls, [], 'no fetches when the input is already invalid');
  const noUrl = await admin.post('/api/admin/students', { name: 'A', rollNo: '1', deptId: CSE, batchYear: 2028 });
  assert.deepEqual(noUrl.body.error.errors, ['at least one profile URL is required']);
  assert.equal((await admin.post('/api/admin/students', [1, 2])).status, 400);
});

test('a duplicate roll number is a 409 and costs no profile fetches', async () => {
  await add();
  calls.length = 0;
  const res = await add({ name: 'Other', leetcodeUrl: lc('other') });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'ROLL_NUMBER_EXISTS');
  assert.deepEqual(calls, []);
  assert.equal(await count(), 1);
});

test('student endpoints are admin only', async () => {
  await createStaff(t.db, { username: 'principal', scopes: [{}] });
  const c = app.client();
  await c.login('principal');
  for (const [method, path, body] of [
    ['GET', '/api/admin/students'], ['POST', '/api/admin/students', student()], ['PATCH', '/api/admin/students/1', { name: 'x' }],
    ['DELETE', '/api/admin/students/1'], ['POST', '/api/admin/students/1/refresh', {}],
    ['POST', '/api/admin/students/validate', { rows: [student()] }], ['POST', '/api/admin/students/import', { rows: [student()] }],
  ]) {
    assert.equal((await c.request(method, path, body)).status, 403, `${method} ${path}`);
  }
  assert.equal(await count(), 0);
});

test('listing supports filters, search, paging and shows scrape state', async () => {
  await add({ name: 'Asha', rollNo: 'CSE001' });
  await add({ name: 'Bala', rollNo: 'CSE002', batchYear: 2029, leetcodeUrl: lc('bala'), hackerrankUrl: hr('bala') });
  await add({ name: 'Chitra 100%', rollNo: 'IT001', deptId: IT, leetcodeUrl: lc('chitra'), hackerrankUrl: null });

  const list = async (q = '') => (await admin.get(`/api/admin/students${q}`)).body;
  const all = await list();
  assert.equal(all.total, 3);
  assert.deepEqual(all.items.map((s) => s.name), ['Asha', 'Bala', 'Chitra 100%']);
  assert.equal(all.items[0].accounts[0].profileUrl, 'https://leetcode.com/u/asha/');
  assert.equal(all.items[0].accounts[0].state, 'active');
  assert.deepEqual(all.items[2].accounts.map((a) => a.platform), ['leetcode']);
  assert.equal(all.items[1].yearOfStudy, 2);

  assert.deepEqual((await list(`?deptId=${IT}`)).items.map((s) => s.name), ['Chitra 100%']);
  assert.deepEqual((await list('?batchYear=2029')).items.map((s) => s.name), ['Bala']);
  assert.deepEqual((await list('?q=it0')).items.map((s) => s.name), ['Chitra 100%'], 'search matches roll numbers');
  assert.deepEqual((await list('?q=ASH')).items.map((s) => s.name), ['Asha'], 'search is case-insensitive');
  assert.deepEqual((await list('?q=100%25')).items.map((s) => s.name), ['Chitra 100%'], 'wildcards are escaped');
  assert.equal((await list('?q=%25')).total, 1, 'a bare % matches only literal percent signs');

  const page2 = await list('?pageSize=2&page=2');
  assert.deepEqual([page2.total, page2.page, page2.pageSize, page2.items.length], [3, 2, 2, 1]);
  assert.equal((await admin.get('/api/admin/students?pageSize=101')).status, 400);
  assert.equal((await admin.get('/api/admin/students?deptId=x')).status, 400);
});

test('editing details, department and batch', async () => {
  const { body: { student: s } } = await add();
  const res = await admin.patch(`/api/admin/students/${s.id}`, { name: 'Asha K', rollNo: 'CSE099', deptId: IT, batchYear: 2029 });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.student.name, res.body.student.rollNo, res.body.student.deptCode, res.body.student.batchYear], ['Asha K', 'CSE099', 'IT', 2029]);
  assert.deepEqual(calls.length, 2, 'unchanged profile URLs are not fetched again');

  await add({ name: 'Other', rollNo: 'CSE050', leetcodeUrl: lc('other'), hackerrankUrl: null });
  assert.equal((await admin.patch(`/api/admin/students/${s.id}`, { rollNo: 'CSE050' })).body.error.code, 'ROLL_NUMBER_EXISTS');
  assert.equal((await admin.patch(`/api/admin/students/${s.id}`, { name: '' })).status, 422);
  assert.equal((await admin.patch(`/api/admin/students/${s.id}`, { deptId: 77 })).status, 422);
  assert.equal((await admin.patch('/api/admin/students/9999', { name: 'x' })).status, 404);
});

test('changing a profile URL re-verifies it, drops the old profile\'s data and stores a fresh snapshot', async () => {
  const { body: { student: s } } = await add();
  assert.equal((await leaderboard('leetcode'))[0].solved.total, 54);

  const res = await admin.patch(`/api/admin/students/${s.id}`, { leetcodeUrl: lc('asha_new_handle') });
  assert.equal(res.status, 200);
  assert.equal(res.body.student.accounts.find((a) => a.platform === 'leetcode').username, 'asha_new_handle');
  const lb = await leaderboard('leetcode');
  assert.equal(lb.length, 1);
  assert.equal(lb[0].solved.total, 50 + 'asha_new_handle'.length, 'shows the new profile, not the old one');
  assert.equal(await count('snapshots'), 2, 'one snapshot per platform');

  const bad = await admin.patch(`/api/admin/students/${s.id}`, { leetcodeUrl: lc('missing_new') });
  assert.equal(bad.status, 422);
  assert.equal((await admin.get(`/api/admin/students?q=asha`)).body.items[0].accounts[0].username, 'asha_new_handle', 'a rejected change leaves everything as it was');
});

test('removing a profile deletes its account and data, but a student keeps at least one', async () => {
  const { body: { student: s } } = await add();
  const res = await admin.patch(`/api/admin/students/${s.id}`, { hackerrankUrl: '' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.student.accounts.map((a) => a.platform), ['leetcode']);
  assert.deepEqual(await leaderboard('hackerrank'), []);
  assert.equal(await count('snapshots'), 1);

  const last = await admin.patch(`/api/admin/students/${s.id}`, { leetcodeUrl: null });
  assert.equal(last.status, 422);
  assert.match(last.body.error.message, /at least one profile URL/);
});

test('re-submitting the URL of a broken profile re-verifies and reactivates it', async () => {
  const { body: { student: s } } = await add();
  await t.db.query("update platform_accounts set state = 'broken', last_error = 'Profile not found' where username = 'asha'");
  assert.deepEqual(await leaderboard('leetcode'), [], 'broken accounts are hidden');

  calls.length = 0;
  const res = await admin.patch(`/api/admin/students/${s.id}`, { leetcodeUrl: lc('asha') });
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ['leetcode:asha']);
  assert.equal(res.body.student.accounts[0].state, 'active');
  assert.equal((await leaderboard('leetcode')).length, 1);
});

test('deleting a student removes their accounts and snapshots', async () => {
  const { body: { student: s } } = await add();
  assert.equal((await admin.delete(`/api/admin/students/${s.id}`)).status, 204);
  assert.deepEqual([await count(), await count('platform_accounts'), await count('snapshots')], [0, 0, 0]);
  assert.equal((await admin.delete(`/api/admin/students/${s.id}`)).status, 404);
  assert.equal((await admin.delete('/api/admin/students/abc')).status, 400);
});

test('refresh scrapes now: updates data, marks missing profiles broken, ignores temporary failures', async () => {
  const { body: { student: s } } = await add();
  await t.db.query("update snapshots set solved_total = 1 where platform = 'leetcode'");

  const ok = await admin.post(`/api/admin/students/${s.id}/refresh`, {});
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.results.map((r) => [r.platform, r.status]), [['leetcode', 'ok'], ['hackerrank', 'ok']]);
  assert.equal((await leaderboard('leetcode'))[0].solved.total, 54, 'snapshot refreshed');

  await t.db.query("update platform_accounts set username = 'flaky_now' where platform = 'leetcode'");
  const flaky = await admin.post(`/api/admin/students/${s.id}/refresh`, {});
  assert.equal(flaky.body.results.find((r) => r.platform === 'leetcode').status, 'error');
  assert.equal(flaky.body.student.accounts.find((a) => a.platform === 'leetcode').state, 'active', 'a temporary failure changes nothing');

  await t.db.query("update platform_accounts set username = 'missing_now' where platform = 'leetcode'");
  const gone = await admin.post(`/api/admin/students/${s.id}/refresh`, {});
  assert.equal(gone.body.results.find((r) => r.platform === 'leetcode').status, 'not_found');
  assert.equal(gone.body.student.accounts.find((a) => a.platform === 'leetcode').state, 'broken');

  assert.equal((await admin.post('/api/admin/students/9999/refresh', {})).status, 404);
});

test('CSV validate: checks each row, flags duplicates and missing profiles, never writes', async () => {
  await add({ rollNo: 'EXIST1' });
  calls.length = 0;
  const rows = [
    student({ name: 'Ok One', rollNo: 'N1', leetcodeUrl: lc('ok_one'), hackerrankUrl: hr('ok_one') }),
    student({ name: 'Missing', rollNo: 'N2', leetcodeUrl: lc('missing_a'), hackerrankUrl: null }),
    student({ name: 'Dup File', rollNo: 'n1', leetcodeUrl: lc('dup') }),
    student({ name: 'Dup DB', rollNo: 'EXIST1', leetcodeUrl: lc('dupdb') }),
    student({ name: 'Bad URL', rollNo: 'N5', leetcodeUrl: 'nope', hackerrankUrl: null }),
    student({ name: 'Flaky', rollNo: 'N6', leetcodeUrl: lc('flaky_x'), hackerrankUrl: null }),
  ];
  const res = await admin.post('/api/admin/students/validate', { rows });
  assert.equal(res.status, 200);
  const r = res.body.results;
  assert.deepEqual(r.map((x) => [x.index, x.ok]), [[0, true], [1, false], [2, false], [3, false], [4, false], [5, true]]);
  assert.deepEqual(r[0].accounts.map((a) => [a.platform, a.verified, a.solvedTotal]), [['leetcode', 'ok', 56], ['hackerrank', 'ok', 56]]);
  assert.match(r[1].errors[0], /missing_a.*not found/);
  assert.match(r[2].errors.join(), /more than once/);
  assert.match(r[3].errors.join(), /already exists/);
  assert.match(r[4].errors.join(), /leetcode/);
  assert.equal(r[5].warnings.length, 1, 'a temporary failure is a warning, not an error');
  assert.equal(await count(), 1, 'nothing was created');
  assert.ok(!calls.includes('leetcode:dup') && !calls.includes('leetcode:dupdb'), 'rows that are already invalid are not fetched');

  assert.equal((await admin.post('/api/admin/students/validate', { rows: Array.from({ length: 11 }, () => student()) })).status, 400);
  assert.equal((await admin.post('/api/admin/students/validate', { rows: [] })).status, 400);
});

test('CSV validate returns rows it could not reach in time as unchecked so they can be resent', async () => {
  let time = 0;
  const slow = async (platform, username) => { time += 6000; return fetchProfile(platform, username); };
  const rows = Array.from({ length: 6 }, (_, i) => student({ rollNo: `S${i}`, leetcodeUrl: lc(`slow${i}`), hackerrankUrl: null }));
  const results = await validateRows(t.db, rows, { fetchProfile: slow, clock: () => time, budgetMs: 20000, sleep: async () => {} });
  assert.deepEqual(results.map((r) => r.checked), [true, true, true, false, false, false]);
  assert.ok(results.slice(3).every((r) => !r.ok && r.errors.length === 0));
});

test('CSV import creates valid rows, skips bad ones with reasons, and does not fetch profiles', async () => {
  await add({ rollNo: 'EXIST1' });
  calls.length = 0;
  const res = await admin.post('/api/admin/students/import', {
    rows: [
      { name: 'One', rollNo: 'I1', deptCode: 'cse', batchYear: '2028', leetcodeUrl: lc('one'), hackerrankUrl: hr('one') },
      { name: 'Two', rollNo: 'I2', deptId: IT, batchYear: 2029, leetcodeUrl: lc('two') },
      { name: 'Dup', rollNo: 'EXIST1', deptId: CSE, batchYear: 2028, leetcodeUrl: lc('dup') },
      { name: 'Bad', rollNo: 'I4', deptId: CSE, batchYear: 2028, leetcodeUrl: 'nope' },
      { name: 'Same file', rollNo: 'I1', deptId: CSE, batchYear: 2028, leetcodeUrl: lc('samefile') },
    ],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.created.map((c) => c.rollNo), ['I1', 'I2']);
  assert.deepEqual(res.body.skipped.map((s) => [s.index, s.rollNo]), [[2, 'EXIST1'], [3, 'I4'], [4, 'I1']]);
  assert.match(res.body.skipped[0].reason, /already exists/);
  assert.match(res.body.skipped[1].reason, /leetcode/);
  assert.equal(await count(), 3);
  assert.deepEqual(calls, []);

  const { rows } = await t.db.query("select state, last_scraped_at from platform_accounts where username = 'one' and platform = 'leetcode'");
  assert.deepEqual(rows, [{ state: 'active', last_scraped_at: null }], 'imported accounts are due for the next scrape');
  assert.equal((await admin.post('/api/admin/students/import', { rows: Array.from({ length: 201 }, () => student()) })).status, 400);
});
