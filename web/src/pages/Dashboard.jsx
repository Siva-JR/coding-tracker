import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/index.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../context/Auth.jsx';
import { useScope } from '../context/Scope.jsx';
import { greeting, longDate, niceTitle, num, relDay, shortDate } from '../lib/format.js';
import { Icon } from '../components/Icons.jsx';
import { Scribble } from '../components/Decor.jsx';
import { COLORS, LineChart, Sparkline } from '../components/Charts.jsx';
import { canSeeAttention } from '../lib/access.js';
import Leaderboard from '../components/Leaderboard.jsx';
import SampleBadge from '../components/SampleBadge.jsx';

function Kpi({ tone, icon, label, value, note, spark, color, loading }) {
  return (
    <div className={`card kpi tone-${tone}`}>
      <div className="kpi-top">
        <span className="kpi-ic"><Icon name={icon} /></span>
        <span className="kpi-label">{label}</span>
      </div>
      {loading ? <div className="skeleton" style={{ height: 34, width: 90, margin: '8px 0 0 52px' }} /> : <div className="kpi-value num">{num(value)}</div>}
      {note && !loading && <div className="kpi-note">{note}</div>}
      {spark && !loading ? <Sparkline data={spark} color={color} /> : <div style={{ height: 50 }} />}
    </div>
  );
}

