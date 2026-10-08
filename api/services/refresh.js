// "Refresh now" for staff: which students a signed-in user may refresh, and when their data was last updated.
// The fetching itself is refreshStudent (the same one the nightly job uses); this only decides who is in reach.
const GRANT_FILTER = `($2::jsonb is null or exists (
  select 1 from jsonb_to_recordset($2::jsonb) as g(dept_id int, batch_year int)
  where (g.dept_id is null or g.dept_id = st.dept_id) and (g.batch_year is null or g.batch_year = st.batch_year)))`;

/**
 * Students with at least one linked profile inside the caller's scopes (optionally one department),
 * plus the most recent successful fetch among them.
 */
export async function refreshTargets(db, { deptId = null, grants = null }) {
  const { rows } = await db.query(
    `select st.id, st.name, max(pa.last_ok_at) as last_ok_at
       from students st join platform_accounts pa on pa.student_id = st.id
      where ($1::int is null or st.dept_id = $1) and ${GRANT_FILTER}
      group by st.id order by st.name, st.id`,
    [deptId, grants],
  );
  const times = rows.map((r) => r.last_ok_at).filter(Boolean).map((d) => d.getTime());
  return {
    students: rows.map((r) => ({ id: r.id, name: r.name })),
    lastUpdatedAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    oldestAt: times.length && times.length === rows.length ? new Date(Math.min(...times)).toISOString() : null,
  };
}
