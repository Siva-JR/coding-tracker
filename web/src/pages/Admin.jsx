import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api/index.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../context/Auth.jsx';
import { useToast } from '../components/Toasts.jsx';
import SampleBadge from '../components/SampleBadge.jsx';
import { Icon } from '../components/Icons.jsx';
import { Scribble } from '../components/Decor.jsx';
import { CSV_TEMPLATE, rowsFromCsv } from '../lib/csv.js';
import { batchYearFor } from '../lib/yearOfStudy.js';
import { parseProfileUrl } from '../lib/profileUrl.js';
import { num } from '../lib/format.js';

const BLANK = { name: '', rollNo: '', deptCode: '', batchYear: '', leetcodeUrl: '', hackerrankUrl: '' };

function Modal({ title, children, onClose, actions }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}

// ── Add one student ─────────────────────────────────────────────────────
function AddStudent({ depts }) {
  const toast = useToast();
  const [f, setF] = useState(BLANK);
  const [touched, setTouched] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const blur = (k) => () => setTouched({ ...touched, [k]: true });
  const year = batchYearFor(1);

  const errs = {
    name: !f.name.trim() && 'Required',
    rollNo: !f.rollNo.trim() && 'Required',
    deptCode: !f.deptCode && 'Choose a department',
    batchYear: !(Number(f.batchYear) >= batchYearFor(4) && Number(f.batchYear) <= year) && `Between ${batchYearFor(4)} and ${year}`,
    leetcodeUrl: parseProfileUrl('leetcode', f.leetcodeUrl).error,
    hackerrankUrl: parseProfileUrl('hackerrank', f.hackerrankUrl).error,
  };
  const valid = Object.values(errs).every((e) => !e);
  const show = (k) => touched[k] && errs[k];

  const submit = async (e) => {
    e.preventDefault();
    setTouched(Object.fromEntries(Object.keys(BLANK).map((k) => [k, true])));
    if (!valid) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const r = await api.admin.addStudent(f);
      setResult(r); setF(BLANK); setTouched({});
      toast('Student added');
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const field = (k, label, props = {}) => (
    <div className={`field ${props.full ? 'full' : ''}`}>
      <label htmlFor={`f-${k}`}>{label}</label>
      <input id={`f-${k}`} className={`input ${show(k) ? 'invalid' : ''}`} value={f[k]} onChange={set(k)} onBlur={blur(k)} aria-invalid={!!show(k)} {...props.input} />
      {show(k) ? <span className="err-text">{errs[k]}</span> : props.hint && <span className="hint">{props.hint}</span>}
    </div>
  );

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-head"><h2><Icon name="plus" /> Add a student</h2></div>
      {error && <div className="alert" role="alert" style={{ marginBottom: 14 }}><Icon name="alert" /><span>{error}</span></div>}
      {result && (
        <div className="alert ok" role="status" style={{ marginBottom: 14 }}>
          <Icon name="check" />
          <span>Both profiles verified. LeetCode <b>@{result.leetcode.username}</b> has {result.leetcode.solved} solved; HackerRank <b>@{result.hackerrank.username}</b> has {result.hackerrank.solved} solved.</span>
        </div>
      )}
      <div className="form-grid">
        {field('name', 'Full name', { input: { autoComplete: 'off' } })}
        {field('rollNo', 'Roll number', { input: { autoComplete: 'off', placeholder: '24CSE201' } })}
        <div className="field">
          <label htmlFor="f-dept">Department</label>
          <select id="f-dept" className={`input ${show('deptCode') ? 'invalid' : ''}`} value={f.deptCode} onChange={set('deptCode')} onBlur={blur('deptCode')}>
            <option value="">Select…</option>
            {depts?.map((d) => <option key={d.id} value={d.code}>{d.code} · {d.name}</option>)}
          </select>
          {show('deptCode') && <span className="err-text">{errs.deptCode}</span>}
        </div>
        {field('batchYear', 'Batch (graduation year)', { input: { inputMode: 'numeric', placeholder: String(batchYearFor(3)) }, hint: `${batchYearFor(1)} = 1st year, ${batchYearFor(4)} = 4th year` })}
        {field('leetcodeUrl', 'LeetCode profile URL', { full: true, input: { placeholder: 'https://leetcode.com/u/username', inputMode: 'url' } })}
        {field('hackerrankUrl', 'HackerRank profile URL', { full: true, input: { placeholder: 'https://www.hackerrank.com/profile/username', inputMode: 'url' } })}
      </div>
      <div style={{ marginTop: 20, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn" disabled={busy}>{busy ? 'Checking both profiles…' : 'Validate & add'}</button>
        <span className="hint">Both profiles are fetched live before the student is saved.</span>
      </div>
    </form>
  );
}

// ── CSV import ──────────────────────────────────────────────────────────
function ImportCsv({ depts }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [over, setOver] = useState(false);
  const [rows, setRows] = useState([]);           // input rows
  const [results, setResults] = useState({});     // key -> validation result
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [problem, setProblem] = useState('');
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState(null);

  const validate = useCallback(async (list) => {
    setChecking(true); setProgress(0);
    try {
      for (let i = 0; i < list.length; i += 10) {           // ≤10 rows per call
        const chunk = list.slice(i, i + 10);
        const res = await api.admin.validate(chunk);
        setResults((r) => ({ ...r, ...Object.fromEntries(chunk.map((row, n) => [row.key, res[n]])) }));
        setProgress(Math.min(list.length, i + 10));
      }
    } catch (err) { setProblem(err.message); }
    setChecking(false);
  }, []);

  const load = async (file) => {
    setProblem(''); setSummary(null); setResults({});
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) { setProblem('Please choose a .csv file.'); return; }
    const { rows: parsed, missing } = rowsFromCsv(await file.text());
    if (missing.length) { setProblem(`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Download the template to see the expected header.`); setRows([]); return; }
    if (!parsed.length) { setProblem('No student rows found.'); return; }
    setRows(parsed);
    validate(parsed);
  };

  const editCell = (key, field, value) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const recheck = (row) => { setResults((r) => { const n = { ...r }; delete n[row.key]; return n; }); validate([row]); };
  const dropRow = (key) => setRows((rs) => rs.filter((r) => r.key !== key));

  const good = rows.filter((r) => results[r.key]?.ok);
  const bad = rows.filter((r) => results[r.key] && !results[r.key].ok);

  const doImport = async () => {
    setImporting(true);
    try {
      const out = await api.admin.importRows(good.map((row) => ({ row, result: results[row.key] })));
      setSummary(out);
      setRows((rs) => rs.filter((r) => !results[r.key]?.ok));
      toast(`${out.created} students imported`);
    } catch (err) { setProblem(err.message); }
    setImporting(false);
  };

  const template = () => {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'students-template.csv' });
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2><Icon name="upload" /> Import from CSV</h2>
        <button className="btn ghost sm" onClick={template}><Icon name="download" /> Template</button>
      </div>
      <div
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]); }}
      >
        <Icon name="file" />
        <p>Drop a CSV here with <b>name, roll_no, department, batch, leetcode_url, hackerrank_url</b></p>
        <button className="btn" onClick={() => fileRef.current.click()} disabled={checking}>Choose file</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { load(e.target.files[0]); e.target.value = ''; }} />
      </div>
      {problem && <div className="alert" role="alert" style={{ marginTop: 14 }}><Icon name="alert" /><span>{problem}</span></div>}
      {summary && (
        <div className="alert ok" role="status" style={{ marginTop: 14 }}>
          <Icon name="check" /><span>{summary.created} imported{summary.skipped.length > 0 && `, ${summary.skipped.length} skipped (${summary.skipped.map((s) => `${s.rollNo}: ${s.reason}`).join('; ')})`}.</span>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
            <b>{checking ? `Checking profiles live… ${progress}/${rows.length}` : `${good.length} ready · ${bad.length} need fixing`}</b>
            <div className="spacer" />
            <button className="btn" onClick={doImport} disabled={checking || importing || good.length === 0}>
              {importing ? 'Importing…' : `Import ${good.length} valid row${good.length === 1 ? '' : 's'}`}
            </button>
          </div>
          {checking && <div className="progress" style={{ marginBottom: 12 }} role="progressbar" aria-valuenow={progress} aria-valuemax={rows.length}><i style={{ width: `${(progress / rows.length) * 100}%` }} /></div>}
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Result</th><th>Student</th><th>Dept · Batch</th><th>LeetCode</th><th>HackerRank</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const res = results[r.key];
                  return (
                    <tr key={r.key}>
                      <td style={{ minWidth: 150 }}>
                        {!res ? <span className="chip">{checking ? 'Waiting…' : 'Not checked'}</span>
                          : res.ok ? <span className="chip ok"><Icon name="check" size={13} /> OK</span>
                          : <span className="chip bad">Fix needed</span>}
                        {res?.errors.map((e, i) => <span className="row-err" key={i}>{e}</span>)}
                      </td>
                      <td className="name-cell">{r.name || '—'}<small>{r.rollNo}</small></td>
                      <td>{r.deptCode} · {r.batchYear}</td>
                      {['leetcodeUrl', 'hackerrankUrl'].map((k) => {
                        const p = k === 'leetcodeUrl' ? res?.leetcode : res?.hackerrank;
                        return (
                          <td key={k}>
                            {res && !res.ok ? (
                              <input className={`cell-input ${parseProfileUrl(k === 'leetcodeUrl' ? 'leetcode' : 'hackerrank', r[k]).error ? 'invalid' : ''}`} value={r[k]} onChange={(e) => editCell(r.key, k, e.target.value)} aria-label={k === 'leetcodeUrl' ? 'LeetCode URL' : 'HackerRank URL'} />
                            ) : p ? <span className="num">@{p.username} · <b>{num(p.solved)}</b> solved</span> : <span className="hint">—</span>}
                          </td>
                        );
                      })}
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        {res && !res.ok && <button className="btn sm ghost" onClick={() => recheck(r)} disabled={checking}><Icon name="refresh" /> Re-check</button>}
                        <button className="icon-btn danger" onClick={() => dropRow(r.key)} aria-label={`Remove ${r.name || 'row'}`}><Icon name="x" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Students list: edit / delete ────────────────────────────────────────
function Students({ depts }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  const { data, loading, reload } = useAsync(() => api.students({ q: dq, page, pageSize: 12 }), [dq, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const save = async () => {
    try { await api.admin.updateStudent(editing.id, editing); toast('Saved'); setEditing(null); reload(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  const del = async () => {
    try { await api.admin.deleteStudent(deleting.id); toast(`${deleting.name} deleted`); setDeleting(null); reload(); }
    catch (e) { toast(e.message, 'bad'); }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2><Icon name="users" /> All students {data && <span className="chip">{data.total}</span>}</h2>
        <div className="input-wrap" style={{ width: 260 }}>
          <Icon name="search" />
          <input className="input" style={{ height: 40 }} placeholder="Search name or roll no" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search students" />
        </div>
      </div>
      <div className="table-wrap" style={{ opacity: loading ? 0.55 : 1 }}>
        <table className="t">
          <thead><tr><th>Student</th><th>Dept</th><th>Year</th><th>LeetCode</th><th>HackerRank</th><th /></tr></thead>
          <tbody>
            {data?.items.map((s) => (
              <tr key={s.id}>
                <td className="name-cell">{s.name}<small>{s.rollNo}</small></td>
                <td>{s.deptCode}</td><td>{s.yearOfStudy}</td>
                <td className="num">{s.leetcode.status === 'not_found' ? <span className="chip bad">not found</span> : num(s.leetcode.total)}</td>
                <td className="num">{s.hackerrank.status === 'not_found' ? <span className="chip bad">not found</span> : num(s.hackerrank.total)}</td>
                <td className="r" style={{ whiteSpace: 'nowrap' }}>
                  <button className="icon-btn" onClick={() => setEditing({ id: s.id, name: s.name, deptId: s.deptId, batchYear: s.batchYear })} aria-label={`Edit ${s.name}`}><Icon name="edit" /></button>
                  <button className="icon-btn danger" onClick={() => setDeleting(s)} aria-label={`Delete ${s.name}`}><Icon name="trash" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <div className="empty">No students match “{dq}”.</div>}
      </div>
      <div className="controls" style={{ marginTop: 12, marginBottom: 0 }}>
        <span className="hint">Page {page} of {pages}</span><div className="spacer" />
        <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <button className="btn ghost sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </div>
      {editing && (
        <Modal title="Edit student" onClose={() => setEditing(null)} actions={<><button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button><button className="btn" onClick={save}>Save</button></>}>
          <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
            <div className="field"><label htmlFor="e-n">Name</label><input id="e-n" className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="e-d">Department</label>
              <select id="e-d" className="input" value={editing.deptId} onChange={(e) => setEditing({ ...editing, deptId: e.target.value })}>{depts?.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</select></div>
            <div className="field"><label htmlFor="e-b">Batch</label><input id="e-b" className="input" inputMode="numeric" value={editing.batchYear} onChange={(e) => setEditing({ ...editing, batchYear: e.target.value })} /></div>
          </div>
        </Modal>
      )}
      {deleting && (
        <Modal title="Delete student?" onClose={() => setDeleting(null)} actions={<><button className="btn ghost" onClick={() => setDeleting(null)}>Cancel</button><button className="btn danger" onClick={del}>Delete</button></>}>
          <p style={{ color: 'var(--ink-2)', marginTop: 8 }}><b>{deleting.name}</b> ({deleting.rollNo}) and all of their history will be removed. This can't be undone.</p>
        </Modal>
      )}
    </section>
  );
}

// ── Staff accounts ──────────────────────────────────────────────────────
function Staff({ depts }) {
  const toast = useToast();
  const { user } = useAuth();
  const { data, reload } = useAsync(() => api.admin.staff(), []);
  const [pw, setPw] = useState(null);
  const [creating, setCreating] = useState(null);
  const [err, setErr] = useState('');

  const reset = async (s) => {
    try { const r = await api.admin.resetPassword(s.id); setPw({ who: s.username, value: r.tempPassword }); }
    catch (e) { toast(e.message, 'bad'); }
  };
  const toggle = async (s) => {
    try { await api.admin.setStaffDisabled(s.id, !s.disabled); reload(); toast(s.disabled ? 'Account enabled' : 'Account disabled'); }
    catch (e) { toast(e.message, 'bad'); }
  };
  const create = async () => {
    setErr('');
    try { const r = await api.admin.createStaff(creating); setCreating(null); setPw({ who: r.user.username, value: r.tempPassword }); reload(); }
    catch (e) { setErr(e.message); }
  };
  const roleLabel = { admin: 'Admin', institute: 'Institute', hod: 'HOD' };

  return (
    <section className="card">
      <div className="card-head">
        <h2><Icon name="shield" /> Staff accounts</h2>
        <button className="btn sm" onClick={() => setCreating({ username: '', role: 'hod', deptId: '', displayTitle: '' })}><Icon name="plus" /> New account</button>
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Username</th><th>Title</th><th>Role</th><th>Department</th><th /></tr></thead>
          <tbody>
            {data?.map((s) => (
              <tr key={s.id} style={{ opacity: s.disabled ? 0.55 : 1 }}>
                <td className="name-cell">@{s.username}{s.disabled && <span className="chip bad" style={{ marginLeft: 8 }}>disabled</span>}</td>
                <td>{s.displayTitle}</td>
                <td><span className={`chip ${s.role === 'admin' ? 'blue' : ''}`}>{roleLabel[s.role]}</span></td>
                <td>{s.deptName || '—'}</td>
                <td className="r" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost sm" onClick={() => reset(s)}>Reset password</button>{' '}
                  <button className="btn ghost sm" onClick={() => toggle(s)} disabled={s.id === user.id}>{s.disabled ? 'Enable' : 'Disable'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pw && (
        <Modal title="Temporary password" onClose={() => setPw(null)} actions={<button className="btn" onClick={() => setPw(null)}>Done</button>}>
          <p style={{ color: 'var(--ink-2)', marginTop: 6 }}>Share this with <b>@{pw.who}</b> now. It is shown only once, and old sessions are signed out.</p>
          <div className="temp-pw">{pw.value}</div>
        </Modal>
      )}
      {creating && (
        <Modal title="New staff account" onClose={() => setCreating(null)} actions={<><button className="btn ghost" onClick={() => setCreating(null)}>Cancel</button><button className="btn" onClick={create}>Create</button></>}>
          {err && <div className="alert" role="alert" style={{ marginTop: 10 }}><Icon name="alert" /><span>{err}</span></div>}
          <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
            <div className="field"><label htmlFor="s-u">Username</label><input id="s-u" className="input" autoCapitalize="none" value={creating.username} onChange={(e) => setCreating({ ...creating, username: e.target.value })} /></div>
            <div className="field"><label htmlFor="s-t">Display title</label><input id="s-t" className="input" placeholder="HOD, CSE" value={creating.displayTitle} onChange={(e) => setCreating({ ...creating, displayTitle: e.target.value })} /></div>
            <div className="field"><label htmlFor="s-r">Role</label>
              <select id="s-r" className="input" value={creating.role} onChange={(e) => setCreating({ ...creating, role: e.target.value })}>
                <option value="hod">HOD (own department, read-only)</option><option value="institute">Institute (all departments, read-only)</option><option value="admin">Admin</option>
              </select></div>
            {creating.role === 'hod' && (
              <div className="field"><label htmlFor="s-d">Department</label>
                <select id="s-d" className="input" value={creating.deptId} onChange={(e) => setCreating({ ...creating, deptId: e.target.value })}>
                  <option value="">Select…</option>{depts?.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
                </select></div>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}

const TABS = [['add', 'Add student'], ['import', 'Import CSV'], ['students', 'Students'], ['staff', 'Staff']];

export default function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState('add');
  const depts = useAsync(() => api.departments(), []);
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Admin</h1>
          <Scribble width={140} />
          <p className="sub">Manage students and staff accounts.</p>
          <div style={{ marginTop: 8 }}><SampleBadge feature="admin" /></div>
        </div>
      </header>
      <div className="controls">
        <div className="seg" role="tablist" aria-label="Admin sections">
          {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </div>
      </div>
      {tab === 'add' && <AddStudent depts={depts.data} />}
      {tab === 'import' && <ImportCsv depts={depts.data} />}
      {tab === 'students' && <Students depts={depts.data} />}
      {tab === 'staff' && <Staff depts={depts.data} />}
    </>
  );
}
