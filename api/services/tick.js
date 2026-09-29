import { fetchProfile as defaultFetchProfile } from '../../scraper/index.js';
import { currentWindow } from './windows.js';
import { claimNext, releaseClaim, recordSuccess, recordNotFound, recordTransientFailure, MAX_ATTEMPTS } from './queue.js';

const PLATFORMS = ['leetcode', 'hackerrank'];
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Scrapes due profiles until the time budget is spent. One lane per platform runs in parallel;
// within a lane fetches are sequential with a random pause so we never hammer a site.
// The budget is a hard deadline that keeps the whole tick inside AppSail's 30 s request limit.
export async function runTick({
  db,
  now = () => new Date(),
  clock = () => Date.now(),
  budgetMs = 22000,
  fetchTimeoutMs = 7000,
  pauseMs = [2000, 4000],
  leaseMs = 120000,
  maxAttempts = MAX_ATTEMPTS,
  fetchProfile = defaultFetchProfile,
  sleep = defaultSleep,
  random = Math.random,
} = {}) {
  const window = currentWindow(now());
  if (!window) return { skipped: 'outside_window' };

  const started = clock();
  const canStartFetch = () => clock() - started + fetchTimeoutMs <= budgetMs;
  const claim = (platform) => claimNext(db, platform, { now: now(), windowStart: window.start, leaseMs, maxAttempts });

  async function process(platform, account, counts) {
    const at = now();
    try {
      const result = await fetchProfile(platform, account.username, { retries: 0, timeoutMs: fetchTimeoutMs });
      if (result.status === 'ok') {
        await recordSuccess(db, account, result.data, { now: at });
        counts.ok++;
      } else if (result.status === 'not_found') {
        await recordNotFound(db, account, { now: at });
        counts.not_found++;
      } else {
        await recordTransientFailure(db, account, result.error, { now: at, windowStart: window.start });
        counts.retry++;
      }
    } catch (err) {
      await recordTransientFailure(db, account, err?.message, { now: at, windowStart: window.start });
      counts.retry++;
    }
  }

  async function lane(platform) {
    const counts = { ok: 0, not_found: 0, retry: 0, released: 0 };
    if (!canStartFetch()) return counts;

    let account = await claim(platform);
    while (account) {
      await process(platform, account, counts);
      if (!canStartFetch()) break;

      const next = await claim(platform);
      if (!next) break;
      await sleep(pauseMs[0] + random() * (pauseMs[1] - pauseMs[0]));
      if (!canStartFetch()) {
        await releaseClaim(db, next.id);
        counts.released++;
        break;
      }
      account = next;
    }
    return counts;
  }

  const results = await Promise.all(PLATFORMS.map(lane));
  return {
    window: { start: window.start.toISOString(), end: window.end.toISOString() },
    ms: clock() - started,
    ...Object.fromEntries(PLATFORMS.map((p, i) => [p, results[i]])),
  };
}
