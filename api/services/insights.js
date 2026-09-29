// Read-only aggregates behind the dashboard: summary stats, activity, attention lists, department
// overview and a single student's detail. Everything is derived from the latest successful snapshot
// per student and platform, so a failed scrape never blanks a number. Where history is too short to
// know something (for example a weekly gain with a single snapshot) the value is null or omitted,
// never guessed.
import { istDate } from './windows.js';
import { yearOfStudy, batchYearFor } from './year.js';
import { PROFILE_URL } from './leaderboard.js';

const PLATFORMS = ['leetcode', 'hackerrank'];
const DAY_MS = 86400000;
const STALE_DAYS = 3;
const INACTIVE_DAYS = 30;
const MILESTONES = [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
const SURGE_MIN = 4;
const WEEKS = 12;

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const avg = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

const GRANT_FILTER = `($3::jsonb is null or exists (
  select 1 from jsonb_to_recordset($3::jsonb) as g(dept_id int, batch_year int)
  where (g.dept_id is null or g.dept_id = st.dept_id) and (g.batch_year is null or g.batch_year = st.batch_year)))`;

export async function scopedStudents(db, { deptId = null, year = 'all', grants = null, now = new Date() }) {
  const batchYear = year === 'all' || year == null ? null : batchYearFor(Number(year), now);
  const { rows } = await db.query(
    `select st.id, st.name, st.roll_no, st.dept_id, d.code as dept_code, d.name as dept_name, st.batch_year
     from students st join departments d on d.id = st.dept_id
     where ($1::int is null or st.dept_id = $1) and ($2::int is null or st.batch_year = $2) and ${GRANT_FILTER}
     order by st.name, st.id`,
    [deptId, batchYear, grants],
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, rollNo: r.roll_no, deptId: r.dept_id, deptCode: r.dept_code, deptName: r.dept_name,
    batchYear: r.batch_year, yearOfStudy: yearOfStudy(r.batch_year, now),
  }));
}

const key = (studentId, platform) => `${studentId}:${platform}`;

async function loadAccounts(db, ids) {
  const { rows } = await db.query(
    `select student_id, platform, username, state, attempts, last_ok_at, last_error
     from platform_accounts where student_id = any($1::int[])`,
    [ids],
  );
  return new Map(rows.map((r) => [key(r.student_id, r.platform), r]));
}

const SNAP_COLS = 'student_id, platform, snap_date::text as date, solved_total as total, solved_easy as easy, solved_medium as medium, solved_hard as hard, global_rank as rank, hr_stars as stars';

// Per (student, platform): latest snapshot, earliest snapshot, and the snapshot at or before N days ago.
async function loadFacts(db, ids, today, baselines = [7]) {
  const one = async (extraWhere, order, params) => {
    const { rows } = await db.query(
      `select distinct on (student_id, platform) ${SNAP_COLS} from snapshots
       where student_id = any($1::int[]) ${extraWhere} order by student_id, platform, snap_date ${order}`,
      [ids, ...params],
    );
    return new Map(rows.map((r) => [key(r.student_id, r.platform), r]));
  };
  const latest = await one('', 'desc', []);
  const earliest = await one('', 'asc', []);
  const base = {};
  for (const days of baselines) base[days] = await one('and snap_date <= $2::date', 'desc', [addDays(today, -days)]);
  return { latest, earliest, base };
}

// Solved since N days ago. Falls back to the earliest snapshot when tracking started less than N days
// ago; null when there is only one snapshot, because then nothing is known about the change.
function gainOf(facts, k, days) {
  const latest = facts.latest.get(k);
  if (!latest) return null;
  let baseline = facts.base[days]?.get(k);
  if (!baseline) {
    const first = facts.earliest.get(k);
    baseline = first && first.date < latest.date ? first : null;
  }
  return baseline ? Math.max(0, latest.total - baseline.total) : null;
}

const historyDaysOf = (facts) => {
  let max = 0;
  for (const [k, latest] of facts.latest) {
    const first = facts.earliest.get(k);
    if (first) max = Math.max(max, daysBetween(first.date, latest.date));
  }
  return max;
};

