import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { Icon } from '../../components/Icons.jsx';
import ScrapeProgress from '../../components/ScrapeProgress.jsx';
import { newTally, retryFailed, scrapeSequentially } from '../../lib/scrape.js';
import { Modal } from './shared.jsx';

// Every student, page by page (the list endpoint returns at most 100 at a time).
async function allStudents() {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await api.admin.students({ page, pageSize: 100 });
    out.push(...r.items);
    if (out.length >= r.total || !r.items.length) return out;
  }
}
const neverFetched = (s) => s.accounts.some((a) => a.state === 'active' && !a.lastOkAt);

/**
 * "Refresh all": fetches LeetCode and HackerRank again for many students, right now, one student after
 * another. This is the same fetch the nightly job does, on demand.
 */
export default function RefreshAll({ onDone }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState([]);
  const [scope, setScope] = useState('everyone');            // 'everyone' | 'waiting'
  const [tally, setTally] = useState(null);
  const [finished, setFinished] = useState(false);
  const stopRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setStudents(await allStudents()); } catch { setStudents([]); }
    setLoading(false);
  }, []);
  useEffect(() => { if (open && !tally) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const linked = students.filter((s) => s.accounts.length);
  const waiting = students.filter(neverFetched);
  const targets = scope === 'everyone' ? linked : waiting;

  // The run stops if the tab is closed part-way; warn first.
  useEffect(() => {
    if (!tally || finished) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [tally, finished]);

  const start = async () => {
    const list = targets.map((s) => ({ id: s.id, name: s.name }));
    stopRef.current = false;
    const t = newTally(list.length);
    setFinished(false); setTally({ ...t });
    const opts = { onStep: (x) => setTally({ ...x }), shouldStop: () => stopRef.current };
    const failed = await scrapeSequentially(list, t, opts);
    await retryFailed(failed, t, opts);
    t.current = '';
    setTally({ ...t }); setFinished(true);
    onDone?.();
  };

  const close = () => { if (tally && !finished) return; setOpen(false); setTally(null); setFinished(false); };

  return (
    <>
      <button className="btn ghost sm" onClick={() => setOpen(true)}><Icon name="refresh" /> Refresh all</button>
      {open && (
        <Modal
          wide
          title="Refresh all"
          onClose={close}
          actions={tally ? (
            finished
              ? <button className="btn" onClick={close}>Done</button>
              : <button className="btn ghost" onClick={() => { stopRef.current = true; }}>Stop after this student</button>
          ) : (
            <>
              <button className="btn ghost" onClick={close}>Cancel</button>
              <button className="btn" onClick={start} disabled={loading || !targets.length}>{loading ? 'Counting…' : `Refresh ${targets.length} students`}</button>
            </>
          )}
        >
          {!tally && (
            <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>
              <p style={{ color: 'var(--ink-2)' }}>
                Fetches the latest LeetCode and HackerRank numbers again, one student after another. Keep this page open while it runs.
              </p>
              <label className="radio-row"><input type="radio" name="scope" checked={scope === 'everyone'} onChange={() => setScope('everyone')} /> <span><b>Everyone with a linked profile</b> ({loading ? '…' : linked.length})</span></label>
              <label className="radio-row"><input type="radio" name="scope" checked={scope === 'waiting'} onChange={() => setScope('waiting')} /> <span><b>Only students never fetched yet</b> ({loading ? '…' : waiting.length})</span></label>
              {!loading && !targets.length && <span className="hint">Nothing to refresh here.</span>}
            </div>
          )}
          {tally && (
            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              <ScrapeProgress tally={tally} label="Refreshing" finished={finished} />
              {finished && tally.notFound > 0 && <span className="hint">Profiles that were not found are listed under Needs attention so the link can be corrected.</span>}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
