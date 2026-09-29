import { useCallback, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useToast } from '../../components/Toasts.jsx';
import { Icon } from '../../components/Icons.jsx';
import { CSV_TEMPLATE, apiRow, rowsFromCsv } from '../../lib/csv.js';
import { parseProfileUrl } from '../../lib/profileUrl.js';
import { num } from '../../lib/format.js';
import { ErrorBox, platformName } from './shared.jsx';

const VALIDATE_CHUNK = 10;   // server limit per validate call
const IMPORT_CHUNK = 200;    // server limit per import call

export default function ImportCsv() {
  const toast = useToast();
  const fileRef = useRef(null);
  const [over, setOver] = useState(false);
  const [rows, setRows] = useState([]);
  const [results, setResults] = useState({});   // row.key -> { ok, errors, warnings, accounts }
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [problem, setProblem] = useState(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState(null);

  // Checks rows in chunks of 10. The server may stop early to stay inside its time budget and
  // report the rest as `checked: false`; those are sent again.
  const validate = useCallback(async (list) => {
    setChecking(true); setProgress(0); setProblem(null);
    try {
      let pending = list;
      let done = 0;
      let stalled = 0;
      while (pending.length) {
        const chunk = pending.slice(0, VALIDATE_CHUNK);
        const { results: res } = await api.admin.validate(chunk.map(apiRow));
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
        if (stalled >= 3) throw new Error('The server could not check these rows right now. Try again in a moment.');
        pending = [...unchecked, ...pending.slice(VALIDATE_CHUNK)];
      }
    } catch (err) { setProblem(err); }
    setChecking(false);
  }, []);

  const load = async (file) => {
    setProblem(null); setSummary(null); setResults({});
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
    setImporting(true); setProblem(null);
    try {
      const created = [];
      const skipped = [];
      for (let i = 0; i < good.length; i += IMPORT_CHUNK) {
        const chunk = good.slice(i, i + IMPORT_CHUNK);
        const out = await api.admin.importRows(chunk.map(apiRow));
        out.created.forEach((c) => created.push(chunk[c.index].key));
        out.skipped.forEach((s) => skipped.push({ key: chunk[s.index].key, reason: s.reason }));
      }
      setSummary({ created: created.length, skipped: skipped.length });
      setRows((rs) => rs.filter((r) => !created.includes(r.key)));
      setResults((cur) => {
        const n = { ...cur };
        skipped.forEach((s) => { n[s.key] = { ok: false, errors: [s.reason], warnings: [], accounts: [] }; });
        return n;
      });
      toast(`${created.length} student${created.length === 1 ? '' : 's'} imported`);
    } catch (err) { setProblem(err); }
    setImporting(false);
  };

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
      <ErrorBox err={typeof problem === 'string' ? [problem] : problem} style={{ marginTop: 14 }} />
      {summary && (
        <div className="alert ok" role="status" style={{ marginTop: 14 }}>
          <Icon name="check" />
          <span>{summary.created} imported{summary.skipped > 0 && `, ${summary.skipped} skipped (see below)`}. Their numbers appear after the next scrape window; open Students and press Refresh to fetch one now.</span>
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
                        {res?.warnings?.map((w, i) => <span className="hint" style={{ display: 'block' }} key={i}>{w}</span>)}
                      </td>
                      <td className="name-cell">{r.name || '—'}<small>{r.rollNo}</small></td>
                      <td>{r.deptCode} · {r.batchYear}</td>
                      <td>{urlCell(r, res, 'leetcode', 'leetcodeUrl')}</td>
                      <td>{urlCell(r, res, 'hackerrank', 'hackerrankUrl')}</td>
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
