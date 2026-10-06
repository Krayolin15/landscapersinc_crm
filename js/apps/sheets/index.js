/* =============================================================================
   Sheets (#/sheets) — spreadsheets with a real formula engine (engine.js):
   multi-tab workbooks, cross-tab refs, ~75 Excel functions, fill, sort, insert /
   delete rows & columns (formulas follow), copy/paste with Excel & Google Sheets,
   undo/redo, number formats (R, %, dates), frozen header rows, live charts,
   Excel / CSV import & export, PDF, and "pull live data" from any CRM table.
   Everything autosaves (sheets.tabs) and shows who last changed it.
   ========================================================================== */

import { h, ensureStyle, downloadText, debounce, escapeCSV } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, card, pageHeader, emptyState, listItem, callout, attribution } from '../../ui/components.js';
import { toast, showError, confirm, prompt, modal, menu } from '../../ui/overlays.js';
import { chart } from '../../ui/charts.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { can } from '../../core/perms.js';
import { getBlob, fromFolder, NEEDS_LOADING } from '../../core/files.js';
import { today } from '../../core/dates.js';
import * as fmt from '../../core/format.js';
import { SCHEMA, fieldsOf, optionValues } from '../../core/schema.js';
import { company } from '../_biz.js';
import { addr, parseAddr, colName, evaluateBook, parseInput, formatValue, isErr, shiftFormula, shiftCells, sortRows, dateToSerial, serialToDate, FUNCTION_NAMES, renameSheetRefs, cleanTabName, normaliseFormula, mergeBooks } from './engine.js';
import { ensureLib } from '../../core/lazy.js';

const RH = 26, HW = 48, DEF_W = 104, MAX_CELLS = 60000;
const me = () => store.get('user') || {};

ensureStyle('lsi-sheets', `
.sh-app{display:flex;flex-direction:column;height:calc(100vh - 150px);min-height:460px;border:1px solid var(--border);border-radius:18px;overflow:hidden;background:var(--surface-solid)}
.sh-tools{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--border);background:var(--surface-2)}
.sh-tools .sep{width:1px;height:22px;background:var(--border);margin:0 4px}
.sh-tools button.on{background:var(--primary-soft);color:var(--primary)}
.sh-bar{display:flex;gap:6px;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border)}
.sh-bar .nb{width:92px;font:600 .8rem var(--font-mono,monospace);padding:4px 6px;border:1px solid var(--border);border-radius:8px;background:var(--surface)}
.sh-bar .fx{flex:1;font:.86rem var(--font-mono,monospace);padding:5px 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)}
.sh-hint{display:flex;gap:4px;flex-wrap:wrap;padding:0 8px 4px 108px;font-size:.72rem}.sh-hint button{border:1px solid var(--border);background:var(--surface);border-radius:8px;padding:1px 7px;cursor:pointer;font:600 .72rem var(--font-mono,monospace)}
.sh-wrap{position:relative;flex:1;min-height:0}
.sh-scroll{position:absolute;inset:0;overflow:auto;outline:none;overscroll-behavior:contain}
.sh-sink{position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;resize:none;border:0;padding:0;overflow:hidden}
.sh-wrap:focus-within .sh-grid td.act{outline-color:var(--primary)}
.sh-grid{border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:.84rem;user-select:none}
.sh-grid th,.sh-grid td{height:${RH}px;box-sizing:border-box;border-right:1px solid var(--border);border-bottom:1px solid var(--border);padding:0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sh-grid thead th{position:sticky;top:0;z-index:3;background:var(--surface-2);font-weight:600;color:var(--muted);text-align:center;font-size:.74rem}
.sh-grid th.rh{position:sticky;left:0;z-index:2;background:var(--surface-2);color:var(--muted);text-align:center;font-weight:600;font-size:.72rem}
.sh-grid thead th.rh{z-index:4}
.sh-grid th.hl{background:var(--primary-soft);color:var(--primary)}
.sh-grid td{background:var(--surface-solid);cursor:cell}
.sh-grid td.num{text-align:right;font-variant-numeric:tabular-nums}.sh-grid td.bool{text-align:center}
.sh-grid td.err{color:var(--danger);font-weight:600}
.sh-grid td.in{background:color-mix(in srgb,var(--primary) 12%,var(--surface-solid))}
.sh-grid td.act{outline:2px solid var(--primary);outline-offset:-2px}
.sh-grid tr.frz>*{position:sticky;top:var(--top);z-index:2;box-shadow:inset 0 -1px 0 var(--border)}
.sh-grid tr.frz>th.rh{z-index:3}
.sh-grid tr.frz.last>*{border-bottom:2px solid var(--muted)}
.sh-grid th .rs{position:absolute;right:-3px;top:0;width:7px;height:100%;cursor:col-resize;z-index:5}
.sh-grid thead th{position:sticky}
.sh-edit{position:absolute;z-index:6;border:2px solid var(--primary);padding:0 5px;font:.84rem var(--font-mono,monospace);background:var(--surface-solid);color:var(--text);box-shadow:0 6px 18px rgba(0,0,0,.18);outline:none}
.sh-foot{display:flex;align-items:center;gap:4px;padding:4px 8px;border-top:1px solid var(--border);background:var(--surface-2);overflow-x:auto}
.sh-foot .sh-tab{border:1px solid transparent;background:none;border-radius:10px;padding:4px 12px;cursor:pointer;font-weight:600;font-size:.8rem;white-space:nowrap;color:var(--muted)}
.sh-foot .sh-tab.on{background:var(--surface-solid);border-color:var(--border);color:var(--primary);box-shadow:0 2px 6px rgba(0,0,0,.06)}
.sh-foot .stats{margin-left:auto;font-size:.76rem;color:var(--muted);white-space:nowrap}
.sh-charts{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;margin-top:12px}
.tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.tpl{border:1px solid var(--border);border-radius:16px;padding:14px;cursor:pointer;background:var(--surface-solid);transition:transform .15s,box-shadow .15s;text-align:left}
.tpl:hover{transform:translateY(-3px);box-shadow:0 10px 24px rgba(0,0,0,.08)}
.tpl .mini{height:64px;border-radius:10px;margin-bottom:10px;background:repeating-linear-gradient(0deg,var(--border) 0 1px,transparent 1px 13px),repeating-linear-gradient(90deg,var(--border) 0 1px,transparent 1px 34px),var(--surface-2)}
@media (max-width:700px){.sh-app{height:calc(100vh - 120px)}.sh-hint{padding-left:8px}}
`);

/* ---------------- workbook helpers ---------------- */
const blankTab = name => ({ name, cells: {}, rows: 100, cols: 26, colWidths: {}, frozen: 0, charts: [] });
function normalise(tabs) {
  const list = Array.isArray(tabs) && tabs.length ? JSON.parse(JSON.stringify(tabs)) : [blankTab('Sheet1')];
  return list.map((t, i) => ({ name: cleanTabName(t.name || `Sheet${i + 1}`), cells: t.cells || {}, rows: Math.max(t.rows || 0, 100), cols: Math.max(t.cols || 0, 26), colWidths: t.colWidths || {}, frozen: t.frozen || 0, charts: t.charts || [] }));
}
const cellCount = tabs => tabs.reduce((n, t) => n + Object.keys(t.cells || {}).length, 0);
function usedRange(t) { let r = -1, c = -1; for (const a of Object.keys(t.cells || {})) { const p = parseAddr(a); if (p) { if (p.r > r) r = p.r; if (p.c > c) c = p.c; } } return { r, c }; }
// key-order-independent JSON (Postgres jsonb hands objects back with its own key order)
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x));
const uniqueName = (tabs, name) => { let n = cleanTabName(name), k = 2; const has = x => tabs.some(t => t.name.toLowerCase() === x.toLowerCase()); while (has(n)) n = cleanTabName(`${name} ${k++}`); return n; };
/** Build a tab from a 2-D array of inputs (strings go through parseInput, so "=B2*C2" is a formula). */
function fromGrid(name, grid, { header = true, fmt: colFmt = {}, widths = {}, frozen = header ? 1 : 0, decimal = '.' } = {}) {
  const cells = {};
  grid.forEach((row, r) => row.forEach((raw, c) => {
    // a cell may be a plain input or { in, fmt, b } to set its own format / bold
    const o = raw && typeof raw === 'object' ? raw : { in: raw };
    const val = o.in;
    if (val === '' || val == null) return;
    const inp = typeof val === 'number' ? { v: val } : typeof val === 'boolean' ? { v: val } : parseInput(String(val), { decimal });
    if (!inp) return;
    const cell = inp.f != null ? { f: inp.f } : { v: inp.v };
    const s = {};
    if ((header && r === 0) || o.b) { s.b = true; if (header && r === 0) s.bg = '#e8f3ec'; }
    const f = o.fmt || ((r > 0 || !header) && (inp.fmt || colFmt[colName(c)]));
    if (f) s.fmt = f;
    if (Object.keys(s).length) cell.s = s;
    cells[addr(c, r)] = cell;
  }));
  const colWidths = {}; Object.entries(widths).forEach(([k, w]) => { colWidths[typeof k === 'string' && /^[A-Z]+$/.test(k) ? parseAddr(k + '1').c : k] = w; });
  return { name: cleanTabName(name), cells, rows: Math.max(100, grid.length + 30), cols: Math.max(26, ...grid.map(r => r.length)), colWidths, frozen, charts: [] };
}

