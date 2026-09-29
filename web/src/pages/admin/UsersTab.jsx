import { useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../lib/hooks.js';
import { useAuth } from '../../context/Auth.jsx';
import { useScope } from '../../context/Scope.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { Icon } from '../../components/Icons.jsx';
import { ErrorBox, Modal } from './shared.jsx';

const scopeLabel = (s) => `${s.deptCode || 'All departments'} · ${s.year ? `year ${s.year}` : 'all years'}`;
const BLANK = { username: '', displayTitle: '', role: 'viewer', password: '', scopes: [{ deptId: '', year: '' }] };

function ScopeEditor({ scopes, onChange, departments }) {
  const set = (i, k, v) => onChange(scopes.map((s, n) => (n === i ? { ...s, [k]: v } : s)));
  return (
    <div className="field full">
      <span className="lbl">Access</span>
      <div style={{ display: 'grid', gap: 8 }}>
        {scopes.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="input" style={{ height: 40 }} value={s.deptId} onChange={(e) => set(i, 'deptId', e.target.value)} aria-label={`Scope ${i + 1} department`}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
            </select>
            <select className="input" style={{ height: 40, width: 140 }} value={s.year} onChange={(e) => set(i, 'year', e.target.value)} aria-label={`Scope ${i + 1} year`}>
              <option value="">All years</option>
              {[1, 2, 3, 4].map((y) => <option key={y} value={y}>Year {y}</option>)}
            </select>
            <button type="button" className="icon-btn danger" onClick={() => onChange(scopes.filter((_, n) => n !== i))} disabled={scopes.length === 1} aria-label={`Remove scope ${i + 1}`}><Icon name="x" /></button>
          </div>
        ))}
      </div>
      <button type="button" className="link-btn" style={{ justifySelf: 'start', marginTop: 6 }} onClick={() => onChange([...scopes, { deptId: '', year: '' }])}><Icon name="plus" /> Add another scope</button>
      <span className="hint">A viewer sees only what their scopes cover. “Year” is year of study, so it moves up each June.</span>
    </div>
  );
}

const toApiScopes = (role, scopes) => (role === 'admin' ? [] : scopes.map((s) => ({ deptId: s.deptId ? Number(s.deptId) : null, year: s.year ? Number(s.year) : null })));

