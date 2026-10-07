import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useAsync } from '../lib/hooks.js';
import { romanYear } from '../lib/yearOfStudy.js';
import { Icon } from './Icons.jsx';

const FIRST = 20;
const MORE = 10;
const safeHref = (u) => (/^https?:\/\//i.test(u || '') ? u : undefined);

/**
 * Students who have shared a GitHub link, each with a button that opens their profile. No numbers, no ranking.
 * Search comes from the shared box above the list; the list grows 10 at a time.
 */
export default function GithubList({ deptId, year, q, showDept }) {
  const [limit, setLimit] = useState(FIRST);
  useEffect(() => { setLimit(FIRST); }, [deptId, year, q]);
  const { data, loading, error, reload } = useAsync(() => api.github({ deptId, year, q, limit, offset: 0 }), [deptId, year, q, limit]);

  return (
    <div>
      {data && !q && <p className="hint" style={{ margin: '4px 0 8px' }}>{data.total} of {data.scopeTotal} students have added a GitHub link</p>}
      {loading && !data && <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ height: 46 }} />)}</div>}
      {error && <div className="alert" role="alert"><Icon name="alert" /> <span>Couldn't load the GitHub links. <button className="link-btn" onClick={reload}>Try again</button></span></div>}
      {data && data.items.length === 0 && (
        <div className="empty"><span className="hand">{q ? 'No match' : 'No GitHub links yet'}</span>{q ? `Nobody with a GitHub link matches “${q}”.` : 'Students who have a GitHub link on file will appear here.'}</div>
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
                    <td>{romanYear(s.yearOfStudy)}</td>
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
          <div className="lb-foot">
            <span className="hint">Showing {data.items.length} of {data.total}{q ? ` matching “${q}”` : ''}</span>
            {data.items.length < data.total && (
              <button className="btn ghost sm" onClick={() => setLimit(limit + MORE)} disabled={loading}>Show {MORE} more ({data.total - data.items.length} left)</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