/* ---------------- templates (structure + formulas; figures come from the company's own data) ---------------- */
function latestExpensePeriod() { return db.all('expenses').map(e => e.period).filter(Boolean).sort().pop() || today().slice(0, 7); }
const vatRegistered = () => !!company().vat_registered; // VAT is only charged when the company is registered
/** Roles allowed to read a collection (null = everyone): a sheet made from restricted data inherits them. */
const readersOf = col => { const r = SCHEMA[col] && SCHEMA[col].perms && SCHEMA[col].perms.read; return !r || r === '*' || (Array.isArray(r) && r.includes('*')) ? null : r; };
export const canSeeSheet = (s, user = store.get('user') || {}) => !Array.isArray(s.restricted_to) || !s.restricted_to.length || ['owner', 'admin'].includes(user.role) || s.created_by === user.id || s.restricted_to.includes(user.role);
const TEMPLATES = [
  { key: 'blank', name: 'Blank spreadsheet', icon: 'sheet', desc: 'Start from scratch', build: () => [blankTab('Sheet1')] },
  { key: 'costing', name: 'Job costing', icon: 'calculator', desc: 'Qty × rate, markup and margin for one job', build: () => {
    const vat = vatRegistered();
    const rows = [
      ['Item', 'Qty', 'Unit', 'Rate (R)', 'Amount (R)'],
      ['Labour', '', 'hr', '', '=B2*D2'], ['Materials', '', 'each', '', '=B3*D3'], ['Plants', '', 'each', '', '=B4*D4'], ['Refuse removal / dumping', '', 'load', '', '=B5*D5'], ['Fuel & travel', '', 'km', '', '=B6*D6'], ['Equipment hire', '', 'day', '', '=B7*D7'], ['Subcontractor', '', 'job', '', '=B8*D8'],
      [], ['', '', '', { in: 'Cost total', b: true }, '=SUM(E2:E8)'], ['', '', '', 'Markup %', '30%'], ['', '', '', { in: vat ? 'Price excl. VAT' : 'Price (no VAT — not VAT registered)', b: !vat }, { in: '=ROUND(E10*(1+E11),2)', b: !vat }]
    ];
    if (vat) rows.push(['', '', '', 'VAT (15%)', '=VAT(E12)'], ['', '', '', { in: 'Price incl. VAT', b: true }, { in: '=E12+E13', b: true }]);
    rows.push(['', '', '', 'Gross margin %', { in: '=IFERROR((E12-E10)/E12,0)', fmt: 'percent' }]);
    return [fromGrid('Costing', rows, { fmt: { D: 'money', E: 'money' }, widths: { A: 220, D: 200, E: 130 } })];
  } },
  { key: 'budget', name: 'Budget vs actual', icon: 'piggy-bank', desc: 'Actuals filled from the latest month of recorded expenses', restricted: () => readersOf('expenses'), build: () => {
    const period = latestExpensePeriod(); const cats = optionValues(fieldsOf('expenses').find(f => f.name === 'category') || { options: [] });
    const actual = c => db.filter('expenses', e => e.period === period && e.category === c).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const rows = cats.map((c, i) => [fmt.titleCase(String(c).replace(/_/g, ' ')), '', Math.round(actual(c) * 100) / 100, `=C${i + 2}-B${i + 2}`, `=IFERROR(C${i + 2}/B${i + 2},"")`]);
    return [fromGrid(`Budget ${period}`, [['Category', 'Budget (R)', `Actual ${period} (R)`, 'Variance (R)', '% of budget'], ...rows, [], ['Total', `=SUM(B2:B${rows.length + 1})`, `=SUM(C2:C${rows.length + 1})`, `=C${rows.length + 3}-B${rows.length + 3}`, `=IFERROR(C${rows.length + 3}/B${rows.length + 3},"")`]], { fmt: { B: 'money', C: 'money', D: 'money', E: 'percent' }, widths: { A: 200, B: 130, C: 150, D: 130 } })];
  } },
  { key: 'timesheet', name: 'Crew timesheet', icon: 'clock', desc: 'One row per current employee, hours × rate', restricted: () => readersOf('employees'), build: () => {
    const staff = db.filter('employees', e => e.status !== 'left').map(e => [e.first_name ? `${e.first_name} ${e.last_name || ''}`.trim() : e.name || e.full_name || e.id]).sort();
    const rows = staff.map(([n], i) => [n, '', '', '', '', '', '', '', `=SUM(B${i + 2}:H${i + 2})`, '', `=I${i + 2}*J${i + 2}`]);
    return [fromGrid('Timesheet', [['Employee', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Hours', 'Rate (R/hr)', 'Pay (R)'], ...rows, [], ['Total', ...Array(7).fill(''), `=SUM(I2:I${rows.length + 1})`, '', `=SUM(K2:K${rows.length + 1})`]], { fmt: { J: 'money', K: 'money' }, widths: { A: 190 } })];
  } },
  { key: 'pricelist', name: 'Service price list', icon: 'tags', desc: 'Every service in the catalogue with its rate', build: () => {
    const svc = db.all('services').filter(s => s.active !== false).sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)));
    const vat = vatRegistered();
    return [fromGrid('Price list', [['Service', 'Category', 'Unit', 'Rate (R)', ...(vat ? ['Rate incl. VAT (R)'] : [])], ...svc.map((s, i) => [s.name, fmt.titleCase(String(s.category || '').replace(/_/g, ' ')), s.unit || '', s.rate == null ? '' : Number(s.rate), ...(vat ? [`=IF(D${i + 2}="","",INCVAT(D${i + 2}))`] : [])])], { fmt: { D: 'money', E: 'money' }, widths: { A: 260, B: 160 } })];
  } }
];

/* ---------------- live data from any collection ---------------- */
const LIVE = ['clients', 'sites', 'contracts', 'invoices', 'quotes', 'payments', 'expenses', 'jobs', 'visits', 'leads', 'employees', 'vehicles', 'assets', 'suppliers', 'services', 'purchases', 'tasks', 'events', 'kpi_entries'];
function tabFromCollection(col) {
  const skipTypes = new Set(['json', 'richtext', 'signature', 'file', 'files', 'bank_account', 'sa_id', 'tax_ref']);
  const all = fieldsOf(col).filter(f => !f.hidden && !f.sensitive && !skipTypes.has(f.type));
  const fields = [...all.filter(f => f.list), ...all.filter(f => !f.list)].slice(0, 24);
  const recs = db.all(col);
  const cellOf = (f, v) => {
    if (v == null || v === '') return null;
    if (['money', 'number', 'int', 'rating'].includes(f.type)) return Number.isFinite(Number(v)) ? { v: Number(v), s: f.type === 'money' ? { fmt: 'money' } : undefined } : { v: String(v) };
    if (f.type === 'percent') return { v: Number(v) / 100, s: { fmt: 'percent' } };
    if (f.type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(v)) return { v: dateToSerial(String(v).slice(0, 10)), s: { fmt: 'date' } };
    if (f.type === 'datetime') return { v: fmt.dateTime(v) }; // stored in UTC — shown in South African time
    if (f.type === 'bool') return { v: !!v };
    if (f.type === 'ref') return { v: db.label(f.ref, v) || String(v) };
    if (Array.isArray(v)) return { v: v.map(x => (f.type === 'refs' ? db.label(f.ref, x) || x : x)).join(', ') };
    if (typeof v === 'object') return { v: JSON.stringify(v) };
    return { v: String(v) };
  };
  const cells = {};
  fields.forEach((f, c) => { cells[addr(c, 0)] = { v: f.label || fmt.titleCase(f.name.replace(/_/g, ' ')), s: { b: true, bg: '#e8f3ec' } }; });
  recs.forEach((r, i) => fields.forEach((f, c) => { const x = cellOf(f, r[f.name]); if (x) { if (!x.s) delete x.s; cells[addr(c, i + 1)] = x; } }));
  return { name: cleanTabName(`${SCHEMA[col].label || col} ${today()}`), cells, rows: recs.length + 30, cols: Math.max(26, fields.length), colWidths: Object.fromEntries(fields.map((f, c) => [c, f.type === 'longtext' || f.name.includes('name') || f.name.includes('description') ? 200 : 120])), frozen: 1, charts: [] };
}

/* ---------------- file import ---------------- */
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  const s = String(text).replace(/^﻿/, '');
  const delim = (s.split('\n')[0].match(/;/g) || []).length > (s.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  rows.delimiter = delim; // ';' means the file came from comma-decimal Excel (e.g. South African regional settings)
  return rows;
}
function tabsFromXlsx(wb, X) {
  return wb.SheetNames.map(name => {
    const ws = wb.Sheets[name]; const cells = {}; let maxR = 0, maxC = 0;
    for (const [k, c] of Object.entries(ws)) {
      if (k[0] === '!') continue;
      // formula cells saved without a cached value arrive as stubs (t:'z') — keep them, we recalculate
      const p = parseAddr(k); if (!p || (c.t === 'z' && !c.f)) continue;
      const cell = {}; const s = {};
      const isDate = c.z && X.SSF && X.SSF.is_date(c.z);
      if (c.f) cell.f = String(c.f).replace(/^=/, '');
      else if (c.t === 'n') cell.v = c.v;
      else if (c.t === 'b') cell.v = !!c.v;
      else if (c.t === 'd') { cell.v = dateToSerial(new Date(c.v).toISOString().slice(0, 10)); s.fmt = 'date'; }
      else if (c.t === 'e') cell.v = c.w || '#VALUE!';
      else cell.v = String(c.v ?? '');
      if (!s.fmt && c.z && (c.t === 'n' || c.f)) s.fmt = isDate ? 'date' : /%/.test(c.z) ? 'percent' : /R|\$/.test(c.z) ? 'money' : /0\.0/.test(c.z) ? 'number' : /#,##0/.test(c.z) ? 'int' : undefined;
      if (!s.fmt) delete s.fmt;
      if (Object.keys(s).length) cell.s = s;
      cells[k] = cell; maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c);
    }
    const colWidths = {}; (ws['!cols'] || []).forEach((c, i) => { if (c && (c.wpx || c.wch)) colWidths[i] = Math.max(40, Math.round(c.wpx || c.wch * 7.5)); });
    return { name: cleanTabName(name), cells, rows: Math.max(100, maxR + 30), cols: Math.max(26, maxC + 1), colWidths, frozen: 0, charts: [] };
  });
}
async function tabsFromFile(file) {
  const name = file.name || 'Imported';
  if (/\.csv$|\.txt$/i.test(name) || /csv|text\/plain/.test(file.type || '')) {
    const grid = parseCSV(await file.text());
    return [fromGrid(name.replace(/\.[^.]+$/, ''), grid, { header: true, decimal: grid.delimiter === ';' ? ',' : '.' })];
  }
  let X; try { X = await ensureLib('xlsx'); } catch { throw new Error('The Excel library could not load — check your connection and try again.'); }
  const wb = X.read(await file.arrayBuffer(), { cellFormula: true, cellNF: true, cellDates: false, sheetStubs: true });
  return tabsFromXlsx(wb, X);
}
async function createSheet(title, tabs, extra = {}) {
  const n = cellCount(tabs);
  if (n > MAX_CELLS) throw new Error(`That workbook has ${fmt.num(n)} cells — the limit is ${fmt.num(MAX_CELLS)}. Split it into smaller files.`);
  const s = await db.insert('sheets', { title, tabs, drive_id: extra.drive_id || null, folder_id: extra.folder_id || null, source_path: extra.source_path || null, restricted_to: extra.restricted_to || null });
  if (extra.drive_id || extra.folder_id) await db.insert('files', { name: title, kind: 'sheet', ref_id: s.id, drive_id: extra.drive_id || null, folder_id: extra.folder_id || null, mime: 'application/vnd.lsi.sheet' }).catch(() => {});
  return s;
}
const pickFile = accept => new Promise(res => { const i = h('input', { type: 'file', accept, style: 'display:none', onChange: () => { res(i.files[0] || null); i.remove(); } }); document.body.appendChild(i); i.click(); });

