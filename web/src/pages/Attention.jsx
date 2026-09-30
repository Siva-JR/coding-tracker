import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/index.js';
import { useAsync } from '../lib/hooks.js';
import { useScope } from '../context/Scope.jsx';
import { shortDate } from '../lib/format.js';
import SampleBadge from '../components/SampleBadge.jsx';
import { Icon } from '../components/Icons.jsx';
import { Scribble } from '../components/Decor.jsx';

const PLAT = { leetcode: 'LeetCode', hackerrank: 'HackerRank' };

export default function Attention() {
  const { single } = useScope();
  const nav = useNavigate();
  const [tab, setTab] = useState('broken');
  const { data, loading, error } = useAsync(() => api.attention({}), []);
  const rows = data?.[tab] ?? [];
  const tabs = useMemo(() => [
    ['broken', 'Broken profiles', data?.broken.length],
    ['stale', 'Stale data', data?.stale.length],
    ['inactive', 'Inactive 30 days', data?.inactive.length],
  ], [data]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Needs attention</h1>
          <Scribble width={250} />
          <p className="sub">{single ? single.name : 'All departments'}</p>
          <div style={{ marginTop: 8 }}><SampleBadge feature="attention" /></div>
        </div>
      </header>
      <section className="card">
        <div className="controls">
          <div className="seg" role="tablist" aria-label="Attention lists">
            {tabs.map(([k, l, n]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}{n != null && <span className="chip" style={{ padding: '0 8px' }}>{n}</span>}</button>
            ))}
          </div>
        </div>
        <p className="hint" style={{ marginBottom: 8 }}>
          {tab === 'broken' && 'The profile was not found or the latest fetch failed. These students are excluded from that platform’s leaderboard until fixed.'}
          {tab === 'stale' && 'Fetches succeeded before, but nothing new has come through for 3 or more days. Old numbers are still shown.'}
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
                  {tab === 'inactive' ? <><th scope="col" className="r">LeetCode</th><th scope="col" className="r">HackerRank</th></> : <><th scope="col">Platform</th><th scope="col">{tab === 'broken' ? 'Problem' : 'Last good data'}</th></>}
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.studentId}-${r.platform || i}`} className="click" onClick={() => nav(`/student/${r.studentId}`)}>
                    <td className="name-cell">{r.name}<small>{r.rollNo}</small></td>
                    <td>{r.deptCode}</td>
                    <td>{r.yearOfStudy}</td>
                    {tab === 'inactive' ? (
                      <><td className="r num">{r.leetcode ?? '—'}</td><td className="r num">{r.hackerrank ?? '—'}</td></>
                    ) : (
                      <>
                        <td>{PLAT[r.platform]}<small className="hint" style={{ display: 'block' }}>@{r.username}</small></td>
                        <td>
                          {tab === 'broken'
                            ? <span className={`chip ${r.status === 'not_found' ? 'bad' : 'warn'}`}>{r.error}</span>
                            : <span className="chip warn">{shortDate(r.lastOk)}</span>}
                        </td>
                      </>
                    )}
                    <td className="r">
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
