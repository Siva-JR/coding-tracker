import { withTransaction } from '../db.js';
import { HttpError, ValidationError } from '../http.js';
import { parseProfileUrl, fetchProfile as defaultFetchProfile } from '../../scraper/index.js';
import { recordSuccess, recordNotFound } from './queue.js';
import { PROFILE_URL } from './leaderboard.js';
import { yearOfStudy } from './year.js';

export { ValidationError };

const PLATFORMS = ['leetcode', 'hackerrank'];
const URL_FIELD = { leetcode: 'leetcodeUrl', hackerrank: 'hackerrankUrl' };
const VERIFY_TIMEOUT_MS = 8000;
const text = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

function checkFields(input, { partial }) {
  const errors = [];
  const fields = {};

  if (!partial || input.name !== undefined) {
    const name = text(input.name);
    if (!name) errors.push('name is required');
    else if (name.length > 100) errors.push('name must be at most 100 characters');
    else fields.name = name;
  }
  if (!partial || input.rollNo !== undefined) {
    const rollNo = text(input.rollNo);
    if (!rollNo) errors.push('rollNo is required');
    else if (rollNo.length > 40) errors.push('rollNo must be at most 40 characters');
    else fields.rollNo = rollNo;
  }
  if (!partial || input.batchYear !== undefined) {
    const batch = Number(input.batchYear);
    if (!Number.isInteger(batch) || batch < 2000 || batch > 2100) errors.push('batchYear must be a year like 2028');
    else fields.batchYear = batch;
  }
  return { errors, fields };
}

// Returns { errors, urls } where urls[platform] is a username, null (remove) or absent (unchanged / not given).
function checkUrls(input) {
  const errors = [];
  const urls = {};
  for (const platform of PLATFORMS) {
    const raw = input[URL_FIELD[platform]];
    if (raw === undefined) continue;
    if (raw === null || (typeof raw === 'string' && !raw.trim())) {
      urls[platform] = null;
      continue;
    }
    const parsed = parseProfileUrl(platform, raw);
    if (parsed.ok) urls[platform] = parsed.username;
    else errors.push(`${platform}: ${parsed.error}`);
  }
  return { errors, urls };
}

async function resolveDepartment(db, { deptId, deptCode }) {
  if (deptId !== undefined && deptId !== null && deptId !== '') {
    return (await db.query('select id, code from departments where id = $1', [Number(deptId) || 0])).rows[0] ?? null;
  }
  if (text(deptCode)) return (await db.query('select id, code from departments where lower(code) = lower($1)', [text(deptCode)])).rows[0] ?? null;
  return null;
}

const departmentError = (input) => {
  if (input.deptId !== undefined && input.deptId !== null && input.deptId !== '') return `unknown department id: ${input.deptId}`;
  return text(input.deptCode) ? `unknown department: ${input.deptCode}` : 'department is required';
};

// Fetches each profile once, in parallel. status: ok | not_found | unverified (temporary failure).
export async function verifyAccounts(accounts, fetchProfile = defaultFetchProfile) {
  return Promise.all(accounts.map(async ({ platform, username }) => {
    try {
      const r = await fetchProfile(platform, username, { retries: 0, timeoutMs: VERIFY_TIMEOUT_MS });
      if (r.status === 'ok') return { platform, username, status: 'ok', data: r.data };
      if (r.status === 'not_found') return { platform, username, status: 'not_found' };
      return { platform, username, status: 'unverified', error: r.error };
    } catch (err) {
      return { platform, username, status: 'unverified', error: err?.message };
    }
  }));
}

const notFoundErrors = (checks) => checks.filter((c) => c.status === 'not_found').map((c) => `${c.platform}: profile "${c.username}" was not found`);

const rollTaken = (rollNo) => new ValidationError([`roll number ${rollNo} already exists`], { status: 409, code: 'ROLL_NUMBER_EXISTS' });

async function storeFirstSnapshots(db, studentId, checks, now) {
  for (const c of checks.filter((x) => x.status === 'ok')) {
    const { rows: [account] } = await db.query('select id, student_id, platform from platform_accounts where student_id = $1 and platform = $2', [studentId, c.platform]);
    if (account) await recordSuccess(db, account, c.data, { now });
  }
}

