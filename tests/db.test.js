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

test('hod staff must have a department; other roles must not', async () => {
  const add = (role, deptId) => t.db.query("insert into staff (username, password_hash, role, dept_id) values ($1, 'x', $2, $3)", [`u-${role}-${deptId}`, role, deptId]);
  await assert.rejects(() => add('hod', null), /check constraint/);
  await assert.rejects(() => add('admin', 1), /check constraint/);
  const { rows: [dept] } = await t.db.query("select id from departments limit 1");
  await add('hod', dept.id);
  await add('admin', null);
});

test('one snapshot per student, platform and day', async () => {
  const { rows: [s] } = await t.db.query('select id from students limit 1');
  const insert = () => t.db.query("insert into snapshots (student_id, platform, snap_date, solved_total) values ($1, 'leetcode', '2026-09-30', 10)", [s.id]);
  await insert();
  await assert.rejects(insert, /duplicate key/);
});