export default function UsersTab() {
  const toast = useToast();
  const { user: me } = useAuth();
  const { departments } = useScope();
  const { data, error, reload } = useAsync(() => api.admin.users(), []);
  const [form, setForm] = useState(null);      // { mode: 'create'|'edit', id?, ...fields }
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reset, setReset] = useState(null);    // { user, password, result }
  const [shown, setShown] = useState(null);    // { who, value, note }

  const openCreate = () => { setFormError(null); setForm({ mode: 'create', ...BLANK, scopes: [{ deptId: '', year: '' }] }); };
  const openEdit = (u) => {
    setFormError(null);
    setForm({
      mode: 'edit', id: u.id, username: u.username, displayTitle: u.displayTitle || '', role: u.role,
      scopes: u.scopes.length ? u.scopes.map((s) => ({ deptId: s.deptId ?? '', year: s.year ?? '' })) : [{ deptId: '', year: '' }],
    });
  };

  const submit = async () => {
    setSaving(true); setFormError(null);
    try {
      if (form.mode === 'create') {
        const body = { username: form.username.trim(), displayTitle: form.displayTitle.trim() || null, role: form.role, scopes: toApiScopes(form.role, form.scopes) };
        if (form.password) body.password = form.password;
        const r = await api.admin.createUser(body);
        setForm(null);
        setShown({ who: r.user.username, value: r.temporaryPassword, note: 'They will be asked to choose their own password at first sign-in.' });
      } else {
        await api.admin.updateUser(form.id, { displayTitle: form.displayTitle.trim() || null, role: form.role, scopes: toApiScopes(form.role, form.scopes) });
        setForm(null); toast('User updated');
      }
      reload();
    } catch (err) { setFormError(err); }
    setSaving(false);
  };

  const toggle = async (u) => {
    try { await api.admin.updateUser(u.id, { disabled: !u.disabled }); toast(u.disabled ? 'Account enabled' : 'Account disabled and signed out'); reload(); }
    catch (e) { toast(e.message, 'bad'); }
  };

  const doReset = async () => {
    setSaving(true); setFormError(null);
    try {
      const r = await api.admin.resetPassword(reset.user.id, reset.password || undefined);
      setShown({ who: reset.user.username, value: r.temporaryPassword, note: 'They are signed out everywhere and must choose a new password at next sign-in.' });
      setReset(null); reload();
    } catch (err) { setFormError(err); }
    setSaving(false);
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <section className="card">
      <div className="card-head">
        <h2><Icon name="shield" /> Users</h2>
        <button className="btn sm" onClick={openCreate}><Icon name="plus" /> New user</button>
      </div>
      {error && <ErrorBox err={error} />}
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Username</th><th>Title</th><th>Role</th><th>Access</th><th /></tr></thead>
          <tbody>
            {data?.map((u) => (
              <tr key={u.id} style={{ opacity: u.disabled ? 0.55 : 1 }}>
                <td className="name-cell">@{u.username}
                  {u.disabled && <span className="chip bad" style={{ marginLeft: 8 }}>disabled</span>}
                  {u.mustChangePassword && <span className="chip warn" style={{ marginLeft: 8 }}>must change password</span>}
                </td>
                <td>{u.displayTitle || '—'}</td>
                <td><span className={`chip ${u.role === 'admin' ? 'blue' : ''}`}>{u.role === 'admin' ? 'Admin' : 'Viewer'}</span></td>
                <td style={{ maxWidth: 260 }}>{u.role === 'admin' ? 'Everything' : u.scopes.map(scopeLabel).join(', ')}</td>
                <td className="r" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost sm" onClick={() => openEdit(u)}>Edit</button>{' '}
                  <button className="btn ghost sm" onClick={() => { setFormError(null); setReset({ user: u, password: '' }); }}>Reset password</button>{' '}
                  <button className="btn ghost sm" onClick={() => toggle(u)} disabled={u.id === me.id}>{u.disabled ? 'Enable' : 'Disable'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal wide title={form.mode === 'create' ? 'New user' : `Edit @${form.username}`} onClose={() => setForm(null)}
          actions={<><button className="btn ghost" onClick={() => setForm(null)}>Cancel</button><button className="btn" onClick={submit} disabled={saving}>{saving ? 'Saving…' : form.mode === 'create' ? 'Create' : 'Save'}</button></>}>
          <ErrorBox err={formError} style={{ marginTop: 10 }} />
          <div className="form-grid" style={{ marginTop: 14 }}>
            {form.mode === 'create' && <div className="field"><label htmlFor="u-n">Username</label><input id="u-n" className="input" autoCapitalize="none" spellCheck="false" value={form.username} onChange={set('username')} /><span className="hint">3–32 characters: letters, digits, dot, dash, underscore.</span></div>}
            <div className="field"><label htmlFor="u-t">Display title</label><input id="u-t" className="input" placeholder="HOD - IT" value={form.displayTitle} onChange={set('displayTitle')} /></div>
            <div className="field"><label htmlFor="u-r">Role</label>
              <select id="u-r" className="input" value={form.role} onChange={set('role')} disabled={form.mode === 'edit' && form.id === me.id}>
                <option value="viewer">Viewer (read-only, limited to scopes)</option><option value="admin">Admin (everything)</option>
              </select></div>
            {form.mode === 'create' && <div className="field"><label htmlFor="u-p">Password (optional)</label><input id="u-p" className="input" type="text" autoComplete="off" value={form.password} onChange={set('password')} /><span className="hint">Leave empty to generate one.</span></div>}
            {form.role === 'viewer' && <ScopeEditor scopes={form.scopes} departments={departments} onChange={(scopes) => setForm({ ...form, scopes })} />}
          </div>
        </Modal>
      )}

      {reset && (
        <Modal title={`Reset password for @${reset.user.username}`} onClose={() => setReset(null)}
          actions={<><button className="btn ghost" onClick={() => setReset(null)}>Cancel</button><button className="btn" onClick={doReset} disabled={saving}>{saving ? 'Resetting…' : 'Reset password'}</button></>}>
          <ErrorBox err={formError} style={{ marginTop: 10 }} />
          <div className="field" style={{ marginTop: 14 }}><label htmlFor="rp">New password (optional)</label>
            <input id="rp" className="input" type="text" autoComplete="off" value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} />
            <span className="hint">Leave empty to generate one. Any lockout is cleared.</span></div>
        </Modal>
      )}

      {shown && (
        <Modal title={shown.value ? 'Temporary password' : 'Password set'} onClose={() => setShown(null)} actions={<button className="btn" onClick={() => setShown(null)}>Done</button>}>
          {shown.value
            ? <><p style={{ color: 'var(--ink-2)', marginTop: 6 }}>Share this with <b>@{shown.who}</b> now. It is shown only once. {shown.note}</p><div className="temp-pw">{shown.value}</div></>
            : <p style={{ color: 'var(--ink-2)', marginTop: 6 }}>The password you chose is set for <b>@{shown.who}</b>. {shown.note}</p>}
        </Modal>
      )}
    </section>
  );
}
