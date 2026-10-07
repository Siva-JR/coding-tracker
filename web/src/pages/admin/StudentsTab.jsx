import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../lib/hooks.js';
import { useScope } from '../../context/Scope.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { Icon } from '../../components/Icons.jsx';
import { parseProfileUrl } from '../../lib/profileUrl.js';
import { checkGithubUrl, githubHandle } from '../../lib/github.js';
import { shortDate } from '../../lib/format.js';
import { romanYear } from '../../lib/yearOfStudy.js';
import { ErrorBox, Modal, platformName } from './shared.jsx';
import RefreshAll from './RefreshAll.jsx';

function AccountCell({ account }) {
  if (!account) return <span className="hint">not linked</span>;
  return (
    <div>
      <a href={account.profileUrl} target="_blank" rel="noreferrer noopener" style={{ fontWeight: 600 }}>@{account.username}</a>
      <div style={{ marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {account.state === 'broken'
          ? <span className="chip bad" title={account.lastError || ''}>profile not found</span>
          : account.lastOkAt
            ? <span className="chip ok">updated {shortDate(account.lastOkAt.slice(0, 10))}</span>
            : <span className="chip">waiting for first scrape</span>}
      </div>
    </div>
  );
}

const urlOf = (student, platform) => student.accounts.find((a) => a.platform === platform)?.profileUrl ?? '';

export default function StudentsTab() {
  const toast = useToast();
  const { departments } = useScope();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [deptId, setDeptId] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);   // { original, form }
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(null);         // id being refreshed
  const [saveError, setSaveError] = useState(null);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);

  const { data, loading, error, reload } = useAsync(() => api.admin.students({ q: dq, deptId, page, pageSize: 12 }), [dq, deptId, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const openEdit = (s) => {
    setSaveError(null);
    setEditing({ original: s, form: { name: s.name, rollNo: s.rollNo, deptId: String(s.deptId), batchYear: String(s.batchYear), leetcodeUrl: urlOf(s, 'leetcode'), hackerrankUrl: urlOf(s, 'hackerrank'), githubUrl: s.githubUrl || '' } });
  };

  const save = async () => {
    const { original: o, form: f } = editing;
    const patch = {};
    if (f.name.trim() !== o.name) patch.name = f.name.trim();
    if (f.rollNo.trim() !== o.rollNo) patch.rollNo = f.rollNo.trim();
    if (Number(f.deptId) !== o.deptId) patch.deptId = Number(f.deptId);
    if (Number(f.batchYear) !== o.batchYear) patch.batchYear = Number(f.batchYear);
    for (const [platform, key] of [['leetcode', 'leetcodeUrl'], ['hackerrank', 'hackerrankUrl']]) {
      const before = urlOf(o, platform);
      const now = f[key].trim();
      if (now === before) continue;
      if (now && parseProfileUrl(platform, now).error) { setSaveError([`${platformName(platform)}: ${parseProfileUrl(platform, now).error}`]); return; }
      patch[key] = now; // an empty string removes the profile
    }
    const gh = f.githubUrl.trim();
    if (gh !== (o.githubUrl || '')) {
      const bad = checkGithubUrl(gh);
      if (bad) { setSaveError([`GitHub: ${bad}`]); return; }
      patch.githubUrl = gh; // an empty string removes the link
    }
    if (!Object.keys(patch).length) { setEditing(null); return; }
    setBusy('save'); setSaveError(null);
    try {
      const r = await api.admin.updateStudent(o.id, patch);
      toast(r.warnings?.length ? `Saved. ${r.warnings[0]}` : 'Saved');
      setEditing(null); reload();
    } catch (err) { setSaveError(err); }
    setBusy(null);
  };

  const del = async () => {
    try { await api.admin.deleteStudent(deleting.id); toast(`${deleting.name} deleted`); setDeleting(null); reload(); }
    catch (e) { toast(e.message, 'bad'); }
  };

  const refresh = async (s) => {
    setBusy(s.id);
    try {
      const r = await api.admin.refreshStudent(s.id);
      const bits = r.results.map((x) => `${platformName(x.platform)}: ${x.status === 'ok' ? 'updated' : x.status === 'not_found' ? 'not found' : 'try again later'}`);
      toast(bits.join(' · ') || 'Nothing to refresh');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(null);
  };

  const set = (k) => (e) => setEditing({ ...editing, form: { ...editing.form, [k]: e.target.value } });

  return (
    <section className="card">
      <div className="card-head">
        <h2><Icon name="users" /> All students {data && <span className="chip">{data.total}</span>}</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <RefreshAll onDone={reload} />
          <select className="input" style={{ width: 'auto', height: 40 }} value={deptId} onChange={(e) => { setDeptId(e.target.value); setPage(1); }} aria-label="Filter by department">
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
          </select>
          <div className="input-wrap" style={{ width: 240 }}>
            <Icon name="search" />
            <input className="input" style={{ height: 40 }} placeholder="Search name or reg no" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search students" />
          </div>
        </div>
      </div>
      {error && <ErrorBox err={error} style={{ marginBottom: 10 }} />}
      <div className="table-wrap" style={{ opacity: loading && data ? 0.55 : 1 }}>
        <table className="t">
          <thead><tr><th>Student</th><th>Dept</th><th>Year</th><th>LeetCode</th><th>HackerRank</th><th>GitHub</th><th /></tr></thead>
          <tbody>
            {data?.items.map((s) => (
              <tr key={s.id}>
                <td className="name-cell">{s.name}<small>{s.rollNo}</small></td>
                <td>{s.deptCode}</td>
                <td>{romanYear(s.yearOfStudy)}</td>
                <td><AccountCell account={s.accounts.find((a) => a.platform === 'leetcode')} /></td>
                <td><AccountCell account={s.accounts.find((a) => a.platform === 'hackerrank')} /></td>
                <td>{s.githubUrl ? <a href={s.githubUrl} target="_blank" rel="noreferrer noopener" style={{ fontWeight: 600 }}>{githubHandle(s.githubUrl) || 'link'}</a> : <span className="hint">—</span>}</td>
                <td className="r" style={{ whiteSpace: 'nowrap' }}>
                  <button className="icon-btn" onClick={() => refresh(s)} disabled={busy === s.id} aria-label={`Refresh ${s.name} now`} title="Fetch the latest numbers now"><Icon name="refresh" /></button>
                  <button className="icon-btn" onClick={() => openEdit(s)} aria-label={`Edit ${s.name}`}><Icon name="edit" /></button>
                  <button className="icon-btn danger" onClick={() => setDeleting(s)} aria-label={`Delete ${s.name}`}><Icon name="trash" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && !data && <div className="skeleton" style={{ height: 240 }} />}
        {data && data.items.length === 0 && <div className="empty"><span className="hand">No students</span>{dq ? `Nothing matches “${dq}”.` : 'Add one or import an Excel file.'}</div>}
      </div>
      <div className="controls" style={{ marginTop: 12, marginBottom: 0 }}>
        <span className="hint">Page {page} of {pages}</span><div className="spacer" />
        <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <button className="btn ghost sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </div>

      {editing && (
        <Modal wide title="Edit student" onClose={() => setEditing(null)} actions={<><button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button><button className="btn" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? 'Checking profiles…' : 'Save'}</button></>}>
          <ErrorBox err={saveError} style={{ marginTop: 10 }} />
          <div className="form-grid" style={{ marginTop: 14 }}>
            <div className="field"><label htmlFor="e-n">Name</label><input id="e-n" className="input" value={editing.form.name} onChange={set('name')} /></div>
            <div className="field"><label htmlFor="e-r">Reg no</label><input id="e-r" className="input" value={editing.form.rollNo} onChange={set('rollNo')} /></div>
            <div className="field"><label htmlFor="e-d">Department</label>
              <select id="e-d" className="input" value={editing.form.deptId} onChange={set('deptId')}>{departments.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</select></div>
            <div className="field"><label htmlFor="e-b">Batch</label><input id="e-b" className="input" inputMode="numeric" value={editing.form.batchYear} onChange={set('batchYear')} /></div>
            <div className="field full"><label htmlFor="e-l">LeetCode URL</label><input id="e-l" className="input" value={editing.form.leetcodeUrl} onChange={set('leetcodeUrl')} placeholder="(none)" /></div>
            <div className="field full"><label htmlFor="e-h">HackerRank URL</label><input id="e-h" className="input" value={editing.form.hackerrankUrl} onChange={set('hackerrankUrl')} placeholder="(none)" />
              <span className="hint">Changing a URL re-checks the profile and clears the old profile’s history. Empty removes it (a student keeps at least one).</span></div>
            <div className="field full"><label htmlFor="e-g">GitHub URL</label><input id="e-g" className="input" value={editing.form.githubUrl} onChange={set('githubUrl')} placeholder="(none)" /></div>
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
