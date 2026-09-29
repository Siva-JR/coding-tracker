import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useToast } from '../../components/Toasts.jsx';
import { Icon } from '../../components/Icons.jsx';
import { CSV_TEMPLATE, apiRow, rowsFromCsv } from '../../lib/csv.js';
import { readWorkbook } from '../../lib/xlsx.js';
import { FIELD_LABELS, applyDefaults, studentsFromSheet } from '../../lib/sheet.js';
import { batchYearFor } from '../../lib/yearOfStudy.js';
import { useScope } from '../../context/Scope.jsx';
import { parseProfileUrl } from '../../lib/profileUrl.js';
import { githubHandle } from '../../lib/github.js';
import { num } from '../../lib/format.js';
import ScrapeProgress from '../../components/ScrapeProgress.jsx';
import { newTally, retryFailed, scrapeSequentially } from '../../lib/scrape.js';
import { ErrorBox, platformName } from './shared.jsx';

const VALIDATE_CHUNK = 10;   // server limit per validate call
const IMPORT_STEP = 10;      // students created per call; each is fetched right after, so progress is steady (server limit is 200)
const RETRIES = 3;           // extra attempts for a call that fails because of the connection
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A dropped connection, a timeout or a server error is worth retrying; a 4xx is not.
const isTransient = (err) => err?.status === 0 || err?.status === 408 || err?.status >= 500;

async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (err) {
      if (!isTransient(err) || attempt >= RETRIES) throw err;
      await sleep(1500 * (attempt + 1));
    }
  }
}

