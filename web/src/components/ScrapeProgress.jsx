import { timeLeft } from '../lib/scrape.js';

/** Progress bar and counts for a run that fetches students one after another. */
export default function ScrapeProgress({ tally, label, finished, stopNote, words = {} }) {
  const w = { fetched: 'updated', notFound: 'profile not found', failed: 'could not be reached', skipped: 'skipped', ...words };
  const pct = tally.total ? Math.round((tally.done / tally.total) * 100) : 0;
  const left = tally.total - tally.done;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="progress" role="progressbar" aria-valuenow={tally.done} aria-valuemax={tally.total} aria-label={label}><i style={{ width: `${pct}%` }} /></div>
      <b>
        {finished
          ? `${tally.stopped ? 'Stopped' : tally.aborted ? 'Paused' : 'Finished'} · ${tally.done} of ${tally.total} students`
          : `${label} · ${tally.done} of ${tally.total} students · ${left} left`}
      </b>
      {!finished && (
        <span className="hint" role="status">
          {tally.current ? `Now fetching ${tally.current}` : 'Starting…'}{timeLeft(tally) ? ` · ${timeLeft(tally)}` : ''}
        </span>
      )}
      <div className="meta">
        <span className="chip ok">{tally.fetched} {w.fetched}</span>
        {tally.notFound > 0 && <span className="chip bad">{tally.notFound} {w.notFound}</span>}
        {tally.failed > 0 && <span className="chip warn">{tally.failed} {w.failed}</span>}
        {tally.skipped > 0 && <span className="chip">{tally.skipped} {w.skipped}</span>}
      </div>
      {stopNote && <span className="hint">{stopNote}</span>}
      {tally.aborted && <span className="hint" role="alert">LeetCode or HackerRank is not answering right now. Wait a few minutes and try again; students already fetched are kept.</span>}
    </div>
  );
}
