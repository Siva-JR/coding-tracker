// Writes a simple .xlsx (bold header row, plain rows) that opens in Excel and Google Sheets. Cells that
// hold a web address become clickable links, so a file keeps its links when it is edited and uploaded again.
import { strToU8, zipSync } from 'fflate';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const isUrl = (v) => /^https?:\/\/\S+$/i.test(String(v ?? '').trim());

/**
 * rows: array of arrays of strings. headerRow: index of the row to make bold. widths: column widths in characters.
 * Returns the file as bytes.
 */
export function writeWorkbook({ sheetName = 'Students', rows, headerRow = 0, widths = [] }) {
  const links = [];
  const rowsXml = rows.map((cells, r) => {
    const cs = cells.map((v, c) => {
      const ref = `${colName(c)}${r + 1}`;
      if (isUrl(v)) links.push({ ref, url: String(v).trim() });
      const text = String(v ?? '');
      return text === '' ? '' : `<c r="${ref}" t="inlineStr"${r === headerRow ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cs}</row>`;
  }).join('');
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const hyperlinks = links.length ? `<hyperlinks>${links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rId${i + 1}"/>`).join('')}</hyperlinks>` : '';
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = {
    '[Content_Types].xml': `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `${head}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `${head}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${cols}<sheetData>${rowsXml}</sheetData>${hyperlinks}</worksheet>`,
  };
  if (links.length) {
    files['xl/worksheets/_rels/sheet1.xml.rels'] = `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map((l, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(l.url)}" TargetMode="External"/>`).join('')}</Relationships>`;
  }
  const zipped = {};
  for (const [name, xml] of Object.entries(files)) zipped[name] = strToU8(xml);
  return zipSync(zipped);
}

export function downloadXlsx(filename, bytes) {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

export const TEMPLATE_HEADER = ['NAME', 'REG NO', 'DEPARTMENT', 'BATCH', 'LEETCODE LINK', 'HACKERRANK LINK', 'GITHUB LINK'];
const WIDTHS = [28, 16, 14, 10, 46, 46, 40];

export function templateWorkbook() {
  return writeWorkbook({
    sheetName: 'Students',
    rows: [
      ['One student per row. Paste each profile link into its cell, then upload this file.'],
      TEMPLATE_HEADER,
    ],
    headerRow: 1,
    widths: WIDTHS,
  });
}

/** Students that still need attention: the import columns plus what is wrong, ready to fix and upload again. */
export function problemsWorkbook(rows) {
  return writeWorkbook({ sheetName: 'Needing links', rows: [[...TEMPLATE_HEADER, 'PROBLEM'], ...rows], widths: [...WIDTHS, 70] });
}
