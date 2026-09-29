import { yearOfStudy, batchYearFor } from './year.js';

const ORDER = {
  solved: 'l.solved_total desc, l.solved_hard desc nulls last, l.solved_medium desc nulls last, st.name, st.id',
  rank: 'l.global_rank asc nulls last, l.solved_total desc, st.name, st.id',
};

const PROFILE_URL = {
  leetcode: (u) => `https://leetcode.com/u/${u}/`,
  hackerrank: (u) => `https://www.hackerrank.com/profile/${u}`,
};

// Uses each student's latest successful snapshot, so a failed scrape never removes anyone.
// Accounts marked broken (profile not found) are left out until an admin fixes the URL.
export async function getLeaderboard(db, { platform, sort, year, deptId, limit, grants = null, now = new Date() }) {
  const batchYear = year === 'all' ? null : batchYearFor(year, now);
  const { rows } = await db.query(
    `with latest as (
       select distinct on (student_id) *
       from snapshots
       where platform = $1
       order by student_id, snap_date desc
     )
     select st.id as student_id, st.name, st.roll_no, d.code as dept_code, st.batch_year,
            l.solved_total, l.solved_easy, l.solved_medium, l.solved_hard, l.global_rank, l.hr_stars,
            l.snap_date::text as snap_date, pa.username
     from latest l
     join students st on st.id = l.student_id
     join departments d on d.id = st.dept_id
     join platform_accounts pa on pa.student_id = st.id and pa.platform = $1 and pa.state = 'active'
     where ($2::int is null or st.dept_id = $2)
       and ($3::int is null or st.batch_year = $3)
       and ($5::jsonb is null or exists (
         select 1 from jsonb_to_recordset($5::jsonb) as g(dept_id int, batch_year int)
         where (g.dept_id is null or g.dept_id = st.dept_id)
           and (g.batch_year is null or g.batch_year = st.batch_year)))
     order by ${ORDER[sort]}
     limit $4`,
    [platform, deptId, batchYear, limit, grants],
  );

  const isLeetCode = platform === 'leetcode';
  return {
    platform,
    sort,
    year,
    deptId: deptId ?? null,
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
    })),
  };
}
