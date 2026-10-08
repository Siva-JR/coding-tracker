import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { newTally, retryFailed, scrapeSequentially } from '../lib/scrape.js';
import { Icon } from './Icons.jsx';
import ScrapeProgress from './ScrapeProgress.jsx';

const refresh = (id) => api.refreshMine(id);
const STALE_AFTER_MS = 2 * 24 * 3600 * 1000;

export const stamp = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * "Refresh now" for the signed-in user: fetches LeetCode and HackerRank again for every student their
 * scopes cover (a HoD's department, or everyone for the principal, vice-principal and admin), one student
 * after another. It lives above the popover so a run carries on when the popover is closed.
 */
export function useRefreshNow(userId) {
  const [info, setInfo] = useState(null);          // { students, lastUpdatedAt } or { error: true }
  const [tally, setTally] = useState(null);
  const [finished, setFinished] = useState(false);
  const stopRef = useRef(false);

  const load = useCallback(() => api.refreshTargets({}).then(setInfo).catch(() => setInfo({ error: true })), []);
  useEffect(() => { setInfo(null); load(); }, [load, userId]);

  const running = !!tally && !finished;
  useEffect(() => {
    if (!running) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  const start = async () => {
    const list = info.students;
    stopRef.current = false;
    const t = newTally(list.length);
    setFinished(false); setTally({ ...t });
    const opts = { onStep: (x) => setTally({ ...x }), shouldStop: () => stopRef.current, refresh };
    const failed = await scrapeSequentially(list, t, opts);
    await retryFailed(failed, t, opts);
    t.current = '';
    setTally({ ...t }); setFinished(true);
    load();
  };
  const stop = () => { stopRef.current = true; };
  const dismiss = () => { setTally(null); setFinished(false); };
  return { info, tally, finished, running, start, stop, dismiss };
}

export default function SyncPanel({ run, scopeText }) {
  const { info, tally, finished, running, start, stop, dismiss } = run;
  const last = info?.lastUpdatedAt;
  const old = last && Date.now() - new Date(last).getTime() > STALE_AFTER_MS;
  const count = info?.students?.length ?? 0;

  return (
    <>
      <h4>{!last ? 'No data fetched yet' : old ? 'Data may be out of date' : 'Data is fresh'}</h4>
      <p className="sub">
        {last ? <>Last updated <b>{stamp(last)}</b></> : 'Nothing has been fetched yet.'}
        {info?.oldestAt && <><br />Oldest profile: {stamp(info.oldestAt)}</>}
      </p>

      {!tally && (
        <>
          <button className="btn sm" disabled={!count} onClick={start}>
            <Icon name="refresh" /> {info ? `Refresh ${count} student${count === 1 ? '' : 's'}` : 'Checking…'}
          </button>
          <p className="hint" style={{ marginTop: 8 }}>
            {info?.error ? 'Could not check the data status.' : <>Covers {scopeText}. Takes a second or two per student; keep this tab open while it runs.</>}
          </p>
        </>
      )}
      {tally && (
        <div style={{ display: 'grid', gap: 10 }}>
          <ScrapeProgress tally={tally} label="Refreshing" finished={finished} />
          {finished
            ? <button className="btn sm" onClick={dismiss}>Done</button>
            : <button className="btn ghost sm" onClick={stop}>Stop after this student</button>}
          {running && <span className="hint">You can close this; it keeps running.</span>}
        </div>
      )}
    </>
  );
}
