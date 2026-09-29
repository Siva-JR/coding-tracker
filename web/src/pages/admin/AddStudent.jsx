import { useState } from 'react';
import { api } from '../../api/index.js';
import { useScope } from '../../context/Scope.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { Icon } from '../../components/Icons.jsx';
import { batchYearFor } from '../../lib/yearOfStudy.js';
import { parseProfileUrl } from '../../lib/profileUrl.js';
import { checkGithubUrl } from '../../lib/github.js';
import { num } from '../../lib/format.js';
import { ErrorBox, platformName } from './shared.jsx';

const BLANK = { name: '', rollNo: '', deptCode: '', batchYear: '', leetcodeUrl: '', hackerrankUrl: '', githubUrl: '' };

export default function AddStudent() {
  const toast = useToast();
  const { departments } = useScope();
  const [f, setF] = useState(BLANK);
  const [touched, setTouched] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const blur = (k) => () => setTouched({ ...touched, [k]: true });
  const youngest = batchYearFor(1);

  const optionalUrl = (platform, key) => (f[key].trim() ? parseProfileUrl(platform, f[key]).error : null);
  const noUrl = !f.leetcodeUrl.trim() && !f.hackerrankUrl.trim();
  const errs = {
    name: !f.name.trim() && 'Required',
    rollNo: !f.rollNo.trim() && 'Required',
    deptCode: !f.deptCode && 'Choose a department',
    batchYear: !(Number(f.batchYear) >= batchYearFor(4) && Number(f.batchYear) <= youngest) && `Between ${batchYearFor(4)} and ${youngest}`,
    leetcodeUrl: optionalUrl('leetcode', 'leetcodeUrl') || (noUrl && 'Add at least one profile URL'),
    hackerrankUrl: optionalUrl('hackerrank', 'hackerrankUrl'),
    githubUrl: checkGithubUrl(f.githubUrl),
  };
  const valid = Object.values(errs).every((e) => !e);
  const show = (k) => touched[k] && errs[k];

  const submit = async (e) => {
    e.preventDefault();
    setTouched(Object.fromEntries(Object.keys(BLANK).map((k) => [k, true])));
    if (!valid) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await api.admin.addStudent({ ...f, batchYear: Number(f.batchYear) });
      setResult(r); setF(BLANK); setTouched({});
      toast('Student added');
    } catch (err) { setError(err); }
    setBusy(false);
  };

  const field = (k, label, { full, hint, input } = {}) => (
    <div className={`field ${full ? 'full' : ''}`}>
      <label htmlFor={`f-${k}`}>{label}</label>
      <input id={`f-${k}`} className={`input ${show(k) ? 'invalid' : ''}`} value={f[k]} onChange={set(k)} onBlur={blur(k)} aria-invalid={!!show(k)} {...input} />
      {show(k) ? <span className="err-text">{errs[k]}</span> : hint && <span className="hint">{hint}</span>}
    </div>
  );

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-head"><h2><Icon name="plus" /> Add a student</h2></div>
      <ErrorBox err={error} style={{ marginBottom: 14 }} />
      {result && (
        <div className="alert ok" role="status" style={{ marginBottom: 14 }}>
          <Icon name="check" />
          <span>
            {result.student.name} was added and appears on the leaderboard now.{' '}
            {result.accounts.map((a) => (
              <span key={a.platform} style={{ display: 'block' }}>
                {platformName(a.platform)} <b>@{a.username}</b>: {a.verified === 'ok' ? `verified, ${num(a.stats?.solvedTotal)} solved` : 'could not be verified right now; the next scrape will check it'}
              </span>
            ))}
            {result.warnings.map((w, i) => <span key={i} style={{ display: 'block' }}>{w}</span>)}
          </span>
        </div>
      )}
      <div className="form-grid">
        {field('name', 'Full name', { input: { autoComplete: 'off' } })}
        {field('rollNo', 'Reg no', { input: { autoComplete: 'off', placeholder: '111725203001' } })}
        <div className="field">
          <label htmlFor="f-dept">Department</label>
          <select id="f-dept" className={`input ${show('deptCode') ? 'invalid' : ''}`} value={f.deptCode} onChange={set('deptCode')} onBlur={blur('deptCode')}>
            <option value="">Select…</option>
            {departments.map((d) => <option key={d.id} value={d.code}>{d.code} · {d.name}</option>)}
          </select>
          {show('deptCode') && <span className="err-text">{errs.deptCode}</span>}
        </div>
        {field('batchYear', 'Batch (graduation year)', { input: { inputMode: 'numeric', placeholder: String(batchYearFor(3)) }, hint: `${youngest} = 1st year, ${batchYearFor(4)} = 4th year` })}
        {field('leetcodeUrl', 'LeetCode profile URL', { full: true, input: { placeholder: 'https://leetcode.com/u/username', inputMode: 'url' } })}
        {field('hackerrankUrl', 'HackerRank profile URL', { full: true, input: { placeholder: 'https://www.hackerrank.com/profile/username', inputMode: 'url' }, hint: 'At least one of LeetCode or HackerRank is required.' })}
        {field('githubUrl', 'GitHub profile URL', { full: true, input: { placeholder: 'https://github.com/username', inputMode: 'url' } })}
      </div>
      <div style={{ marginTop: 20, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn" disabled={busy}>{busy ? 'Checking profiles…' : 'Validate & add'}</button>
        <span className="hint">Each profile is fetched live before the student is saved.</span>
      </div>
    </form>
  );
}