function Health({ label, badge, color, h }) {
  if (!h.total) {
    return (
      <div className="health-row">
        <span className="health-ic" style={{ background: color, opacity: 0.45 }} aria-hidden="true">{badge}</span>
        <div className="health-body">
          <div className="health-line"><span>{label}</span><span className="hint">none linked</span></div>
          <div className="bar"><i style={{ width: 0 }} /></div>
        </div>
      </div>
    );
  }
  return (
    <div className="health-row">
      <span className="health-ic" style={{ background: color }} aria-hidden="true">{badge}</span>
      <div className="health-body">
        <div className="health-line"><span>{label}</span><span className="num">{h.pct}%</span></div>
        <div className="bar" role="progressbar" aria-valuenow={h.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} profiles verified`}>
          <i style={{ width: `${h.pct}%`, background: color }} />
        </div>
        <div className="hint" style={{ marginTop: 4 }}>{h.ok} of {h.total} profiles fetched</div>
      </div>
    </div>
  );
}

const eventText = (e) => (e.kind === 'milestone'
  ? <><b>{e.name}</b> passed {e.value} solved on {e.platform === 'leetcode' ? 'LeetCode' : 'HackerRank'}</>
  : <><b>{e.name}</b> solved {e.value} problems in a day on {e.platform === 'leetcode' ? 'LeetCode' : 'HackerRank'}</>);

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const params = useParams();
  const scope = useScope();
  const isHod = !!scope.single; // one visible department: no picker, department-only view
  const deptId = scope.single ? scope.single.id : params.deptId ? Number(params.deptId) : null;
  const depts = { data: scope.departments };
  const stats = useAsync(() => api.stats({ deptId }), [deptId]);
  const feed = useAsync(() => api.activity({ deptId, limit: 7 }), [deptId]);
  const dept = depts.data?.find((d) => d.id === deptId);

  const s = stats.data;
  const days = s?.historyDays ?? 99; // sample data has plenty of history
  const historyNote = days < 1 ? 'needs 2+ days of data' : days < 7 ? `over ${days} day${days === 1 ? '' : 's'} tracked` : null;
  const scopeName = dept ? dept.name : 'All departments';

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{greeting()}, {niceTitle(user.displayTitle)}</h1>
          <Scribble />
          <p className="sub">{isHod || dept ? (scope.single ? scope.single.name : scopeName) : scope.multi && user.role !== 'admin' && !scope.years ? 'Your departments' : 'Whole college'}</p>
          <p className="date">{longDate()}</p>
        </div>
        <p className="quote" aria-hidden="true">“Consistent Practice Builds Progress”</p>
      </header>

      {!isHod && deptId && (
        <button className="crumb" onClick={() => nav('/')}><Icon name="chevron" /> Back to whole college</button>
      )}

      <div style={{ marginBottom: 8 }}><SampleBadge feature="stats" /></div>
      <div className="grid kpis">
        <Kpi tone="blue" icon="users" label="Total students" value={s?.kpis.totalStudents.value} loading={stats.loading && !s} note={`${s?.needsAttention ?? 0} need${s?.needsAttention === 1 ? 's' : ''} attention`} />
        <Kpi tone="teal" icon="user" label="Active this week" value={s?.kpis.activeStudents.value} spark={s?.kpis.activeStudents.spark} color="#0f8f72" loading={stats.loading && !s} note={historyNote || 'solved something in 7 days'} />
        <Kpi tone="violet" icon="code" label="Avg. LeetCode solved" value={s?.kpis.avgSolved.value} spark={s?.kpis.avgSolved.spark} color="#6d4fd6" loading={stats.loading && !s} note="per student" />
        <Kpi tone="amber" icon="trend" label="Solved this week" value={s?.kpis.weekSolved.value} spark={s?.kpis.weekSolved.spark} color="#b86e00" loading={stats.loading && !s} note={historyNote || 'both platforms'} />
      </div>

      <div className="grid main-grid">
        {scope.ready ? <Leaderboard
          deptId={deptId}
          showDept={!deptId}
          allowDeptFilter={!isHod}
          departments={depts.data}
          onDept={(id) => nav(id ? `/dept/${id}` : '/')}
        /> : <div className="card"><div className="skeleton" style={{ height: 420 }} /></div>}

        <div className="stack">
          <section className="card" aria-labelledby="ph">
            <div className="card-head"><h2 id="ph">Profile health <SampleBadge feature="stats" /></h2></div>
            {s ? (
              <>
                <Health label="LeetCode" badge="LC" color={COLORS.leetcode} h={s.health.leetcode} />
                <Health label="HackerRank" badge="H" color={COLORS.hackerrank} h={s.health.hackerrank} />
              </>
            ) : <div className="skeleton" style={{ height: 130 }} />}
            {canSeeAttention(user) && <p className="margin-note"><Icon name="arrowCurl" /> Profiles that fail to load are listed under “Needs attention”.</p>}
          </section>

          <section className="card" aria-labelledby="ra">
            <div className="card-head">
              <h2 id="ra">Recent activity <SampleBadge feature="activity" /></h2>
              {canSeeAttention(user) && <button className="link-btn" onClick={() => nav('/attention')}>Needs attention <Icon name="chevron" /></button>}
            </div>
            {feed.loading && !feed.data && <div className="skeleton" style={{ height: 200 }} />}
            {feed.data && feed.data.length === 0 && <div className="empty">No notable changes in the last few days.</div>}
            {feed.data && (
              <ul className="feed">
                {feed.data.map((e, i) => (
                  <li key={i} className="click" onClick={() => nav(`/student/${e.studentId}`)}>
                    <span className="d" style={{ background: e.platform === 'leetcode' ? COLORS.leetcode : COLORS.hackerrank }} />
                    <span>{eventText(e)}</span>
                    <span className="when">{relDay(e.date)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="hint" style={{ marginTop: 8 }}>Built from nightly snapshots, so times are by day.</p>
          </section>
        </div>
      </div>

      <section className="card" aria-labelledby="tl">
        <div className="card-head">
          <h2 id="tl"><Icon name="trend" /> Coding progress over time <SampleBadge feature="stats" /></h2>
          <div className="legend">
            <span><i style={{ borderColor: COLORS.leetcode }} />LeetCode</span>
            <span><i className="dash" style={{ borderColor: COLORS.hackerrank }} />HackerRank</span>
          </div>
        </div>
        <p className="hint" style={{ marginBottom: 8 }}>
          Average problems solved per student, weekly.
          {s && s.timeline.length < 2 && ' Only one day of data so far; the chart fills in as nightly snapshots build up.'}
        </p>
        {s ? (
          <LineChart
            data={s.timeline}
            formatX={shortDate}
            series={[
              { key: 'leetcode', label: 'LeetCode', color: COLORS.leetcode },
              { key: 'hackerrank', label: 'HackerRank', color: COLORS.hackerrank, dash: true },
            ]}
          />
        ) : <div className="skeleton" style={{ height: 260 }} />}
      </section>
    </>
  );
}
