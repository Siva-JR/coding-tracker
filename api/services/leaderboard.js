import { yearOfStudy, batchYearFor } from './year.js';
import { istDate } from './windows.js';

const STALE_DAYS = 3;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

const ORDER = {
  solved: 'l.solved_total desc, l.solved_hard desc nulls last, l.solved_medium desc nulls last, st.name, st.id',
  rank: 'l.global_rank asc nulls last, l.solved_total desc, st.name, st.id',
};

export const PROFILE_URL = {
  leetcode: (u) => `https://leetcode.com/u/${u}/`,
  hackerrank: (u) => `https://www.hackerrank.com/profile/${u}`,
};

// Uses each student's latest successful snapshot (read straight from the snapshots index, so it stays fast as
// history grows), so a failed scrape never removes anyone.
// Accounts marked broken (profile not found) are left out until an admin fixes the URL.
export async function getLeaderboard(db, { platform, sort, year, deptId, limit, grants = null, now = new Date() }) {
  const batchYear = year === 'all' ? null : batchYearFor(year, now);
  const today = istDate(now);
  const { rows } = await db.query(
    `select st.id as student_id, st.name, st.roll_no, d.code as dept_code, st.batch_year,
            l.solved_total, l.solved_easy, l.solved_medium, l.solved_hard, l.global_rank, l.hr_stars,
            l.snap_date::text as snap_date, pa.username, count(*) over () as matched,
            (select b.solved_total from snapshots b where b.student_id = l.student_id and b.platform = $1
               and b.snap_date <= ($6::date - 7) order by b.snap_date desc limit 1) as base_total,
            (select e.solved_total from snapshots e where e.student_id = l.student_id and e.platform = $1
               order by e.snap_date asc limit 1) as first_total,
            (select e.snap_date::text from snapshots e where e.student_id = l.student_id and e.platform = $1
               order by e.snap_date asc limit 1) as first_date
     from students st
     join departments d on d.id = st.dept_id
     join platform_accounts pa on pa.student_id = st.id and pa.platform = $1 and pa.state = 'active'
     join lateral (
       select * from snapshots sn where sn.student_id = st.id and sn.platform = $1 order by sn.snap_date desc limit 1
     ) l on true
     where ($2::int is null or st.dept_id = $2)
       and ($3::int is null or st.batch_year = $3)
       and ($5::jsonb is null or exists (
         select 1 from jsonb_to_recordset($5::jsonb) as g(dept_id int, batch_year int)
         where (g.dept_id is null or g.dept_id = st.dept_id)
           and (g.batch_year is null or g.batch_year = st.batch_year)))
     order by ${ORDER[sort]}
     limit $4`,
    [platform, deptId, batchYear, limit, grants, today],
  );

  const isLeetCode = platform === 'leetcode';
  return {
    platform,
    sort,
    year,
    deptId: deptId ?? null,
    total: rows.length ? Number(rows[0].matched) : 0,
    asOf: rows.reduce((max, r) => (r.snap_date > max ? r.snap_date : max), '') || null,
    entries: rows.map((r, i) => ({
      position: i + 1,
      studentId: r.student_id,
      name: r.name,
      rollNo: r.roll_no,
      deptCode: r.dept_code,
      batchYear: r.batch_year,
      yearOfStudy: yearOfStudy(r.batch_year, now),
      solved: {
        total: r.solved_total,
        easy: isLeetCode ? r.solved_easy : null,
        medium: isLeetCode ? r.solved_medium : null,
        hard: isLeetCode ? r.solved_hard : null,
      },
      globalRank: isLeetCode ? r.global_rank : null,
      stars: isLeetCode ? null : r.hr_stars,
      profileUrl: PROFILE_URL[platform](r.username),
      // Solved in the last 7 days; null when tracking is too new to know.
      weekGain: weekGain(r),
      stale: daysBetween(r.snap_date, today) >= STALE_DAYS,
    })),
  };
}

function weekGain(r) {
  if (r.base_total != null) return Math.max(0, r.solved_total - r.base_total);
  if (r.first_date && r.first_date < r.snap_date) return Math.max(0, r.solved_total - r.first_total);
  return null;
}
