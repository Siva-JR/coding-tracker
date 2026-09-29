import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/Auth.jsx';
import { Icon } from '../components/Icons.jsx';
import { Blobs } from '../components/Decor.jsx';
import { DEMO_PASSWORD, isLiveMode } from '../api/index.js';

export default function Login() {
  const { user, signIn } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wipe, setWipe] = useState(false);

  if (user && !busy) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) { setError('Enter your username and password.'); return; }
    setBusy(true); setError('');
    try {
      await signIn(username, password);
      setWipe(true);
      setTimeout(() => nav('/', { replace: true }), 380);
    } catch (err) {
      const wait = err.details?.retryAfterSeconds;
      setError(err.code === 'LOCKED' && wait
        ? `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute${wait > 90 ? 's' : ''}.`
        : err.message || 'Could not sign in.');
      setBusy(false);
    }
  };

  return (
    <div className="board">
      <div className="bezel">
        <div className="glass">
          <Blobs />
          <div className="scroll bare" style={{ padding: 0 }}>
            <div className="login-wrap">
              <div className="login">
                <Icon name="cap" className="cap" strokeWidth="1.6" />
                <h1>ACADEMIC <em>CODING BOARD</em></h1>
                <p className="tag">Student Coding Performance Management</p>
                <form className="card" onSubmit={submit} noValidate>
                  {error && <div className="alert" role="alert"><Icon name="alert" /><span>{error}</span></div>}
                  <div className="field">
                    <label htmlFor="u">Username</label>
                    <div className="input-wrap">
                      <Icon name="user" />
                      <input id="u" className="input" placeholder="Enter your username" autoComplete="username" autoCapitalize="none" spellCheck="false" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="p">Password</label>
                    <div className="input-wrap">
                      <Icon name="lock" />
                      <input id="p" className="input" type={show ? 'text' : 'password'} placeholder="Enter your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                      <button type="button" className="end" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
                        <Icon name={show ? 'eyeOff' : 'eye'} />
                      </button>
                    </div>
                  </div>
                  <button className="btn" style={{ height: 50, fontSize: 16 }} disabled={busy}>{busy ? 'Signing in…' : 'Sign In'}</button>
                  <p className="roles">Principal <span className="dot-sep" />HOD<span className="dot-sep" />Admin</p>
                </form>
                {!isLiveMode && <p className="demo">Demo data. Try <code>admin</code>, <code>principal</code> or <code>hod.it</code> with password <code>{DEMO_PASSWORD}</code>.</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="tray" aria-hidden="true"><span className="pen blue" /><span className="pen red" /><span className="pen white" /></div>
      {wipe && <div className="wipe" aria-hidden="true" />}
    </div>
  );
}
