// In-memory implementation of the API contract (BACKEND_PLAN §3).
// Every function takes the signed-in `user` and derives scope from it, exactly
// like the real server will: a HOD's deptId is never taken from the request.
import { DEPARTMENTS, USERS, TODAY_ISO, HISTORY_DAYS, dayIso, generateStudents, yearOf } from './mockData.js';
import { parseProfileUrl, profileUrl } from '../lib/profileUrl.js';
import { batchYearFor } from '../lib/yearOfStudy.js';

const students = generateStudents();
const staff = USERS.map((u) => ({ ...u }));
let nextStudentId = students.length + 1;
let nextStaffId = staff.length + 1;

const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms + Math.random() * 180));

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const deptById = (id) => DEPARTMENTS.find((d) => d.id === id);
const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  role: u.role,
  deptId: u.deptId,
  deptName: u.deptId ? deptById(u.deptId).name : null,
  displayTitle: u.displayTitle,
});

function scopeDept(user, requested) {
  if (user.role === 'hod') return user.deptId; // server-derived; request is ignored
  return requested ? Number(requested) : null;
}

const scoped = (user, deptId, year = 'all') => {
  const d = scopeDept(user, deptId);
  return students.filter((s) => (d ? s.deptId === d : true) && (year === 'all' || yearOf(s) === Number(year)));
};

const lastIdx = HISTORY_DAYS - 1;
const total = (s, p) => (s[p].history ? s[p].history[lastIdx] : null);
const gain = (s, p, days) => (s[p].history ? s[p].history[lastIdx] - s[p].history[lastIdx - days] : 0);

// ── auth ────────────────────────────────────────────────────────────────
export async function login(username, password) {
  await wait(350);
  const u = staff.find((x) => x.username === username.trim().toLowerCase());
  if (!u || u.password !== password) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Wrong username or password.');
  if (u.disabled) throw new ApiError(403, 'DISABLED', 'This account is disabled. Ask the administrator.');
  return { user: publicUser(u) };
}

export async function me(userId) {
  const u = staff.find((x) => x.id === userId);
  if (!u || u.disabled) throw new ApiError(401, 'UNAUTHENTICATED', 'Session expired.');
  return { user: publicUser(u) };
}

// ── reference ───────────────────────────────────────────────────────────
export async function departments(user) {
  await wait(80);
  return DEPARTMENTS.filter((d) => user.role !== 'hod' || d.id === user.deptId).map(({ id, name, code }) => ({ id, name, code }));
}

export async function departmentOverview(user) {
  await wait();
  return DEPARTMENTS.filter((d) => user.role !== 'hod' || d.id === user.deptId).map((d) => {
    const list = students.filter((s) => s.deptId === d.id);
    const lc = list.filter((s) => total(s, 'leetcode') != null);
    const avg = lc.length ? Math.round(lc.reduce((a, s) => a + total(s, 'leetcode'), 0) / lc.length) : 0;
    const active = list.filter((s) => gain(s, 'leetcode', 7) + gain(s, 'hackerrank', 7) > 0).length;
    const attention = list.filter((s) => s.leetcode.status !== 'ok' || s.hackerrank.status !== 'ok').length;
    const top = [...lc].sort((a, b) => total(b, 'leetcode') - total(a, 'leetcode'))[0];
    const spark = weeklySeries(list, 'leetcode', 12);
    return {
      id: d.id, code: d.code, name: d.name,
      students: list.length, avgSolved: avg, active, attention,
      top: top ? { name: top.name, solved: total(top, 'leetcode') } : null,
      spark,
    };
  });
}

