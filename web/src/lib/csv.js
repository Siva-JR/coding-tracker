// Small RFC-4180-ish parser: quoted fields, escaped quotes, CRLF.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

// Columns the file must have (URLs are both optional per row, but a row needs at least one).
const ALIASES = {
  name: ['name', 'student name', 'student'],
  rollNo: ['roll_no', 'roll no', 'rollno', 'roll number', 'register no', 'register number'],
  deptCode: ['department', 'dept', 'department code'],
  batchYear: ['batch', 'batch_year', 'batch year'],
  leetcodeUrl: ['leetcode_url', 'leetcode', 'leetcode url'],
  hackerrankUrl: ['hackerrank_url', 'hackerrank', 'hackerrank url'],
};

export function rowsFromCsv(text) {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], missing: ['a header row and at least one student'] };
  const header = grid[0].map((h) => h.trim().toLowerCase());
  const idx = {};
  const missing = [];
  for (const [key, names] of Object.entries(ALIASES)) {
    const at = header.findIndex((h) => names.includes(h));
    if (at < 0) missing.push(names[0]); else idx[key] = at;
  }
  if (missing.length) return { rows: [], missing };
  const cell = (r, k) => (r[idx[k]] || '').trim();
  return {
    rows: grid.slice(1).map((r, n) => ({
      key: n, name: cell(r, 'name'), rollNo: cell(r, 'rollNo'), deptCode: cell(r, 'deptCode'),
      batchYear: cell(r, 'batchYear'), leetcodeUrl: cell(r, 'leetcodeUrl'), hackerrankUrl: cell(r, 'hackerrankUrl'),
    })),
    missing: [],
  };
}

export const CSV_TEMPLATE =
  'name,roll_no,department,batch,leetcode_url,hackerrank_url\n' +
  'Arun Kumar,24CSE201,CSE,2028,https://leetcode.com/u/arunkumar,https://www.hackerrank.com/profile/arun_kumar\n';

/** Rows sent to the API don't need our local `key`. */
export const apiRow = ({ key, ...row }) => row;
