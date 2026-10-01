import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/index.js';
import { useAsync } from '../lib/hooks.js';
import { num, shortDate } from '../lib/format.js';
import { yearLabel } from '../lib/yearOfStudy.js';
import { Icon } from '../components/Icons.jsx';
import { COLORS, LineChart } from '../components/Charts.jsx';

function statusChip(st, lastOk) {
  if (st === 'not_found') return <span className="chip bad">Profile not found</span>;
  if (st === 'error') return <span className="chip warn">Last fetch failed · showing {lastOk ? shortDate(lastOk) : 'no'} data</span>;
  return <span className="chip ok"><Icon name="check" size={13} /> Up to date</span>;
}

function Platform({ kind, p, username }) {
  const lc = kind === 'leetcode';
  if (!p) {
    return (
      <section className="card" aria-label={lc ? 'LeetCode' : 'HackerRank'}>
        <div className="plat-head">
          <span className="plat-badge" style={{ background: COLORS[kind], opacity: 0.45 }}>{lc ? 'LC' : 'H'}</span>
          <div><h2 style={{ fontSize: 18 }}>{lc ? 'LeetCode' : 'HackerRank'}</h2><span className="hint">not linked</span></div>
        </div>
        <div className="empty" style={{ padding: '10px 0' }}>No {lc ? 'LeetCode' : 'HackerRank'} profile was added for this student.</div>
      </section>
    );
  }
  const has = p.total != null;
  return (
    <section className="card" aria-label={lc ? 'LeetCode' : 'HackerRank'}>
      <div className="plat-head">
        <span className="plat-badge" style={{ background: COLORS[kind] }}>{lc ? 'LC' : 'H'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 18 }}>{lc ? 'LeetCode' : 'HackerRank'}</h2>
          <span className="hint">@{p.username || username}</span>
        </div>
        {p.url && <a className="link-btn" href={p.url} target="_blank" rel="noreferrer noopener">Open <Icon name="external" /></a>}
      </div>
      {has ? (
        <>
          <div className="big num">{num(p.total)} <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--muted)' }}>solved</span></div>
          <div className="facts">
            {lc ? (
              <>
                <div><b className="num" style={{ color: '#0a6b56' }}>{p.easy}</b><span>Easy</span></div>
                <div><b className="num" style={{ color: '#8a5200' }}>{p.medium}</b><span>Medium</span></div>
                <div><b className="num" style={{ color: '#a02828' }}>{p.hard}</b><span>Hard</span></div>
                <div><b className="num">{p.globalRank ? num(p.globalRank) : '—'}</b><span>Global rank</span></div>
              </>
            ) : (
              <div><b className="num">{p.stars ? `${p.stars} ★` : '—'}</b><span>Problem Solving stars</span></div>
            )}
            <div><b className="num">{p.weekGain == null ? '–' : `+${p.weekGain}`}</b><span>Last 7 days</span></div>
          </div>
        </>
      ) : <div className="empty" style={{ padding: '10px 0' }}><span className="hand">{p.status === 'ok' ? 'Waiting for the first scrape' : 'No data'}</span>{p.lastError}</div>}
      <div className="meta">{statusChip(p.status, p.lastOk)}</div>
    </section>
  );
}

export default function StudentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: s, loading, error } = useAsync(() => api.student(id), [id]);

  return (
    <>
      <button className="crumb" onClick={() => nav(-1)}><Icon name="chevron" /> Back</button>
      {error && <div className="alert" role="alert"><Icon name="alert" /> {error.status === 404 ? 'Student not found.' : "Couldn't load this student."}</div>}
      {loading && !s && <div className="skeleton" style={{ height: 320 }} />}
      {s && (
        <>
          <header className="page-head">
            <div>
              <h1>{s.name}</h1>
              <p className="sub">{s.rollNo} <span className="dot-sep" />{s.deptName}</p>
              <div className="meta">
                <span className="chip blue">{yearLabel(s.yearOfStudy)}</span>
                <span className="chip">Batch {s.batchYear}</span>
                {s.githubUrl && <a className="chip" href={s.githubUrl} target="_blank" rel="noreferrer noopener">GitHub <Icon name="external" size={12} /></a>}
              </div>
            </div>
          </header>
          <div className="grid detail-grid">
            <Platform kind="leetcode" p={s.leetcode} username={s.leetcodeUsername} />
            <Platform kind="hackerrank" p={s.hackerrank} username={s.hackerrankUsername} />
          </div>
          <section className="card" aria-labelledby="trend">
            <div className="card-head">
              <h2 id="trend"><Icon name="trend" /> Trend {s.firstSnapshot ? `since ${shortDate(s.firstSnapshot)}` : ''}</h2>
              <div className="legend">
                <span><i style={{ borderColor: COLORS.leetcode }} />LeetCode</span>
                <span><i className="dash" style={{ borderColor: COLORS.hackerrank }} />HackerRank</span>
              </div>
            </div>
            {s.history.length < 2 && <p className="hint" style={{ marginBottom: 8 }}>Only one day of data so far; the trend fills in as nightly snapshots build up.</p>}
            <LineChart
              data={s.history}
              formatX={shortDate}
              yLabel="problems solved"
              series={[
                { key: 'leetcode', label: 'LeetCode', color: COLORS.leetcode },
                { key: 'hackerrank', label: 'HackerRank', color: COLORS.hackerrank, dash: true },
              ]}
            />
          </section>
        </>
      )}
    </>
  );
}