// ── leaderboard ─────────────────────────────────────────────────────────
export async function leaderboard(user, { platform = 'leetcode', sort = 'solved', year = 'all', deptId, limit = 20 } = {}) {
  await wait();
  if (platform === 'hackerrank' && sort === 'rank') {
    throw new ApiError(400, 'BAD_REQUEST', 'HackerRank sorts by problems solved only.');
  }
  const list = scoped(user, deptId, year).filter((s) => total(s, platform) != null && s[platform].status !== 'not_found');
  const sorted = list.sort((a, b) => {
    if (platform === 'leetcode' && sort === 'rank') {
      const ra = a.leetcode.globalRank ?? Infinity;
      const rb = b.leetcode.globalRank ?? Infinity;
      return ra - rb || total(b, platform) - total(a, platform);
    }
    const t = total(b, platform) - total(a, platform);
    if (t) return t;
    if (platform === 'leetcode') return b.leetcode.hard - a.leetcode.hard || b.leetcode.medium - a.leetcode.medium;
    return 0;
  });
  const entries = sorted.slice(0, limit).map((s, i) => ({
    position: i + 1,
    studentId: s.id,
    name: s.name,
    rollNo: s.rollNo,
    deptCode: s.deptCode,
    batchYear: s.batchYear,
    yearOfStudy: yearOf(s),
    solved:
      platform === 'leetcode'
        ? { total: total(s, platform), easy: s.leetcode.easy, medium: s.leetcode.medium, hard: s.leetcode.hard }
        : { total: total(s, platform), easy: null, medium: null, hard: null },
    globalRank: platform === 'leetcode' ? s.leetcode.globalRank : null,
    stars: platform === 'hackerrank' ? s.hackerrank.stars : null,
    weekGain: gain(s, platform, 7),
    stale: s[platform].status !== 'ok' || s[platform].lastOk !== TODAY_ISO,
    profileUrl: profileUrl(platform, platform === 'leetcode' ? s.leetcodeUsername : s.hackerrankUsername),
  }));
  return { platform, sort, year, deptId: scopeDept(user, deptId), asOf: TODAY_ISO, count: list.length, entries };
}

// ── stats for the dashboard ─────────────────────────────────────────────
function weeklySeries(list, platform, weeks) {
  // Average solved per student, sampled weekly (end of each week).
  const out = [];
  const withData = list.filter((s) => s[platform].history);
  for (let w = weeks - 1; w >= 0; w--) {
    const idx = lastIdx - w * 7;
    if (idx < 0 || !withData.length) continue;
    out.push(Math.round(withData.reduce((a, s) => a + s[platform].history[idx], 0) / withData.length));
  }
  return out;
}

export async function stats(user, { deptId } = {}) {
  await wait();
  const list = scoped(user, deptId);
  const lc = list.filter((s) => total(s, 'leetcode') != null);
  const active = list.filter((s) => gain(s, 'leetcode', 7) + gain(s, 'hackerrank', 7) > 0);
  const weekSolved = list.reduce((a, s) => a + gain(s, 'leetcode', 7) + gain(s, 'hackerrank', 7), 0);
  const avg = lc.length ? Math.round(lc.reduce((a, s) => a + total(s, 'leetcode'), 0) / lc.length) : 0;

  const weeks = 12;
  const activeSpark = [];
  const weekSpark = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const end = lastIdx - w * 7;
    const start = end - 7;
    if (start < 0) continue;
    let a = 0;
    let sum = 0;
    for (const s of list) {
      let g = 0;
      for (const p of ['leetcode', 'hackerrank']) if (s[p].history) g += s[p].history[end] - s[p].history[start];
      if (g > 0) a++;
      sum += g;
    }
    activeSpark.push(a);
    weekSpark.push(sum);
  }

  // Timeline: weekly average solved per student, both platforms, ~17 weeks.
  const points = [];
  for (let w = 16; w >= 0; w--) {
    const idx = lastIdx - w * 7;
    if (idx < 0) continue;
    const day = dayIso(w * 7);
    const avgOf = (p) => {
      const l = list.filter((s) => s[p].history);
      return l.length ? Math.round((l.reduce((a, s) => a + s[p].history[idx], 0) / l.length) * 10) / 10 : 0;
    };
    points.push({ date: day, leetcode: avgOf('leetcode'), hackerrank: avgOf('hackerrank') });
  }

  const health = (p) => {
    const ok = list.filter((s) => s[p].status === 'ok').length;
    return { ok, total: list.length, pct: list.length ? Math.round((ok / list.length) * 100) : 0 };
  };

  return {
    asOf: TODAY_ISO,
    kpis: {
      totalStudents: { value: list.length, spark: null },
      activeStudents: { value: active.length, spark: activeSpark },
      avgSolved: { value: avg, spark: weeklySeries(list, 'leetcode', 12) },
      weekSolved: { value: weekSolved, spark: weekSpark },
    },
    timeline: points,
    health: { leetcode: health('leetcode'), hackerrank: health('hackerrank') },
    needsAttention: list.filter((s) => s.leetcode.status !== 'ok' || s.hackerrank.status !== 'ok').length,
  };
}

