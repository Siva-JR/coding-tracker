// Turns a parsed worksheet into student rows for the import table.
//
// Real college sheets are messy: title rows above the header, headers like "REG NUMBER" or
// "LEET CODE Link", reg numbers stored as numbers, and links hidden behind labels ("LeetCode") or
// Google Sheets chips. This finds the header, maps the columns, and for each profile cell picks the
// first candidate (hyperlink target, then visible text) that is a real profile link.
import { parseProfileUrl } from './profileUrl.js';
import { checkGithubUrl } from './github.js';
import { batchYearFor } from './yearOfStudy.js';

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Column detection by header text. Platform columns match on the platform name.
const FIELDS = [
  ['name', (h) => ['name', 'studentname', 'student', 'fullname', 'nameofthestudent'].includes(h)],
  ['rollNo', (h) => ['rollno', 'rollnumber', 'regno', 'regnumber', 'registerno', 'registernumber', 'registrationnumber', 'registrationno', 'enrollmentno', 'enrollmentnumber'].includes(h)],
  ['deptCode', (h) => ['department', 'dept', 'deptcode', 'departmentcode', 'branch'].includes(h)],
  ['batchYear', (h) => ['batch', 'batchyear', 'passoutyear', 'yearofpassing', 'graduationyear', 'yearofgraduation'].includes(h)],
  ['leetcodeUrl', (h) => h.includes('leetcode')],
  ['hackerrankUrl', (h) => h.includes('hackerrank')],
  ['githubUrl', (h) => h.includes('github')],
];
export const FIELD_LABELS = { name: 'Name', rollNo: 'Reg no', deptCode: 'Department', batchYear: 'Batch', leetcodeUrl: 'LeetCode', hackerrankUrl: 'HackerRank', githubUrl: 'GitHub' };

function mapHeader(row) {
  const map = {};
  (row || []).forEach((cell, c) => {
    if (!cell?.text) return;
    const h = squash(cell.text);
    for (const [field, test] of FIELDS) if (map[field] === undefined && test(h)) { map[field] = c; break; }
  });
  return map;
}

/** Finds the header row (within the first 40 rows). Needs a name, a reg no and a platform column. */
export function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const map = mapHeader(rows[r]);
    if (map.name !== undefined && map.rollNo !== undefined && (map.leetcodeUrl !== undefined || map.hackerrankUrl !== undefined)) return { rowIndex: r, map };
  }
  return null;
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, first: 1, second: 2, third: 3, fourth: 4 };

/** Hints from the title rows above the header, e.g. "DEPARTMENT OF INFORMATION TECHNOLOGY" / "II YEAR". */
function titleHints(rows, headerRow, departments) {
  const text = rows.slice(0, headerRow).flat().map((c) => c?.text).filter(Boolean).join(' | ');
  const y = /\b(iv|iii|ii|i|1st|2nd|3rd|4th|first|second|third|fourth)\s*year\b/i.exec(text);
  const squashed = squash(text);
  const dept = (departments || []).find((d) => squashed.includes(squash(d.name)));
  return { yearOfStudy: y ? ROMAN[y[1].toLowerCase()] : null, deptCode: dept ? dept.code : null };
}

const PLATFORM_NAME = { leetcode: 'LeetCode', hackerrank: 'HackerRank' };

// A cell can show one thing and link to another. Prefer whichever is a real profile link.
// When nothing usable is there, the link is left empty and a note says why, so the student can still
// be imported with the other platform's link and the gap stays visible.
function pickLink(platform, cell) {
  const isGood = platform === 'github' ? (c) => !checkGithubUrl(c) : (c) => !parseProfileUrl(platform, c).error;
  const candidates = cell ? [...cell.links, cell.text, ...(cell.text.match(/https?:\/\/\S+/g) || [])].filter(Boolean) : [];
  const good = candidates.find(isGood);
  if (good) return { url: good };
  if (platform === 'github') return { url: '' };
  const link = candidates.find((c) => /^https?:\/\//i.test(c) || /\.com/i.test(c));
  const why = link ? 'the link has no username (it points to the site, not a profile)' : 'no link in the sheet';
  return { url: '', note: { platform, text: `${PLATFORM_NAME[platform]}: ${why}` } };
}

/**
 * Reads student rows out of a worksheet.
 * Returns { rows, columns, missing, hints } or { error }.
 *   columns: which sheet header was matched to each field (for showing the user what was detected)
 *   missing: fields with no column (department / batch can be supplied by the user instead)
 */
export function studentsFromSheet(rows, { departments } = {}) {
  const header = findHeader(rows);
  if (!header) return { error: 'Could not find a header row. The sheet needs columns for the student name, reg no, and a LeetCode or HackerRank link.' };
  const { rowIndex, map } = header;
  const cell = (r, field) => (map[field] === undefined ? undefined : rows[r]?.[map[field]]);

  const out = [];
  for (let r = rowIndex + 1; r < rows.length; r++) {
    const name = cell(r, 'name')?.text || '';
    const rollNo = cell(r, 'rollNo')?.text || '';
    if (!name && !rollNo) continue; // blank rows below the data
    const lc = map.leetcodeUrl === undefined ? { url: '' } : pickLink('leetcode', cell(r, 'leetcodeUrl'));
    const hr = map.hackerrankUrl === undefined ? { url: '' } : pickLink('hackerrank', cell(r, 'hackerrankUrl'));
    out.push({
      key: out.length,
      name,
      rollNo,
      deptCode: (cell(r, 'deptCode')?.text || '').toUpperCase(),
      batchYear: cell(r, 'batchYear')?.text || '',
      leetcodeUrl: lc.url,
      hackerrankUrl: hr.url,
      githubUrl: pickLink('github', cell(r, 'githubUrl')).url,
      notes: [lc.note, hr.note].filter(Boolean),
    });
  }

  const columns = {};
  for (const f of Object.keys(map)) columns[f] = rows[rowIndex][map[f]].text;
  const missing = Object.keys(FIELD_LABELS).filter((f) => map[f] === undefined && f !== 'githubUrl');
  const flagged = out.filter((r) => r.notes.length).length;
  return { rows: out, columns, missing, flagged, hints: titleHints(rows, rowIndex, departments), headerRow: rowIndex + 1 };
}

/** Fills department / batch for every row when the sheet has no such column. */
export function applyDefaults(rows, { deptCode, yearOfStudy }) {
  return rows.map((r) => ({
    ...r,
    deptCode: r.deptCode || deptCode || '',
    batchYear: r.batchYear || (yearOfStudy ? String(batchYearFor(Number(yearOfStudy))) : ''),
  }));
}
