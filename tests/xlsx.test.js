import { test } from 'node:test';
import assert from 'node:assert/strict';

// The web app's spreadsheet reader has its own dependency (fflate). Skip when web/ has not been installed.
let fflate;
let readWorkbook;
let studentsFromSheet;
let applyDefaults;
try {
  fflate = await import('../web/node_modules/fflate/esm/browser.js');
  ({ readWorkbook } = await import('../web/src/lib/xlsx.js'));
  ({ studentsFromSheet, applyDefaults } = await import('../web/src/lib/sheet.js'));
} catch {
  fflate = null;
}
const skip = fflate ? false : 'web dependencies are not installed (run npm install in web/)';

const enc = (s) => new TextEncoder().encode(s);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Builds a small workbook. cells: { A1: 'text' | 123 | { f: 'HYPERLINK("u","l")', v: 'label' } | { rich: [...] } }
// links: { E5: 'https://…' } become external hyperlinks, like Excel links and Google Sheets chips.
function workbook({ cells, links = {}, sheetName = 'Sheet1', prefix = '', extraSheets = [] }) {
  const p = prefix;
  const strings = [];
  const sIndex = (t) => { let i = strings.indexOf(t); if (i < 0) { strings.push(t); i = strings.length - 1; } return i; };
  const byRow = {};
  for (const [ref, v] of Object.entries(cells)) (byRow[Number(ref.match(/\d+/)[0])] ??= []).push([ref, v]);
  const rowsXml = Object.keys(byRow).map(Number).sort((a, b) => a - b).map((r) => {
    const cs = byRow[r].map(([ref, v]) => {
      if (typeof v === 'number') return `<${p}c r="${ref}"><${p}v>${v}</${p}v></${p}c>`;
      if (v && v.f) return `<${p}c r="${ref}" t="str"><${p}f>${esc(v.f)}</${p}f><${p}v>${esc(v.v)}</${p}v></${p}c>`;
      if (v && v.rich) return `<${p}c r="${ref}" t="inlineStr"><${p}is>${v.rich.map((t) => `<${p}r><${p}t>${esc(t)}</${p}t></${p}r>`).join('')}</${p}is></${p}c>`;
      return `<${p}c r="${ref}" t="s"><${p}v>${sIndex(v)}</${p}v></${p}c>`;
    }).join('');
    return `<${p}row r="${r}">${cs}</${p}row>`;
  }).join('');

  const linkEntries = Object.entries(links);
  const hyperlinks = linkEntries.length ? `<${p}hyperlinks>${linkEntries.map(([ref], i) => `<${p}hyperlink ref="${ref}" r:id="rId${i + 1}"/>`).join('')}</${p}hyperlinks>` : '';
  const sheetXml = `<?xml version="1.0"?><${p}worksheet xmlns${p ? ':' + p.slice(0, -1) : ''}="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><${p}sheetData>${rowsXml}</${p}sheetData>${hyperlinks}</${p}worksheet>`;
  const sheetRels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${linkEntries.map(([, url], i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(url)}" TargetMode="External"/>`).join('')}</Relationships>`;

  const all = [{ name: sheetName, xml: sheetXml, rels: sheetRels }, ...extraSheets.map((x) => ({ name: x.name, xml: workbookSheetXml(x) }))];
  const files = {
    'xl/workbook.xml': enc(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${all.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': enc(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${all.map((s, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`),
    'xl/sharedStrings.xml': enc(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join('')}</sst>`),
  };
  all.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = enc(s.xml);
    if (s.rels && linkEntries.length && i === 0) files[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = enc(s.rels);
  });
  return fflate.zipSync(files);
}

// A second sheet that has no student columns
const workbookSheetXml = ({ rows }) => `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, c) => `<c r="${String.fromCharCode(65 + c)}${i + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;

const HEADER = { A4: 'NAME', B4: 'REG NUMBER', C4: 'Department', D4: 'Batch', E4: 'LEET CODE Link', F4: 'HACKER RANK Link' };
const DEPTS = [{ code: 'IT', name: 'Information Technology' }, { code: 'CSE', name: 'Computer Science and Engineering' }];

test('links hidden behind labels are read (Google Sheets chips and Excel links)', { skip }, () => {
  const bytes = workbook({
    cells: {
      ...HEADER,
      A5: 'Asha', B5: 111725203001, C5: 'IT', D5: 2029, E5: 'LeetCode', F5: 'HackerRank',
      A6: 'Bala', B6: '111725203002', C6: 'it', D6: '2029', E6: "LeetCode - The World's Leading Programming Learning Platform", F6: 'https://www.hackerrank.com/profile/bala_h',
    },
    links: { E5: 'https://leetcode.com/u/asha1/', F5: 'https://www.hackerrank.com/profile/asha_h', E6: 'https://leetcode.com/u/bala2' },
  });
  const [sheet] = readWorkbook(bytes);
  const res = studentsFromSheet(sheet.rows);
  assert.equal(res.error, undefined);
  assert.equal(res.headerRow, 4);
  assert.equal(res.rows.length, 2);
  assert.deepEqual(
    res.rows.map((r) => [r.name, r.rollNo, r.deptCode, r.batchYear, r.leetcodeUrl, r.hackerrankUrl]),
    [
      ['Asha', '111725203001', 'IT', '2029', 'https://leetcode.com/u/asha1/', 'https://www.hackerrank.com/profile/asha_h'],
      ['Bala', '111725203002', 'IT', '2029', 'https://leetcode.com/u/bala2', 'https://www.hackerrank.com/profile/bala_h'],
    ],
  );
  assert.deepEqual(res.missing, []);
  assert.equal(res.flagged, 0);
});

test('=HYPERLINK() formulas and rich text cells are read', { skip }, () => {
  const bytes = workbook({
    cells: {
      ...HEADER,
      A5: { rich: ['Cha', 'ndra'] }, B5: 'R5', C5: 'IT', D5: 2029,
      E5: { f: 'HYPERLINK("https://leetcode.com/u/chandra9/","My LeetCode")', v: 'My LeetCode' },
      F5: { f: '_xlfn.HYPERLINK("https://www.hackerrank.com/profile/chandra_h","HR")', v: 'HR' },
    },
  });
  const res = studentsFromSheet(readWorkbook(bytes)[0].rows);
  assert.equal(res.rows[0].name, 'Chandra');
  assert.equal(res.rows[0].leetcodeUrl, 'https://leetcode.com/u/chandra9/');
  assert.equal(res.rows[0].hackerrankUrl, 'https://www.hackerrank.com/profile/chandra_h');
});

test('a link with no username is flagged, the student keeps the other platform, and one with neither is blocked', { skip }, () => {
  const bytes = workbook({
    cells: {
      ...HEADER,
      A5: 'Dev', B5: 'R1', C5: 'IT', D5: 2029, E5: 'https://leetcode.com/', F5: 'https://www.hackerrank.com/profile/dev_h',
      A6: 'Esha', B6: 'R2', C6: 'IT', D6: 2029, E6: 'LeetCode', F6: 'https://www.hackerrank.com/dashboard',
      A7: 'Farid', B7: 'R3', C7: 'IT', D7: 2029, E7: 'https://leetcode.com/farid_l', F7: 'HackerRank',
    },
    links: { E5: 'https://leetcode.com/', F6: 'https://www.hackerrank.com/dashboard' },
  });
  const res = studentsFromSheet(readWorkbook(bytes)[0].rows);
  const [dev, esha, farid] = res.rows;
  assert.equal(dev.leetcodeUrl, '');
  assert.equal(dev.hackerrankUrl, 'https://www.hackerrank.com/profile/dev_h');
  assert.match(dev.notes[0].text, /LeetCode: the link has no username/);
  assert.equal(esha.leetcodeUrl, '');
  assert.equal(esha.hackerrankUrl, '');
  assert.equal(esha.notes.length, 2);
  assert.match(esha.notes.find((n) => n.platform === 'leetcode').text, /no link in the sheet/);
  assert.match(esha.notes.find((n) => n.platform === 'hackerrank').text, /no username/);
  assert.equal(farid.leetcodeUrl, 'https://leetcode.com/farid_l');
  assert.equal(res.flagged, 3);
});

test('title rows above the header are skipped and hint the department and year', { skip }, () => {
  const bytes = workbook({
    cells: {
      A2: 'DEPARTMENT OF INFORMATION TECHNOLOGY', B3: 'II YEAR',
      A4: 'NAME', B4: 'Register No.', C4: 'LeetCode profile', D4: 'HackerRank profile', E4: 'GitHub Link',
      A5: 'Gita', B5: 111725203010, C5: 'https://leetcode.com/u/gita', D5: 'https://www.hackerrank.com/profile/gita', E5: 'x',
    },
    links: { E5: 'https://github.com/gita-dev' },
  });
  const res = studentsFromSheet(readWorkbook(bytes)[0].rows, { departments: DEPTS });
  assert.deepEqual(res.missing.sort(), ['batchYear', 'deptCode']);
  assert.deepEqual(res.hints, { yearOfStudy: 2, deptCode: 'IT' });
  assert.equal(res.rows[0].githubUrl, 'https://github.com/gita-dev');
  const filled = applyDefaults(res.rows, { deptCode: 'IT', yearOfStudy: 2 });
  assert.equal(filled[0].deptCode, 'IT');
  assert.match(filled[0].batchYear, /^20\d\d$/);
});

test('reg numbers stored as numbers keep every digit', { skip }, () => {
  const bytes = workbook({ cells: { ...HEADER, A5: 'H', B5: 111725203004, C5: 'IT', D5: 2029, E5: 'https://leetcode.com/u/h1' } });
  assert.equal(studentsFromSheet(readWorkbook(bytes)[0].rows).rows[0].rollNo, '111725203004');
});

test('namespace-prefixed XML (some exporters) and a sheet without student columns', { skip }, () => {
  const bytes = workbook({
    prefix: 'x:',
    cells: { ...HEADER, A5: 'Ira', B5: 'R9', C5: 'IT', D5: 2029, E5: 'https://leetcode.com/u/ira' },
    extraSheets: [{ name: 'Notes', rows: [['just', 'some', 'notes']] }],
  });
  const sheets = readWorkbook(bytes);
  assert.equal(sheets.length, 2);
  assert.equal(studentsFromSheet(sheets[1].rows).error !== undefined, true);
  assert.equal(studentsFromSheet(sheets[0].rows).rows[0].name, 'Ira');
});

test('files that are not workbooks give a plain message', { skip }, () => {
  assert.throws(() => readWorkbook(enc('name,reg_no\nA,1\n')), /does not look like an .xlsx/);
  assert.throws(() => readWorkbook(new Uint8Array([0x50, 0x4b, 1, 2, 3, 4])), /Could not open/);
});
