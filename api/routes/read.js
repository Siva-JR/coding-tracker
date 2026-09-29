import { Router } from 'express';
import { HttpError, asyncRoute, bad, parseInteger } from '../http.js';
import { authenticate } from '../middleware/auth.js';
import { getLeaderboard } from '../services/leaderboard.js';
import { resolveAccess, canRequest, grantsParam, canSeeDepartment } from '../services/scopes.js';

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
    limit: query.limit === undefined ? 20 : parseInteger(query.limit, 'limit', { min: 1, max: 100 }),
  };
}

export function readRoutes({ db, sessionSecret, now }) {
  const router = Router();
  const auth = authenticate({ db, sessionSecret });

  router.get('/leaderboard', auth, asyncRoute(async (req, res) => {
    const params = parseLeaderboardQuery(req.query);
    const access = resolveAccess(req.user, now());
    if (!canRequest(access, params, now())) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to that department or year');
    res.json(await getLeaderboard(db, { ...params, grants: grantsParam(access), now: now() }));
  }));

  router.get('/departments', auth, asyncRoute(async (req, res) => {
    const access = resolveAccess(req.user, now());
    const { rows } = await db.query('select id, name, code from departments order by id');
    res.json(rows.filter((d) => canSeeDepartment(access, d.id)));
  }));

  return router;
}
