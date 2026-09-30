import { useNavigate } from 'react-router-dom';
import { api } from '../api/index.js';
import { useAsync } from '../lib/hooks.js';
import { num } from '../lib/format.js';
import SampleBadge from '../components/SampleBadge.jsx';
import { Icon } from '../components/Icons.jsx';
import { Scribble } from '../components/Decor.jsx';
import { Sparkline } from '../components/Charts.jsx';

export default function Departments() {
  const nav = useNavigate();
  const { data, loading, error } = useAsync(() => api.departmentOverview(), []);
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Departments</h1>
          <Scribble width={220} />
          <p className="sub">Pick a department to see its own Top 20.</p>
          <div style={{ marginTop: 8 }}><SampleBadge feature="departmentOverview" /></div>
        </div>
      </header>
      {error && <div className="alert" role="alert"><Icon name="alert" /> Couldn't load departments.</div>}
      <div className="grid dept-grid">
        {loading && !data && Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ height: 220 }} />)}
        {data?.map((d) => (
          <button key={d.id} className="card dept" onClick={() => nav(`/dept/${d.id}`)} aria-label={`Open ${d.name}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="dept-code">{d.code}</div>
                <div className="dept-name">{d.name}</div>
              </div>
              <Icon name="chevron" size={22} style={{ color: 'var(--accent)' }} />
            </div>
            <div className="dept-stats">
              <div><b className="num">{d.students}</b><span>students</span></div>
              <div><b className="num">{d.active}</b><span>active this week</span></div>
              <div><b className="num">{d.avgSolved}</b><span>avg LeetCode</span></div>
            </div>
            <Sparkline data={d.spark} />
            <div className="dept-top">
              {d.top ? <>Top: <b>{d.top.name}</b> · {num(d.top.solved)} solved</> : 'No data yet'}
              {d.attention > 0 && <span className="chip warn" style={{ float: 'right' }}>{d.attention} need attention</span>}
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
