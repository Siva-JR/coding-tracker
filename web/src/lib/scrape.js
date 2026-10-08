// Fetches fresh numbers for students, one at a time: the next student starts only when the previous one
// has finished. Used by both "Import" (fetch each student right after they are created) and "Refresh all".
//
// There is no fixed rest between students; each fetch takes a second or two, which is gentle enough. It only
// slows down when something fails, and stops if the sites keep failing.
import { api } from '../api/index.js';

const PACE = Number(import.meta.env.VITE_REFRESH_PACE) || 1; // scales the waits below; only for quick tests
export const FAILURE_BACKOFF_MS = 5000 * PACE;
export const STOP_AFTER_FAILURES = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const newTally = (total = 0) => ({
  total, done: 0, fetched: 0, notFound: 0, failed: 0, skipped: 0,
  current: '', streak: 0, aborted: false, stopped: false, startedAt: Date.now(),
});

/** 'fetched' | 'notFound' | 'failed' for one student. */
export async function scrapeOne(id, refresh = (x) => api.admin.refreshStudent(x)) {
  try {
    const r = await refresh(id);
    if (r.results.some((x) => x.status === 'error')) return 'failed';
    return r.results.some((x) => x.status === 'not_found') ? 'notFound' : 'fetched';
  } catch {
    return 'failed';
  }
}

/**
 * Runs through `list` ([{ id, name }]) one student at a time, updating `tally` and calling `onStep`
 * after each one. `tally` can be shared across several calls (Import feeds it a chunk at a time).
 * Returns the students that failed temporarily so the caller can try them once more.
 */
export async function scrapeSequentially(list, tally, { onStep, shouldStop, refresh }) {
  const failed = [];
  for (const s of list) {
    if (shouldStop?.() || tally.aborted) { tally.stopped = !!shouldStop?.(); break; }
    tally.current = s.name;
    onStep?.({ ...tally });
    const outcome = await scrapeOne(s.id, refresh);
    tally.done++;
    if (outcome === 'failed') {
      tally.failed++; tally.streak++; failed.push(s);
      if (tally.streak >= STOP_AFTER_FAILURES) { tally.aborted = true; onStep?.({ ...tally }); break; }
      await sleep(FAILURE_BACKOFF_MS); // ease off after a failure, then carry on
    } else {
      tally.streak = 0; tally[outcome]++;
    }
    onStep?.({ ...tally });
  }
  return failed;
}

/** One more go at students that failed temporarily. Fixes the tally as they succeed. */
export async function retryFailed(list, tally, { onStep, shouldStop, refresh }) {
  if (!list.length || tally.aborted) return;
  await sleep(FAILURE_BACKOFF_MS);
  for (const s of list) {
    if (shouldStop?.()) { tally.stopped = true; break; }
    tally.current = s.name;
    onStep?.({ ...tally });
    const outcome = await scrapeOne(s.id, refresh);
    if (outcome !== 'failed') { tally.failed--; tally[outcome]++; }
    onStep?.({ ...tally });
  }
}

/** "about 3 minutes left" from the pace so far. */
export function timeLeft(tally) {
  if (tally.done < 2) return '';
  const perStudent = (Date.now() - tally.startedAt) / tally.done;
  const secs = Math.round((tally.total - tally.done) * perStudent / 1000);
  if (secs < 5) return 'almost done';
  if (secs < 90) return `about ${secs} seconds left`;
  return `about ${Math.round(secs / 60)} minutes left`;
}
