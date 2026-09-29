import { withTransaction } from '../db.js';
import { parseProfileUrl } from '../../scraper/index.js';

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.join('; '));
    this.errors = errors;
  }
}

// Creates a student and one platform_account per provided profile URL.
// The scrape tick picks the new accounts up in the next window (or via refresh).
export async function addStudent(db, { name, rollNo, deptCode, batchYear, leetcodeUrl, hackerrankUrl }) {
  const errors = [];
  if (!name?.trim()) errors.push('name is required');
  if (!rollNo?.trim()) errors.push('rollNo is required');
  if (!deptCode?.trim()) errors.push('department is required');
  const batch = Number(batchYear);
  if (!Number.isInteger(batch) || batch < 2000 || batch > 2100) errors.push('batchYear must be a year like 2028');

  const accounts = [];
  let providedUrls = 0;
  for (const [platform, url] of [['leetcode', leetcodeUrl], ['hackerrank', hackerrankUrl]]) {
    if (!url?.trim()) continue;
    providedUrls++;
    const parsed = parseProfileUrl(platform, url);
    if (parsed.ok) accounts.push({ platform, username: parsed.username });
    else errors.push(`${platform}: ${parsed.error}`);
  }
  if (!providedUrls) errors.push('at least one profile URL is required');
  if (errors.length) throw new ValidationError(errors);

  return withTransaction(db, async (client) => {
    const dept = (await client.query('select id from departments where lower(code) = lower($1)', [deptCode.trim()])).rows[0];
    if (!dept) throw new ValidationError([`unknown department: ${deptCode}`]);

    let student;
    try {
      student = (await client.query(
        'insert into students (roll_no, name, dept_id, batch_year) values ($1, $2, $3, $4) returning id',
        [rollNo.trim(), name.trim(), dept.id, batch],
      )).rows[0];
    } catch (err) {
      if (err.code === '23505') throw new ValidationError([`roll number ${rollNo} already exists`]);
      throw err;
    }

    for (const a of accounts) {
      await client.query('insert into platform_accounts (student_id, platform, username) values ($1, $2, $3)', [student.id, a.platform, a.username]);
    }
    return { studentId: student.id, accounts };
  });
}
