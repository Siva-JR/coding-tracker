import { Router } from 'express';
import { HttpError, asyncRoute, bad, parseInteger } from '../http.js';
import { authenticate } from '../middleware/auth.js';
import { getLeaderboard } from '../services/leaderboard.js';
import { resolveAccess, canRequest, grantsParam, canSeeDepartment, coversStudent } from '../services/scopes.js';
import { refreshTargets } from '../services/refresh.js';
import { refreshStudent } from '../services/students.js';
import { getStats, getActivity, getAttention, getDepartmentOverview, getStudentDetail, listGithubLinks } from '../services/insights.js';

const PLATFORMS = ['leetcode', 'hackerrank'];
const SORTS = ['solved', 'rank'];

function parseLeaderboardQuery(query) {
  const platform = query.platform;
  if (!PLATFORMS.includes(platform)) throw bad(`platform must be one of: ${PLATFORMS.join(', ')}`);

  const sort = query.sort ?? 'solved';
  if (!SORTS.includes(sort)) throw bad(`sort must be one of: ${SORTS.join(', ')}`);
  if (platform === 'hackerrank' && sort === 'rank') throw bad('HackerRank can only be sorted by problems solved');

  const year = query.year ?? 'all';
  if (year !== 'all') parseInteger(year, 'year', { min: 1, max: 4 });

  return {
    platform,
    sort,
    year: year === 'all' ? 'all' : Number(year),
    deptId: query.deptId === undefined ? null : parseInteger(query.deptId, 'deptId', { min: 1, max: 2147483647 }),
    // Up to 1000 so "show everyone" can be a single request.
    limit: query.limit === undefined ? 20 : parseInteger(query.limit, 'limit', { min: 1, max: 1000 }),
    q: typeof query.q === 'string' && query.q.trim() ? query.q.trim().slice(0, 100) : null,
  };
}

export function readRoutes({ db, sessionSecret, now, fetchProfile }) {
  const router = Router();
  const auth = authenticate({ db, sessionSecret });

  router.get('/leaderboard', auth, asyncRoute(async (req, res) => {
    const params = parseLeaderboardQuery(req.query);
    const access = resolveAccess(req.user, now());
    if (!canRequest(access, params, now())) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to that department or year');
    res.json(await getLeaderboard(db, { ...params, grants: grantsParam(access), now: now() }));
  }));

  // Scoped like the leaderboard: an optional deptId must be covered by one of the caller's scopes.
  const scoped = (req) => {
    const deptId = req.query.deptId === undefined ? null : parseInteger(req.query.deptId, 'deptId', { min: 1, max: 2147483647 });
    const access = resolveAccess(req.user, now());
    if (!canRequest(access, { deptId }, now())) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to that department');
    return { deptId, grants: grantsParam(access), now: now() };
  };

  // GitHub tab: who has shared a GitHub link (scoped like the leaderboard). Links are listed, never fetched.
  router.get('/github', auth, asyncRoute(async (req, res) => {
    const year = req.query.year ?? 'all';
    if (year !== 'all') parseInteger(year, 'year', { min: 1, max: 4 });
    const deptId = req.query.deptId === undefined ? null : parseInteger(req.query.deptId, 'deptId', { min: 1, max: 2147483647 });
    const access = resolveAccess(req.user, now());
    if (!canRequest(access, { deptId, year: year === 'all' ? 'all' : Number(year) }, now())) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to that department or year');
    const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim().slice(0, 100) : null;
    res.json(await listGithubLinks(db, {
      deptId, year: year === 'all' ? 'all' : Number(year), q,
      limit: req.query.limit === undefined ? 20 : parseInteger(req.query.limit, 'limit', { min: 1, max: 100 }),
      offset: req.query.offset === undefined ? 0 : parseInteger(req.query.offset, 'offset', { min: 0, max: 100000 }),
      grants: grantsParam(access), now: now(),
    }));
  }));

  router.get('/stats', auth, asyncRoute(async (req, res) => res.json(await getStats(db, scoped(req)))));

  router.get('/activity', auth, asyncRoute(async (req, res) => {
    const limit = req.query.limit === undefined ? 8 : parseInteger(req.query.limit, 'limit', { min: 1, max: 50 });
    res.json(await getActivity(db, { ...scoped(req), limit }));
  }));

  router.get('/attention', auth, asyncRoute(async (req, res) => res.json(await getAttention(db, scoped(req)))));

  router.get('/departments/overview', auth, asyncRoute(async (req, res) => {
    const access = resolveAccess(req.user, now());
    const { rows } = await db.query('select id, name, code from departments order by id');
    const departments = rows.filter((d) => canSeeDepartment(access, d.id));
    res.json(await getDepartmentOverview(db, { departments, grants: grantsParam(access), now: now() }));
  }));

  router.get('/students/:id', auth, asyncRoute(async (req, res) => {
    const id = parseInteger(req.params.id, 'id', { min: 1, max: 2147483647 });
    const access = resolveAccess(req.user, now());
    const detail = await getStudentDetail(db, id, { now: now() });
    // Outside the caller's scopes looks the same as not existing.
    if (!detail || !coversStudent(access, detail)) throw new HttpError(404, 'NOT_FOUND', 'Student not found');
    res.json(detail);
  }));

  // "Refresh now": anyone signed in can refresh the students their scopes cover (a HoD their department,
  // the principal and vice-principal everyone). The list also carries when the data was last updated.
  router.get('/refresh', auth, asyncRoute(async (req, res) => {
    res.json(await refreshTargets(db, scoped(req)));
  }));

  router.post('/refresh/students/:id', auth, asyncRoute(async (req, res) => {
    const id = parseInteger(req.params.id, 'id', { min: 1, max: 2147483647 });
    const access = resolveAccess(req.user, now());
    const { rows: [st] } = await db.query('select dept_id as "deptId", batch_year as "batchYear" from students where id = $1', [id]);
    // Outside the caller's scopes looks the same as not existing.
    if (!st || !coversStudent(access, st)) throw new HttpError(404, 'NOT_FOUND', 'Student not found');
    res.json(await refreshStudent(db, id, { fetchProfile, now: now() }));
  }));

  router.get('/departments', auth, asyncRoute(async (req, res) => {
    const access = resolveAccess(req.user, now());
    const { rows } = await db.query('select id, name, code from departments order by id');
    res.json(rows.filter((d) => canSeeDepartment(access, d.id)));
  }));

  return router;
}