// Derived from snapshot differences — we only scrape nightly, so there are
// no per-solve timestamps; "+N since yesterday" is the honest version.
export async function activity(user, { deptId, limit = 8 } = {}) {
  await wait(160);
  const list = scoped(user, deptId);
  const events = [];
  for (const s of list) {
    for (const p of ['leetcode', 'hackerrank']) {
      const h = s[p].history;
      if (!h) continue;
      for (let back = 0; back < 5; back++) {
        const i = lastIdx - back;
        const g = h[i] - h[i - 1];
        const crossed = [50, 100, 150, 200, 250, 300, 400, 500].find((m) => h[i - 1] < m && h[i] >= m);
        if (crossed) events.push({ date: dayIso(back), studentId: s.id, name: s.name, platform: p, kind: 'milestone', value: crossed, weight: 100 + crossed });
        else if (g >= 4) events.push({ date: dayIso(back), studentId: s.id, name: s.name, platform: p, kind: 'surge', value: g, weight: g });
      }
    }
  }
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.weight - a.weight));
  return events.slice(0, limit);
}

// ── students ────────────────────────────────────────────────────────────
function studentSummary(s) {
  return {
    id: s.id, name: s.name, rollNo: s.rollNo, deptId: s.deptId, deptCode: s.deptCode,
    deptName: deptById(s.deptId).name,
    batchYear: s.batchYear, yearOfStudy: yearOf(s),
    leetcodeUsername: s.leetcodeUsername, hackerrankUsername: s.hackerrankUsername,
    leetcode: {
      status: s.leetcode.status, total: total(s, 'leetcode'), easy: s.leetcode.easy, medium: s.leetcode.medium, hard: s.leetcode.hard,
      globalRank: s.leetcode.globalRank, lastOk: s.leetcode.lastOk, lastError: s.leetcode.lastError, weekGain: gain(s, 'leetcode', 7),
      url: profileUrl('leetcode', s.leetcodeUsername),
    },
    hackerrank: {
      status: s.hackerrank.status, total: total(s, 'hackerrank'), stars: s.hackerrank.stars,
      lastOk: s.hackerrank.lastOk, lastError: s.hackerrank.lastError, weekGain: gain(s, 'hackerrank', 7),
      url: profileUrl('hackerrank', s.hackerrankUsername),
    },
  };
}

export async function listStudents(user, { deptId, year = 'all', q = '', page = 1, pageSize = 25 } = {}) {
  await wait(160);
  const needle = q.trim().toLowerCase();
  let list = scoped(user, deptId, year);
  if (needle) list = list.filter((s) => s.name.toLowerCase().includes(needle) || s.rollNo.toLowerCase().includes(needle));
  list = [...list].sort((a, b) => a.rollNo.localeCompare(b.rollNo));
  const start = (page - 1) * pageSize;
  return { total: list.length, page, pageSize, items: list.slice(start, start + pageSize).map(studentSummary) };
}

export async function student(user, id) {
  await wait();
  const s = students.find((x) => x.id === Number(id));
  if (!s || (user.role === 'hod' && s.deptId !== user.deptId)) throw new ApiError(404, 'NOT_FOUND', 'Student not found.');
  const history = [];
  for (let i = 0; i < HISTORY_DAYS; i++) {
    if (i % 3 !== 0 && i !== lastIdx) continue;
    history.push({
      date: dayIso(lastIdx - i),
      leetcode: s.leetcode.history ? s.leetcode.history[i] : null,
      hackerrank: s.hackerrank.history ? s.hackerrank.history[i] : null,
    });
  }
  const first = history[0];
  return { ...studentSummary(s), history, firstSnapshot: first?.date };
}

