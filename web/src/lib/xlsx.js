// Minimal .xlsx reader for the student import. Works on files saved from Excel and downloaded from
// Google Sheets, and keeps what a spreadsheet hides behind a cell: hyperlink targets (including Google
// "smart chips", which export as hyperlinks) and =HYPERLINK("url", "label") formulas.
//
// It only reads. Nothing in the file is ever executed.
import { unzipSync } from 'fflate';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 40 * 1024 * 1024;

// ── tiny XML parser (xlsx parts are small, well-formed and simple) ──────
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e.toLowerCase()] ?? m;
});
const local = (name) => name.slice(name.indexOf(':') + 1); // drop any namespace prefix

export function parseXml(xml) {
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([^>\s]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) { if (stack.length > 1) stack.pop(); }
    else if (m[3] !== undefined) {
      const attrs = {};
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[local(a[1])] = decode(a[2] ?? a[3]);
      const node = { tag: local(m[3]), attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += decode(m[6]);
  }
  return root;
}

const kids = (n, tag) => n.children.filter((c) => c.tag === tag);
const kid = (n, tag) => n.children.find((c) => c.tag === tag);
const collectText = (n) => (n.tag === 't' ? n.text : n.children.map(collectText).join('')); // skips phonetic <rPh> via callers

function stringOf(si) {
  // <si><t>..</t></si> or rich text <si><r><t>..</t></r>...</si>; ignore phonetic hints (<rPh>)
  return si.children.filter((c) => c.tag !== 'rPh' && c.tag !== 'phoneticPr').map(collectText).join('');
}

// ── addresses ───────────────────────────────────────────────────────────
export function colToIndex(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function indexToCol(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const splitRef = (ref) => { const m = /^([A-Za-z]+)(\d+)$/.exec(ref); return m ? { col: colToIndex(m[1]), row: Number(m[2]) - 1 } : null; };

// Numbers written by spreadsheets: 1.11725203001E11 -> "111725203001"
function numberText(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return Number.isInteger(n) && Math.abs(n) < 2 ** 53 ? String(n) : String(v);
}

// HYPERLINK("https://…", "label") -> the address, else null
export function urlFromFormula(formula) {
  const m = /^\s*(?:_xlfn\.)?HYPERLINK\s*\(\s*"((?:[^"]|"")*)"/i.exec(formula || '');
  return m ? m[1].replace(/""/g, '"') : null;
}

// ── workbook ────────────────────────────────────────────────────────────
function relsOf(files, path) {
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  const relPath = `${dir}_rels/${path.slice(dir.length)}.rels`;
  if (!files[relPath]) return {};
  const out = {};
  for (const r of kid(parseXml(dec(files[relPath])), 'Relationships')?.children ?? []) {
    if (r.tag !== 'Relationship') continue;
    out[r.attrs.Id] = { target: r.attrs.Target, external: r.attrs.TargetMode === 'External' };
  }
  return out;
}
const dec = (bytes) => new TextDecoder('utf-8').decode(bytes);
const norm = (p) => p.replace(/^\/+/, '').replace(/^xl\//, '');

/**
 * Reads a workbook. Returns [{ name, rows }] where rows[r][c] = { text, links: [urls] } (sparse).
 * Throws an Error with a message fit for the user when the file can't be read.
 */
export function readWorkbook(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('That file is larger than 10 MB. Export just the student sheet and try again.');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('That does not look like an .xlsx file. Save or download it as “Microsoft Excel (.xlsx)”.');

  let total = 0;
  let files;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new Error('too large');
        return /^(xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml|worksheets\/_rels\/[^/]+\.rels))$/.test(f.name);
      },
    });
  } catch (err) {
    throw new Error(err.message === 'too large' ? 'That file expands to an unreasonable size.' : 'Could not open that file. Is it a valid .xlsx?');
  }
  if (!files['xl/workbook.xml']) throw new Error('This file has no worksheets. Is it a valid .xlsx?');

  const workbook = kid(parseXml(dec(files['xl/workbook.xml'])), 'workbook');
  const wbRels = relsOf(files, 'xl/workbook.xml');
  const shared = files['xl/sharedStrings.xml']
    ? kids(kid(parseXml(dec(files['xl/sharedStrings.xml'])), 'sst') ?? { children: [] }, 'si').map(stringOf)
    : [];

  const sheets = [];
  for (const s of kids(kid(workbook, 'sheets') ?? { children: [] }, 'sheet')) {
    const rel = wbRels[s.attrs.id];
    const path = rel && `xl/${norm(rel.target)}`;
    if (!path || !files[path]) continue; // chart sheets and the like
    sheets.push({ name: s.attrs.name, rows: readSheet(files, path, shared) });
  }
  if (!sheets.length) throw new Error('This file has no worksheets. Is it a valid .xlsx?');
  return sheets;
}

function readSheet(files, path, shared) {
  const doc = kid(parseXml(dec(files[path])), 'worksheet');
  const rows = [];
  const cellAt = (r, c) => { rows[r] ??= []; return (rows[r][c] ??= { text: '', links: [] }); };

  for (const rowNode of kids(kid(doc, 'sheetData') ?? { children: [] }, 'row')) {
    for (const c of kids(rowNode, 'c')) {
      const pos = splitRef(c.attrs.r || '');
      if (!pos) continue;
      const v = kid(c, 'v')?.text ?? '';
      const t = c.attrs.t;
      let text = '';
      if (t === 's') text = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') text = kid(c, 'is') ? stringOf(kid(c, 'is')) : '';
      else if (t === 'str' || t === 'e') text = v;
      else if (t === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
      else text = v === '' ? '' : numberText(v);
      const cell = cellAt(pos.row, pos.col);
      cell.text = text.trim();
      const fromFormula = urlFromFormula(kid(c, 'f')?.text);
      if (fromFormula) cell.links.push(fromFormula);
    }
  }

  // Hyperlinks (Excel links, Google Sheets links and smart chips) live in a separate list.
  const rels = relsOf(files, path);
  for (const h of kids(kid(doc, 'hyperlinks') ?? { children: [] }, 'hyperlink')) {
    const rel = h.attrs.id ? rels[h.attrs.id] : null;
    const target = rel?.external ? rel.target : null;
    if (!target) continue; // internal jumps ("location") are not profile links
    const [a, b] = (h.attrs.ref || '').split(':');
    const from = splitRef(a);
    const to = b ? splitRef(b) : from;
    if (!from || !to) continue;
    for (let r = from.row; r <= Math.min(to.row, from.row + 2000); r++) {
      for (let c = from.col; c <= Math.min(to.col, from.col + 50); c++) cellAt(r, c).links.push(target);
    }
  }

  // Merged cells: only the top-left cell holds the value, but it applies to the whole range. A sheet that
  // merges the Department or Batch cells down the column means "this value for every student".
  for (const m of kids(kid(doc, 'mergeCells') ?? { children: [] }, 'mergeCell')) {
    const [a, b] = (m.attrs.ref || '').split(':');
    const from = splitRef(a);
    const to = b ? splitRef(b) : null;
    const top = from && rows[from.row]?.[from.col];
    if (!to || !top?.text) continue;
    for (let r = from.row; r <= Math.min(to.row, from.row + 5000); r++) {
      for (let c = from.col; c <= Math.min(to.col, from.col + 50); c++) {
        const cell = cellAt(r, c);
        if (!cell.text) cell.text = top.text;
      }
    }
  }
  return rows;
}