function healthOf(students, accounts, platform) {
  const mine = students.map((s) => accounts.get(key(s.id, platform))).filter(Boolean);
  const ok = mine.filter((a) => a.state === 'active' && a.last_ok_at).length;
  return { ok, total: mine.length, pct: mine.length ? Math.round((ok / mine.length) * 100) : 0 };
}

const accountStatus = (a) => (a.state === 'broken' ? 'not_found' : a.last_error ? 'error' : 'ok');
const needsAttention = (a) => accountStatus(a) !== 'ok';

async function weeklyTotals(db, ids, today) {
  const { rows } = await db.query(
    `select w.n as wk, s.student_id, s.platform, s.solved_total as total
     from generate_series(0, $3::int) as w(n)
     cross join lateral (
       select distinct on (sn.student_id, sn.platform) sn.student_id, sn.platform, sn.solved_total
       from snapshots sn
       where sn.student_id = any($1::int[]) and sn.snap_date <= ($2::date - (w.n * 7))
       order by sn.student_id, sn.platform, sn.snap_date desc
     ) s`,
    [ids, today, WEEKS],
  );
  // wk -> platform -> studentId -> total
  const byWeek = new Map();
  for (const r of rows) {
    if (!byWeek.has(r.wk)) byWeek.set(r.wk, { leetcode: new Map(), hackerrank: new Map() });
    byWeek.get(r.wk)[r.platform].set(r.student_id, r.total);
  }
  return byWeek;
}

function timelineFrom(byWeek, today) {
  const points = [];
  for (let wk = WEEKS; wk >= 0; wk--) {
    const w = byWeek.get(wk);
    if (!w) continue;
    const lc = avg([...w.leetcode.values()]);
    const hr = avg([...w.hackerrank.values()]);
    if (lc == null && hr == null) continue;
    points.push({ date: addDays(today, -wk * 7), leetcode: round1(lc), hackerrank: round1(hr) });
  }
  return points;
}

// Weekly change series (oldest to newest), only for weeks where at least one student has both ends.
function weeklyChange(byWeek) {
  const active = [];
  const solved = [];
  for (let wk = WEEKS - 1; wk >= 0; wk--) {
    const now = byWeek.get(wk);
    const before = byWeek.get(wk + 1);
    if (!now || !before) continue;
    const perStudent = new Map();
    for (const p of PLATFORMS) {
      for (const [id, total] of now[p]) {
        const prev = before[p].get(id);
        if (prev != null) perStudent.set(id, (perStudent.get(id) ?? 0) + Math.max(0, total - prev));
      }
    }
    if (!perStudent.size) continue;
    active.push([...perStudent.values()].filter((g) => g > 0).length);
    solved.push([...perStudent.values()].reduce((a, b) => a + b, 0));
  }
  return { active, solved };
}

export async function getStats(db, { deptId = null, grants = null, now = new Date() }) {
  const today = istDate(now);
  const students = await scopedStudents(db, { deptId, grants, now });
  const ids = students.map((s) => s.id);
  const empty = {
    asOf: null, historyDays: 0, timeline: [], needsAttention: 0,
    kpis: { totalStudents: { value: 0, spark: null }, activeStudents: { value: 0, spark: null }, avgSolved: { value: 0, spark: null }, weekSolved: { value: 0, spark: null } },
    health: { leetcode: { ok: 0, total: 0, pct: 0 }, hackerrank: { ok: 0, total: 0, pct: 0 } },
  };
  if (!ids.length) return empty;

  const [accounts, facts, byWeek] = await Promise.all([loadAccounts(db, ids), loadFacts(db, ids, today, [7]), weeklyTotals(db, ids, today)]);

  let active = 0;
  let weekSolved = 0;
  for (const s of students) {
    const gains = PLATFORMS.map((p) => gainOf(facts, key(s.id, p), 7)).filter((g) => g != null);
    const sum = gains.reduce((a, b) => a + b, 0);
    if (sum > 0) active++;
    weekSolved += sum;
  }
  const lcTotals = students.map((s) => facts.latest.get(key(s.id, 'leetcode'))?.total).filter((v) => v != null);
  const timeline = timelineFrom(byWeek, today);
  const change = weeklyChange(byWeek);
  const spark = (arr) => (arr.length >= 2 ? arr : null);
  const asOf = [...facts.latest.values()].reduce((max, r) => (r.date > max ? r.date : max), '') || null;

  return {
    asOf,
    historyDays: historyDaysOf(facts),
    timeline,
    needsAttention: students.filter((s) => PLATFORMS.some((p) => { const a = accounts.get(key(s.id, p)); return a && needsAttention(a); })).length,
    kpis: {
      totalStudents: { value: students.length, spark: null },
      activeStudents: { value: active, spark: spark(change.active) },
      avgSolved: { value: Math.round(avg(lcTotals) ?? 0), spark: spark(timeline.map((p) => p.leetcode).filter((v) => v != null)) },
      weekSolved: { value: weekSolved, spark: spark(change.solved) },
    },
    health: { leetcode: healthOf(students, accounts, 'leetcode'), hackerrank: healthOf(students, accounts, 'hackerrank') },
  };
}