export async function attention(user, { deptId } = {}) {
  await wait();
  const list = scoped(user, deptId);
  const broken = [];
  const stale = [];
  const inactive = [];
  for (const s of list) {
    for (const p of ['leetcode', 'hackerrank']) {
      const st = s[p];
      const base = {
        studentId: s.id, name: s.name, rollNo: s.rollNo, deptCode: s.deptCode, yearOfStudy: yearOf(s),
        platform: p, username: p === 'leetcode' ? s.leetcodeUsername : s.hackerrankUsername,
        url: profileUrl(p, p === 'leetcode' ? s.leetcodeUsername : s.hackerrankUsername),
      };
      if (st.status !== 'ok') broken.push({ ...base, status: st.status, error: st.lastError, lastOk: st.lastOk });
      else if (st.lastOk && st.lastOk !== TODAY_ISO && daysBetween(st.lastOk) >= 3) stale.push({ ...base, lastOk: st.lastOk });
    }
    if ((s.leetcode.history || s.hackerrank.history) && gain(s, 'leetcode', 30) + gain(s, 'hackerrank', 30) === 0) {
      inactive.push({ studentId: s.id, name: s.name, rollNo: s.rollNo, deptCode: s.deptCode, yearOfStudy: yearOf(s), leetcode: total(s, 'leetcode'), hackerrank: total(s, 'hackerrank') });
    }
  }
  return { broken, stale, inactive };
}

function daysBetween(iso) {
  return Math.round((new Date(TODAY_ISO) - new Date(iso)) / 86400000);
}

// ── admin ───────────────────────────────────────────────────────────────
function assertAdmin(user) {
  if (user.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Admin access required.');
}

const hash = (str) => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

async function probe(platform, username) {
  const low = username.toLowerCase();
  if (low.includes('notfound') || low.includes('invalid') || low.includes('missing')) return { ok: false, error: `${platform === 'leetcode' ? 'LeetCode' : 'HackerRank'} profile "${username}" not found` };
  const h = hash(username);
  return { ok: true, username, solved: platform === 'leetcode' ? h % 420 : h % 140 };
}

function validateRowShape(row, seenRolls) {
  const errors = [];
  if (!row.name?.trim()) errors.push('Name is required');
  const roll = row.rollNo?.trim();
  if (!roll) errors.push('Roll number is required');
  else if (students.some((s) => s.rollNo.toLowerCase() === roll.toLowerCase()) || seenRolls.has(roll.toLowerCase())) errors.push(`Roll number ${roll} already exists`);
  if (!DEPARTMENTS.some((d) => d.code === (row.deptCode || '').trim().toUpperCase())) errors.push(`Unknown department "${row.deptCode || ''}"`);
  const by = Number(row.batchYear);
  if (!Number.isInteger(by) || by < batchYearFor(4) || by > batchYearFor(1)) errors.push(`Batch must be ${batchYearFor(4)}–${batchYearFor(1)}`);
  return errors;
}

export async function validateRows(user, rows) {
  assertAdmin(user);
  if (rows.length > 10) throw new ApiError(400, 'BAD_REQUEST', 'At most 10 rows per call.');
  await wait(500);
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const errors = validateRowShape(row, seen);
    if (row.rollNo) seen.add(row.rollNo.trim().toLowerCase());
    const lc = parseProfileUrl('leetcode', row.leetcodeUrl);
    const hr = parseProfileUrl('hackerrank', row.hackerrankUrl);
    let leetcode = null;
    let hackerrank = null;
    if (lc.error) errors.push(`LeetCode: ${lc.error}`);
    else {
      const p = await probe('leetcode', lc.username);
      if (p.ok) leetcode = { username: p.username, solved: p.solved };
      else errors.push(p.error);
    }
    if (hr.error) errors.push(`HackerRank: ${hr.error}`);
    else {
      const p = await probe('hackerrank', hr.username);
      if (p.ok) hackerrank = { username: p.username, solved: p.solved };
      else errors.push(p.error);
    }
    out.push({ ok: errors.length === 0, errors, leetcode, hackerrank });
  }
  return out;
}

