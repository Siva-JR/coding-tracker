import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, has } from '../api/index.js';
import { useAsync } from '../lib/hooks.js';
import { num, shortDate } from '../lib/format.js';
import { COLORS } from './Charts.jsx';
import { Icon } from './Icons.jsx';
import { useScope } from '../context/Scope.jsx';

export const YEARS = [
  ['all', 'All'], ['1', '1st year'], ['2', '2nd year'], ['3', '3rd year'], ['4', '4th year'],
];

export function PlatformToggle({ value, onChange }) {
  return (
    <div className="seg" role="group" aria-label="Platform">
      {[['leetcode', 'LeetCode'], ['hackerrank', 'HackerRank']].map(([k, l]) => (
        <button key={k} aria-pressed={value === k} onClick={() => onChange(k)}>
          <span className="swatch" style={{ background: COLORS[k] }} />{l}
        </button>
      ))}
    </div>
  );
}

const Stars = ({ n }) => (n == null ? '—' : (
  <span className="stars" aria-label={`${n} stars`}>{'★'.repeat(n)}<i>{'★'.repeat(5 - n)}</i></span>
));

const Delta = ({ v }) => (v > 0 ? <span className="delta">▲ {v}</span> : <span className="delta zero">–</span>);

export function LeaderboardTable({ data, platform, showDept, onOpen }) {
  const lc = platform === 'leetcode';
  const showGain = data.entries.some((e) => e.weekGain != null);
  return (
    <div className="table-wrap">
      <table className="t">
        <caption className="sr-only">Top students on {lc ? 'LeetCode' : 'HackerRank'}</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Student</th>
            {showDept && <th scope="col">Dept</th>}
            <th scope="col">Year</th>
            {lc && <th scope="col">Easy · Med · Hard</th>}
            <th scope="col" className="r">Solved</th>
            <th scope="col" className="r">{lc ? 'Global rank' : 'Stars'}</th>
            {showGain && <th scope="col" className="r">7 days</th>}
          </tr>
        </thead>
        <tbody>
          {data.entries.map((e) => (
            <tr key={e.studentId} className={onOpen ? 'click' : ''} onClick={onOpen ? () => onOpen(e.studentId) : undefined}>
              <td><span className={`pos p${e.position}`}>{e.position}</span></td>
              <td className="name-cell">
                {onOpen
                  ? <a href={`#/student/${e.studentId}`} onClick={(ev) => ev.stopPropagation()} style={{ color: 'inherit', textDecoration: 'none' }}>{e.name}</a>
                  : <a href={e.profileUrl} target="_blank" rel="noreferrer noopener" style={{ color: 'inherit', textDecoration: 'none' }} title="Open profile">{e.name}</a>}
                <small>{e.rollNo}{e.stale && <span className="chip warn" style={{ marginLeft: 8 }} title="Latest fetch failed; showing the last good numbers">stale</span>}</small>
              </td>
              {showDept && <td>{e.deptCode}</td>}
              <td>{e.yearOfStudy}</td>
              {lc && (
                <td>
                  <span className="diff">
                    <span className="e" title="Easy">{e.solved.easy}</span>
                    <span className="m" title="Medium">{e.solved.medium}</span>
                    <span className="h" title="Hard">{e.solved.hard}</span>
                  </span>
                </td>
              )}
              <td className="r num"><b style={{ fontSize: 17 }}>{num(e.solved.total)}</b></td>
              <td className="r num">{lc ? (e.globalRank ? num(e.globalRank) : <span className="hint">unranked</span>) : <Stars n={e.stars} />}</td>
              {showGain && <td className="r"><Delta v={e.weekGain} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The landing-page leaderboard: platform toggle, sort toggle, year tabs. */
export default function Leaderboard({ deptId, showDept, allowDeptFilter, departments, onDept }) {
  const nav = useNavigate();
  const { years: allowedYears } = useScope();
  const yearTabs = allowedYears ? YEARS.filter(([k]) => k === 'all' || allowedYears.includes(Number(k))) : YEARS;
  const [platform, setPlatform] = useState('leetcode');
  const [sort, setSort] = useState('solved');
  const [year, setYear] = useState('all');
  const effSort = platform === 'hackerrank' ? 'solved' : sort;
  const q = useMemo(() => ({ platform, sort: effSort, year, deptId, limit: 20 }), [platform, effSort, year, deptId]);
  const { data, loading, error, reload } = useAsync(() => api.leaderboard(q), [q]);

  return (
    <section className="card" aria-labelledby="lb-h">
      <div className="card-head">
        <h2 id="lb-h"><Icon name="trophy" /> Top 20 {deptId ? 'in the department' : 'across the college'}</h2>
        {data?.asOf && <span className="hint">as of {shortDate(data.asOf)}</span>}
      </div>

      <div className="controls">
        <PlatformToggle value={platform} onChange={setPlatform} />
        {platform === 'leetcode' && (
          <div className="seg" role="group" aria-label="Sort by">
            <button aria-pressed={sort === 'solved'} onClick={() => setSort('solved')}>Problems solved</button>
            <button aria-pressed={sort === 'rank'} onClick={() => setSort('rank')}>Global rank</button>
          </div>
        )}
        <div className="spacer" />
        {allowDeptFilter && (
          <select className="input" style={{ width: 'auto', height: 40 }} value={deptId || ''} onChange={(e) => onDept(e.target.value || null)} aria-label="Filter by department">
            <option value="">All departments</option>
            {departments?.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
          </select>
        )}
      </div>
      <div className="controls" style={{ marginBottom: 6 }}>
        <div className="seg" role="tablist" aria-label="Year of study">
          {yearTabs.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={year === k} onClick={() => setYear(k)}>{l}</button>
          ))}
        </div>
      </div>

      {loading && !data && <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ height: 46 }} />)}</div>}
      {error && (
        <div className="alert" role="alert"><Icon name="alert" /> <span>Couldn't load the leaderboard. <button className="link-btn" onClick={reload}>Try again</button></span></div>
      )}
      {data && data.entries.length === 0 && <div className="empty"><span className="hand">Nothing here yet</span>No students with a fetched profile match these filters.</div>}
      {data && data.entries.length > 0 && (
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
          <LeaderboardTable data={data} platform={platform} showDept={showDept} onOpen={has('student') ? (id) => nav(`/student/${id}`) : undefined} />
        </div>
      )}
      <p className="hint" style={{ marginTop: 10 }}>
        Counts show practice activity, not skill. Students with a broken profile are listed under Needs attention instead.
      </p>
    </section>
  );
}
