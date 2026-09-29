import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { getLeaderboard } from './services/leaderboard.js';
import { runTick } from './services/tick.js';

const PLATFORMS = ['leetcode', 'hackerrank'];
const SORTS = ['solved', 'rank'];

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const bad = (message) => new HttpError(400, 'BAD_REQUEST', message);

function parseInteger(value, name, { min, max }) {
  if (!/^\d+$/.test(String(value))) throw bad(`${name} must be a whole number`);
  const n = Number(value);
  if (n < min || n > max) throw bad(`${name} must be between ${min} and ${max}`);
  return n;
}

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

function secretMatches(provided, expected) {
  const a = Buffer.from(String(provided ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp({ db, scrapeSecret, now = () => new Date(), tickOptions = {}, log = console.log }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (req, res) => res.json({ ok: true }));

  // TEMPORARY: open until staff auth is added. Do not expose real student data publicly before then.
  app.get('/api/leaderboard', async (req, res, next) => {
    try {
      res.json(await getLeaderboard(db, { ...parseLeaderboardQuery(req.query), now: now() }));
    } catch (err) {
      next(err);
    }
  });

  app.post('/internal/scrape/tick', async (req, res, next) => {
    try {
      if (!scrapeSecret) throw new HttpError(503, 'NOT_CONFIGURED', 'Scrape secret is not configured');
      if (!secretMatches(req.get('x-scrape-secret'), scrapeSecret)) throw new HttpError(401, 'UNAUTHORIZED', 'Invalid scrape secret');
      const summary = await runTick({ db, now, ...tickOptions });
      log(JSON.stringify({ event: 'scrape_tick', ...summary }));
      res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } });
    console.error(err);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  return app;
}