// Derived from snapshot differences: only nightly snapshots exist, so events are dated by day.
export async function getActivity(db, { deptId = null, grants = null, limit = 8, now = new Date() }) {
  const today = istDate(now);
  const students = await scopedStudents(db, { deptId, grants, now });
  if (!students.length) return [];
  const byId = new Map(students.map((s) => [s.id, s]));
  const { rows } = await db.query(
    `select * from (
       select sn.student_id, sn.platform, sn.snap_date::text as date, sn.solved_total as total,
              lag(sn.solved_total) over (partition by sn.student_id, sn.platform order by sn.snap_date) as prev
       from snapshots sn where sn.student_id = any($1::int[]) and sn.snap_date >= ($2::date - 40)
     ) t where t.date >= $3 and t.prev is not null and t.total > t.prev`,
    [[...byId.keys()], today, addDays(today, -6)],
  );
  const events = [];
  for (const r of rows) {
    const s = byId.get(r.student_id);
    const crossed = MILESTONES.filter((m) => r.prev < m && r.total >= m).pop();
    const gain = r.total - r.prev;
    if (crossed) events.push({ date: r.date, studentId: s.id, name: s.name, platform: r.platform, kind: 'milestone', value: crossed, weight: 1000 + crossed });
    else if (gain >= SURGE_MIN) events.push({ date: r.date, studentId: s.id, name: s.name, platform: r.platform, kind: 'surge', value: gain, weight: gain });
  }
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.weight - a.weight));
  return events.slice(0, limit).map(({ weight, ...e }) => e);
}

export async function getAttention(db, { deptId = null, grants = null, now = new Date() }) {
  const today = istDate(now);
  const students = await scopedStudents(db, { deptId, grants, now });
  const out = { broken: [], stale: [], inactive: [], inactiveAvailable: false };
  if (!students.length) return out;
  const ids = students.map((s) => s.id);
  const [accounts, facts] = await Promise.all([loadAccounts(db, ids), loadFacts(db, ids, today, [INACTIVE_DAYS])]);

  for (const s of students) {
    for (const platform of PLATFORMS) {
      const a = accounts.get(key(s.id, platform));
      if (!a) continue;
      const base = {
        studentId: s.id, name: s.name, rollNo: s.rollNo, deptCode: s.deptCode, yearOfStudy: s.yearOfStudy,
        platform, username: a.username, url: PROFILE_URL[platform](a.username),
        lastOk: a.last_ok_at ? istDate(new Date(a.last_ok_at)) : null,
      };
      if (needsAttention(a)) out.broken.push({ ...base, status: accountStatus(a), error: a.last_error });
      else if (base.lastOk && daysBetween(base.lastOk, today) >= STALE_DAYS) out.stale.push(base);
    }
  }

  // "Inactive" needs a full window of history; without it we would flag everyone.
  const historyDays = historyDaysOf(facts);
  out.inactiveAvailable = historyDays >= INACTIVE_DAYS;
  if (out.inactiveAvailable) {
    for (const s of students) {
      const gains = PLATFORMS.map((p) => gainOf(facts, key(s.id, p), INACTIVE_DAYS)).filter((g) => g != null);
      if (gains.length && gains.reduce((a, b) => a + b, 0) === 0) {
        out.inactive.push({
          studentId: s.id, name: s.name, rollNo: s.rollNo, deptCode: s.deptCode, yearOfStudy: s.yearOfStudy,
          leetcode: facts.latest.get(key(s.id, 'leetcode'))?.total ?? null, hackerrank: facts.latest.get(key(s.id, 'hackerrank'))?.total ?? null,
        });
      }
    }
  }
  return out;
}

