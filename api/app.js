import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { HttpError } from './http.js';
import { cors, requireJson } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { readRoutes } from './routes/read.js';
import { adminRoutes } from './routes/admin.js';
import { runTick } from './services/tick.js';
import { fetchProfile as defaultFetchProfile } from '../scraper/index.js';

function secretMatches(provided, expected) {
  const a = Buffer.from(String(provided ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp({
  db,
  sessionSecret,
  scrapeSecret,
  cookie = {},
  corsOrigins = [],
  now = () => new Date(),
  tickOptions = {},
  fetchProfile = defaultFetchProfile,
  log = console.log,
}) {
  if (!sessionSecret) throw new Error('sessionSecret is required');

  const cookieOptions = { httpOnly: true, secure: cookie.secure ?? false, sameSite: cookie.sameSite ?? 'lax', path: '/' };

  const app = express();
  app.disable('x-powered-by');
  app.use(cors(corsOrigins));
  app.use(cookieParser());
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.use('/api', requireJson);
  app.use('/api/auth', authRoutes({ db, sessionSecret, cookieOptions, now }));
  app.use('/api/admin', adminRoutes({ db, sessionSecret, fetchProfile, now }));
  app.use('/api', readRoutes({ db, sessionSecret, now }));

  app.post('/internal/scrape/tick', async (req, res, next) => {
    try {
      if (!scrapeSecret) throw new HttpError(503, 'NOT_CONFIGURED', 'Scrape secret is not configured');
      if (!secretMatches(req.get('x-scrape-secret'), scrapeSecret)) throw new HttpError(401, 'UNAUTHORIZED', 'Invalid scrape secret');
      const summary = await runTick({ db, now, fetchProfile, ...tickOptions });
      log(JSON.stringify({ event: 'scrape_tick', ...summary }));
      res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.details } });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Request body is too large' } });
    console.error(err);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  return app;
}
