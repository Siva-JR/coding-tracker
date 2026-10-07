import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, has } from '../api/index.js';
import { useAsync } from '../lib/hooks.js';
import { num, shortDate } from '../lib/format.js';
import { batchYearFor, romanYear } from '../lib/yearOfStudy.js';
import { COLORS } from './Charts.jsx';
import { Icon } from './Icons.jsx';
import { useScope } from '../context/Scope.jsx';
import GithubList from './GithubList.jsx';

// "How many to show": Top 3 -> 5 -> 10 -> 20 -> everyone, then 10 more at a time.
export const TOP_CHOICES = [3, 5, 10, 20];
const NEXT_TOP = { 3: 5, 5: 10, 10: 20, 20: 'all' };
const FIRST_ALL = 20;   // "All" starts with the top 20, so it continues straight on from Top 20
const MORE = 10;        // and then grows by 10
const FIRST_SEARCH = 10;
const MAX_ROWS = 1000;  // the most the server returns in one request

// Year tabs: "II Year" with the batch it belongs to written below it.
const yearTabsFor = (allowed) => [
  { key: 'all', main: 'All', sub: 'Years' },
  ...[1, 2, 3, 4]
    .filter((y) => !allowed || allowed.includes(y))
    .map((y) => ({ key: String(y), main: `${romanYear(y)} Year`, sub: String(batchYearFor(y)) })),
];

