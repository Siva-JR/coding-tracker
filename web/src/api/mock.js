// In-memory implementation of the API contract (BACKEND_PLAN §3), used when no backend is configured
// and for the sections the real backend doesn't serve yet (stats, activity, attention, student detail).
// Every function takes the signed-in `user` and derives scope from it, like the real server.
import { DEPARTMENTS, USERS, TODAY_ISO, HISTORY_DAYS, dayIso, generateStudents, yearOf, scopeOf, DEMO_PASSWORD } from './mockData.js';
import { parseProfileUrl, profileUrl } from '../lib/profileUrl.js';
import { batchYearFor } from '../lib/yearOfStudy.js';
import { scopeCovers } from '../lib/access.js';
import { checkGithubUrl } from '../lib/github.js';

const students = generateStudents();
const staff = USERS.map((u) => ({ ...u }));
let nextStudentId = students.length + 1;
let nextStaffId = 100;

const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms + Math.random() * 180));

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const deptById = (id) => DEPARTMENTS.find((d) => d.id === id);
const publicUser = ({ password, ...rest }) => rest;
const assertAdmin = (user) => { if (user.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Admin access required'); };
const covers = (user, s) => scopeCovers(user, { deptId: s.deptId, yearOfStudy: yearOf(s) });

function visible(user, { deptId, year = 'all' } = {}) {
  const d = deptId ? Number(deptId) : null;
  const y = year === 'all' || year == null ? null : Number(year);
  if ((d || y) && user.role !== 'admin' && !user.scopes.some((s) => (d == null || s.deptId == null || s.deptId === d) && (y == null || s.year == null || s.year === y))) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have access to that department or year');
  }
  return students.filter((s) => covers(user, s) && (d == null || s.deptId === d) && (y == null || yearOf(s) === y));
}

const lastIdx = HISTORY_DAYS - 1;
const total = (s, p) => (s[p].history ? s[p].history[lastIdx] : null);
const gain = (s, p, days) => (s[p].history ? s[p].history[lastIdx] - s[p].history[lastIdx - days] : 0);

// ── auth ────────────────────────────────────────────────────────────────
export async function login(username, password) {
  await wait(350);
  const u = staff.find((x) => x.username === username.trim().toLowerCase());
  if (!u || u.password !== password || u.disabled) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
  return publicUser(u);
}

export async function me(id) {
  const u = staff.find((x) => x.id === id);
  if (!u || u.disabled) throw new ApiError(401, 'UNAUTHENTICATED', 'Login required');
  return publicUser(u);
}

export async function changePassword(user, currentPassword, newPassword) {
  await wait(300);
  const u = staff.find((x) => x.id === user.id);
  if (u.password !== currentPassword) throw new ApiError(400, 'WRONG_PASSWORD', 'Current password is incorrect');
  if (String(newPassword).length < 8) throw new ApiError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters');
  if (newPassword === currentPassword) throw new ApiError(400, 'WEAK_PASSWORD', 'New password must be different from the current one');
  u.password = newPassword;
  u.mustChangePassword = false;
  return publicUser(u);
}

// ── reference ───────────────────────────────────────────────────────────
export async function departments(user) {
  await wait(80);
  return DEPARTMENTS
    .filter((d) => user.role === 'admin' || user.scopes.some((s) => s.deptId == null || s.deptId === d.id))
    .map(({ id, name, code }) => ({ id, name, code }));
}

export async function departmentOverview(user) {
  await wait();
  const allowed = new Set((await departments(user)).map((d) => d.id));
  return DEPARTMENTS.filter((d) => allowed.has(d.id)).map((d) => {
    const list = visible(user, { deptId: d.id });
    const lc = list.filter((s) => total(s, 'leetcode') != null);
    const avg = lc.length ? Math.round(lc.reduce((a, s) => a + total(s, 'leetcode'), 0) / lc.length) : 0;
    const active = list.filter((s) => gain(s, 'leetcode', 7) + gain(s, 'hackerrank', 7) > 0).length;
    const attention = list.filter((s) => s.leetcode.status !== 'ok' || s.hackerrank.status !== 'ok').length;
    const top = [...lc].sort((a, b) => total(b, 'leetcode') - total(a, 'leetcode'))[0];
    return {
      id: d.id, code: d.code, name: d.name, students: list.length, avgSolved: avg, active, attention,
      top: top ? { name: top.name, solved: total(top, 'leetcode') } : null,
      spark: weeklySeries(list, 'leetcode', 12),
    };
  });
}

// ── leaderboard ─────────────────────────────────────────────────────────
export async function leaderboard(user, { platform = 'leetcode', sort = 'solved', year = 'all', deptId, limit = 20 } = {}) {
  await wait();
  if (platform === 'hackerrank' && sort === 'rank') throw new ApiError(400, 'BAD_REQUEST', 'HackerRank can only be sorted by problems solved');
  const list = visible(user, { deptId, year }).filter((s) => total(s, platform) != null && s[platform].status !== 'not_found');
  const sorted = list.sort((a, b) => {
    if (platform === 'leetcode' && sort === 'rank') {
      return (a.leetcode.globalRank ?? Infinity) - (b.leetcode.globalRank ?? Infinity) || total(b, platform) - total(a, platform);
    }
    const t = total(b, platform) - total(a, platform);
    if (t) return t;
    return platform === 'leetcode' ? b.leetcode.hard - a.leetcode.hard || b.leetcode.medium - a.leetcode.medium : 0;
  });
  const entries = sorted.slice(0, limit).map((s, i) => ({
    position: i + 1, studentId: s.id, name: s.name, rollNo: s.rollNo, deptCode: s.deptCode, batchYear: s.batchYear, yearOfStudy: yearOf(s),
    solved: platform === 'leetcode'
      ? { total: total(s, platform), easy: s.leetcode.easy, medium: s.leetcode.medium, hard: s.leetcode.hard }
      : { total: total(s, platform), easy: null, medium: null, hard: null },
    globalRank: platform === 'leetcode' ? s.leetcode.globalRank : null,
    stars: platform === 'hackerrank' ? s.hackerrank.stars : null,
    weekGain: gain(s, platform, 7),
    stale: s[platform].status !== 'ok' || s[platform].lastOk !== TODAY_ISO,
    profileUrl: profileUrl(platform, platform === 'leetcode' ? s.leetcodeUsername : s.hackerrankUsername),
  }));
  return { platform, sort, year, deptId: deptId ? Number(deptId) : null, asOf: TODAY_ISO, count: list.length, entries };
}

// ── stats for the dashboard (not on the real backend yet) ───────────────
function weeklySeries(list, platform, weeks) {
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
  const list = visible(user, { deptId });
  const lc = list.filter((s) => total(s, 'leetcode') != null);
  const active = list.filter((s) => gain(s, 'leetcode', 7) + gain(s, 'hackerrank', 7) > 0);
  const weekSolved = list.reduce((a, s) => a + gain(s, 'leetcode', 7) + gain(s, 'hackerrank', 7), 0);
  const avg = lc.length ? Math.round(lc.reduce((a, s) => a + total(s, 'leetcode'), 0) / lc.length) : 0;

  const activeSpark = [];
  const weekSpark = [];
  for (let w = 11; w >= 0; w--) {
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

  const points = [];
  for (let w = 16; w >= 0; w--) {
    const idx = lastIdx - w * 7;
    if (idx < 0) continue;
    const avgOf = (p) => {
      const l = list.filter((s) => s[p].history);
      return l.length ? Math.round((l.reduce((a, s) => a + s[p].history[idx], 0) / l.length) * 10) / 10 : 0;
    };
    points.push({ date: dayIso(w * 7), leetcode: avgOf('leetcode'), hackerrank: avgOf('hackerrank') });
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

// Derived from snapshot differences: we only scrape nightly, so there are no per-solve timestamps.
export async function activity(user, { deptId, limit = 8 } = {}) {
  await wait(160);
  const events = [];
  for (const s of visible(user, { deptId })) {
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

// GitHub tab: who has shared a GitHub link. Links are listed, never fetched.
export async function github(user, { deptId, year = 'all', q = '', limit = 20, offset = 0 } = {}) {
  await wait(160);
  const inScope = visible(user, { deptId, year });
  const needle = String(q || '').trim().toLowerCase();
  const withLink = inScope
    .filter((s) => s.githubUrl && (!needle || s.name.toLowerCase().includes(needle) || s.rollNo.toLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  return {
    total: withLink.length, scopeTotal: inScope.length, limit, offset,
    items: withLink.slice(offset, offset + limit).map((s) => ({
      studentId: s.id, name: s.name, rollNo: s.rollNo, deptCode: s.deptCode, batchYear: s.batchYear, yearOfStudy: yearOf(s), githubUrl: s.githubUrl,
    })),
  };
}

// ── student detail & attention (not on the real backend yet) ────────────
function studentSummary(s) {
  return {
    id: s.id, name: s.name, rollNo: s.rollNo, deptId: s.deptId, deptCode: s.deptCode, deptName: deptById(s.deptId).name,
    batchYear: s.batchYear, yearOfStudy: yearOf(s), leetcodeUsername: s.leetcodeUsername, hackerrankUsername: s.hackerrankUsername, githubUrl: s.githubUrl ?? null,
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

export async function student(user, id) {
  await wait();
  const s = students.find((x) => x.id === Number(id));
  if (!s || !covers(user, s)) throw new ApiError(404, 'NOT_FOUND', 'Student not found');
  const history = [];
  for (let i = 0; i < HISTORY_DAYS; i++) {
    if (i % 3 !== 0 && i !== lastIdx) continue;
    history.push({
      date: dayIso(lastIdx - i),
      leetcode: s.leetcode.history ? s.leetcode.history[i] : null,
      hackerrank: s.hackerrank.history ? s.hackerrank.history[i] : null,
    });
  }
  return { ...studentSummary(s), history, firstSnapshot: history[0]?.date };
}

const daysBetween = (iso) => Math.round((new Date(TODAY_ISO) - new Date(iso)) / 86400000);

export async function attention(user, { deptId } = {}) {
  await wait();
  const broken = [];
  const stale = [];
  const inactive = [];
  for (const s of visible(user, { deptId })) {
    for (const p of ['leetcode', 'hackerrank']) {
      const st = s[p];
      const username = p === 'leetcode' ? s.leetcodeUsername : s.hackerrankUsername;
      const base = { studentId: s.id, name: s.name, rollNo: s.rollNo, deptCode: s.deptCode, yearOfStudy: yearOf(s), platform: p, username, url: profileUrl(p, username) };
      if (st.status !== 'ok') broken.push({ ...base, status: st.status, error: st.lastError, lastOk: st.lastOk });
      else if (st.lastOk && st.lastOk !== TODAY_ISO && daysBetween(st.lastOk) >= 3) stale.push({ ...base, lastOk: st.lastOk });
    }
    if ((s.leetcode.history || s.hackerrank.history) && gain(s, 'leetcode', 30) + gain(s, 'hackerrank', 30) === 0) {
      inactive.push({ studentId: s.id, name: s.name, rollNo: s.rollNo, deptCode: s.deptCode, yearOfStudy: yearOf(s), leetcode: total(s, 'leetcode'), hackerrank: total(s, 'hackerrank') });
    }
  }
  return { broken, stale, inactive };
}

// ── admin: students (same shapes as the real endpoints) ─────────────────
const hash = (str) => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const missing = (name) => /notfound|invalid|missing/i.test(name);

function accountsOf(s) {
  const mk = (platform, username, st) => ({
    platform, username, profileUrl: profileUrl(platform, username),
    state: st.status === 'not_found' ? 'broken' : 'active', attempts: st.status === 'error' ? 2 : 0,
    lastOkAt: st.lastOk ? `${st.lastOk}T02:10:00.000Z` : null, lastError: st.lastError,
  });
  return [
    ...(s.leetcodeUsername ? [mk('leetcode', s.leetcodeUsername, s.leetcode)] : []),
    ...(s.hackerrankUsername ? [mk('hackerrank', s.hackerrankUsername, s.hackerrank)] : []),
  ];
}

const adminStudent = (s) => ({
  id: s.id, rollNo: s.rollNo, name: s.name, deptId: s.deptId, deptCode: s.deptCode, batchYear: s.batchYear, yearOfStudy: yearOf(s), githubUrl: s.githubUrl ?? null, accounts: accountsOf(s),
});

export async function adminStudents(user, { deptId, batchYear, q, page = 1, pageSize = 50 } = {}) {
  assertAdmin(user);
  await wait(160);
  const needle = (q || '').trim().toLowerCase();
  let list = students.filter((s) => (!deptId || s.deptId === Number(deptId)) && (!batchYear || s.batchYear === Number(batchYear)));
  if (needle) list = list.filter((s) => s.name.toLowerCase().includes(needle) || s.rollNo.toLowerCase().includes(needle));
  list = [...list].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  const start = (page - 1) * pageSize;
  return { items: list.slice(start, start + pageSize).map(adminStudent), page: Number(page), pageSize: Number(pageSize), total: list.length };
}

// Returns the row's problems, or the parsed accounts.
function inspectRow(row, seen, { lenientGithub = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!String(row.name ?? '').trim()) errors.push('name is required');
  const roll = String(row.rollNo ?? '').trim();
  if (!roll) errors.push('reg no is required');
  else if (students.some((s) => s.rollNo.toLowerCase() === roll.toLowerCase())) errors.push(`reg no ${roll} already exists`);
  else if (seen?.has(roll.toLowerCase())) errors.push(`reg no ${roll} appears more than once in this file`);
  const dept = DEPARTMENTS.find((d) => d.code === String(row.deptCode ?? '').trim().toUpperCase() || d.id === Number(row.deptId));
  if (!dept) errors.push(row.deptCode || row.deptId ? `unknown department: ${row.deptCode ?? row.deptId}` : 'department is required');
  const batch = Number(row.batchYear);
  if (!Number.isInteger(batch) || batch < 2000 || batch > 2100) errors.push('batchYear must be a year like 2028');
  const accounts = [];
  let gave = 0;
  for (const [platform, key] of [['leetcode', 'leetcodeUrl'], ['hackerrank', 'hackerrankUrl']]) {
    if (!String(row[key] ?? '').trim()) continue;
    gave++;
    const p = parseProfileUrl(platform, row[key]);
    if (p.error) errors.push(`${platform}: ${p.error}`);
    else accounts.push({ platform, username: p.username });
  }
  if (!gave) errors.push('at least one profile URL is required');
  // GitHub is only stored for now. From a CSV a bad link is dropped with a warning; by hand it is an error.
  let githubUrl = null;
  const rawGithub = String(row.githubUrl ?? '').trim();
  if (rawGithub) {
    const bad = checkGithubUrl(rawGithub);
    if (!bad) githubUrl = /^https?:\/\//i.test(rawGithub) ? rawGithub : `https://${rawGithub}`;
    else if (lenientGithub) warnings.push(`github: ${bad}; the GitHub link was not saved`);
    else errors.push(`github: ${bad}`);
  }
  return { errors, warnings, dept, batch, roll, accounts, githubUrl };
}

const solvedFor = (platform, username) => (platform === 'leetcode' ? hash(username) % 420 : hash(username) % 140);

function insertStudent({ dept, batch, roll, accounts, githubUrl }, row) {
  const flat = (n) => Array.from({ length: HISTORY_DAYS }, () => n);
  const lc = accounts.find((a) => a.platform === 'leetcode');
  const hr = accounts.find((a) => a.platform === 'hackerrank');
  const lcN = lc ? solvedFor('leetcode', lc.username) : 0;
  const hrN = hr ? solvedFor('hackerrank', hr.username) : 0;
  const s = {
    id: nextStudentId++, rollNo: roll, name: row.name.trim(), deptId: dept.id, deptCode: dept.code, batchYear: batch,
    leetcodeUsername: lc?.username ?? null, hackerrankUsername: hr?.username ?? null, githubUrl: githubUrl ?? null,
    leetcode: lc
      ? { status: 'ok', history: flat(lcN), easy: Math.round(lcN * 0.6), medium: Math.round(lcN * 0.33), hard: Math.round(lcN * 0.07), globalRank: null, lastError: null, lastOk: TODAY_ISO }
      : { status: 'ok', history: null, easy: 0, medium: 0, hard: 0, globalRank: null, lastError: null, lastOk: null },
    hackerrank: hr
      ? { status: 'ok', history: flat(hrN), stars: 1, lastError: null, lastOk: TODAY_ISO }
      : { status: 'ok', history: null, stars: null, lastError: null, lastOk: null },
  };
  students.push(s);
  return s;
}

const verifyAccounts = (accounts) => accounts.map((a) => (missing(a.username)
  ? { ...a, verified: 'not_found' }
  : { ...a, verified: 'ok', solvedTotal: solvedFor(a.platform, a.username) }));

export async function addStudent(user, row) {
  assertAdmin(user);
  await wait(700);
  const r = inspectRow(row);
  const checks = verifyAccounts(r.accounts);
  const errors = [...r.errors, ...checks.filter((c) => c.verified === 'not_found').map((c) => `${c.platform}: profile "${c.username}" was not found`)];
  if (errors.length) {
    const dup = errors.some((e) => e.includes('already exists'));
    throw new ApiError(dup ? 409 : 422, dup ? 'ROLL_NUMBER_EXISTS' : 'VALIDATION_FAILED', errors.join('; '), { errors });
  }
  const s = insertStudent(r, row);
  return {
    studentId: s.id, student: adminStudent(s), warnings: [],
    accounts: checks.map((c) => ({ platform: c.platform, username: c.username, verified: 'ok', stats: { solvedTotal: c.solvedTotal } })),
  };
}

export async function validateRows(user, rows) {
  assertAdmin(user);
  if (rows.length > 10) throw new ApiError(400, 'BAD_REQUEST', 'rows: at most 10 rows per call');
  await wait(500);
  const seen = new Set();
  return {
    results: rows.map((row, index) => {
      const r = inspectRow(row, seen, { lenientGithub: true });
      if (r.roll) seen.add(r.roll.toLowerCase());
      if (r.errors.length) return { index, checked: true, ok: false, errors: r.errors, warnings: r.warnings, accounts: [] };
      const checks = verifyAccounts(r.accounts);
      const notFound = checks.filter((c) => c.verified === 'not_found').map((c) => `${c.platform}: profile "${c.username}" was not found`);
      return {
        index, checked: true, ok: !notFound.length, errors: notFound, warnings: r.warnings,
        accounts: checks.map((c) => ({ platform: c.platform, username: c.username, verified: c.verified === 'ok' ? 'ok' : 'unverified', solvedTotal: c.solvedTotal ?? null })),
      };
    }),
  };
}

export async function importRows(user, rows) {
  assertAdmin(user);
  await wait(600);
  const created = [];
  const skipped = [];
  rows.forEach((row, index) => {
    const r = inspectRow(row, undefined, { lenientGithub: true });
    if (r.errors.length) { skipped.push({ index, rollNo: r.roll || null, reason: r.errors.join('; ') }); return; }
    created.push({ index, studentId: insertStudent(r, row).id, rollNo: r.roll, ...(r.warnings.length ? { warnings: r.warnings } : {}) });
  });
  return { created, skipped };
}

export async function updateStudent(user, id, patch) {
  assertAdmin(user);
  await wait(500);
  const s = students.find((x) => x.id === Number(id));
  if (!s) throw new ApiError(404, 'NOT_FOUND', 'Student not found');
  const errors = [];
  if (patch.name !== undefined) { if (!String(patch.name).trim()) errors.push('name is required'); else s.name = String(patch.name).trim(); }
  if (patch.rollNo !== undefined) {
    const roll = String(patch.rollNo).trim();
    if (!roll) errors.push('reg no is required');
    else if (students.some((x) => x.id !== s.id && x.rollNo.toLowerCase() === roll.toLowerCase())) throw new ApiError(409, 'ROLL_NUMBER_EXISTS', `reg no ${roll} already exists`);
    else s.rollNo = roll;
  }
  if (patch.batchYear !== undefined) s.batchYear = Number(patch.batchYear);
  if (patch.githubUrl !== undefined) {
    const raw = String(patch.githubUrl ?? '').trim();
    const bad = raw ? checkGithubUrl(raw) : null;
    if (bad) errors.push(`github: ${bad}`);
    else s.githubUrl = raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : null;
  }
  if (patch.deptId !== undefined) { const d = deptById(Number(patch.deptId)); if (d) { s.deptId = d.id; s.deptCode = d.code; } else errors.push('unknown department'); }
  for (const [platform, key, field] of [['leetcode', 'leetcodeUrl', 'leetcodeUsername'], ['hackerrank', 'hackerrankUrl', 'hackerrankUsername']]) {
    if (patch[key] === undefined) continue;
    if (patch[key] === null || !String(patch[key]).trim()) { s[field] = null; continue; }
    const p = parseProfileUrl(platform, patch[key]);
    if (p.error) errors.push(`${platform}: ${p.error}`);
    else if (missing(p.username)) errors.push(`${platform}: profile "${p.username}" was not found`);
    else {
      s[field] = p.username;
      const n = solvedFor(platform, p.username);
      s[platform] = { ...s[platform], status: 'ok', lastError: null, lastOk: TODAY_ISO, history: Array.from({ length: HISTORY_DAYS }, () => n) };
    }
  }
  if (!s.leetcodeUsername && !s.hackerrankUsername) errors.push('a student needs at least one profile URL');
  if (errors.length) throw new ApiError(422, 'VALIDATION_FAILED', errors.join('; '), { errors });
  return { student: adminStudent(s), warnings: [] };
}

export async function deleteStudent(user, id) {
  assertAdmin(user);
  await wait(300);
  const i = students.findIndex((x) => x.id === Number(id));
  if (i < 0) throw new ApiError(404, 'NOT_FOUND', 'Student not found');
  students.splice(i, 1);
  return null;
}

export async function refreshStudent(user, id) {
  assertAdmin(user);
  await wait(900);
  const s = students.find((x) => x.id === Number(id));
  if (!s) throw new ApiError(404, 'NOT_FOUND', 'Student not found');
  const results = accountsOf(s).map((a) => (missing(a.username)
    ? { platform: a.platform, username: a.username, status: 'not_found' }
    : { platform: a.platform, username: a.username, status: 'ok', stats: { solvedTotal: solvedFor(a.platform, a.username) } }));
  return { student: adminStudent(s), results };
}

// ── admin: users & departments ──────────────────────────────────────────
function cleanScopes(role, scopes) {
  if (role === 'admin') {
    if (scopes?.length) throw new ApiError(400, 'BAD_REQUEST', 'Admins see everything and cannot have scopes');
    return [];
  }
  if (!scopes?.length) throw new ApiError(400, 'BAD_REQUEST', 'Viewers need at least one scope');
  const seen = new Set();
  return scopes.filter((s) => { const k = `${s.deptId ?? 0}:${s.year ?? 0}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((s) => scopeOf(s.deptId ?? null, s.year ?? null));
}

const tempPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

export async function listUsers(user) {
  assertAdmin(user);
  await wait(160);
  return [...staff].sort((a, b) => a.username.localeCompare(b.username)).map(publicUser);
}

export async function createUser(user, { username, displayTitle, role, password, scopes }) {
  assertAdmin(user);
  await wait(300);
  const name = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(name)) throw new ApiError(400, 'BAD_REQUEST', 'username must be 3-32 characters: letters, digits, dot, dash or underscore');
  if (staff.some((u) => u.username === name)) throw new ApiError(409, 'USERNAME_TAKEN', `Username ${name} is already taken`);
  const generated = !password;
  const plain = generated ? tempPassword() : password;
  if (plain.length < 8) throw new ApiError(400, 'BAD_REQUEST', 'Password must be at least 8 characters');
  const u = { id: nextStaffId++, username: name, role, displayTitle: displayTitle?.trim() || null, scopes: cleanScopes(role, scopes), password: plain, mustChangePassword: true, disabled: false };
  staff.push(u);
  return { user: publicUser(u), temporaryPassword: generated ? plain : undefined };
}

export async function updateUser(user, id, { displayTitle, role, scopes, disabled }) {
  assertAdmin(user);
  await wait(300);
  const u = staff.find((x) => x.id === id);
  if (!u) throw new ApiError(404, 'NOT_FOUND', 'User not found');
  const newRole = role ?? u.role;
  const newDisabled = disabled ?? u.disabled;
  const otherAdmins = staff.some((x) => x.id !== u.id && x.role === 'admin' && !x.disabled);
  if (u.role === 'admin' && !u.disabled && (newRole !== 'admin' || newDisabled) && !otherAdmins) throw new ApiError(409, 'LAST_ADMIN', 'At least one active admin must remain');
  if (scopes !== undefined) u.scopes = cleanScopes(newRole, scopes);
  else if (newRole !== u.role) u.scopes = cleanScopes(newRole, newRole === 'admin' ? [] : undefined);
  if (displayTitle !== undefined) u.displayTitle = displayTitle?.trim() || null;
  u.role = newRole;
  u.disabled = newDisabled;
  return publicUser(u);
}

export async function resetPassword(user, id, password) {
  assertAdmin(user);
  await wait(300);
  const u = staff.find((x) => x.id === id);
  if (!u) throw new ApiError(404, 'NOT_FOUND', 'User not found');
  const generated = !password;
  u.password = generated ? tempPassword() : password;
  u.mustChangePassword = true;
  return { temporaryPassword: generated ? u.password : undefined };
}

export async function createDepartment(user, name, code) {
  assertAdmin(user);
  await wait(300);
  const c = String(code).trim().toUpperCase();
  if (DEPARTMENTS.some((d) => d.code === c || d.name.toLowerCase() === String(name).trim().toLowerCase())) {
    throw new ApiError(409, 'DEPARTMENT_EXISTS', 'A department with that name or code already exists');
  }
  const d = { id: DEPARTMENTS.length + 1, code: c, name: String(name).trim(), size: 0, skill: 0.5 };
  DEPARTMENTS.push(d);
  return { id: d.id, name: d.name, code: d.code };
}

export { DEMO_PASSWORD };