function describeChecks(accounts, checks) {
  return accounts.map((a) => {
    const c = checks.find((x) => x.platform === a.platform);
    return { platform: a.platform, username: a.username, verified: !c ? 'skipped' : c.status === 'ok' ? 'ok' : 'unverified', ...(c?.status === 'ok' ? { stats: c.data } : {}) };
  });
}

const warningsFor = (checks) => checks.filter((c) => c.status === 'unverified')
  .map((c) => `${c.platform}: could not verify "${c.username}" right now (${c.error}); the next scrape will check it`);

// Validates a candidate student without writing anything. Returns { errors, value } where value is
// { name, rollNo, batchYear, deptId, accounts } when there are no errors.
async function prepareStudent(db, input) {
  const { errors, fields } = checkFields(input, { partial: false });
  const urlCheck = checkUrls(input);
  errors.push(...urlCheck.errors);

  const accounts = PLATFORMS.filter((p) => typeof urlCheck.urls[p] === 'string').map((p) => ({ platform: p, username: urlCheck.urls[p] }));
  const gaveUrl = PLATFORMS.some((p) => text(input[URL_FIELD[p]]));
  if (!gaveUrl) errors.push('at least one profile URL is required');

  const dept = await resolveDepartment(db, input);
  if (!dept) errors.push(departmentError(input));

  return { errors, value: { ...fields, deptId: dept?.id, deptCode: dept?.code, accounts } };
}

// Creates a student and one platform_account per provided profile URL. With verify, each profile
// is fetched live first: a nonexistent profile is rejected, a temporary failure only warns, and
// the first snapshot is stored immediately.
export async function addStudent(db, input, { verify = false, fetchProfile = defaultFetchProfile, now = new Date() } = {}) {
  const { errors, value } = await prepareStudent(db, input);
  if (errors.length) throw new ValidationError(errors);

  if ((await db.query('select 1 from students where roll_no = $1', [value.rollNo])).rowCount) throw rollTaken(value.rollNo);

  const checks = verify ? await verifyAccounts(value.accounts, fetchProfile) : [];
  const missing = notFoundErrors(checks);
  if (missing.length) throw new ValidationError(missing);

  const studentId = await withTransaction(db, async (client) => {
    let student;
    try {
      student = (await client.query(
        'insert into students (roll_no, name, dept_id, batch_year) values ($1, $2, $3, $4) returning id',
        [value.rollNo, value.name, value.deptId, value.batchYear],
      )).rows[0];
    } catch (err) {
      if (err.code === '23505') throw rollTaken(value.rollNo);
      throw err;
    }
    for (const a of value.accounts) {
      await client.query('insert into platform_accounts (student_id, platform, username) values ($1, $2, $3)', [student.id, a.platform, a.username]);
    }
    return student.id;
  });

  await storeFirstSnapshots(db, studentId, checks, now);
  return {
    studentId,
    student: await getStudent(db, studentId),
    accounts: describeChecks(value.accounts, checks),
    warnings: warningsFor(checks),
  };
}

const STUDENT_SELECT = `
  select st.id, st.roll_no, st.name, st.dept_id, d.code as dept_code, st.batch_year,
    coalesce(json_agg(json_build_object(
      'platform', pa.platform, 'username', pa.username, 'state', pa.state,
      'attempts', pa.attempts, 'lastOkAt', pa.last_ok_at, 'lastError', pa.last_error
    ) order by case pa.platform when 'leetcode' then 0 else 1 end) filter (where pa.id is not null), '[]'::json) as accounts
  from students st
  join departments d on d.id = st.dept_id
  left join platform_accounts pa on pa.student_id = st.id`;

const toStudent = (r, now = new Date()) => ({
  id: r.id,
  rollNo: r.roll_no,
  name: r.name,
  deptId: r.dept_id,
  deptCode: r.dept_code,
  batchYear: r.batch_year,
  yearOfStudy: yearOfStudy(r.batch_year, now),
  accounts: r.accounts.map((a) => ({ ...a, profileUrl: PROFILE_URL[a.platform](a.username) })),
});

