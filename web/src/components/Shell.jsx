import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icons.jsx';
import { Blobs } from './Decor.jsx';
import { useAuth } from '../context/Auth.jsx';
import { api, isSample } from '../api/index.js';
import { handle, niceTitle } from '../lib/format.js';
import { accessOf, describeScopes } from '../lib/access.js';
import { BrandBar, Footer } from './Brand.jsx';
import { useScope } from '../context/Scope.jsx';
import SyncPanel, { useRefreshNow } from './SyncPanel.jsx';

function Tool({ to, icon, label, end, badge }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `tool${isActive ? ' active' : ''}`} aria-label={label}>
      <Icon name={icon} />
      {badge > 0 && <span className="dot" aria-hidden="true">{badge > 99 ? '99+' : badge}</span>}
      <span className="tip" aria-hidden="true">{label}</span>
    </NavLink>
  );
}

function Popover({ id, open, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest(`[data-pop="${id}"]`)) onClose(); };
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open, onClose, id]);
  if (!open) return null;
  return <div className={`popover${wide ? ' wide' : ''}`} ref={ref} role="dialog">{children}</div>;
}

export default function Shell() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const scrollRef = useRef(null);
  const [pop, setPop] = useState(null); // 'account' | 'sync' | null
  const [attn, setAttn] = useState(0);
  const presenting = pathname === '/present';
  const { multi } = useScope();
  const everyone = !accessOf(user).deptIds;
  const run = useRefreshNow(user.id);

  useEffect(() => { scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' }); setPop(null); }, [pathname]);
  useEffect(() => {
    api.attention({}).then((a) => setAttn(a.broken.length)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  const enterPresent = () => {
    nav('/present');
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="board">
      <div className="bezel">
        <div className="glass">
          <Blobs />
          {!presenting && (
            <nav className="toolbar left" aria-label="Main">
              <Tool to="/" end icon="home" label="Leaderboard" />
              {multi && <Tool to="/departments" icon="grid" label="Departments" />}
              <Tool to="/attention" icon="alert" label="Needs attention" badge={isSample('attention') ? 0 : attn} />
              {user.role === 'admin' && (
                <>
                  <div className="tool-sep" />
                  <Tool to="/admin" icon="shield" label="Admin" />
                </>
              )}
            </nav>
          )}
          {!presenting && (
            <div className="toolbar right" role="toolbar" aria-label="Board tools">
              <button className="tool" onClick={enterPresent} aria-label="Present mode">
                <Icon name="monitor" /><span className="tip" aria-hidden="true">Present mode</span>
              </button>
              <button className="tool" data-pop="sync" onClick={() => setPop(pop === 'sync' ? null : 'sync')} aria-label="Data status" aria-expanded={pop === 'sync'}>
                <Icon name="wifi" /><span className="tip" aria-hidden="true">Data status</span>
              </button>
              <div className="tool-sep" />
              <button className="tool" data-pop="account" onClick={() => setPop(pop === 'account' ? null : 'account')} aria-label="Account" aria-expanded={pop === 'account'}>
                <Icon name="users" /><span className="tip" aria-hidden="true">Account</span>
              </button>
              <Popover id="sync" open={pop === 'sync'} onClose={() => setPop(null)} wide>
                <SyncPanel run={run} scopeText={everyone ? 'every student in the college' : 'your department'} />
              </Popover>
              <Popover id="account" open={pop === 'account'} onClose={() => setPop(null)}>
                <h4>{niceTitle(user.displayTitle)}</h4>
                <p className="sub">
                  {handle(user.username)}
                  <br />{describeScopes(user)}
                </p>
                <button className="btn ghost sm" onClick={() => signOut()}><Icon name="logout" /> Sign out</button>
              </Popover>
            </div>
          )}
          <main className={`scroll${presenting ? ' bare' : ''}`} ref={scrollRef} id="main" tabIndex={-1}>
            {!presenting && <BrandBar />}
            <Outlet />
            {!presenting && <Footer />}
          </main>
        </div>
      </div>
      <div className="tray" aria-hidden="true">
        <span className="pen blue" /><span className="pen red" /><span className="pen white" />
      </div>
    </div>
  );
}
