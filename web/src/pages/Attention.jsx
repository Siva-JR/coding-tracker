import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAsync } from '../lib/hooks.js';
import { useScope } from '../context/Scope.jsx';
import { shortDate } from '../lib/format.js';
import { romanYear } from '../lib/yearOfStudy.js';
import SampleBadge from '../components/SampleBadge.jsx';
import { Icon } from '../components/Icons.jsx';
import { Scribble } from '../components/Decor.jsx';
import { useAuth } from '../context/Auth.jsx';
import { api } from '../api/index.js';
import { scrapeOne } from '../lib/scrape.js';
import { useToast } from '../components/Toasts.jsx';
import { downloadXlsx, problemsWorkbook } from '../lib/xlsxWrite.js';

const REASON = { not_fetched: 'Not fetched yet', failed: 'Last fetch failed', stale: 'Out of date' };
const PLAT = { leetcode: 'LeetCode', hackerrank: 'HackerRank' };

export default function Attention() {
  const { single } = useScope();
  const nav = useNavigate();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(['fix', 'stale', 'inactive'].includes(params.get('tab')) ? params.get('tab') : 'fix');
  const { data, loading, error, reload } = useAsync(() => api.attention({}), []);
  const fixRows = useMemo(() => (data ? [...data.fix].sort((x, y) => x.name.localeCompare(y.name)) : []), [data]);
  const toast = useToast();
  const [busy, setBusy] = useState(() => new Set());
  // Fetches one student again (both platforms) and reloads the lists.
  const refreshOne = async (e, r) => {
    e.stopPropagation();
    setBusy((b) => new Set(b).add(r.studentId));
    const outcome = await scrapeOne(r.studentId, (id) => api.refreshMine(id));
    setBusy((b) => { const n = new Set(b); n.delete(r.studentId); return n; });
    toast(outcome === 'fetched' ? `${r.name} updated` : outcome === 'notFound' ? `${r.name}: a profile was not found, check the link` : `${r.name} still could not be fetched, try again later`);
    reload();
  };
  const rows = tab === 'fix' ? fixRows : (data?.[tab] ?? []);
  const tabs = useMemo(() => [
    ['fix', 'Links to fix', fixRows.length],
    ['stale', 'Stale or not fetched', data?.stale.length],
    ['inactive', 'Inactive 30 days', data?.inactive.length],
  ], [data, fixRows]);

  // Everyone whose links need correcting, in the import format, so the file can be fixed and uploaded again.
  const download = () => {
    const lines = data.fix.map((f) => [f.name, f.rollNo, f.deptCode, f.batchYear, f.leetcodeUrl, f.hackerrankUrl, f.githubUrl, f.problems.join(' | ')]);
    downloadXlsx(`${single ? `${single.code}-` : ''}profile-links-to-fix.xlsx`, problemsWorkbook(lines));
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Profile check</h1>
          <Scribble width={250} />
          <p className="sub">{single ? single.name : 'All departments'}</p>
          <div style={{ marginTop: 8 }}><SampleBadge feature="attention" /></div>
        </div>
        {data?.fix.length > 0 && (
          <button className="btn ghost sm" onClick={download} title="An Excel file in the import format, with the problem written next to each student">
            <Icon name="download" /> Download {data.fix.length} to fix
          </button>
        )}
      </header>
      <section className="card">
        <div className="controls">
          <div className="seg" role="tablist" aria-label="Profile check lists">
            {tabs.map(([k, l, n]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}{n != null && <span className="chip" style={{ padding: '0 8px' }}>{n}</span>}</button>
            ))}
          </div>
        </div>
        <p className="hint" style={{ marginBottom: 8 }}>
          {tab === 'fix' && `Students with no link, or a link to a profile that does not exist, and why. Download the list, correct the links in the file${user.role === 'admin' ? ', then upload it again under Admin → Import' : ' and give it to an admin to upload under Admin → Import'}. Students missing a link are left out of that platform’s leaderboard until it is fixed.`}
          {tab === 'stale' && 'Profiles whose numbers are missing or old: never fetched, the last fetch failed, or nothing new for 3 or more days. Old numbers are still shown. Use Refresh to try one student again.'}
          {tab === 'inactive' && (data && data.inactiveAvailable === false
            ? 'Needs 30 days of history before anyone can be called inactive. It will fill in as nightly snapshots build up.'
            : 'No new problems on either platform in the last 30 days.')}
        </p>
        {error && <div className="alert" role="alert"><Icon name="alert" /> Couldn't load this list.</div>}
        {loading && !data && <div className="skeleton" style={{ height: 200 }} />}
        {data && rows.length === 0 && <div className="empty"><span className="hand">{tab === 'inactive' && data.inactiveAvailable === false ? 'Not enough history yet' : 'All clear'}</span>{tab === 'inactive' && data.inactiveAvailable === false ? 'Check back after a month of nightly snapshots.' : 'Nobody in this list.'}</div>}
        {data && rows.length > 0 && (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th scope="col">Student</th><th scope="col">Dept</th><th scope="col">Year</th>
                  {tab === 'fix' ? <th scope="col">What is wrong</th> : tab === 'inactive' ? <><th scope="col" className="r">LeetCode</th><th scope="col" className="r">HackerRank</th></> : <><th scope="col">Platform</th><th scope="col">Status</th></>}
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.studentId}-${r.platform || i}`} className="click" onClick={() => nav(`/student/${r.studentId}`)}>
                    <td className="name-cell">{r.name}<small>{r.rollNo}</small></td>
                    <td>{r.deptCode}</td>
                    <td>{romanYear(r.yearOfStudy)}</td>
                    {tab === 'fix' ? (
                      <td>{r.problems.map((p) => <span key={p} className="chip warn" style={{ display: 'block', width: 'fit-content', marginBottom: 4 }}>{p}</span>)}</td>
                    ) : tab === 'inactive' ? (
                      <><td className="r num">{r.leetcode ?? '—'}</td><td className="r num">{r.hackerrank ?? '—'}</td></>
                    ) : (
                      <>
                        <td>{PLAT[r.platform]}<small className="hint" style={{ display: 'block' }}>@{r.username}</small></td>
                        <td>
                          <span className="chip warn">{REASON[r.reason] ?? 'Out of date'}</span>
                          <small className="hint" style={{ display: 'block', marginTop: 2 }}>{r.lastOk ? `Last good data ${shortDate(r.lastOk)}` : 'No data yet'}</small>
                        </td>
                      </>
                    )}
                    <td className="r">
                      {tab === 'stale' && (
                        <button className="btn ghost sm" disabled={busy.has(r.studentId)} onClick={(e) => refreshOne(e, r)}>
                          {busy.has(r.studentId) ? 'Refreshing…' : 'Refresh'}
                        </button>
                      )}
                      {r.url && <a className="link-btn" href={r.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>Profile <Icon name="external" /></a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