export async function getStudent(db, id) {
  const { rows: [row] } = await db.query(`${STUDENT_SELECT} where st.id = $1 group by st.id, d.code`, [id]);
  return row ? toStudent(row) : null;
}

export async function listStudents(db, { deptId = null, batchYear = null, q = null, page = 1, pageSize = 50, now = new Date() }) {
  const params = [deptId, batchYear, q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null];
  const where = `where ($1::int is null or st.dept_id = $1) and ($2::int is null or st.batch_year = $2)
                 and ($3::text is null or st.name ilike $3 or st.roll_no ilike $3)`;

  const total = (await db.query(`select count(*)::int as n from students st ${where}`, params)).rows[0].n;
  const { rows } = await db.query(
    `${STUDENT_SELECT} ${where} group by st.id, d.code order by st.name, st.id limit $4 offset $5`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map((r) => toStudent(r, now)), page, pageSize, total };
}

export async function updateStudent(db, id, input, { fetchProfile = defaultFetchProfile, now = new Date() } = {}) {
  const { rows: [current] } = await db.query('select id from students where id = $1', [id]);
  if (!current) throw new HttpError(404, 'NOT_FOUND', 'Student not found');

  const { errors, fields } = checkFields(input, { partial: true });
  const urlCheck = checkUrls(input);
  errors.push(...urlCheck.errors);

  const changes = { ...fields };
  if (input.deptId !== undefined || input.deptCode !== undefined) {
    const dept = await resolveDepartment(db, input);
    if (dept) changes.deptId = dept.id;
    else errors.push(departmentError(input));
  }

  const existing = (await db.query('select platform, username, state from platform_accounts where student_id = $1', [id])).rows;
  const remaining = new Set(existing.map((a) => a.platform));
  const toVerify = [];
  for (const platform of PLATFORMS) {
    const wanted = urlCheck.urls[platform];
    if (wanted === undefined) continue;
    const had = existing.find((a) => a.platform === platform);
    if (wanted === null) remaining.delete(platform);
    else {
      remaining.add(platform);
      if (!had || had.username.toLowerCase() !== wanted.toLowerCase() || had.state === 'broken') toVerify.push({ platform, username: wanted });
    }
  }
  if (!remaining.size) errors.push('a student needs at least one profile URL');
  if (errors.length) throw new ValidationError(errors);

  const checks = await verifyAccounts(toVerify, fetchProfile);
  const missing = notFoundErrors(checks);
  if (missing.length) throw new ValidationError(missing);

  await withTransaction(db, async (client) => {
    const sets = [];
    const values = [id];
    for (const [key, column] of [['name', 'name'], ['rollNo', 'roll_no'], ['deptId', 'dept_id'], ['batchYear', 'batch_year']]) {
      if (changes[key] === undefined) continue;
      values.push(changes[key]);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length) {
      try {
        await client.query(`update students set ${sets.join(', ')} where id = $1`, values);
      } catch (err) {
        if (err.code === '23505') throw rollTaken(changes.rollNo);
        throw err;
      }
    }

    for (const platform of PLATFORMS) {
      const wanted = urlCheck.urls[platform];
      if (wanted === undefined) continue;
      if (wanted === null) {
        await client.query('delete from platform_accounts where student_id = $1 and platform = $2', [id, platform]);
        await client.query('delete from snapshots where student_id = $1 and platform = $2', [id, platform]);
        continue;
      }
      if (!toVerify.some((v) => v.platform === platform)) continue;

      const had = existing.find((a) => a.platform === platform);
      if (had && had.username.toLowerCase() !== wanted.toLowerCase()) {
        await client.query('delete from snapshots where student_id = $1 and platform = $2', [id, platform]); // belonged to another profile
      }
      await client.query(
        `insert into platform_accounts (student_id, platform, username) values ($1, $2, $3)
         on conflict (student_id, platform) do update set username = excluded.username, state = 'active', attempts = 0,
           next_retry_at = null, claimed_until = null, last_scraped_at = null, last_ok_at = null, last_error = null`,
        [id, platform, wanted],
      );
    }
  });

  await storeFirstSnapshots(db, id, checks, now);
  return { student: await getStudent(db, id), warnings: warningsFor(checks) };
}