export function PlatformToggle({ value, onChange }) {
  return (
    <div className="seg" role="group" aria-label="Platform">
      {[['leetcode', 'LeetCode'], ['hackerrank', 'HackerRank'], ['github', 'GitHub']].map(([k, l]) => (
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
        <caption className="sr-only">Students ranked on {lc ? 'LeetCode' : 'HackerRank'}</caption>
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
              <td>{romanYear(e.yearOfStudy)}</td>
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

// The ranked table for LeetCode / HackerRank, with the "show more" button underneath.
function RankedPane({ platform, sort, year, deptId, shown, q, mode, top, showDept, onMore, onMeta }) {
  const nav = useNavigate();
  const request = useMemo(() => ({ platform, sort, year, deptId, q, limit: Math.min(shown, MAX_ROWS) }), [platform, sort, year, deptId, q, shown]);
  const { data, loading, error, reload } = useAsync(() => api.leaderboard(request), [request]);
  useEffect(() => { onMeta({ asOf: data?.asOf ?? null, total: data?.total ?? null }); }, [data?.asOf, data?.total]); // eslint-disable-line react-hooks/exhaustive-deps

  const more = data && data.entries.length < data.total && data.entries.length < MAX_ROWS;
  let moreLabel = `Show ${MORE} more`;
  if (mode === 'top') moreLabel = NEXT_TOP[top] === 'all' ? 'Show all students' : `Show Top ${NEXT_TOP[top]}`;

  return (
    <>
      {loading && !data && <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>{Array.from({ length: Math.min(shown, 6) }, (_, i) => <div key={i} className="skeleton" style={{ height: 46 }} />)}</div>}
      {error && (
        <div className="alert" role="alert"><Icon name="alert" /> <span>Couldn't load the leaderboard. <button className="link-btn" onClick={reload}>Try again</button></span></div>
      )}
      {data && data.entries.length === 0 && (
        <div className="empty"><span className="hand">{q ? 'No match' : 'Nothing here yet'}</span>{q ? `Nobody in this list matches “${q}”.` : 'No students with a fetched profile match these filters.'}</div>
      )}
      {data && data.entries.length > 0 && (
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
          <LeaderboardTable data={data} platform={platform} showDept={showDept} onOpen={has('student') ? (id) => nav(`/student/${id}`) : undefined} />
          <div className="lb-foot">
            <span className="hint">
              Showing {data.entries.length} of {data.total} student{data.total === 1 ? '' : 's'}{q ? ` matching “${q}”` : ''}
            </span>
            {more && <button className="btn ghost sm" onClick={onMore} disabled={loading}>{moreLabel}{mode !== 'top' ? ` (${data.total - data.entries.length} left)` : ''}</button>}
          </div>
        </div>
      )}
      <p className="hint" style={{ marginTop: 10 }}>
        Counts show practice activity, not skill. Students with a broken profile are listed under Needs attention instead.
      </p>
    </>
  );
}

/** The landing-page leaderboard: platform tabs, search, year tabs, Top 3 / 5 / 10 / 20 / All, and a GitHub tab. */
export default function Leaderboard({ deptId, showDept, allowDeptFilter, departments, onDept }) {
  const { years: allowedYears } = useScope();
  const yearTabs = useMemo(() => yearTabsFor(allowedYears), [allowedYears]);
  const [platform, setPlatform] = useState('leetcode');
  const [sort, setSort] = useState('solved');
  const [year, setYear] = useState('all');
  const [top, setTop] = useState(20);                 // 3 | 5 | 10 | 20 | 'all'
  const [allCount, setAllCount] = useState(FIRST_ALL);
  const [searchCount, setSearchCount] = useState(FIRST_SEARCH);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [meta, setMeta] = useState({ asOf: null, total: null });

  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  // A different list starts again from the top.
  useEffect(() => { setAllCount(FIRST_ALL); setSearchCount(FIRST_SEARCH); }, [platform, sort, year, deptId, q]);

  const ranked = platform !== 'github';
  const searching = ranked && !!q;
  const mode = searching ? 'search' : top === 'all' ? 'all' : 'top';
  const shown = searching ? searchCount : top === 'all' ? allCount : top;
  const effSort = platform === 'hackerrank' ? 'solved' : sort;
  const where = deptId ? 'in the department' : 'across the college';

  const showMore = () => {
    if (mode === 'top') setTop(NEXT_TOP[top]);
    else if (mode === 'all') setAllCount((c) => c + MORE);
    else setSearchCount((c) => c + MORE);
  };

  let heading = `GitHub profiles ${where}`;
  if (searching) heading = `Search results${meta.total != null ? ` · ${meta.total} found` : ''}`;
  else if (ranked) heading = top === 'all' ? `All students ${where}` : `Top ${top} ${where}`;

  return (
    <section className="card" aria-labelledby="lb-h">
      <div className="card-head">
        <h2 id="lb-h"><Icon name={ranked ? (searching ? 'search' : 'trophy') : 'code'} /> {heading}</h2>
        {ranked && !searching && meta.asOf && <span className="hint">as of {shortDate(meta.asOf)}</span>}
      </div>

      <div className="lb-controls">
        <div className="lb-row">
          <PlatformToggle value={platform} onChange={setPlatform} />
          <div className="spacer" />
          <div className="input-wrap lb-search">
            <Icon name="search" />
            <input className="input" placeholder="Search name or reg no" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search students" />
            {text && <button type="button" className="end" onClick={() => setText('')} aria-label="Clear search"><Icon name="x" /></button>}
          </div>
        </div>

        <div className="lb-row">
          <div className="seg seg-years" role="tablist" aria-label="Year of study">
            {yearTabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={year === t.key} onClick={() => setYear(t.key)}>
                <span className="yr-main">{t.main}</span><span className="yr-sub">{t.sub}</span>
              </button>
            ))}
          </div>
          <div className="spacer" />
          {allowDeptFilter && (
            <select className="input lb-dept" value={deptId || ''} onChange={(e) => onDept(e.target.value || null)} aria-label="Filter by department">
              <option value="">All departments</option>
              {departments?.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
            </select>
          )}
        </div>

        {ranked && (
          <div className="lb-row lb-row-options">
            {!searching && (
              <div className="lb-group">
                <span className="lb-label">Show</span>
                <div className="seg" role="group" aria-label="How many to show">
                  {TOP_CHOICES.map((n) => <button key={n} aria-pressed={top === n} onClick={() => setTop(n)}>Top {n}</button>)}
                  <button aria-pressed={top === 'all'} onClick={() => setTop('all')}>All</button>
                </div>
              </div>
            )}
            {searching && <span className="hint">Searching everyone in this list. Clear the search to go back to Top {top === 'all' ? 'All' : top}.</span>}
            {platform === 'leetcode' && (
              <div className="lb-group lb-sort">
                <span className="lb-label">Sort by</span>
                <div className="seg" role="group" aria-label="Sort by">
                  <button aria-pressed={sort === 'solved'} onClick={() => setSort('solved')}>Problems solved</button>
                  <button aria-pressed={sort === 'rank'} onClick={() => setSort('rank')}>Global rank</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {ranked
        ? <RankedPane platform={platform} sort={effSort} year={year} deptId={deptId} shown={shown} q={q} mode={mode} top={top} showDept={showDept} onMore={showMore} onMeta={setMeta} />
        : <GithubList deptId={deptId} year={year} q={q} showDept={showDept} />}
    </section>
  );
}