// One row per department the caller can see, for the department picker.
export async function getDepartmentOverview(db, { departments, grants = null, now = new Date() }) {
  const today = istDate(now);
  const students = await scopedStudents(db, { grants, now });
  const ids = students.map((s) => s.id);
  const [accounts, facts, byWeek] = ids.length
    ? await Promise.all([loadAccounts(db, ids), loadFacts(db, ids, today, [7]), weeklyTotals(db, ids, today)])
    : [new Map(), { latest: new Map(), earliest: new Map(), base: {} }, new Map()];

  return departments.map((d) => {
    const list = students.filter((s) => s.deptId === d.id);
    const lc = list.map((s) => ({ s, total: facts.latest.get(key(s.id, 'leetcode'))?.total })).filter((x) => x.total != null);
    const top = [...lc].sort((a, b) => b.total - a.total)[0];
    const active = list.filter((s) => PLATFORMS.map((p) => gainOf(facts, key(s.id, p), 7) ?? 0).reduce((a, b) => a + b, 0) > 0).length;
    const series = [];
    for (let wk = WEEKS; wk >= 0; wk--) {
      const w = byWeek.get(wk);
      const totals = w ? list.map((s) => w.leetcode.get(s.id)).filter((v) => v != null) : [];
      if (totals.length) series.push(Math.round(avg(totals)));
    }
    return {
      id: d.id, code: d.code, name: d.name, students: list.length,
      avgSolved: Math.round(avg(lc.map((x) => x.total)) ?? 0), active,
      attention: list.filter((s) => PLATFORMS.some((p) => { const a = accounts.get(key(s.id, p)); return a && needsAttention(a); })).length,
      top: top ? { name: top.s.name, solved: top.total } : null,
      spark: series.length >= 2 ? series : null,
    };
  });
}

export async function getStudentDetail(db, id, { now = new Date() }) {
  const today = istDate(now);
  const { rows: [st] } = await db.query(
    `select st.id, st.name, st.roll_no, st.dept_id, d.code as dept_code, d.name as dept_name, st.batch_year, st.github_url
     from students st join departments d on d.id = st.dept_id where st.id = $1`,
    [id],
  );
  if (!st) return null;
  const student = {
    id: st.id, name: st.name, rollNo: st.roll_no, deptId: st.dept_id, deptCode: st.dept_code, deptName: st.dept_name,
    batchYear: st.batch_year, yearOfStudy: yearOfStudy(st.batch_year, now), githubUrl: st.github_url,
  };
  const [accounts, facts, hist] = await Promise.all([
    loadAccounts(db, [id]), loadFacts(db, [id], today, [7]),
    db.query('select platform, snap_date::text as date, solved_total as total from snapshots where student_id = $1 order by snap_date', [id]),
  ]);

  const platform = (name) => {
    const a = accounts.get(key(id, name));
    if (!a) return null;
    const l = facts.latest.get(key(id, name));
    const base = {
      status: accountStatus(a), username: a.username, url: PROFILE_URL[name](a.username),
      total: l?.total ?? null, weekGain: gainOf(facts, key(id, name), 7),
      lastOk: a.last_ok_at ? istDate(new Date(a.last_ok_at)) : null, lastError: a.last_error,
    };
    return name === 'leetcode'
      ? { ...base, easy: l?.easy ?? null, medium: l?.medium ?? null, hard: l?.hard ?? null, globalRank: l?.rank ?? null }
      : { ...base, stars: l?.stars ?? null };
  };

  const byDate = new Map();
  for (const r of hist.rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date, leetcode: null, hackerrank: null });
    byDate.get(r.date)[r.platform] = r.total;
  }
  const history = [...byDate.values()];
  return { ...student, leetcode: platform('leetcode'), hackerrank: platform('hackerrank'), history, firstSnapshot: history[0]?.date ?? null };
}
