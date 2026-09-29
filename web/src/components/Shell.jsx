import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icons.jsx';
import { Blobs } from './Decor.jsx';
import { useAuth } from '../context/Auth.jsx';
import { api, isSample } from '../api/index.js';
import { longDate } from '../lib/format.js';
import { describeScopes } from '../lib/access.js';
import { useScope } from '../context/Scope.jsx';

function Tool({ to, icon, label, end, badge }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `tool${isActive ? ' active' : ''}`} aria-label={label}>
      <Icon name={icon} />
      {badge > 0 && <span className="dot" aria-hidden="true">{badge > 99 ? '99+' : badge}</span>}
      <span className="tip" aria-hidden="true">{label}</span>
    </NavLink>
  );
}

function Popover({ id, open, onClose, children }) {
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
  return <div className="popover" ref={ref} role="dialog">{children}</div>;
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
              <Popover id="sync" open={pop === 'sync'} onClose={() => setPop(null)}>
                <h4>Data is fresh</h4>
                <p className="sub">Profiles refresh automatically every night between 01:00 and 05:00 IST.</p>
                <span className="chip ok"><Icon name="check" size={14} /> Last full update: {longDate()}</span>
              </Popover>
              <Popover id="account" open={pop === 'account'} onClose={() => setPop(null)}>
                <h4>{user.displayTitle}</h4>
                <p className="sub">
                  @{user.username}
                  <br />{describeScopes(user)}
                </p>
                <button className="btn ghost sm" onClick={() => signOut()}><Icon name="logout" /> Sign out</button>
              </Popover>
            </div>
          )}
          <main className={`scroll${presenting ? ' bare' : ''}`} ref={scrollRef} id="main" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>
      <div className="tray" aria-hidden="true">
        <span className="pen blue" /><span className="pen red" /><span className="pen white" />
      </div>
    </div>
  );
}