export default function ImportCsv() {
  const toast = useToast();
  const { departments } = useScope();
  const fileRef = useRef(null);
  const [setup, setSetup] = useState(null);      // spreadsheet waiting for department / year choices
  const [readInfo, setReadInfo] = useState('');  // what was read from the file, shown above the table
  const [over, setOver] = useState(false);
  const [rows, setRows] = useState([]);
  const [results, setResults] = useState({});   // row.key -> { ok, errors, warnings, accounts }
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [problem, setProblem] = useState(null);  // shown at the top, next to the file picker
  const [stopped, setStopped] = useState(null);  // why checking stopped early, shown beside the progress line
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [run, setRun] = useState(null);         // progress of the import + fetch run
  const [runDone, setRunDone] = useState(false);
  const stopImport = useRef(false);
  const [summary, setSummary] = useState(null);

  const callValidate = useCallback(async (chunk) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await api.admin.validate(chunk.map(apiRow));
      } catch (err) {
        if (!isTransient(err) || attempt >= RETRIES) throw err;
        setNotice(`Connection problem, retrying (${attempt + 1}/${RETRIES})…`);
        await sleep(1500 * (attempt + 1));
      }
    }
  }, []);

  // Checks rows in chunks of 10. The server may stop early to stay inside its time budget and report
  // the rest as `checked: false`; those are sent again. If the connection keeps failing we stop, keep
  // everything checked so far, and offer "Check remaining rows".
  const validate = useCallback(async (list) => {
    setChecking(true); setProgress(0); setTotal(list.length); setProblem(null); setStopped(null); setNotice('');
    try {
      let pending = list;
      let done = 0;
      let stalled = 0;
      while (pending.length) {
        const chunk = pending.slice(0, VALIDATE_CHUNK);
        const { results: res } = await callValidate(chunk);
        setNotice('');
        const unchecked = [];
        const update = {};
        res.forEach((r) => {
          const row = chunk[r.index];
          if (!row) return;
          if (r.checked) update[row.key] = r; else unchecked.push(row);
        });
        setResults((cur) => ({ ...cur, ...update }));
        done += chunk.length - unchecked.length;
        setProgress(Math.min(list.length, done));
        stalled = unchecked.length === chunk.length ? stalled + 1 : 0;
        if (stalled >= 3) throw new Error('The server could not check these rows right now.');
        pending = [...unchecked, ...pending.slice(VALIDATE_CHUNK)];
      }
    } catch (err) {
      setStopped(err.message || 'Checking stopped.');
    }
    setNotice('');
    setChecking(false);
  }, [callValidate]);

  const begin = (parsed, info) => {
    setRows(parsed); setReadInfo(info); setSetup(null);
    validate(parsed);
  };

  const describe = (res, sheetName) => {
    const cols = Object.entries(res.columns).map(([f, h]) => `${FIELD_LABELS[f]} ← ${h}`).join(' · ');
    return `Read ${res.rows.length} students from “${sheetName}” (header on row ${res.headerRow}). Matched: ${cols}.`;
  };

  // Spreadsheet (.xlsx from Excel or Google Sheets): read hyperlinks as well as cell text.
  const loadSheet = async (file) => {
    let sheets;
    try { sheets = readWorkbook(await file.arrayBuffer()); } catch (err) { setProblem(err.message); return; }
    const found = sheets.map((sh) => ({ name: sh.name, res: studentsFromSheet(sh.rows, { departments }) })).filter((x) => !x.res.error);
    if (!found.length) {
      setProblem(studentsFromSheet(sheets[0].rows).error || 'No student sheet found in this file.');
      return;
    }
    chooseSheet(found, 0);
  };

  const chooseSheet = (found, idx) => {
    const { name, res } = found[idx];
    const needDept = res.missing.includes('deptCode');
    const needBatch = res.missing.includes('batchYear');
    if (!res.rows.length) { setProblem(`“${name}” has a header but no students below it.`); return; }
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
    const rows2 = applyDefaults(res.rows, { deptCode, yearOfStudy: year });
    const extra = [setup.needDept && `department ${deptCode}`, setup.needBatch && `batch ${batchYearFor(Number(year))} (year ${year})`].filter(Boolean).join(' and ');
    begin(rows2, `${describe(res, name)} The sheet has no ${[setup.needDept && 'department', setup.needBatch && 'batch'].filter(Boolean).join(' or ')} column, so every row uses ${extra}.`);
  };

  const load = async (file) => {
    setProblem(null); setStopped(null); setSummary(null); setResults({}); setSetup(null); setReadInfo(''); setRun(null); setRunDone(false);
    if (!file) return;
    if (/\.xlsx$/i.test(file.name)) { setRows([]); await loadSheet(file); return; }
    if (/\.(xls|ods|numbers)$/i.test(file.name)) { setProblem('Save or download the sheet as “Microsoft Excel (.xlsx)” and upload that.'); return; }
    if (!/\.csv$/i.test(file.name)) { setProblem('Please choose an .xlsx or .csv file.'); return; }
    const { rows: parsed, missing } = rowsFromCsv(await file.text());
    if (missing.length) { setProblem(`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Download the template to see the expected header.`); setRows([]); return; }
    if (!parsed.length) { setProblem('No student rows found.'); return; }
    begin(parsed, `Read ${parsed.length} students.`);
  };

  const editCell = (key, field, value) => setRows((rs) => rs.map((r) => {
    if (r.key !== key) return r;
    const platform = field === 'leetcodeUrl' ? 'leetcode' : field === 'hackerrankUrl' ? 'hackerrank' : null;
    return { ...r, [field]: value, notes: platform ? (r.notes || []).filter((n) => n.platform !== platform) : r.notes };
  }));
  const recheck = (row) => { setResults((r) => { const n = { ...r }; delete n[row.key]; return n; }); validate([row]); };
  const dropRow = (key) => setRows((rs) => rs.filter((r) => r.key !== key));

  const good = rows.filter((r) => results[r.key]?.ok);
  const bad = rows.filter((r) => results[r.key] && !results[r.key].ok);
  const remaining = rows.filter((r) => !results[r.key]);

  // When the network comes back after a stop, carry on where we left off.
  useEffect(() => {
    const onOnline = () => { if (stopped && !checking && remaining.length) validate(remaining); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [stopped, checking, remaining, validate]);

  // Creates students a few at a time and fetches each one's numbers straight after, one student at a
  // time, so nobody is left "waiting for first scrape". The nightly job then only updates them.
  const doImport = async () => {
    setImporting(true); setProblem(null); setSummary(null); stopImport.current = false;
    const queue = [...good];
    const t = newTally(queue.length);
    setRun({ ...t }); setRunDone(false);
    const opts = { onStep: (x) => setRun({ ...x }), shouldStop: () => stopImport.current };
    const created = [];
    const skipped = [];
    const failedStudents = [];
    try {
      for (let i = 0; i < queue.length && !stopImport.current && !t.aborted; i += IMPORT_STEP) {
        const chunk = queue.slice(i, i + IMPORT_STEP);
        t.current = 'saving the next students…'; setRun({ ...t });
        const out = await withRetry(() => api.admin.importRows(chunk.map(apiRow)));
        out.skipped.forEach((sk) => { skipped.push({ key: chunk[sk.index].key, reason: sk.reason }); t.done++; t.skipped++; });
        const students = out.created.map((c) => { created.push(chunk[c.index].key); return { id: c.studentId, name: chunk[c.index].name }; });
        failedStudents.push(...await scrapeSequentially(students, t, opts));
      }
      await retryFailed(failedStudents, t, opts);
    } catch (err) { setProblem(err); }
    t.current = ''; setRun({ ...t }); setRunDone(true);
    setSummary({ created: created.length, skipped: skipped.length, tally: { ...t } });
    setRows((rs) => rs.filter((r) => !created.includes(r.key)));
    setResults((cur) => {
      const n = { ...cur };
      skipped.forEach((sk) => { n[sk.key] = { ok: false, errors: [sk.reason], warnings: [], accounts: [] }; });
      return n;
    });
    toast(`${created.length} student${created.length === 1 ? '' : 's'} imported`);
    setImporting(false);
  };

  // Everyone whose row is blocked or flagged, in the same columns as the import, ready to fill in and upload again.
  const flaggedRows = rows.filter((r) => (r.notes && r.notes.length) || (results[r.key] && !results[r.key].ok));
  const downloadFlagged = () => {
    const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = [['name', 'reg_no', 'department', 'batch', 'leetcode_url', 'hackerrank_url', 'github_url', 'problem']];
    for (const r of flaggedRows) {
      const problems = [...(r.notes || []).map((n) => n.text), ...((results[r.key]?.errors) || [])];
      lines.push([r.name, r.rollNo, r.deptCode, r.batchYear, r.leetcodeUrl, r.hackerrankUrl, r.githubUrl || '', problems.join(' | ')]);
    }
    const url = URL.createObjectURL(new Blob([lines.map((l) => l.map(esc).join(',')).join('\n') + '\n'], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: 'students-needing-links.csv' }).click();
    URL.revokeObjectURL(url);
  };

  const describeColumns = (res) => `Matched: ${Object.entries(res.columns).map(([f, h]) => `${FIELD_LABELS[f]} ← ${h}`).join(' · ')}`;

  const template = () => {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'students-template.csv' });
    a.click(); URL.revokeObjectURL(url);
  };

  const urlCell = (row, res, platform, field) => {
    const acc = res?.accounts?.find((a) => a.platform === platform);
    if (res && !res.ok) {
      const bad = row[field] && parseProfileUrl(platform, row[field]).error;
      return <input className={`cell-input ${bad ? 'invalid' : ''}`} value={row[field]} placeholder="(none)" onChange={(e) => editCell(row.key, field, e.target.value)} aria-label={`${platformName(platform)} URL`} />;
    }
    if (acc) return acc.verified === 'ok'
      ? <span className="num">@{acc.username} · <b>{num(acc.solvedTotal)}</b> solved</span>
      : <span className="num">@{acc.username} <span className="chip warn">unverified</span></span>;
    return <span className="hint">—</span>;
  };

  const githubCell = (row, res) => {
    if (res && !res.ok) {
      return <input className="cell-input" value={row.githubUrl} placeholder="(none)" onChange={(e) => editCell(row.key, 'githubUrl', e.target.value)} aria-label="GitHub link" />;
    }
    const handle = githubHandle(row.githubUrl);
    return handle ? <span className="num" title={row.githubUrl}>{handle}</span> : <span className="hint">—</span>;
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2><Icon name="upload" /> Import students</h2>
        <button className="btn ghost sm" onClick={template}><Icon name="download" /> Template</button>
      </div>
      <div
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]); }}
      >
        <Icon name="file" />
        <p>Drop an Excel (.xlsx) or CSV file here<br /><span className="hint">Columns: name, reg_no, department, batch, leetcode_url, hackerrank_url, github_url</span></p>
        <button className="btn" onClick={() => fileRef.current.click()} disabled={checking}>Choose file</button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { load(e.target.files[0]); e.target.value = ''; }} />
      </div>
      <ErrorBox err={typeof problem === 'string' ? [problem] : problem} style={{ marginTop: 14 }} />
      {run && (
        <div className="setup" style={{ marginTop: 14 }}>
          <ScrapeProgress
            tally={run}
            label="Importing and fetching numbers"
            finished={runDone}
            stopNote={!runDone ? 'Each student is saved and their LeetCode and HackerRank numbers are fetched before the next one starts. Keep this page open.' : null}
          />
          {!runDone && <div><button className="btn ghost sm" onClick={() => { stopImport.current = true; }}>Stop after this student</button></div>}
        </div>
      )}
      {summary && runDone && (
        <div className="alert ok" role="status" style={{ marginTop: 14 }}>
          <Icon name="check" />
          <span>
            {summary.created} imported{summary.skipped > 0 && `, ${summary.skipped} skipped (see below)`}.
            {' '}{summary.tally.fetched} have their numbers now{summary.tally.notFound > 0 ? `, ${summary.tally.notFound} have a profile that was not found (see Needs attention)` : ''}{summary.tally.failed > 0 ? `, ${summary.tally.failed} could not be reached; use Refresh all in Students to try them again` : ''}.
          </span>
        </div>
      )}

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
                  {[1, 2, 3, 4].map((y) => <option key={y} value={y}>Year {y} (batch {batchYearFor(y)})</option>)}
                </select></div>
            )}
          </div>
          <span className="hint">
            This sheet has no {[setup.needDept && 'department', setup.needBatch && 'batch'].filter(Boolean).join(' or ')} column, so choose it for every student.
            {setup.guessed && ' Filled in from the sheet’s title; please check it.'}
          </span>
          <div><button className="btn" onClick={continueSetup} disabled={(setup.needDept && !setup.deptCode) || (setup.needBatch && !setup.year)}>Check the profiles</button></div>
        </div>
      )}
      {readInfo && !setup && rows.length > 0 && <p className="hint" style={{ marginTop: 12 }}>{readInfo}</p>}

      {rows.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
            <b>{checking ? `Checking profiles live… ${progress}/${total}` : `${good.length} ready · ${bad.length} need fixing${remaining.length ? ` · ${remaining.length} not checked` : ''}`}</b>
            {notice && <span className="hint" role="status">{notice}</span>}
            <div className="spacer" />
            {!checking && flaggedRows.length > 0 && (
              <button className="btn ghost sm" onClick={downloadFlagged} title="A file of the students with a missing or unusable link, to fill in and upload again"><Icon name="download" /> List of {flaggedRows.length} needing links</button>
            )}
            {!checking && remaining.length > 0 && (
              <button className="btn ghost" onClick={() => validate(remaining)}><Icon name="refresh" /> Check remaining rows ({remaining.length})</button>
            )}
            <button className="btn" onClick={doImport} disabled={checking || importing || good.length === 0}>
              {importing ? 'Importing…' : `Import ${good.length} valid row${good.length === 1 ? '' : 's'}`}
            </button>
          </div>
          {stopped && !checking && (
            <div className="alert" role="alert" style={{ marginBottom: 10 }}>
              <Icon name="alert" />
              <span>Checking stopped: {stopped} {remaining.length ? `${rows.length - remaining.length} rows are already checked. It will carry on when your connection is back, or press “Check remaining rows”.` : ''}</span>
            </div>
          )}
          {checking && <div className="progress" style={{ marginBottom: 12 }} role="progressbar" aria-valuenow={progress} aria-valuemax={total}><i style={{ width: `${total ? (progress / total) * 100 : 0}%` }} /></div>}
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Result</th><th>Student</th><th>Dept · Batch</th><th>LeetCode</th><th>HackerRank</th><th>GitHub</th><th /></tr></thead>
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
                        {(r.notes || []).map((n) => <span className="row-note" key={n.platform}>{n.text}</span>)}
                        {res?.warnings?.map((w, i) => <span className="hint" style={{ display: 'block' }} key={i}>{w}</span>)}
                      </td>
                      <td className="name-cell">{r.name || '—'}<small>{r.rollNo}</small></td>
                      <td>{r.deptCode} · {r.batchYear}</td>
                      <td>{urlCell(r, res, 'leetcode', 'leetcodeUrl')}</td>
                      <td>{urlCell(r, res, 'hackerrank', 'hackerrankUrl')}</td>
                      <td>{githubCell(r, res)}</td>
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