/* ---------------- home ---------------- */
function home(ctx) {
  const list = h('div');
  const draw = () => {
    const rows = db.all('sheets').filter(s => canSeeSheet(s)).sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
    list.replaceChildren(rows.length ? h('div.list.divider-list', rows.map(s => listItem({
      title: s.title, sub: `${(s.tabs || []).length} tab${(s.tabs || []).length === 1 ? '' : 's'} · ${fmt.num(cellCount(s.tabs || []))} cells · edited ${fmt.relative(s.updated_at || s.created_at)}${s.updated_by_name ? ' by ' + s.updated_by_name : ''}${Array.isArray(s.restricted_to) && s.restricted_to.length ? ` · 🔒 ${s.restricted_to.join(', ')}` : ''}`,
      icon: 'sheet', tile: 't-grass', href: `#/sheets/${encodeURIComponent(s.id)}`,
      right: can('delete', 'sheets') ? btn({ icon: 'trash-2', size: 'sm', variant: 'ghost', title: 'Delete', onClick: async e => { e.preventDefault(); e.stopPropagation(); if (await confirm(`Move “${s.title}” to the bin?`, { danger: true, ok: 'Delete' })) { await db.remove('sheets', s.id); toast.success('Moved to the bin'); } } }) : null
    }))) : emptyState({ icon: 'sheet', title: 'No spreadsheets yet', text: 'Start from a template, import an Excel file, or pull live data.' }));
  };
  draw();
  ctx.dispose.add(db.on('sheets', draw));
  const make = async (title, tabs, extra) => { try { const s = await createSheet(title, tabs, extra); ctx.navigate(`sheets/${encodeURIComponent(s.id)}`); } catch (e) { showError(e, 'Could not create the spreadsheet'); } };
  const importFile = async () => { const f = await pickFile('.xlsx,.xls,.xlsm,.ods,.csv'); if (!f) return; try { await make(f.name.replace(/\.[^.]+$/, ''), await tabsFromFile(f), { source_path: f.name }); } catch (e) { showError(e, 'Import failed'); } };
  const liveCols = LIVE.filter(c => SCHEMA[c] && can('read', c));
  const pickLive = h('select.select', { style: 'width:auto' }, liveCols.map(c => h('option', { value: c }, `${SCHEMA[c].label} (${fmt.num(db.all(c).length)})`)));
  return h('div',
    pageHeader({ title: 'Sheets', sub: 'Spreadsheets with real formulas — works with Excel and Google Sheets files.', icon: 'sheet', tile: 't-grass',
      actions: [btn({ label: 'Import Excel / CSV', icon: 'upload', variant: 'ghost', onClick: importFile }), btn({ label: 'New spreadsheet', icon: 'plus', variant: 'primary', onClick: () => make('Untitled spreadsheet', [blankTab('Sheet1')]) })] }),
    card({ title: 'Start something new', icon: 'sparkles', cls: 'solid', style: 'margin-bottom:14px' }, h('div.tpl-grid', TEMPLATES.filter(t => !t.restricted || (t.restricted() || []).length === 0 || ['owner', 'admin', ...(t.restricted() || [])].includes((store.get('user') || {}).role)).map(t => h('button.tpl', { type: 'button', onClick: () => make(t.key === 'blank' ? 'Untitled spreadsheet' : t.name, t.build(), { restricted_to: t.restricted ? t.restricted() : null }) }, h('div.mini'), h('div.row.gap-8', icon(t.icon, 16), h('strong', t.name)), h('div.small.muted', t.desc))))),
    liveCols.length ? card({ title: 'Pull live data', sub: 'A snapshot of any table as a spreadsheet. A sheet made from restricted records (expenses, staff, leads…) is only visible to the roles that may read those records.', icon: 'database-zap', cls: 'solid', style: 'margin-bottom:14px' },
      h('div.row.gap-8', pickLive, btn({ label: 'Create sheet', icon: 'arrow-right', onClick: () => { const c = pickLive.value; make(`${SCHEMA[c].label} — ${fmt.date(today())}`, [tabFromCollection(c)], { restricted_to: readersOf(c) }); } }))) : null,
    card({ title: 'Your spreadsheets', icon: 'folder-open', cls: 'solid' }, list));
}