export async function addStudent(user, row) {
  assertAdmin(user);
  const [res] = await validateRows(user, [row]);
  if (!res.ok) throw new ApiError(409, 'VALIDATION_FAILED', res.errors.join(' · '));
  createFromRow(row, res);
  return res;
}

function createFromRow(row, res) {
  const dept = DEPARTMENTS.find((d) => d.code === row.deptCode.trim().toUpperCase());
  const flat = (n) => Array.from({ length: HISTORY_DAYS }, () => n);
  students.push({
    id: nextStudentId++, rollNo: row.rollNo.trim(), name: row.name.trim(), deptId: dept.id, deptCode: dept.code,
    batchYear: Number(row.batchYear), leetcodeUsername: res.leetcode.username, hackerrankUsername: res.hackerrank.username,
    leetcode: { status: 'ok', history: flat(res.leetcode.solved), easy: Math.round(res.leetcode.solved * 0.6), medium: Math.round(res.leetcode.solved * 0.33), hard: Math.round(res.leetcode.solved * 0.07), globalRank: null, lastError: null, lastOk: TODAY_ISO },
    hackerrank: { status: 'ok', history: flat(res.hackerrank.solved), stars: 1, lastError: null, lastOk: TODAY_ISO },
  });
}

export async function importRows(user, items) {
  assertAdmin(user);
  await wait(600);
  const created = [];
  const skipped = [];
  for (const { row, result } of items) {
    if (students.some((s) => s.rollNo.toLowerCase() === row.rollNo.trim().toLowerCase())) {
      skipped.push({ rollNo: row.rollNo, reason: 'Duplicate roll number' });
      continue;
    }
    createFromRow(row, result);
    created.push(row.rollNo);
  }
  return { created: created.length, skipped };
}

export async function updateStudent(user, id, patch) {
  assertAdmin(user);
  await wait(300);
  const s = students.find((x) => x.id === Number(id));
  if (!s) throw new ApiError(404, 'NOT_FOUND', 'Student not found.');
  if (patch.name) s.name = patch.name.trim();
  if (patch.batchYear) s.batchYear = Number(patch.batchYear);
  if (patch.deptId) { s.deptId = Number(patch.deptId); s.deptCode = deptById(s.deptId).code; }
  return studentSummary(s);
}

export async function deleteStudent(user, id) {
  assertAdmin(user);
  await wait(300);
  const i = students.findIndex((x) => x.id === Number(id));
  if (i < 0) throw new ApiError(404, 'NOT_FOUND', 'Student not found.');
  students.splice(i, 1);
  return { ok: true };
}

export async function listStaff(user) {
  assertAdmin(user);
  await wait(160);
  return staff.map((u) => ({ ...publicUser(u), disabled: u.disabled }));
}

export async function createStaff(user, { username, role, deptId, displayTitle }) {
  assertAdmin(user);
  await wait(300);
  const uname = username.trim().toLowerCase();
  if (!uname) throw new ApiError(400, 'BAD_REQUEST', 'Username is required.');
  if (staff.some((u) => u.username === uname)) throw new ApiError(409, 'CONFLICT', 'That username is taken.');
  if (role === 'hod' && !deptId) throw new ApiError(400, 'BAD_REQUEST', 'A HOD needs a department.');
  const temp = tempPassword();
  const u = { id: nextStaffId++, username: uname, role, deptId: role === 'hod' ? Number(deptId) : null, displayTitle: displayTitle.trim() || uname, password: temp, disabled: false };
  staff.push(u);
  return { user: publicUser(u), tempPassword: temp };
}

export async function setStaffDisabled(user, id, disabled) {
  assertAdmin(user);
  await wait(200);
  const u = staff.find((x) => x.id === id);
  if (!u) throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
  if (u.id === user.id) throw new ApiError(400, 'BAD_REQUEST', 'You cannot disable your own account.');
  u.disabled = disabled;
  return { ok: true };
}

export async function resetPassword(user, id) {
  assertAdmin(user);
  await wait(300);
  const u = staff.find((x) => x.id === id);
  if (!u) throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
  u.password = tempPassword();
  return { tempPassword: u.password };
}

function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export { ApiError };
