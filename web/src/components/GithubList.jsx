import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from './Icons.jsx';

const PAGE = 20;
const safeHref = (u) => (/^https?:\/\//i.test(u || '') ? u : undefined);

/** Students who have shared a GitHub link, each with a button that opens their profile. No numbers, no ranking. */
export default function GithubList({ deptId, year, showDept }) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setLimit(PAGE); }, [deptId, year, dq]);
  const { data, loading, error, reload } = useAsync(() => api.github({ deptId, year, q: dq, limit, offset: 0 }), [deptId, year, dq, limit]);

  return (
    <div>
      <div className="controls" style={{ marginTop: 4 }}>
        <div className="input-wrap" style={{ width: 260 }}>
          <Icon name="search" />
          <input className="input" style={{ height: 40 }} placeholder="Search name or reg no" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search students" />
        </div>
        {data && !dq && (
          <span className="hint">{data.total} of {data.scopeTotal} students have added a GitHub link</span>
        )}
      </div>

      {loading && !data && <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ height: 46 }} />)}</div>}
      {error && <div className="alert" role="alert"><Icon name="alert" /> <span>Couldn't load the GitHub links. <button className="link-btn" onClick={reload}>Try again</button></span></div>}
      {data && data.items.length === 0 && (
        <div className="empty"><span className="hand">{dq ? 'No match' : 'No GitHub links yet'}</span>{dq ? `Nobody with a GitHub link matches “${dq}”.` : 'Students who have a GitHub link on file will appear here.'}</div>
      )}
      {data && data.items.length > 0 && (
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
          <div className="table-wrap">
            <table className="t">
              <caption className="sr-only">Students with a GitHub link</caption>
              <thead><tr><th scope="col">Student</th>{showDept && <th scope="col">Dept</th>}<th scope="col">Year</th><th scope="col" className="r">GitHub</th></tr></thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.studentId}>
                    <td className="name-cell">{s.name}<small>{s.rollNo}</small></td>
                    {showDept && <td>{s.deptCode}</td>}
                    <td>{s.yearOfStudy}</td>
                    <td className="r">
                      <a className="btn ghost sm" href={safeHref(s.githubUrl)} target="_blank" rel="noreferrer noopener" aria-label={`Open ${s.name}'s GitHub profile`}>
                        GitHub <Icon name="external" size={14} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.items.length < data.total && (
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <button className="btn ghost sm" onClick={() => setLimit(limit + PAGE)} disabled={loading}>Show more ({data.total - data.items.length} left)</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
