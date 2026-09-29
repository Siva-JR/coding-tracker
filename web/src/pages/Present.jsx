import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/index.js';
import { useAuth } from '../context/Auth.jsx';
import { num } from '../lib/format.js';
import { Icon } from '../components/Icons.jsx';

const SLIDE_MS = 12000;

/** Auto-rotating Top 10 for a lobby screen or a review meeting. */
export default function Present() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [slides, setSlides] = useState([]);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const depts = await api.departments();
      const plan = [];
      if (user.role !== 'hod') {
        plan.push({ title: 'Top 10 · LeetCode', sub: 'Whole college', platform: 'leetcode' });
        plan.push({ title: 'Top 10 · HackerRank', sub: 'Whole college', platform: 'hackerrank' });
      }
      for (const d of depts) {
        plan.push({ title: `${d.code} · LeetCode`, sub: d.name, platform: 'leetcode', deptId: d.id });
        plan.push({ title: `${d.code} · HackerRank`, sub: d.name, platform: 'hackerrank', deptId: d.id });
      }
      const loaded = await Promise.all(plan.map(async (p) => ({
        ...p, data: await api.leaderboard({ platform: p.platform, deptId: p.deptId, limit: 10 }),
      })));
      if (live) setSlides(loaded);
    })().catch(() => {});
    return () => { live = false; };
  }, [user]);

  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    nav('/');
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') exit();
      else if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
      else if (e.key === 'ArrowRight') { setI((x) => (x + 1) % Math.max(slides.length, 1)); setTick(0); }
      else if (e.key === 'ArrowLeft') { setI((x) => (x - 1 + slides.length) % Math.max(slides.length, 1)); setTick(0); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  useEffect(() => {
    if (paused || !slides.length) return undefined;
    const t = setInterval(() => setTick((v) => v + 100), 100);
    return () => clearInterval(t);
  }, [paused, slides.length]);

  useEffect(() => {
    if (tick >= SLIDE_MS) { setTick(0); setI((x) => (x + 1) % slides.length); }
  }, [tick, slides.length]);

  const s = slides[i];
  if (!s) return <div className="present"><div className="skeleton" style={{ height: 300 }} /></div>;
  const entries = s.data.entries;
  const half = Math.ceil(entries.length / 2);

  return (
    <div className="present">
      <div className="present-head">
        <div>
          <p className="hand">{s.sub}</p>
          <h1>{s.title}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost sm" onClick={() => setPaused(!paused)} aria-label={paused ? 'Resume rotation' : 'Pause rotation'}><Icon name={paused ? 'play' : 'pause'} /> {paused ? 'Play' : 'Pause'}</button>
          <button className="btn ghost sm" onClick={exit}><Icon name="x" /> Exit</button>
        </div>
      </div>
      <div className="present-body" key={i}>
        {[entries.slice(0, half), entries.slice(half)].map((col, c) => (
          <div key={c}>
            {col.map((e, r) => (
              <div className="prow" key={e.studentId} style={{ animationDelay: `${(c * half + r) * 60}ms` }}>
                <span className={`pos p${e.position}`}>{e.position}</span>
                <span className="nm">{e.name}<small>{e.rollNo} · {e.deptCode} · Year {e.yearOfStudy}</small></span>
                <span className="sc num">{num(e.solved.total)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="present-foot">
        <span className="hint">{i + 1} / {slides.length} · Space pauses, arrows skip, Esc exits</span>
        <div className="progress" aria-hidden="true"><i style={{ width: `${(tick / SLIDE_MS) * 100}%` }} /></div>
      </div>
    </div>
  );
}
