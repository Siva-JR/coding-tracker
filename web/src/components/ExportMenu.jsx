import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { downloadXlsx, writeWorkbook } from '../lib/xlsxWrite.js';
import { ALL_WIDTHS, VIEW_WIDTHS, allRows, exportFileName, viewRows } from '../lib/exportBoard.js';
import { useToast } from './Toasts.jsx';
import { Icon } from './Icons.jsx';

const EVERYONE = 1000; // the most the server returns in one request

/**
 * "Export Excel" on the leaderboard: the list as it is on screen (same filters, order and direction), or every
 * student with both platforms side by side. Only students whose profile has been fetched are on the board.
 */
export default function ExportMenu({ platform, sort, reverse, year, deptId, q, mode, top, viewLabel }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const run = async (kind) => {
    setBusy(true);
    try {
      if (kind === 'view') {
        const limit = mode === 'top' ? top : EVERYONE;
        const data = await api.leaderboard({ platform, sort, year, deptId, q, limit, reverse, top: mode === 'top' });
        downloadXlsx(exportFileName({ kind, platform, top: mode === 'top' ? top : null, year }), writeWorkbook({ sheetName: 'Leaderboard', rows: viewRows(platform, data.entries), widths: VIEW_WIDTHS[platform] }));
        toast(`${data.entries.length} student${data.entries.length === 1 ? '' : 's'} exported`);
      } else {
        const [lc, hr] = await Promise.all(['leetcode', 'hackerrank'].map((p) => api.leaderboard({ platform: p, sort: 'solved', year, deptId, limit: EVERYONE })));
        const rows = allRows(lc.entries, hr.entries);
        downloadXlsx(exportFileName({ kind, year }), writeWorkbook({ sheetName: 'All students', rows, widths: ALL_WIDTHS }));
        toast(`${rows.length - 1} students exported`);
      }
      setOpen(false);
    } catch {
      toast('Could not export the list. Try again.');
    }
    setBusy(false);
  };

  return (
    <div className="export-menu" ref={ref}>
      <button className="btn ghost sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} disabled={busy}>
        <Icon name="download" /> {busy ? 'Exporting…' : 'Export Excel'}
      </button>
      {open && (
        <div className="export-pop" role="menu">
          <button role="menuitem" onClick={() => run('view')}>
            <b>This list</b><span className="hint">{viewLabel}</span>
          </button>
          <button role="menuitem" onClick={() => run('all')}>
            <b>All students</b><span className="hint">LeetCode and HackerRank side by side</span>
          </button>
          <span className="hint" style={{ padding: '6px 12px 2px' }}>Only students whose profile has been fetched.</span>
        </div>
      )}
    </div>
  );
}
