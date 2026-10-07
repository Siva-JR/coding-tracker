import { useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useScope } from '../../context/Scope.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { Icon } from '../../components/Icons.jsx';
import ScrapeProgress from '../../components/ScrapeProgress.jsx';
import { readWorkbook } from '../../lib/xlsx.js';
import { FIELD_LABELS, applyDefaults, studentsFromSheet } from '../../lib/sheet.js';
import { downloadXlsx, problemsWorkbook, templateWorkbook } from '../../lib/xlsxWrite.js';
import { newTally } from '../../lib/scrape.js';
import { allStudents } from '../../lib/students.js';
import { describePatch, planForExisting } from '../../lib/existing.js';
import { parseProfileUrl } from '../../lib/profileUrl.js';
import { checkGithubUrl, githubHandle } from '../../lib/github.js';
import { batchYearFor, yearBatchLabel, yearLabel } from '../../lib/yearOfStudy.js';
import { num } from '../../lib/format.js';
import { ErrorBox, platformName } from './shared.jsx';

const RETRIES = 3;
const STOP_AFTER_UNREACHABLE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTransient = (err) => err?.status === 0 || err?.status === 408 || err?.status >= 500;

// Checks that need no network: a row that fails any of them is not sent.
function localErrors(row, { deptCodes, seenRegNos }) {
  const errors = [];
  if (!row.name.trim()) errors.push('name is missing');
  if (!row.rollNo.trim()) errors.push('reg no is missing');
  else if (seenRegNos.get(row.rollNo.trim().toLowerCase()) > 1) errors.push(`reg no ${row.rollNo} appears more than once in this file`);
  if (!deptCodes.has(row.deptCode.toUpperCase())) errors.push(row.deptCode ? `unknown department “${row.deptCode}”` : 'department is missing');
  const batch = Number(row.batchYear);
  if (!Number.isInteger(batch) || batch < 2000 || batch > 2100) errors.push('batch should be a year like 2029');
  const lc = row.leetcodeUrl.trim();
  const hr = row.hackerrankUrl.trim();
  const lcBad = lc && parseProfileUrl('leetcode', lc).error;
  const hrBad = hr && parseProfileUrl('hackerrank', hr).error;
  if (lcBad) errors.push(`LeetCode: ${lcBad}`);
  if (hrBad) errors.push(`HackerRank: ${hrBad}`);
  if (!lc && !hr) errors.push('needs a LeetCode or HackerRank profile link');
  return errors;
}

// How the server's answer for one student reads in the table.
function outcomeOf(res) {
  const stats = res.accounts?.filter((a) => a.verified === 'ok').map((a) => ({ platform: a.platform, solved: a.stats?.solvedTotal })) ?? [];
  const unverified = res.accounts?.some((a) => a.verified !== 'ok');
  return { phase: unverified ? 'unverified' : 'done', stats, warnings: res.warnings ?? [] };
}