/* ---------------- editor ---------------- */
function editor(ctx) {
  const id = decodeURIComponent(ctx.params.id);
  const rec = db.get('sheets', id);
  if (!rec) return emptyState({ icon: 'search-x', title: 'Spreadsheet not found', action: btn({ label: 'All spreadsheets', onClick: () => ctx.navigate('sheets') }) });
  if (!canSeeSheet(rec)) return emptyState({ icon: 'lock', title: 'This spreadsheet is restricted', text: `It was made from records only ${rec.restricted_to.join(', ')} may read.` });
  // never invent a blank workbook for a sheet whose data did not load — the next autosave would overwrite the real one
  if (!Array.isArray(rec.tabs)) return emptyState({ icon: 'cloud-off', title: 'This spreadsheet did not load completely', text: 'Reload the page to try again. Nothing has been changed.' });
  const writable = can('write', 'sheets');
  let book = normalise(rec.tabs), title = rec.title;
  // what the server last had (base for merging someone else's edits) and what we last sent (to spot our own echo)
  let serverBook = JSON.parse(JSON.stringify(book)), serverTitle = title, lastSentJson = JSON.stringify(rec.tabs), dirty = false;
  let ti = Math.min(Math.max(0, Number(ctx.query.tab) || 0), book.length - 1);
  let result = evaluateBook(book, { today: today() });
  const tab = () => book[ti];
  const vals = () => result.values[tab().name] || {};
  let act = { c: 0, r: 0 }, anchor = { c: 0, r: 0 }, sel = { c1: 0, r1: 0, c2: 0, r2: 0 };
  const undo = [], redo = [];
  let editing = null, dragging = false, pointing = null, clip = null, lastLocal = 0, win = { a: -1, b: -1 };

  /* ----- saving ----- */
  const saveState = h('span.small.muted', 'All changes saved');
  const save = debounce(async () => {
    const sending = JSON.parse(JSON.stringify(book)), sendingTitle = title;
    try {
      saveState.textContent = 'Saving…';
      lastSentJson = JSON.stringify(sending);
      await db.update('sheets', id, { title: sendingTitle, tabs: sending });
      serverBook = sending; serverTitle = sendingTitle;
      if (JSON.stringify(book) === lastSentJson && title === sendingTitle) dirty = false;
      saveState.textContent = `Saved ${fmt.time(new Date().toISOString())}`;
    } catch (e) { saveState.textContent = 'Not saved'; showError(e); }
  }, 700);
  const recalc = () => { result = evaluateBook(book, { today: today() }); };
  function change(mut, { calc = true } = {}) {
    if (!writable) { toast.error('You have read-only access to Sheets'); return; }
    undo.push(JSON.stringify(book)); if (undo.length > 80) undo.shift(); redo.length = 0;
    mut(); lastLocal = Date.now(); dirty = true;
    if (calc) recalc();
    save(); render();
  }
  const restore = (from, to) => { if (!from.length) return; to.push(JSON.stringify(book)); book = JSON.parse(from.pop()); ti = Math.min(ti, book.length - 1); dirty = true; recalc(); save(); render(); };

  /* ----- cell helpers ----- */
  const width = c => tab().colWidths[c] || DEF_W;
  const colLeft = c => { let x = HW; for (let i = 0; i < c; i++) x += width(i); return x; };
  const cellAt = a => tab().cells[a];
  const fmtOf = a => (cellAt(a) && cellAt(a).s && cellAt(a).s.fmt) || 'general';
  const editText = cell => {
    if (!cell) return '';
    if (cell.f != null) return '=' + cell.f;
    const v = cell.v, f = cell.s && cell.s.fmt;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return f === 'date' ? serialToDate(v) ?? String(v) : f === 'percent' ? `${+(v * 100).toPrecision(12)}%` : String(v);
    return v == null ? '' : String(v);
  };
  function writeCell(t, a, text) {
    const inp = parseInput(text); const old = t.cells[a]; const st = { ...((old && old.s) || {}) };
    if (!inp) { if (Object.keys(st).length) t.cells[a] = { s: st }; else delete t.cells[a]; return; }
    const cell = inp.f != null ? { f: normaliseFormula(inp.f) } : { v: inp.v };
    if (inp.fmt && (!st.fmt || st.fmt === 'general')) st.fmt = inp.fmt;
    if (Object.keys(st).length) cell.s = st;
    t.cells[a] = cell;
    const p = parseAddr(a); if (p.r >= t.rows - 5) t.rows = p.r + 50; if (p.c >= t.cols) t.cols = p.c + 1;
  }
  const eachSel = fn => { for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) fn(addr(c, r), c, r); };
  const selAddr = () => (sel.c1 === sel.c2 && sel.r1 === sel.r2 ? addr(sel.c1, sel.r1) : `${addr(sel.c1, sel.r1)}:${addr(sel.c2, sel.r2)}`);
  function select(c, r, extend = false) {
    const t = tab(); c = Math.max(0, Math.min(c, t.cols - 1)); r = Math.max(0, r);
    if (r >= t.rows) t.rows = r + 20;
    act = { c, r };
    if (!extend) anchor = { c, r };
    sel = { c1: Math.min(anchor.c, c), r1: Math.min(anchor.r, r), c2: Math.max(anchor.c, c), r2: Math.max(anchor.r, r) };
    ensureVisible(c, r); paintSel(); syncBar(); paintTools();
  }
  /** Select a block without scrolling (row / column headers, select-all). */
  function selectRange(c1, r1, c2, r2, focus = { c: c1, r: r1 }) {
    anchor = { c: c1, r: r1 }; act = focus;
    sel = { c1: Math.min(c1, c2), r1: Math.min(r1, r2), c2: Math.max(c1, c2), r2: Math.max(r1, r2) };
    paintSel(); syncBar(); paintTools();
  }
  const selectAll = () => { const u = usedRange(tab()); selectRange(0, 0, Math.max(0, u.c), Math.max(0, u.r)); };
  function styleSel(patch) { change(() => eachSel(a => { const cell = { ...(tab().cells[a] || {}) }; const s = { ...(cell.s || {}), ...patch }; Object.keys(s).forEach(k => (s[k] == null || s[k] === false) && delete s[k]); if (Object.keys(s).length) cell.s = s; else delete cell.s; if (cell.f == null && cell.v == null && !cell.s) delete tab().cells[a]; else tab().cells[a] = cell; }), { calc: false }); }
  const toggle = k => { const on = !!((cellAt(addr(act.c, act.r)) || {}).s || {})[k]; styleSel({ [k]: on ? null : true }); };

  /* ----- DOM ----- */
  const scroll = h('div.sh-scroll', { tabindex: -1 });
  // keyboard sink: a hidden textarea receives keys, typed text (IME, phones, automation) and clipboard events
  const sink = h('textarea.sh-sink', { 'aria-label': 'Spreadsheet grid — type to edit the selected cell', inputmode: 'none', autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
  const table = h('table.sh-grid');
  const wrap = h('div.sh-wrap', scroll, sink);
  scroll.appendChild(table);
  const nameBox = h('input.nb', { 'aria-label': 'Cell address', onKeydown: e => { if (e.key !== 'Enter') return; const [a, b] = nameBox.value.toUpperCase().split(':').map(parseAddr); if (!a) return toast.error('Type an address like B7 or A1:D20'); anchor = a; select(a.c, a.r); if (b) select(b.c, b.r, true); sink.focus({ preventScroll: true }); } });
  const fx = h('input.fx', { placeholder: writable ? 'Type a value or =formula' : 'Read-only', disabled: !writable, spellcheck: false, 'aria-label': 'Formula bar' });
  const hint = h('div.sh-hint');
  const statsEl = h('span.stats');
  const tabsEl = h('div.row.gap-4');
  const chartsEl = h('div');
  let theadRow = null, tbody = null;

  function buildHead() {
    const t = tab();
    const cg = h('colgroup', h('col', { style: `width:${HW}px` }), Array.from({ length: t.cols }, (_, c) => h('col', { style: `width:${width(c)}px` })));
    theadRow = h('tr', h('th.rh', { title: 'Select all', onMousedown: e => { e.preventDefault(); e.stopPropagation(); if (editing) commitEdit(null); selectAll(); sink.focus({ preventScroll: true }); } }, ''),
      Array.from({ length: t.cols }, (_, c) => h('th', { dataset: { c }, style: 'position:sticky;top:0' }, colName(c), writable ? h('span.rs', { onMousedown: e => resizeStart(e, c) }) : null)));
    tbody = h('tbody');
    table.replaceChildren(cg, h('thead', theadRow), tbody);
    table.style.width = `${colLeft(t.cols)}px`;
    win = { a: -1, b: -1 };
    drawBody(true);
  }
  function rowEl(r, frozenIdx) {
    const t = tab(), v = vals();
    const tr = h('tr', frozenIdx != null ? { class: ['frz', frozenIdx === t.frozen - 1 ? 'last' : ''], style: `--top:${RH * (frozenIdx + 1)}px` } : null, h('th.rh', { dataset: { r } }, r + 1));
    for (let c = 0; c < t.cols; c++) {
      const a = addr(c, r), cell = t.cells[a], val = v[a], s = (cell && cell.s) || {};
      const cls = [typeof val === 'number' ? 'num' : typeof val === 'boolean' ? 'bool' : '', isErr(val) ? 'err' : ''];
      const style = [s.b ? 'font-weight:700' : '', s.i ? 'font-style:italic' : '', s.u ? 'text-decoration:underline' : '', s.align ? `text-align:${s.align}` : '', s.bg ? `background:${s.bg}` : '', s.color ? `color:${s.color}` : ''].filter(Boolean).join(';');
      tr.appendChild(h('td', { class: cls, dataset: { a }, style: style || undefined, title: isErr(val) && cell && cell.f ? `=${cell.f}` : undefined }, formatValue(val, s.fmt)));
    }
    return tr;
  }
  function drawBody(force = false) {
    if (!tbody) return;
    const t = tab(), fz = Math.min(t.frozen || 0, t.rows);
    const vh = scroll.clientHeight || 600;
    const first = Math.max(fz, Math.floor(scroll.scrollTop / RH) - 8), last = Math.min(t.rows - 1, first + Math.ceil(vh / RH) + 16);
    if (!force && first === win.a && last === win.b) return;
    win = { a: first, b: last };
    const cols = t.cols + 1;
    const rows = [];
    for (let r = 0; r < fz; r++) rows.push(rowEl(r, r));
    rows.push(h('tr', { style: `height:${(first - fz) * RH}px` }, h('td', { colspan: cols, style: 'padding:0;border:0' })));
    for (let r = first; r <= last; r++) rows.push(rowEl(r));
    rows.push(h('tr', { style: `height:${Math.max(0, t.rows - 1 - last) * RH}px` }, h('td', { colspan: cols, style: 'padding:0;border:0' })));
    tbody.replaceChildren(...rows);
    paintSel();
  }
  function paintSel() {
    table.querySelectorAll('td.in,td.act').forEach(td => td.classList.remove('in', 'act'));
    table.querySelectorAll('th.hl').forEach(th => th.classList.remove('hl'));
    const multi = sel.c1 !== sel.c2 || sel.r1 !== sel.r2;
    for (const td of table.querySelectorAll('td[data-a]')) {
      const p = parseAddr(td.dataset.a);
      if (p.c >= sel.c1 && p.c <= sel.c2 && p.r >= sel.r1 && p.r <= sel.r2) { if (multi) td.classList.add('in'); if (p.c === act.c && p.r === act.r) td.classList.add('act'); }
    }
    for (let c = sel.c1; c <= sel.c2; c++) theadRow && theadRow.children[c + 1] && theadRow.children[c + 1].classList.add('hl');
    table.querySelectorAll('th.rh[data-r]').forEach(th => { const r = Number(th.dataset.r); if (r >= sel.r1 && r <= sel.r2) th.classList.add('hl'); });
    nameBox.value = selAddr();
    // quick maths for the selection
    if (multi) { let sum = 0, n = 0, cnt = 0; const v = vals(); eachSel(a => { const x = v[a]; if (x != null && x !== '') cnt++; if (typeof x === 'number') { sum += x; n++; } }); statsEl.textContent = n ? `Sum ${formatValue(+sum.toPrecision(15), fmtOf(addr(act.c, act.r)))} · Average ${formatValue(+(sum / n).toPrecision(12), fmtOf(addr(act.c, act.r)))} · Count ${cnt}` : `Count ${cnt}`; }
    else statsEl.textContent = '';
  }
  let progScroll = false; // our own scrolling (bringing a cell into view) must not commit the edit that caused it
  const scrollTo = (k, v) => { if (Math.round(scroll[k]) !== Math.round(v)) { progScroll = true; scroll[k] = v; } };
  function ensureVisible(c, r) {
    const t = tab(), top = (r + 1) * RH, fzH = (1 + Math.min(t.frozen || 0, r)) * RH;
    if (r >= (t.frozen || 0)) { if (top - fzH < scroll.scrollTop) scrollTo('scrollTop', top - fzH); else if (top + RH > scroll.scrollTop + scroll.clientHeight) scrollTo('scrollTop', top + RH - scroll.clientHeight); }
    const l = colLeft(c), rgt = l + width(c);
    if (l - HW < scroll.scrollLeft) scrollTo('scrollLeft', l - HW); else if (rgt > scroll.scrollLeft + scroll.clientWidth) scrollTo('scrollLeft', rgt - scroll.clientWidth);
    drawBody();
  }
  function syncBar() { if (editing) return; fx.value = editText(cellAt(addr(act.c, act.r))); hint.replaceChildren(); }

  /* ----- editing ----- */
  function startEdit(initial, where = 'cell', quick = false) {
    if (!writable) return;
    if (editing) commitEdit(null);
    const a = addr(act.c, act.r); const orig = editText(cellAt(a));
    const value = initial != null ? initial : orig;
    if (where === 'bar') { editing = { a, input: fx, orig, quick: false, where }; fx.value = value; return; }
    ensureVisible(act.c, act.r);
    const td = table.querySelector(`td[data-a="${a}"]`); if (!td) return;
    const wr = wrap.getBoundingClientRect(), rr = td.getBoundingClientRect();
    const input = h('input.sh-edit', { value, spellcheck: false, style: `left:${rr.left - wr.left}px;top:${rr.top - wr.top}px;height:${rr.height}px;min-width:${rr.width}px;width:${Math.max(rr.width, Math.min(420, value.length * 8 + 30))}px`,
      onInput: () => { pointing = null; fx.value = input.value; input.style.width = `${Math.max(rr.width, Math.min(520, input.value.length * 8 + 30))}px`; showHint(input); },
      onKeydown: e => editKey(e, input), onBlur: () => setTimeout(() => { if (editing && editing.input === input && document.activeElement !== fx && !pointing) commitEdit(null); }, 0) });
    wrap.appendChild(input);
    editing = { a, input, orig, quick, where };
    fx.value = value;
    input.focus(); const n = input.value.length; input.setSelectionRange(n, n);
    showHint(input);
  }
  function commitEdit(move) {
    if (!editing) return;
    const { a, input, orig } = editing; const text = input.value;
    const tIdx = ti;
    if (input !== fx) input.remove();
    editing = null; pointing = null; hint.replaceChildren();
    if (text !== orig) change(() => writeCell(book[tIdx], a, text));
    if (move === 'down') select(act.c, act.r + 1); else if (move === 'up') select(act.c, act.r - 1); else if (move === 'right') select(act.c + 1, act.r); else if (move === 'left') select(act.c - 1, act.r);
    else syncBar();
    sink.focus({ preventScroll: true });
  }
  function cancelEdit() { if (!editing) return; if (editing.input !== fx) editing.input.remove(); editing = null; pointing = null; hint.replaceChildren(); syncBar(); sink.focus({ preventScroll: true }); }
  function editKey(e, input) {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(e.shiftKey ? 'up' : 'down'); }
    else if (e.key === 'Tab') { e.preventDefault(); commitEdit(e.shiftKey ? 'left' : 'right'); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    else if (editing && editing.quick && !input.value.startsWith('=') && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); commitEdit({ ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right' }[e.key]); }
  }
  function showHint(input) {
    const before = input.value.slice(0, input.selectionStart ?? input.value.length);
    const m = before.startsWith('=') && /([A-Za-z][A-Za-z.]{0,})$/.exec(before);
    if (!m || m[1].length < 1) { hint.replaceChildren(); return; }
    const pre = m[1].toUpperCase(); const hits = FUNCTION_NAMES.filter(n => n.startsWith(pre)).slice(0, 10);
    hint.replaceChildren(...hits.map(n => h('button', { type: 'button', onMousedown: e => { e.preventDefault(); const start = before.length - m[1].length; input.value = input.value.slice(0, start) + n + '(' + input.value.slice(before.length); const pos = start + n.length + 1; input.focus(); input.setSelectionRange(pos, pos); if (input !== fx) fx.value = input.value; else if (editing && editing.input !== fx) editing.input.value = input.value; hint.replaceChildren(); } }, n)));
  }
  const canPoint = () => { if (!editing) return false; const i = editing.input; const before = i.value.slice(0, i.selectionStart ?? i.value.length); return before.startsWith('=') && /[=(,+\-*/^&<>:]\s*$/.test(before); };
  /** Click (or drag) cells while typing a formula to insert A1 / A1:C9 — clicking again replaces the last pointed ref. */
  function pointAt(a, extend) {
    const i = editing.input;
    const cur = i.selectionStart ?? i.value.length;
    if (!pointing || cur !== pointing.start + pointing.len) pointing = { start: cur, len: 0, anchor: a };
    else if (!extend) pointing.anchor = a;
    const ref = extend && pointing.anchor !== a ? (() => { const p = parseAddr(pointing.anchor), q = parseAddr(a); return `${addr(Math.min(p.c, q.c), Math.min(p.r, q.r))}:${addr(Math.max(p.c, q.c), Math.max(p.r, q.r))}`; })() : a;
    i.value = i.value.slice(0, pointing.start) + ref + i.value.slice(pointing.start + pointing.len);
    pointing.len = ref.length;
    const pos = pointing.start + pointing.len; i.setSelectionRange(pos, pos);
    if (i !== fx) fx.value = i.value; else if (editing.input !== fx) editing.input.value = i.value;
  }

  /* ----- mouse ----- */
  scroll.addEventListener('mousedown', e => {
    const td = e.target.closest('td[data-a]'), th = e.target.closest('th');
    if (td) {
      const p = parseAddr(td.dataset.a);
      if (canPoint() || (pointing && editing)) { e.preventDefault(); pointAt(td.dataset.a, false); dragging = 'point'; return; }
      if (editing) commitEdit(null);
      e.preventDefault(); sink.focus({ preventScroll: true });
      if (e.shiftKey) select(p.c, p.r, true); else { anchor = p; select(p.c, p.r); }
      dragging = 'sel'; return;
    }
    if (th && th.dataset.c != null && !e.target.classList.contains('rs')) { e.preventDefault(); if (editing) commitEdit(null); const c = Number(th.dataset.c); const u = usedRange(tab()); selectRange(e.shiftKey ? sel.c1 : c, 0, c, Math.max(u.r, 0), { c, r: 0 }); sink.focus({ preventScroll: true }); }
    else if (th && th.dataset.r != null) { e.preventDefault(); if (editing) commitEdit(null); const r = Number(th.dataset.r); const u = usedRange(tab()); selectRange(0, e.shiftKey ? sel.r1 : r, Math.max(u.c, 0), r, { c: 0, r }); sink.focus({ preventScroll: true }); }
  });
  scroll.addEventListener('mouseover', e => {
    if (!dragging) return; const td = e.target.closest('td[data-a]'); if (!td) return;
    if (dragging === 'point' && editing) { pointAt(td.dataset.a, true); return; }
    const p = parseAddr(td.dataset.a); select(p.c, p.r, true);
  });
  const up = () => { if (dragging === 'point' && editing) editing.input.focus(); dragging = false; };
  document.addEventListener('mouseup', up); ctx.dispose.add(() => document.removeEventListener('mouseup', up));
  scroll.addEventListener('dblclick', e => { const td = e.target.closest('td[data-a]'); if (td) startEdit(null, 'cell'); });
  // keep a formula edit open while scrolling to point at far-away cells; plain values commit
  scroll.addEventListener('scroll', () => {
    if (progScroll) progScroll = false;
    else if (editing && editing.input !== fx && !editing.input.value.startsWith('=')) commitEdit(null);
    drawBody();
  }, { passive: true });
  scroll.addEventListener('contextmenu', e => {
    const td = e.target.closest('td[data-a]'); if (!td || !writable) return;
    const p = parseAddr(td.dataset.a); if (!(p.c >= sel.c1 && p.c <= sel.c2 && p.r >= sel.r1 && p.r <= sel.r2)) { anchor = p; select(p.c, p.r); }
    menu(e, [
      { label: 'Insert row above', icon: 'arrow-up-to-line', onClick: () => insertRows(sel.r1, sel.r2 - sel.r1 + 1) }, { label: 'Insert row below', icon: 'arrow-down-to-line', onClick: () => insertRows(sel.r2 + 1, sel.r2 - sel.r1 + 1) },
      { label: `Delete row${sel.r2 > sel.r1 ? 's' : ''} ${sel.r1 + 1}${sel.r2 > sel.r1 ? '–' + (sel.r2 + 1) : ''}`, icon: 'trash-2', danger: true, onClick: () => insertRows(sel.r1, -(sel.r2 - sel.r1 + 1)) }, '-',
      { label: 'Insert column left', icon: 'arrow-left-to-line', onClick: () => insertCols(sel.c1, sel.c2 - sel.c1 + 1) }, { label: 'Insert column right', icon: 'arrow-right-to-line', onClick: () => insertCols(sel.c2 + 1, sel.c2 - sel.c1 + 1) },
      { label: `Delete column${sel.c2 > sel.c1 ? 's' : ''} ${colName(sel.c1)}${sel.c2 > sel.c1 ? '–' + colName(sel.c2) : ''}`, icon: 'trash-2', danger: true, onClick: () => insertCols(sel.c1, -(sel.c2 - sel.c1 + 1)) }, '-',
      { label: 'Sort A → Z', icon: 'arrow-down-a-z', onClick: () => sortBy(false) }, { label: 'Sort Z → A', icon: 'arrow-up-z-a', onClick: () => sortBy(true) }, '-',
      { label: 'Fill down', icon: 'arrow-down', kbd: 'Ctrl+D', onClick: () => fill('down') }, { label: 'Fill right', icon: 'arrow-right', kbd: 'Ctrl+R', onClick: () => fill('right') },
      { label: 'Clear contents', icon: 'eraser', kbd: 'Del', onClick: clearSel }, { label: 'Clear formatting', icon: 'remove-formatting', onClick: () => change(() => eachSel(a => { const c = tab().cells[a]; if (c) { delete c.s; if (c.f == null && c.v == null) delete tab().cells[a]; } }), { calc: false }) }
    ]);
  });
  function resizeStart(e, c) {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = width(c); const col = table.querySelector('colgroup').children[c + 1];
    let w = w0;
    const mv = ev => { w = Math.max(36, w0 + ev.clientX - x0); col.style.width = `${w}px`; table.style.width = `${colLeft(tab().cols) - width(c) + w}px`; };
    const done = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', done); if (w !== w0) change(() => { tab().colWidths[c] = w; }, { calc: false }); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', done);
  }

  /* ----- structural ops ----- */
  function shiftWidths(at, count) { const cw = {}; for (const [k, w] of Object.entries(tab().colWidths)) { const i = Number(k); if (count < 0 && i >= at && i < at - count) continue; cw[i >= at ? i + count : i] = w; } return cw; }
  function insertRows(at, count) { change(() => { book = shiftCells(book, tab().name, 'row', at, count); }); if (count < 0) select(act.c, Math.min(act.r, tab().rows - 1)); }
  function insertCols(at, count) { change(() => { const cw = shiftWidths(at, count); book = shiftCells(book, tab().name, 'col', at, count); tab().colWidths = cw; }); buildHead(); }
  function clearSel() { change(() => eachSel(a => { const c = tab().cells[a]; if (!c) return; if (c.s) tab().cells[a] = { s: c.s }; else delete tab().cells[a]; })); }
  function sortBy(desc) {
    const u = usedRange(tab()); if (u.r < 1) return;
    const [r1, r2] = sel.r2 > sel.r1 ? [sel.r1, sel.r2] : [1, u.r];
    change(() => { tab().cells = sortRows(tab(), vals(), r1, r2, act.c, desc); });
    toast.success(`Sorted rows ${r1 + 1}–${r2 + 1} by column ${colName(act.c)}`);
  }
  function fill(dir) {
    if (dir === 'down' && sel.r2 === sel.r1) return toast.info('Select the cell to copy and the cells below it first');
    if (dir === 'right' && sel.c2 === sel.c1) return toast.info('Select the cell to copy and the cells to its right first');
    change(() => {
      const t = tab();
      if (dir === 'down') for (let c = sel.c1; c <= sel.c2; c++) { const src = t.cells[addr(c, sel.r1)]; for (let r = sel.r1 + 1; r <= sel.r2; r++) { const a = addr(c, r); if (!src) delete t.cells[a]; else t.cells[a] = src.f != null ? { ...src, f: shiftFormula(src.f, r - sel.r1, 0) } : JSON.parse(JSON.stringify(src)); } }
      else for (let r = sel.r1; r <= sel.r2; r++) { const src = t.cells[addr(sel.c1, r)]; for (let c = sel.c1 + 1; c <= sel.c2; c++) { const a = addr(c, r); if (!src) delete t.cells[a]; else t.cells[a] = src.f != null ? { ...src, f: shiftFormula(src.f, 0, c - sel.c1) } : JSON.parse(JSON.stringify(src)); } }
    });
  }
  function autoSum(fn) {
    const t = tab();
    let target, range;
    if (sel.r2 > sel.r1 || sel.c2 > sel.c1) { const tall = sel.r2 > sel.r1; target = tall ? addr(sel.c1, sel.r2 + 1) : addr(sel.c2 + 1, sel.r1); range = `${addr(sel.c1, sel.r1)}:${tall ? addr(sel.c1, sel.r2) : addr(sel.c2, sel.r1)}`; }
    else { let r = act.r - 1; while (r >= 0 && typeof vals()[addr(act.c, r)] === 'number') r--; if (r === act.r - 1) return startEdit(`=${fn}(`, 'cell'); target = addr(act.c, act.r); range = `${addr(act.c, r + 1)}:${addr(act.c, act.r - 1)}`; }
    change(() => writeCell(t, target, `=${fn}(${range})`));
    const p = parseAddr(target); anchor = p; select(p.c, p.r);
  }

  /* ----- keyboard ----- */
  sink.addEventListener('input', () => { const text = sink.value; sink.value = ''; if (!editing && text && !/[\r\n\t]/.test(text)) startEdit(text, 'cell', true); });
  sink.addEventListener('keydown', e => {
    if (editing) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    const mv = (dc, dr) => { e.preventDefault(); const base = e.shiftKey ? act : act; select(base.c + dc, base.r + dr, e.shiftKey); };
    if (mod && /^[zyZY]$/.test(k)) { e.preventDefault(); if (k.toLowerCase() === 'z' && !e.shiftKey) restore(undo, redo); else restore(redo, undo); return; }
    if (mod && k.toLowerCase() === 'b') { e.preventDefault(); toggle('b'); return; }
    if (mod && k.toLowerCase() === 'i') { e.preventDefault(); toggle('i'); return; }
    if (mod && k.toLowerCase() === 'u') { e.preventDefault(); toggle('u'); return; }
    if (mod && k.toLowerCase() === 'd') { e.preventDefault(); fill('down'); return; }
    if (mod && k.toLowerCase() === 'r') { e.preventDefault(); fill('right'); return; }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
    if (mod && k === 'Home') { e.preventDefault(); anchor = { c: 0, r: 0 }; select(0, 0); return; }
    if (mod && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(k)) { e.preventDefault(); const u = usedRange(tab()); if (k === 'ArrowDown') select(act.c, Math.max(u.r, 0), e.shiftKey); if (k === 'ArrowUp') select(act.c, 0, e.shiftKey); if (k === 'ArrowRight') select(Math.max(u.c, 0), act.r, e.shiftKey); if (k === 'ArrowLeft') select(0, act.r, e.shiftKey); return; }
    if (mod) return; // let copy / paste / find through
    switch (k) {
      case 'ArrowDown': return mv(0, 1); case 'ArrowUp': return mv(0, -1); case 'ArrowRight': return mv(1, 0); case 'ArrowLeft': return mv(-1, 0);
      case 'PageDown': return mv(0, 20); case 'PageUp': return mv(0, -20);
      case 'Home': e.preventDefault(); return select(0, act.r, e.shiftKey);
      case 'Tab': e.preventDefault(); return select(act.c + (e.shiftKey ? -1 : 1), act.r);
      case 'Enter': e.preventDefault(); return e.shiftKey ? select(act.c, act.r - 1) : startEdit(null, 'cell');
      case 'F2': e.preventDefault(); return startEdit(null, 'cell');
      case 'Delete': case 'Backspace': e.preventDefault(); return clearSel();
      case 'Escape': anchor = act; return select(act.c, act.r);
    }
    // printable keys arrive through the sink's input event
  });

  /* ----- clipboard (works with Excel / Google Sheets) ----- */
  const ours = () => document.activeElement === sink && !editing;
  const snapshot = () => { const t = tab(), out = []; for (let r = sel.r1; r <= sel.r2; r++) { const row = []; for (let c = sel.c1; c <= sel.c2; c++) row.push(t.cells[addr(c, r)] ? JSON.parse(JSON.stringify(t.cells[addr(c, r)])) : null); out.push(row); } return out; };
  const tsv = () => { const v = vals(), lines = []; for (let r = sel.r1; r <= sel.r2; r++) { const row = []; for (let c = sel.c1; c <= sel.c2; c++) { const a = addr(c, r); row.push(formatValue(v[a], fmtOf(a)).replace(/[\t\r\n]+/g, ' ')); } lines.push(row.join('\t')); } return lines.join('\n'); };
  const onCopy = (e, cut = false) => { if (!ours()) return; const text = tsv(); e.clipboardData.setData('text/plain', text); e.preventDefault(); clip = { cells: snapshot(), c: sel.c1, r: sel.r1, tab: ti, text, cut }; toast.info(`${cut ? 'Cut' : 'Copied'} ${selAddr()}`); };
  const onPaste = e => {
    if (!ours() || !writable) return;
    const text = (e.clipboardData.getData('text/plain') || '').replace(/\r/g, ''); e.preventDefault();
    const t = tab();
    if (clip && text === clip.text) {
      const dr = act.r - clip.r, dc = act.c - clip.c;
      change(() => {
        if (clip.cut) { const src = book[clip.tab]; clip.cells.forEach((row, i) => row.forEach((_, j) => delete src.cells[addr(clip.c + j, clip.r + i)])); }
        clip.cells.forEach((row, i) => row.forEach((cell, j) => { const a = addr(act.c + j, act.r + i); if (!cell) delete t.cells[a]; else t.cells[a] = cell.f != null && !clip.cut ? { ...cell, f: shiftFormula(cell.f, dr, dc) } : cell; }));
        const lastR = act.r + clip.cells.length; if (lastR >= t.rows) t.rows = lastR + 20;
      });
      anchor = { ...act }; select(act.c + clip.cells[0].length - 1, act.r + clip.cells.length - 1, true);
      if (clip.cut) clip = null;
      return;
    }
    const grid = text.replace(/\n$/, '').split('\n').map(l => l.split('\t'));
    if (!grid.length) return;
    change(() => grid.forEach((row, i) => row.forEach((val, j) => writeCell(t, addr(act.c + j, act.r + i), val))));
    anchor = { ...act }; select(act.c + Math.max(...grid.map(r => r.length)) - 1, act.r + grid.length - 1, true);
  };
  const c1 = e => onCopy(e), c2 = e => { onCopy(e, true); }, c3 = e => onPaste(e);
  document.addEventListener('copy', c1); document.addEventListener('cut', c2); document.addEventListener('paste', c3);
  ctx.dispose.add(() => { document.removeEventListener('copy', c1); document.removeEventListener('cut', c2); document.removeEventListener('paste', c3); });

  /* ----- formula bar ----- */
  fx.addEventListener('focus', () => {
    if (editing && editing.input === fx) return;
    // an in-cell edit moves to the formula bar with its text (never commit half a formula)
    if (editing) { const i = editing.input; fx.value = i.value; editing.input = fx; editing.where = 'bar'; i.remove(); return; }
    startEdit(null, 'bar');
  });
  fx.addEventListener('input', () => { pointing = null; if (editing && editing.input !== fx) editing.input.value = fx.value; showHint(fx); });
  fx.addEventListener('keydown', e => { if (!editing) return; if (editing.input !== fx) { const i = editing.input; editing.input = fx; i.remove(); } editKey(e, fx); });
  fx.addEventListener('blur', () => setTimeout(() => { if (editing && editing.input === fx && !pointing) commitEdit(null); }, 120));

  /* ----- tabs ----- */
  function switchTab(i) { if (editing) commitEdit(null); ti = i; act = { c: 0, r: 0 }; anchor = act; sel = { c1: 0, r1: 0, c2: 0, r2: 0 }; scroll.scrollTop = 0; scroll.scrollLeft = 0; render(); history.replaceState(null, '', `#/sheets/${encodeURIComponent(id)}${i ? `?tab=${i}` : ''}`); }
  async function renameTab(i) {
    const old = book[i].name; const n = await prompt('Tab name', { value: old, title: 'Rename tab' }); if (!n || n === old) return;
    const name = uniqueName(book.filter((_, k) => k !== i), n);
    change(() => { book[i].name = name; book.forEach(t => Object.values(t.cells).forEach(c => { if (c.f != null) c.f = renameSheetRefs(c.f, old, name); })); });
  }
  function drawTabs() {
    tabsEl.replaceChildren(...book.map((t, i) => h('button', { class: ['sh-tab', i === ti ? 'on' : ''], type: 'button', onClick: () => switchTab(i), onDblclick: () => writable && renameTab(i),
      onContextmenu: e => { if (!writable) return; e.preventDefault(); menu(e, [{ label: 'Rename', icon: 'pencil', onClick: () => renameTab(i) }, { label: 'Duplicate', icon: 'copy', onClick: () => change(() => { const c = JSON.parse(JSON.stringify(book[i])); c.name = uniqueName(book, `${book[i].name} copy`); book.splice(i + 1, 0, c); }) },
        i > 0 ? { label: 'Move left', icon: 'arrow-left', onClick: () => change(() => { [book[i - 1], book[i]] = [book[i], book[i - 1]]; ti = i - 1; }) } : null, i < book.length - 1 ? { label: 'Move right', icon: 'arrow-right', onClick: () => change(() => { [book[i + 1], book[i]] = [book[i], book[i + 1]]; ti = i + 1; }) } : null,
        book.length > 1 ? { label: 'Delete tab', icon: 'trash-2', danger: true, onClick: async () => { if (await confirm(`Delete the tab “${t.name}”? Formulas that point at it will show #REF!`, { danger: true, ok: 'Delete' })) change(() => { book.splice(i, 1); ti = Math.max(0, Math.min(ti, book.length - 1)); }); } } : null]); } }, t.name)),
      writable ? btn({ icon: 'plus', size: 'sm', variant: 'ghost', title: 'Add tab', onClick: () => { change(() => { book.push(blankTab(uniqueName(book, `Sheet${book.length + 1}`))); }); switchTab(book.length - 1); } }) : null);
  }

  /* ----- charts ----- */
  function chartData(spec) {
    const [a, b] = String(spec.range).split(':').map(parseAddr); if (!a || !b) return null;
    const v = vals(); const rows = [];
    for (let r = a.r; r <= b.r; r++) { const row = []; for (let c = a.c; c <= b.c; c++) row.push(v[addr(c, r)]); rows.push(row); }
    const headed = rows.length > 1 && rows[0].slice(1).some(x => typeof x === 'string');
    const body = headed ? rows.slice(1) : rows;
    const labels = body.map(r => formatValue(r[0], fmtOf(addr(a.c, a.r))));
    const series = (rows[0] || []).slice(1).map((_, j) => ({ label: headed ? String(rows[0][j + 1] ?? `Series ${j + 1}`) : `Series ${j + 1}`, data: body.map(r => (typeof r[j + 1] === 'number' ? r[j + 1] : 0)) }));
    return { labels, series: /pie|doughnut/.test(spec.type) ? series.slice(0, 1) : series };
  }
  // Chart.js instances are destroyed before every redraw (and when the editor closes) so edits never pile up canvases
  let chartKill = [];
  const killCharts = () => { chartKill.forEach(f => { try { f(); } catch { /* already gone */ } }); chartKill = []; };
  ctx.dispose.add(killCharts);
  function drawCharts() {
    killCharts();
    const list = tab().charts || [], chartDispose = { add: f => chartKill.push(f) };
    chartsEl.replaceChildren(list.length ? h('div.sh-charts', list.map(ch => { const d = chartData(ch); return card({ title: ch.title || `Chart of ${ch.range}`, icon: 'chart-column', cls: 'solid', actions: writable ? [btn({ icon: 'x', size: 'sm', variant: 'ghost', title: 'Remove chart', onClick: () => change(() => { tab().charts = tab().charts.filter(x => x.id !== ch.id); }, { calc: false }) })] : [] }, d ? chart({ type: ch.type, labels: d.labels, series: d.series, height: 240, dispose: chartDispose }) : callout('warning', 'Range is no longer valid', ch.range)); })) : null);
  }
  function chartDialog() {
    const st = { type: 'bar', title: '', range: selAddr().includes(':') ? selAddr() : '' };
    const typeSel = h('select.select', { onChange: e => { st.type = e.target.value; } }, [['bar', 'Column'], ['line', 'Line'], ['doughnut', 'Doughnut'], ['pie', 'Pie']].map(([v, l]) => h('option', { value: v }, l)));
    modal({ title: 'Insert chart', icon: 'chart-column', tile: 't-grass', body: h('div.stack', callout('info', 'How it reads your data', 'First column = labels; each next column = a series. If the first row is text it becomes the legend.', 'info'),
      h('div.field', h('label.field-label', 'Data range'), h('input.input', { value: st.range, placeholder: 'e.g. A1:C13', onInput: e => { st.range = e.target.value.toUpperCase(); } })),
      h('div.field', h('label.field-label', 'Chart type'), typeSel), h('div.field', h('label.field-label', 'Title'), h('input.input', { placeholder: 'Optional', onInput: e => { st.title = e.target.value; } }))),
      actions: [{ label: 'Cancel' }, { label: 'Insert chart', variant: 'primary', icon: 'check', onClick: () => { const [a, b] = st.range.split(':').map(parseAddr); if (!a || !b) { toast.error('Enter a range like A1:C13'); return false; } change(() => { tab().charts = [...(tab().charts || []), { id: Math.random().toString(36).slice(2, 9), ...st }]; }, { calc: false }); } }] });
  }

  /* ----- export ----- */
  const safe = s => String(s || 'spreadsheet').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  async function exportXlsx() {
    let X; try { X = await ensureLib('xlsx'); } catch { return toast.error('The Excel library could not load — check your connection and try again'); }
    const wb = X.utils.book_new();
    for (const t of book) {
      const ws = {}; let mr = 0, mc = 0; const v = result.values[t.name] || {};
      for (const [a, cell] of Object.entries(t.cells)) {
        if (cell.f == null && (cell.v == null || cell.v === '')) continue;
        const p = parseAddr(a); const val = v[a]; const o = {};
        if (isErr(val)) { o.t = 's'; o.v = val.code; } else if (typeof val === 'number') { o.t = 'n'; o.v = val; } else if (typeof val === 'boolean') { o.t = 'b'; o.v = val; } else { o.t = 's'; o.v = val == null ? '' : String(val); }
        if (cell.f != null) o.f = cell.f;
        const z = { money: '"R" #,##0.00', number: '#,##0.00', int: '#,##0', percent: '0.00%', date: 'yyyy-mm-dd' }[cell.s && cell.s.fmt]; if (z) o.z = z;
        ws[a] = o; mr = Math.max(mr, p.r); mc = Math.max(mc, p.c);
      }
      ws['!ref'] = `A1:${addr(mc, mr)}`;
      ws['!cols'] = Array.from({ length: mc + 1 }, (_, i) => ({ wpx: t.colWidths[i] || DEF_W }));
      X.utils.book_append_sheet(wb, ws, cleanTabName(t.name));
    }
    X.writeFile(wb, `${safe(title)}.xlsx`);
  }
  function exportCsv() {
    const t = tab(), u = usedRange(t), v = vals(); if (u.r < 0) return toast.info('This tab is empty');
    const lines = []; for (let r = 0; r <= u.r; r++) { const row = []; for (let c = 0; c <= u.c; c++) { const a = addr(c, r); const x = v[a]; row.push(escapeCSV(typeof x === 'number' && fmtOf(a) !== 'date' ? x : formatValue(x, fmtOf(a)))); } lines.push(row.join(',')); }
    downloadText('﻿' + lines.join('\r\n'), `${safe(title)} - ${safe(t.name)}.csv`, 'text/csv;charset=utf-8');
  }
  async function exportPdf() {
    let J; try { J = (await ensureLib('jspdf')).jsPDF; } catch { return toast.error('The PDF library could not load — check your connection and try again'); }
    const t = tab(), u = usedRange(t), v = vals(); if (u.r < 0) return toast.info('This tab is empty');
    const doc = new J({ orientation: u.c > 5 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    doc.setFontSize(14); doc.text(`${title} — ${t.name}`, 40, 40); doc.setFontSize(8); doc.text(`Landscapers Inc · printed ${fmt.dateTime(new Date().toISOString())}`, 40, 54);
    const body = []; for (let r = 0; r <= u.r; r++) { const row = []; for (let c = 0; c <= u.c; c++) { const a = addr(c, r); row.push(formatValue(v[a], fmtOf(a))); } body.push(row); }
    doc.autoTable({ startY: 66, head: [Array.from({ length: u.c + 1 }, (_, c) => colName(c))], body, styles: { fontSize: 7, cellPadding: 3 }, headStyles: { fillColor: [31, 122, 77] }, margin: { left: 40, right: 40 } });
    doc.save(`${safe(title)} - ${safe(t.name)}.pdf`);
  }
  async function importInto() {
    const f = await pickFile('.xlsx,.xls,.xlsm,.ods,.csv'); if (!f) return;
    try { const tabs = await tabsFromFile(f); if (cellCount(book) + cellCount(tabs) > MAX_CELLS) throw new Error(`This would exceed ${fmt.num(MAX_CELLS)} cells — import it as its own spreadsheet.`); change(() => {
        // an imported tab whose name is taken gets renamed, so the file's own cross-tab formulas must follow it
        // (two passes through placeholder names, so renaming "Sheet1"→"Sheet1 2" can't collide with another tab's rename)
        const moves = tabs.map((t, i) => { const from = t.name, to = uniqueName(book, from); book.push(t); t.name = to; return { from, tmp: `zzImport${i}zz`, to }; }).filter(m => m.from !== m.to);
        if (moves.length) tabs.forEach(t => Object.values(t.cells).forEach(c => {
          if (c.f == null) return;
          let f = c.f; moves.forEach(m => { f = renameSheetRefs(f, m.from, m.tmp); }); moves.forEach(m => { f = renameSheetRefs(f, m.tmp, m.to); }); c.f = f;
        }));
      }); switchTab(book.length - tabs.length); toast.success(`Added ${tabs.length} tab${tabs.length === 1 ? '' : 's'} from ${f.name}`); } catch (e) { showError(e, 'Import failed'); }
  }

  /* ----- toolbar ----- */
  const tb = (ic, title, onClick, key) => h('button.btn.btn-ghost.btn-icon.btn-sm', { type: 'button', title, 'aria-label': title, dataset: key ? { k: key } : undefined, onMousedown: e => e.preventDefault(), onClick }, icon(ic, 16));
  const fmtSel = h('select.select', { style: 'width:auto;padding:3px 8px;font-size:.8rem', title: 'Number format', onChange: e => { styleSel({ fmt: e.target.value === 'general' ? null : e.target.value }); } }, [['general', 'Automatic'], ['number', '1,234.56'], ['int', '1,235'], ['money', 'R1,234.56'], ['percent', '12.5%'], ['date', '2026-09-29']].map(([v, l]) => h('option', { value: v }, l)));
  const colorIn = (title, key) => h('label.btn.btn-ghost.btn-icon.btn-sm', { title, style: 'position:relative' }, icon(key === 'bg' ? 'paint-bucket' : 'baseline', 16), h('input', { type: 'color', value: key === 'bg' ? '#fff7cc' : '#b42318', style: 'position:absolute;inset:0;opacity:0;cursor:pointer', onChange: e => styleSel({ [key]: e.target.value }) }));
  const tools = h('div.sh-tools',
    tb('undo-2', 'Undo (Ctrl+Z)', () => restore(undo, redo)), tb('redo-2', 'Redo (Ctrl+Y)', () => restore(redo, undo)), h('span.sep'),
    fmtSel, tb('badge-percent', 'Rand format', () => styleSel({ fmt: 'money' })), h('span.sep'),
    tb('bold', 'Bold (Ctrl+B)', () => toggle('b'), 'b'), tb('italic', 'Italic (Ctrl+I)', () => toggle('i'), 'i'), tb('underline', 'Underline (Ctrl+U)', () => toggle('u'), 'u'), colorIn('Text colour', 'color'), colorIn('Fill colour', 'bg'), h('span.sep'),
    tb('align-left', 'Align left', () => styleSel({ align: 'left' })), tb('align-center', 'Centre', () => styleSel({ align: 'center' })), tb('align-right', 'Align right', () => styleSel({ align: 'right' })), h('span.sep'),
    h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Functions', onMousedown: e => e.preventDefault(), onClick: e => menu(e.currentTarget, [{ title: 'Quick totals' }, ...['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN'].map(f => ({ label: f, onClick: () => autoSum(f) })), '-', { title: 'Insert' }, ...['IF', 'SUMIF', 'VLOOKUP', 'XLOOKUP', 'ROUND', 'VAT', 'INCVAT', 'TODAY', 'NETWORKDAYS'].map(f => ({ label: `${f}(…)`, onClick: () => startEdit(`=${f}(`, 'cell') }))]) }, icon('sigma', 16), 'Σ'),
    tb('arrow-down-a-z', 'Sort A → Z', () => sortBy(false)), tb('snowflake', 'Freeze rows', e => menu(e.currentTarget, [0, 1, 2, 3].map(n => ({ label: n ? `Freeze ${n} row${n > 1 ? 's' : ''}` : 'No frozen rows', check: (tab().frozen || 0) === n, onClick: () => change(() => { tab().frozen = n; }, { calc: false }) })))),
    tb('chart-column', 'Insert chart', chartDialog), h('span.sep'),
    tb('file-down', 'Download / import', e => menu(e.currentTarget, [{ label: 'Download Excel (.xlsx)', icon: 'file-spreadsheet', onClick: exportXlsx }, { label: 'Download this tab as CSV', icon: 'file-text', onClick: exportCsv }, { label: 'Download this tab as PDF', icon: 'file-type', onClick: exportPdf }, '-', writable ? { label: 'Import Excel / CSV as new tabs…', icon: 'upload', onClick: importInto } : null])),
    h('span', { style: 'flex:1' }), saveState);
  const paintTools = () => { const s = (cellAt(addr(act.c, act.r)) || {}).s || {}; tools.querySelectorAll('button[data-k]').forEach(b => b.classList.toggle('on', !!s[b.dataset.k])); fmtSel.value = s.fmt || 'general'; };

  /* ----- realtime: someone else edited this sheet ----- */
  ctx.dispose.add(db.on('sheets', p => {
    if (!p || !p.rec || p.rec.id !== id || !p.remote) return;
    if (!Array.isArray(p.rec.tabs)) return; // a partial payload must never replace the workbook
    const remoteTitle = typeof p.rec.title === 'string' ? p.rec.title : serverTitle;
    if (canon(p.rec.tabs) === canon(JSON.parse(lastSentJson)) && remoteTitle === serverTitle) return; // our own save coming back
    const remote = normalise(p.rec.tabs);
    if (dirty || editing) {
      // unsaved work here: keep our cell changes, take theirs everywhere we haven't touched
      book = mergeBooks(serverBook, book, remote);
      if (title === serverTitle) title = remoteTitle;
    } else { book = remote; title = remoteTitle; }
    serverBook = JSON.parse(JSON.stringify(remote)); serverTitle = remoteTitle;
    undo.length = 0; redo.length = 0; // older snapshots predate their edit — undoing into one would silently erase it
    ti = Math.min(ti, book.length - 1); recalc(); render(); drawBody(true);
    if (document.activeElement !== titleIn) titleIn.value = title;
    if (dirty) save(); // our pending changes now sit on top of theirs
    toast.info(`${p.rec.updated_by_name || 'Someone'} updated this spreadsheet${dirty ? ' — your changes were kept' : ''}`);
  }));

  /* ----- render ----- */
  const titleIn = h('input.input', { value: title, disabled: !writable, style: 'font-size:1.15rem;font-weight:700;border:0;background:transparent;padding:4px 0;max-width:520px', 'aria-label': 'Spreadsheet title', onChange: e => { const v = e.target.value.trim() || 'Untitled spreadsheet'; change(() => { title = v; }, { calc: false }); } });
  function render() { buildHead(); drawTabs(); drawCharts(); paintTools(); syncBar(); }
  const root = h('div',
    h('div.row.gap-8', { style: 'margin-bottom:8px;align-items:center' }, h('a.btn.btn-ghost.btn-icon', { href: '#/sheets', title: 'All spreadsheets' }, icon('arrow-left', 18)), h('div', { class: ['li-ico', 't-grass'], style: 'width:34px;height:34px;border-radius:11px;display:grid;place-items:center;color:#fff' }, icon('sheet', 17)), titleIn, h('span.spacer'), h('span.small.muted', attribution(rec, { verb: 'Created' }))),
    !writable ? callout('info', 'Read-only', 'You can view and download this spreadsheet but not change it.', 'lock') : null,
    h('div.sh-app', tools, h('div.sh-bar', nameBox, h('span.small.muted', { style: 'font-style:italic;font-weight:700' }, 'fx'), fx), hint, wrap, h('div.sh-foot', tabsEl, statsEl)),
    chartsEl);
  render();
  requestAnimationFrame(() => { drawBody(true); sink.focus({ preventScroll: true }); });
  const ro = new ResizeObserver(() => drawBody()); ro.observe(scroll); ctx.dispose.add(() => ro.disconnect());
  ctx.dispose.add(() => { if (editing) commitEdit(null); }); // the pending debounced save still runs after leaving
  return root;
}

/* ---------------- new / import-from-drive ---------------- */
function newSheet(ctx) {
  const box = h('div', emptyState({ icon: 'loader', title: 'Creating spreadsheet…' }));
  const t = TEMPLATES.find(x => x.key === ctx.query.tpl) || TEMPLATES[0];
  createSheet(t.key === 'blank' ? 'Untitled spreadsheet' : t.name, t.build(), { drive_id: ctx.query.drive || null, folder_id: ctx.query.folder || null })
    .then(s => ctx.navigate(`sheets/${encodeURIComponent(s.id)}`, { replace: true })).catch(e => { showError(e); ctx.navigate('sheets'); });
  return box;
}
function importDriveFile(ctx) {
  const f = db.get('files', ctx.query.file || '');
  if (!f) return emptyState({ icon: 'search-x', title: 'File not found' });
  const box = h('div', emptyState({ icon: 'loader', title: `Opening ${f.name}…` }));
  (async () => {
    const existing = db.find ? db.find('sheets', s => s.source_path === `drive:${f.id}`) : db.filter('sheets', s => s.source_path === `drive:${f.id}`)[0];
    if (existing) return ctx.navigate(`sheets/${encodeURIComponent(existing.id)}`, { replace: true });
    const blob = await getBlob(f); if (!blob) throw new Error(f.vault_path && fromFolder() ? NEEDS_LOADING : 'The file bytes are not available on this device yet (still pending upload?).');
    const file = new File([blob], f.name, { type: f.mime || blob.type });
    const s = await createSheet(f.name.replace(/\.[^.]+$/, ''), await tabsFromFile(file), { source_path: `drive:${f.id}` });
    ctx.navigate(`sheets/${encodeURIComponent(s.id)}`, { replace: true });
  })().catch(e => { box.replaceChildren(emptyState({ icon: 'file-warning', title: 'Could not open the file', text: e.message })); });
  return box;
}

export { tabFromCollection, parseCSV, createSheet, tabsFromFile };
export default {
  id: 'sheets',
  routes: { '': home, new: newSheet, import: importDriveFile, ':id': editor },
  detail: { sheets: (id, ctx) => editor({ ...ctx, params: { id }, query: ctx.query || {} }) }
};
