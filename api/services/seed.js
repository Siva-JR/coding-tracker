import { withTransaction } from '../db.js';
import { hashPassword, passwordProblem } from './passwords.js';

// Development placeholders. Replace with the real department list before production.
const DEPARTMENTS = [
  ['Computer Science and Engineering', 'CSE'],
  ['Information Technology', 'IT'],
  ['Electronics and Communication Engineering', 'ECE'],
];

// deptCode null = all departments. Seeded accounts do not have to change their password at first login.
const ACCOUNTS = [
  { username: 'admin', role: 'admin', title: 'Administrator', deptCode: null },
  { username: 'principal', role: 'viewer', title: 'Principal', deptCode: null },
  { username: 'vice.chairman', role: 'viewer', title: 'Vice Chairman', deptCode: null },
  { username: 'hod.it', role: 'viewer', title: 'HOD - IT', deptCode: 'IT' },
];

// Idempotent: existing departments and accounts are left untouched.
export async function seedDefaults(db, { password }) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(`Seed password rejected: ${problem}`);

  for (const [name, code] of DEPARTMENTS) {
    await db.query('insert into departments (name, code) values ($1, $2) on conflict (code) do nothing', [name, code]);
  }

  const passwordHash = await hashPassword(password);
  const created = [];
  const existing = [];

  for (const account of ACCOUNTS) {
    const inserted = await withTransaction(db, async (client) => {
      const { rows: [row] } = await client.query(
        `insert into staff (username, password_hash, role, display_title, must_change_password)
         values ($1, $2, $3, $4, false) on conflict (username) do nothing returning id`,
        [account.username, passwordHash, account.role, account.title],
      );
      if (!row) return false;
      if (account.role === 'viewer') {
        await client.query(
          'insert into staff_scopes (staff_id, dept_id, year) values ($1, (select id from departments where code = $2), null)',
          [row.id, account.deptCode],
        );
      }
      return true;
    });
    (inserted ? created : existing).push(account.username);
  }
  return { created, existing };
}
