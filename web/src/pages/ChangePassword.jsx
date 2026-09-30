import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/Auth.jsx';
import { Icon } from '../components/Icons.jsx';
import { Blobs } from '../components/Decor.jsx';
import { Crest, Footer } from '../components/Brand.jsx';
import { niceTitle } from '../lib/format.js';

/** Shown when an admin created or reset the account: a new password is required before anything else. */
export default function ChangePassword() {
  const { user, booting, changePassword, signOut } = useAuth();
  const nav = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (booting) return null;
  if (!user) return <Navigate to="/login" replace />;

  const submit = async (e) => {
    e.preventDefault();
    if (next.length < 8) { setError('Choose a password of at least 8 characters.'); return; }
    if (next !== again) { setError('The two new passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      await changePassword(current, next);
      nav('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Could not change the password.');
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
                <Crest height={96} className="login-crest" />
                <h1>Set a <em>new password</em></h1>
                <p className="tag">Hi {niceTitle(user.displayTitle) || user.username}, an administrator set your current password. Pick your own to continue.</p>
                <form className="card" onSubmit={submit} noValidate>
                  {error && <div className="alert" role="alert"><Icon name="alert" /><span>{error}</span></div>}
                  <div className="field"><label htmlFor="cp-c">Current password</label>
                    <input id="cp-c" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus /></div>
                  <div className="field"><label htmlFor="cp-n">New password</label>
                    <input id="cp-n" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
                    <span className="hint">At least 8 characters, and different from your username and old password.</span></div>
                  <div className="field"><label htmlFor="cp-a">Repeat new password</label>
                    <input id="cp-a" className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></div>
                  <button className="btn" style={{ height: 50, fontSize: 16 }} disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button>
                  <button type="button" className="link-btn" style={{ justifySelf: 'center' }} onClick={() => signOut()}>Sign out</button>
                </form>
              </div>
            </div>
          </div>
          <Footer floating />
        </div>
      </div>
    </div>
  );
}
