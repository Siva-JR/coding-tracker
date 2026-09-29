import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers/testdb.js';
import { migrate } from '../api/migrate.js';

let t;
before(async () => { t = await startTestDb(); });
after(async () => { await t.stop(); });

test('migrations are idempotent', async () => {
  assert.deepEqual(await migrate(t.db), []);
});

test('roll numbers are unique', async () => {
  const { rows: [dept] } = await t.db.query("insert into departments (name, code) values ('Computer Science', 'CSE') returning id");
  const insert = () => t.db.query("insert into students (roll_no, name, dept_id, batch_year) values ('R1', 'A', $1, 2028)", [dept.id]);
  await insert();
  await assert.rejects(insert, /duplicate key/);
});

test('staff roles are limited to admin and viewer', async () => {
  const add = (role) => t.db.query("insert into staff (username, password_hash, role) values ($1, 'x', $2)", [`u-${role}`, role]);
  await assert.rejects(() => add('hod'), /check constraint/);
  await add('admin');
  await add('viewer');
});

test('usernames must be lowercase', async () => {
  await assert.rejects(() => t.db.query("insert into staff (username, password_hash, role) values ('MixedCase', 'x', 'viewer')"), /check constraint/);
});

test('a scope row cannot be duplicated, including all-departments rows', async () => {
  const { rows: [s] } = await t.db.query("select id from staff where username = 'u-viewer'");
  const { rows: [d] } = await t.db.query('select id from departments limit 1');
  const add = (dept, year) => t.db.query('insert into staff_scopes (staff_id, dept_id, year) values ($1, $2, $3)', [s.id, dept, year]);
  await add(d.id, null);
  await add(d.id, 2);
  await add(null, null);
  await assert.rejects(() => add(d.id, null), /duplicate key/);
  await assert.rejects(() => add(null, null), /duplicate key/);
  await assert.rejects(() => add(d.id, 5), /check constraint/);
});

test('one snapshot per student, platform and day', async () => {
  const { rows: [s] } = await t.db.query('select id from students limit 1');
  const insert = () => t.db.query("insert into snapshots (student_id, platform, snap_date, solved_total) values ($1, 'leetcode', '2026-09-30', 10)", [s.id]);
  await insert();
  await assert.rejects(insert, /duplicate key/);
});
