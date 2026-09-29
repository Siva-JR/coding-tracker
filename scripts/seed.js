import { createPool } from '../api/db.js';
import { migrate } from '../api/migrate.js';

// Development placeholders. Replace with the real department list before production.
const DEPARTMENTS = [
  ['Computer Science and Engineering', 'CSE'],
  ['Information Technology', 'IT'],
  ['Electronics and Communication Engineering', 'ECE'],
];

const db = createPool();
try {
  await migrate(db);
  for (const [name, code] of DEPARTMENTS) {
    await db.query('insert into departments (name, code) values ($1, $2) on conflict (code) do nothing', [name, code]);
  }
  const { rows } = await db.query('select code, name from departments order by id');
  console.log('Departments:', rows.map((r) => r.code).join(', '));
} finally {
  await db.end();
}