export async function deleteStudent(db, id) {
  const { rowCount } = await db.query('delete from students where id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'NOT_FOUND', 'Student not found');
}

// Scrapes a student's profiles right now. A failed fetch changes nothing; a missing profile marks it broken.
export async function refreshStudent(db, id, { fetchProfile = defaultFetchProfile, now = new Date() } = {}) {
  const { rows: accounts } = await db.query('select id, student_id, platform, username from platform_accounts where student_id = $1 order by case platform when \'leetcode\' then 0 else 1 end', [id]);
  if (!accounts.length) {
    if (!(await db.query('select 1 from students where id = $1', [id])).rowCount) throw new HttpError(404, 'NOT_FOUND', 'Student not found');
    return { student: await getStudent(db, id), results: [] };
  }

  const checks = await verifyAccounts(accounts, fetchProfile);
  const results = [];
  for (const account of accounts) {
    const c = checks.find((x) => x.platform === account.platform);
    if (c.status === 'ok') await recordSuccess(db, account, c.data, { now });
    else if (c.status === 'not_found') await recordNotFound(db, account, { now });
    results.push({
      platform: c.platform, username: c.username,
      status: c.status === 'unverified' ? 'error' : c.status,
      ...(c.status === 'ok' ? { stats: c.data } : {}),
      ...(c.error ? { error: c.error } : {}),
    });
  }
  return { student: await getStudent(db, id), results };
}

// CSV step 1: checks up to 10 rows without writing anything. Rows the time budget cannot reach are
// returned as checked: false so the client can resend them.
export async function validateRows(db, rows, { fetchProfile = defaultFetchProfile, clock = () => Date.now(), budgetMs = 20000, pauseMs = 300, sleep } = {}) {
  const pause = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const started = clock();
  const seenRolls = new Set();
  const results = [];

  for (const [index, row] of rows.entries()) {
    const { errors, value } = await prepareStudent(db, row);
    const roll = value.rollNo;
    if (roll) {
      if (seenRolls.has(roll.toLowerCase())) errors.push(`roll number ${roll} appears more than once in this file`);
      seenRolls.add(roll.toLowerCase());
      if ((await db.query('select 1 from students where roll_no = $1', [roll])).rowCount) errors.push(`roll number ${roll} already exists`);
    }
    if (errors.length) {
      results.push({ index, checked: true, ok: false, errors, warnings: [], accounts: [] });
      continue;
    }

    if (clock() - started + VERIFY_TIMEOUT_MS > budgetMs) {
      results.push({ index, checked: false, ok: false, errors: [], warnings: [], accounts: [] });
      continue;
    }
    const checks = await verifyAccounts(value.accounts, fetchProfile);
    const missing = notFoundErrors(checks);
    results.push({
      index, checked: true, ok: !missing.length, errors: missing, warnings: warningsFor(checks),
      accounts: describeChecks(value.accounts, checks).map(({ platform, username, verified, stats }) => ({ platform, username, verified, solvedTotal: stats?.solvedTotal ?? null })),
    });
    await pause(pauseMs);
  }
  return results;
}

// CSV step 2: inserts each row independently. Rows that fail are skipped with a reason.
export async function importRows(db, rows) {
  const created = [];
  const skipped = [];

  for (const [index, row] of rows.entries()) {
    const { errors, value } = await prepareStudent(db, row);
    if (errors.length) {
      skipped.push({ index, rollNo: text(row.rollNo) || null, reason: errors.join('; ') });
      continue;
    }
    try {
      const studentId = await withTransaction(db, async (client) => {
        const student = (await client.query(
          'insert into students (roll_no, name, dept_id, batch_year) values ($1, $2, $3, $4) returning id',
          [value.rollNo, value.name, value.deptId, value.batchYear],
        )).rows[0];
        for (const a of value.accounts) {
          await client.query('insert into platform_accounts (student_id, platform, username) values ($1, $2, $3)', [student.id, a.platform, a.username]);
        }
        return student.id;
      });
      created.push({ index, studentId, rollNo: value.rollNo });
    } catch (err) {
      if (err.code !== '23505') throw err;
      skipped.push({ index, rollNo: value.rollNo, reason: `roll number ${value.rollNo} already exists` });
    }
  }
  return { created, skipped };
}