export default function ImportStudents() {
  const toast = useToast();
  const { departments } = useScope();
  const fileRef = useRef(null);
  const stopRef = useRef(false);
  const [over, setOver] = useState(false);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState({});        // row.key -> { phase, errors, warnings, stats }
  const [setup, setSetup] = useState(null);        // spreadsheet waiting for a department / year choice
  const [readInfo, setReadInfo] = useState('');
  const [problem, setProblem] = useState(null);
  const [run, setRun] = useState(null);
  const [running, setRunning] = useState(false);
  const [runDone, setRunDone] = useState(false);
  const [existing, setExisting] = useState(new Map());   // lower-case reg no -> student already in the system
  const [checkingExisting, setCheckingExisting] = useState(false);

  const deptCodes = useMemo(() => new Set(departments.map((d) => d.code.toUpperCase())), [departments]);
  const seenRegNos = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => { const k = r.rollNo.trim().toLowerCase(); if (k) m.set(k, (m.get(k) || 0) + 1); });
    return m;
  }, [rows]);

  // Everything the table needs to know about a row. A student who is already in the system is not a problem:
  // they are "already added", or they get a missing link filled in, and only an improper link is flagged.
  const view = rows.map((r, index) => {
    const st = status[r.key];
    const known = existing.get(r.rollNo.trim().toLowerCase());
    const plan = known ? planForExisting(r, known) : null;
    const errors = st?.phase === 'failed' || st?.phase === 'skipped' ? st.errors : (st ? [] : plan ? plan.errors : localErrors(r, { deptCodes, seenRegNos }));
    const phase = st?.phase ?? (plan ? plan.phase : errors.length ? 'fix' : 'ready');
    return { row: r, index, phase, errors, st, known, plan };
  });
  // Problems first, then anything not saved yet, then the students that went in fine or were already there.
  const rank = { fix: 0, failed: 0, skipped: 0, incomplete: 1, unverified: 1, working: 2, update: 3, ready: 3, exists: 4, updated: 4, done: 4 };
  const sorted = [...view].sort((a, b) => rank[a.phase] - rank[b.phase] || a.index - b.index);
  const toSend = view.filter((v) => v.phase === 'ready' || v.phase === 'update');
  const flagged = view.filter((v) => ['fix', 'failed', 'skipped', 'unverified'].includes(v.phase) || v.phase === 'incomplete' || (v.row.notes?.length && !['exists', 'update', 'updated'].includes(v.phase)));

  // ── reading the file ────────────────────────────────────────────────
  const normDept = (v) => {
    const t = (v || '').trim();
    const d = departments.find((x) => x.code.toLowerCase() === t.toLowerCase() || x.name.toLowerCase() === t.toLowerCase());
    return d ? d.code : t.toUpperCase();
  };

  const begin = (parsed, info) => {
    setRows(parsed.map((r) => ({ ...r, deptCode: normDept(r.deptCode) })));
    setStatus({}); setReadInfo(info); setSetup(null); setRun(null); setRunDone(false);
    loadExisting();
  };

  // Who is already in the system, so those rows are not treated as new students.
  const loadExisting = async () => {
    setCheckingExisting(true);
    try {
      const all = await allStudents();
      setExisting(new Map(all.map((st) => [st.rollNo.trim().toLowerCase(), st])));
    } catch {
      setExisting(new Map());   // the server still refuses a duplicate, and that is shown as "already added" too
    }
    setCheckingExisting(false);
  };
  const describe = (res, sheetName) => `Read ${res.rows.length} students from “${sheetName}” (header on row ${res.headerRow}). Matched: ${Object.entries(res.columns).map(([f, h]) => `${FIELD_LABELS[f]} ← ${h}`).join(' · ')}.`;
  const describeColumns = (res) => `Matched: ${Object.entries(res.columns).map(([f, h]) => `${FIELD_LABELS[f]} ← ${h}`).join(' · ')}`;

  const chooseSheet = (found, idx) => {
    const { name, res } = found[idx];
    if (!res.rows.length) { setProblem(`“${name}” has a header but no students below it.`); return; }
    const needDept = res.missing.includes('deptCode');
    const needBatch = res.missing.includes('batchYear');
    if (!needDept && !needBatch) { begin(res.rows, describe(res, name)); return; }
    setSetup({
      found, idx, needDept, needBatch,
      deptCode: res.hints.deptCode || (departments.length === 1 ? departments[0].code : ''),
      year: res.hints.yearOfStudy ? String(res.hints.yearOfStudy) : '',
      guessed: !!(res.hints.deptCode || res.hints.yearOfStudy),
    });
  };

  const continueSetup = () => {
    const { found, idx, deptCode, year } = setup;
    const { name, res } = found[idx];
    const missing = [setup.needDept && 'department', setup.needBatch && 'batch'].filter(Boolean).join(' or ');
    const used = [setup.needDept && `department ${deptCode}`, setup.needBatch && `batch ${batchYearFor(Number(year))} (${yearLabel(Number(year))})`].filter(Boolean).join(' and ');
    begin(applyDefaults(res.rows, { deptCode, yearOfStudy: year }), `${describe(res, name)} The sheet has no ${missing} column, so every row uses ${used}.`);
  };

  const load = async (file) => {
    setProblem(null); setRows([]); setStatus({}); setSetup(null); setReadInfo(''); setRun(null); setRunDone(false);
    if (!file) return;
    if (/\.csv$/i.test(file.name)) { setProblem('Please upload an Excel file (.xlsx). CSV files lose the links behind cells like “LeetCode”. In Google Sheets use File → Download → Microsoft Excel (.xlsx).'); return; }
    if (!/\.xlsx$/i.test(file.name)) { setProblem('Please upload an Excel file (.xlsx). In Google Sheets use File → Download → Microsoft Excel (.xlsx).'); return; }
    let sheets;
    try { sheets = readWorkbook(await file.arrayBuffer()); } catch (err) { setProblem(err.message); return; }
    const found = sheets.map((sh) => ({ name: sh.name, res: studentsFromSheet(sh.rows, { departments }) })).filter((x) => !x.res.error);
    if (!found.length) { setProblem(studentsFromSheet(sheets[0].rows).error || 'No student sheet found in this file.'); return; }
    chooseSheet(found, 0);
  };

  // ── editing a row that needs a fix ──────────────────────────────────
  const editCell = (key, field, value) => {
    setRows((rs) => rs.map((r) => {
      if (r.key !== key) return r;
      const platform = field === 'leetcodeUrl' ? 'leetcode' : field === 'hackerrankUrl' ? 'hackerrank' : null;
      return { ...r, [field]: value, notes: platform ? (r.notes || []).filter((n) => n.platform !== platform) : r.notes };
    }));
    setStatus((s) => { const n = { ...s }; if (n[key]?.phase === 'failed' || n[key]?.phase === 'skipped') delete n[key]; return n; }); // edited: try again
  };
  const dropRow = (key) => { setRows((rs) => rs.filter((r) => r.key !== key)); setStatus((s) => { const n = { ...s }; delete n[key]; return n; }); };

  // ── importing: one student at a time, each fetched once as it is saved ─
  const saveOne = async (v) => {
    const { row } = v;
    // A student already in the system only gets the missing link(s) added.
    if (v.known && v.plan?.phase === 'update') {
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await api.admin.updateStudent(v.known.id, v.plan.patch);
          return { phase: 'updated', warnings: res.warnings ?? [], added: describePatch(v.plan.patch) };
        } catch (err) {
          if (isTransient(err) && attempt < RETRIES) { await sleep(1500 * (attempt + 1)); continue; }
          if (isTransient(err)) return { phase: 'unreachable', errors: ['could not reach the server'] };
          const list = Array.isArray(err.details?.errors) && err.details.errors.length ? err.details.errors : [err.message];
          return { phase: 'failed', errors: list, notFound: list.some((e) => /was not found/i.test(e)) };
        }
      }
    }

    let githubUrl = row.githubUrl;
    const warnings = [];
    if (githubUrl && checkGithubUrl(githubUrl)) { warnings.push('The GitHub link was not usable, so it was left out.'); githubUrl = ''; }
    const body = { name: row.name.trim(), rollNo: row.rollNo.trim(), deptCode: row.deptCode, batchYear: Number(row.batchYear), leetcodeUrl: row.leetcodeUrl.trim(), hackerrankUrl: row.hackerrankUrl.trim(), githubUrl };
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await api.admin.addStudent(body);
        const o = outcomeOf(res);
        return { ...o, warnings: [...warnings, ...o.warnings] };
      } catch (err) {
        if (isTransient(err) && attempt < RETRIES) { await sleep(1500 * (attempt + 1)); continue; }
        if (isTransient(err)) return { phase: 'unreachable', errors: ['could not reach the server'] };
        // The reg no is already taken: that student is already added, which is not a problem.
        if (err.status === 409 || err.code === 'ROLL_NUMBER_EXISTS') return { phase: 'exists', errors: [] };
        const list = Array.isArray(err.details?.errors) && err.details.errors.length ? err.details.errors : [err.message];
        return { phase: 'failed', errors: list, notFound: list.some((e) => /was not found/i.test(e)) };
      }
    }
  };

  const importRows = async (targets) => {
    if (!targets.length) return;
    stopRef.current = false; setProblem(null); setRunDone(false); setRunning(true);
    const t = newTally(targets.length);
    setRun({ ...t });
    let unreachable = 0;
    for (const v of targets) {
      if (stopRef.current) { t.stopped = true; break; }
      t.current = v.row.name;
      setStatus((s) => ({ ...s, [v.row.key]: { phase: 'working', errors: [] } }));
      setRun({ ...t });
      const out = await saveOne(v);
      t.done++;
      if (out.phase === 'unreachable') {
        unreachable++; t.failed++;
        setStatus((s) => { const n = { ...s }; delete n[v.row.key]; return n; }); // still to do; try again later
        if (unreachable >= STOP_AFTER_UNREACHABLE) { t.aborted = true; setRun({ ...t }); break; }
        await sleep(3000);
      } else {
        unreachable = 0;
        if (out.phase === 'done' || out.phase === 'updated') t.fetched++;
        else if (out.phase === 'exists') t.skipped++;
        else if (out.phase === 'unverified') t.failed++;
        else if (out.notFound) t.notFound++;
        else t.skipped++;
        setStatus((s) => ({ ...s, [v.row.key]: out }));
      }
      setRun({ ...t });
    }
    t.current = '';
    setRun({ ...t }); setRunDone(true); setRunning(false);
    if (t.fetched) toast(`${t.fetched} student${t.fetched === 1 ? '' : 's'} saved`);
  };

  const downloadProblems = () => {
    const lines = flagged.map((v) => {
      const r = v.row;
      const problems = [...(r.notes || []).map((n) => n.text), ...(v.phase === 'incomplete' ? [`Already added. ${v.plan.missingText}`] : []), ...v.errors, ...(v.st?.warnings || [])];
      return [r.name, r.rollNo, r.deptCode, r.batchYear, r.leetcodeUrl, r.hackerrankUrl, r.githubUrl || '', problems.join(' | ')];
    });
    downloadXlsx('students-needing-attention.xlsx', problemsWorkbook(lines));
  };

  // ── rendering ───────────────────────────────────────────────────────
  const linkCell = (v, platform, field) => {
    const { row, phase, st } = v;
    if (phase === 'fix' || phase === 'incomplete' || phase === 'failed' || phase === 'skipped') {
      if (v.known && phase === 'incomplete' && v.known.accounts.some((a) => a.platform === platform && a.state === 'active')) {
        return <span className="num">@{v.known.accounts.find((a) => a.platform === platform).username}</span>;
      }
      const bad = row[field] && parseProfileUrl(platform, row[field]).error;
      return <input className={`cell-input ${bad ? 'invalid' : ''}`} value={row[field]} placeholder="(none)" onChange={(e) => editCell(row.key, field, e.target.value)} aria-label={`${platformName(platform)} link`} />;
    }
    if (v.known && ['exists', 'update', 'updated'].includes(phase)) {
      const added = v.plan?.patch?.[field];
      if (added) return <span className="num">@{parseProfileUrl(platform, added).username} <span className="chip blue">new</span></span>;
      const onFile = v.known.accounts.find((a) => a.platform === platform);
      return onFile ? <span className="num">@{onFile.username}</span> : <span className="hint">—</span>;
    }
    const p = row[field] && parseProfileUrl(platform, row[field]);
    if (!p || p.error) return <span className="hint">—</span>;
    const solved = st?.stats?.find((x) => x.platform === platform)?.solved;
    return <span className="num">@{p.username}{solved != null && <> · <b>{num(solved)}</b> solved</>}</span>;
  };

  const badge = (v) => {
    if (v.phase === 'done') return <span className="chip ok"><Icon name="check" size={13} /> Imported</span>;
    if (v.phase === 'updated') return <span className="chip ok"><Icon name="check" size={13} /> {v.st?.added ? `Added ${v.st.added}` : 'Updated'}</span>;
    if (v.phase === 'incomplete') return <span className="chip warn"><Icon name="alert" size={13} /> Link missing</span>;
    if (v.phase === 'exists') return <span className="chip"><Icon name="check" size={13} /> Already added</span>;
    if (v.phase === 'update') return <span className="chip blue">Will add {describePatch(v.plan.patch)}</span>;
    if (v.phase === 'unverified') return <span className="chip warn">Saved, numbers pending</span>;
    if (v.phase === 'working') return <span className="chip blue">Fetching…</span>;
    if (v.phase === 'ready') return <span className="chip">Ready</span>;
    return <span className="chip bad">Fix needed</span>;
  };

  const counts = {
    ready: toSend.length,
    problems: view.filter((v) => ['fix', 'failed', 'skipped'].includes(v.phase)).length,
    done: view.filter((v) => ['done', 'updated', 'unverified'].includes(v.phase)).length,
    missingLink: view.filter((v) => v.phase === 'incomplete').length,
    already: view.filter((v) => v.phase === 'exists').length,
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2><Icon name="upload" /> Import students</h2>
        <button className="btn ghost sm" onClick={() => downloadXlsx('rmk-students-template.xlsx', templateWorkbook())}><Icon name="download" /> Template</button>
      </div>
      <div
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]); }}
      >
        <Icon name="file" />
        <p>Drop an Excel file (.xlsx) here<br /><span className="hint">Columns: Name, Reg no, Department, Batch, LeetCode link, HackerRank link, GitHub link</span></p>
        <button className="btn" onClick={() => fileRef.current.click()} disabled={running}>Choose file</button>
        <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { load(e.target.files[0]); e.target.value = ''; }} />
      </div>
      <ErrorBox err={typeof problem === 'string' ? [problem] : problem} style={{ marginTop: 14 }} />

      {setup && (
        <div className="setup" style={{ marginTop: 14 }}>
          <b>Found {setup.found[setup.idx].res.rows.length} students in “{setup.found[setup.idx].name}”</b>
          <span className="hint">{describeColumns(setup.found[setup.idx].res)}</span>
          {setup.found.length > 1 && (
            <div className="field"><label htmlFor="sh">Sheet</label>
              <select id="sh" className="input" value={setup.idx} onChange={(e) => chooseSheet(setup.found, Number(e.target.value))}>
                {setup.found.map((f, i) => <option key={f.name} value={i}>{f.name}</option>)}
              </select></div>
          )}
          <div className="form-grid">
            {setup.needDept && (
              <div className="field"><label htmlFor="sd">Department</label>
                <select id="sd" className="input" value={setup.deptCode} onChange={(e) => setSetup({ ...setup, deptCode: e.target.value })}>
                  <option value="">Select…</option>
                  {departments.map((d) => <option key={d.id} value={d.code}>{d.code} · {d.name}</option>)}
                </select></div>
            )}
            {setup.needBatch && (
              <div className="field"><label htmlFor="sy">Year of study</label>
                <select id="sy" className="input" value={setup.year} onChange={(e) => setSetup({ ...setup, year: e.target.value })}>
                  <option value="">Select…</option>
                  {[1, 2, 3, 4].map((y) => <option key={y} value={y}>{yearBatchLabel(y)}</option>)}
                </select></div>
            )}
          </div>
          <span className="hint">
            This sheet has no {[setup.needDept && 'department', setup.needBatch && 'batch'].filter(Boolean).join(' or ')} column, so choose it for every student.
            {setup.guessed && ' Filled in from the sheet’s title; please check it.'}
          </span>
          <div><button className="btn" onClick={continueSetup} disabled={(setup.needDept && !setup.deptCode) || (setup.needBatch && !setup.year)}>Continue</button></div>
        </div>
      )}
      {readInfo && !setup && rows.length > 0 && <p className="hint" style={{ marginTop: 12 }}>{readInfo}</p>}

      {run && (
        <div className="setup" style={{ marginTop: 14 }}>
          <ScrapeProgress
            tally={run}
            label="Importing"
            finished={runDone}
            words={{ fetched: 'saved', notFound: 'profile not found', failed: 'saved without numbers', skipped: 'already added' }}
            stopNote={!runDone ? 'Each student is saved and their LeetCode and HackerRank numbers are fetched, then the next one starts. Keep this page open.' : null}
          />
          {!runDone && <div><button className="btn ghost sm" onClick={() => { stopRef.current = true; }}>Stop after this student</button></div>}
        </div>
      )}

      {rows.length > 0 && !setup && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
            <b>{counts.done} imported · {counts.already} already added · {counts.ready} ready · {counts.problems} need fixing{counts.missingLink > 0 && <> · {counts.missingLink} still missing a link</>}</b>
            {checkingExisting && <span className="hint" role="status">Checking who is already added…</span>}
            <div className="spacer" />
            {flagged.length > 0 && !running && (
              <button className="btn ghost sm" onClick={downloadProblems} title="An Excel file of the students that need attention, to fix and upload again"><Icon name="download" /> List of {flagged.length} needing attention</button>
            )}
            <button className="btn" onClick={() => importRows(toSend)} disabled={running || checkingExisting || !toSend.length}>
              {running ? 'Importing…' : counts.done ? `Import the other ${toSend.length}` : `Import ${toSend.length} student${toSend.length === 1 ? '' : 's'}`}
            </button>
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Status</th><th>Student</th><th>Dept · Batch</th><th>LeetCode</th><th>HackerRank</th><th>GitHub</th><th /></tr></thead>
              <tbody>
                {sorted.map((v) => {
                  const r = v.row;
                  return (
                    <tr key={r.key} className={['fix', 'failed', 'skipped'].includes(v.phase) ? 'row-problem' : ''}>
                      <td style={{ minWidth: 170 }}>
                        {badge(v)}
                        {v.errors.map((e, i) => <span className="row-err" key={i}>{e}</span>)}
                        {!v.known && (r.notes || []).map((n) => <span className="row-note" key={n.platform}>{n.text}</span>)}
                        {v.phase === 'incomplete' && <span className="hint" style={{ display: 'block' }}>Already added. {v.plan.missingText}; add it in the sheet or type it here.</span>}
                        {v.known && ['exists', 'update', 'incomplete'].includes(v.phase) && (v.plan?.notes || []).map((n, i) => <span className="hint" style={{ display: 'block' }} key={i}>{n}</span>)}
                        {v.phase === 'exists' && !(v.plan?.notes || []).length && <span className="hint" style={{ display: 'block' }}>Nothing to change.</span>}
                        {(v.st?.warnings || []).map((w, i) => <span className="hint" style={{ display: 'block' }} key={i}>{w}</span>)}
                      </td>
                      <td className="name-cell">{r.name || '—'}<small>{r.rollNo}</small></td>
                      <td>{r.deptCode} · {r.batchYear}</td>
                      <td>{linkCell(v, 'leetcode', 'leetcodeUrl')}</td>
                      <td>{linkCell(v, 'hackerrank', 'hackerrankUrl')}</td>
                      <td>{['fix', 'failed', 'skipped'].includes(v.phase)
                        ? <input className="cell-input" value={r.githubUrl} placeholder="(none)" onChange={(e) => editCell(r.key, 'githubUrl', e.target.value)} aria-label="GitHub link" />
                        : (githubHandle(r.githubUrl) ? <span className="num" title={r.githubUrl}>{githubHandle(r.githubUrl)}</span> : <span className="hint">—</span>)}</td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        {['failed', 'skipped'].includes(v.phase) && <button className="btn sm ghost" disabled={running} onClick={() => importRows([{ ...v, phase: 'ready' }])}><Icon name="refresh" /> Retry</button>}
                        {v.phase !== 'done' && v.phase !== 'unverified' && v.phase !== 'working' && <button className="icon-btn danger" onClick={() => dropRow(r.key)} aria-label={`Remove ${r.name || 'row'}`}><Icon name="x" /></button>}
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
