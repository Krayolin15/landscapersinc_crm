/* Admin → Import centre: CSV/XLSX into any collection with column mapping,
   per-row validation preview, and an error report for the rows left out. */
import { h, downloadText, escapeCSV } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { pageHeader, card, btn, badge, callout, emptyState, skeleton } from '../../ui/components.js';
import { toast, showError, confirm } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { SCHEMA, getDef } from '../../core/schema.js';
import { can } from '../../core/perms.js';
import * as fmt from '../../core/format.js';
import { adminNav } from './nav.js';
import { parseCSV, autoMapColumns } from './lib.js';
import { ensureLib } from '../../core/lazy.js';

function importableFields(def) {
  return Object.entries(def.fields).filter(([, f]) => !f.computed && !f.readonly).map(([key, f]) => ({ key, label: f.label || fmt.titleCase(key.replace(/_/g, ' ')) }));
}

async function readSpreadsheet(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || file.type === 'text/csv') return parseCSV(await file.text());
  let X; try { X = await ensureLib('xlsx'); } catch { throw new Error('The Excel reader could not load — check your connection and try again, or use a CSV file.'); }
  const buf = await file.arrayBuffer();
  const wb = X.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const headers = (grid[0] || []).map(h => String(h ?? '').trim()).filter(Boolean);
  const rows = grid.slice(1).filter(r => r.some(v => String(v ?? '').trim() !== '')).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  return { headers, rows };
}

function transformRow(headers, mapping, def, raw) {
  const rec = {};
  for (const head of headers) {
    const key = mapping[head];
    if (!key) continue;
    const f = def.fields[key] || {};
    let v = raw[head];
    if (v == null) continue;
    v = typeof v === 'string' ? v.trim() : v;
    if (v === '') continue;
    if (f.type === 'tags' || f.type === 'multi') v = String(v).split(/[,;]/).map(s => s.trim()).filter(Boolean);
    rec[key] = v;
  }
  return rec;
}

export function importPage(ctx) {
  const IMPORTABLE = Object.entries(SCHEMA).filter(([col]) => can('write', col)).sort((a, b) => a[1].label.localeCompare(b[1].label));
  const state = {
    col: IMPORTABLE.some(([c]) => c === ctx.params.col) ? ctx.params.col : '',
    headers: [], rows: [], mapping: {}, filename: '', scanned: null
  };

  const root = h('div');
  const body = h('div');

  function fieldOptionsFor(def) { return importableFields(def); }

  function scan() {
    const def = getDef(state.col);
    if (!def || !state.rows.length) { state.scanned = null; return; }
    const fields = fieldOptionsFor(def);
    const results = state.rows.map((raw, i) => {
      const rec = transformRow(state.headers, state.mapping, def, raw);
      const res = db.check(state.col, rec);
      return { i, raw, rec, ok: res.ok, errors: res.errors, warnings: res.warnings };
    });
    state.scanned = { fields, results, valid: results.filter(r => r.ok), invalid: results.filter(r => !r.ok) };
  }

  async function doImport() {
    if (!state.scanned || !state.scanned.valid.length) return;
    const rows = state.scanned.valid.map(r => r.rec);
    if (!(await confirm(`Import ${rows.length} valid ${rows.length === 1 ? 'record' : 'records'} into “${getDef(state.col).label}”?`, { ok: 'Import' }))) return;
    try {
      const { saved, errors } = await db.bulkUpsert(state.col, rows, { validate: true, strict: true });
      toast.success(`Imported ${saved.length} ${saved.length === 1 ? 'record' : 'records'}`, { text: errors.length ? `${errors.length} could not be saved after all` : `into ${getDef(state.col).label}` });
      state.headers = []; state.rows = []; state.mapping = {}; state.filename = ''; state.scanned = null;
      draw();
    } catch (e) { showError(e, 'Import failed'); }
  }

  function downloadErrorReport() {
    if (!state.scanned || !state.scanned.invalid.length) return;
    const headers = [...state.headers, 'Import errors'];
    const lines = [headers.map(escapeCSV).join(',')];
    for (const r of state.scanned.invalid) {
      const msg = [...Object.values(r.errors), ...Object.values(r.warnings)].join(' · ');
      lines.push([...state.headers.map(h => escapeCSV(r.raw[h])), escapeCSV(msg)].join(','));
    }
    downloadText('﻿' + lines.join('\r\n'), `${state.col}-import-errors-${fmt.date(new Date(), 'iso') || ''}.csv`, 'text/csv;charset=utf-8');
  }

  function mappingRow(head) {
    const def = getDef(state.col);
    const sample = state.rows.slice(0, 3).map(r => r[head]).find(v => v != null && v !== '') || '';
    const sel = h('select.select', { onChange: e => { state.mapping[head] = e.target.value || null; scan(); redrawBody(); } },
      h('option', { value: '' }, '— skip this column —'),
      fieldOptionsFor(def).map(f => h('option', { value: f.key, selected: state.mapping[head] === f.key }, f.label)));
    return h('div.row.wrap.gap-8', { style: 'padding:8px 0;border-bottom:1px solid var(--border)' },
      h('div', { style: 'min-width:180px;flex:1' }, h('div.semibold', head), sample ? h('div.xs.muted.ellipsis', `e.g. “${sample}”`) : null),
      h('div', { style: 'min-width:220px' }, sel));
  }

  function previewSection() {
    if (!state.scanned) return null;
    const { valid, invalid } = state.scanned;
    return h('div.stack',
      h('div.grid.cols-2',
        card({ title: 'Ready to import', icon: 'circle-check', cls: 'solid', accent: 'var(--success)' }, h('div.k-value', { style: 'font-size:28px' }, valid.length), h('div.small.muted', `of ${state.rows.length} rows pass validation`)),
        card({ title: 'Will be skipped', icon: 'triangle-alert', cls: 'solid', accent: invalid.length ? 'var(--danger)' : undefined }, h('div.k-value', { style: 'font-size:28px' }, invalid.length), h('div.small.muted', invalid.length ? 'download the error report to see why' : 'nothing to fix'))),
      invalid.length ? h('div.stack.tight', invalid.slice(0, 25).map(r => h('div.row.wrap.gap-8', { style: 'padding:6px 0;border-bottom:1px solid var(--border)' },
        h('span.xs.muted', `Row ${r.i + 2}`), Object.values(r.errors).map(m => badge(m, 'red')), Object.values(r.warnings).map(m => badge(m, 'gold'))))) : null,
      invalid.length > 25 ? h('p.small.muted', `…and ${invalid.length - 25} more. Download the error report for the full list.`) : null,
      h('div.row.wrap.gap-8',
        btn({ label: `Import ${valid.length} valid ${valid.length === 1 ? 'record' : 'records'}`, icon: 'upload', variant: 'primary', disabled: !valid.length, onClick: doImport }),
        invalid.length ? btn({ label: 'Download error report', icon: 'download', variant: 'ghost', onClick: downloadErrorReport }) : null));
  }

  const fileInput = h('input', { type: 'file', accept: '.csv,.xlsx,.xls', style: 'display:none', onChange: async e => {
    const file = (e.target.files || [])[0]; e.target.value = '';
    if (!file) return;
    body.replaceChildren(skeleton(6));
    try {
      const { headers, rows } = await readSpreadsheet(file);
      if (!headers.length || !rows.length) { toast.error('No data found in that file'); redrawBody(); return; }
      state.headers = headers; state.rows = rows; state.filename = file.name;
      state.mapping = autoMapColumns(headers, fieldOptionsFor(getDef(state.col)));
      scan();
    } catch (err) { showError(err, 'Could not read that file'); }
    redrawBody();
  } });

  function redrawBody() {
    if (!state.col) { body.replaceChildren(emptyState({ icon: 'table', title: 'Choose a collection above to begin', text: 'Then upload a CSV or Excel file to map and preview it.' })); return; }
    if (!state.rows.length) {
      body.replaceChildren(card({ cls: 'solid' }, emptyState({ icon: 'upload', title: `Upload a file for ${getDef(state.col).label}`, text: 'CSV or Excel (.xlsx). The first row must be column headers.', action: btn({ label: 'Choose file…', icon: 'folder-open', variant: 'primary', onClick: () => fileInput.click() }) })));
      return;
    }
    body.replaceChildren(
      card({ title: 'Column mapping', sub: `${state.filename} · ${state.rows.length} row${state.rows.length === 1 ? '' : 's'}`, icon: 'columns-3', cls: 'solid',
        actions: [btn({ label: 'Choose a different file', icon: 'folder-open', size: 'sm', variant: 'ghost', onClick: () => fileInput.click() })] },
        h('div.stack.tight', state.headers.map(mappingRow))),
      h('div', { style: 'margin-top:16px' }, previewSection()));
  }

  function draw() {
    const colSelect = h('select.select', { style: 'width:auto;min-width:240px', onChange: e => { state.col = e.target.value; state.headers = []; state.rows = []; state.mapping = {}; state.scanned = null; redrawBody(); } },
      h('option', { value: '' }, 'Choose a collection…'),
      IMPORTABLE.map(([c, def]) => h('option', { value: c, selected: c === state.col }, `${def.label} (${db.count(c)})`)));
    root.replaceChildren(
      pageHeader({ title: 'Import centre', sub: 'Bring in CSV or Excel data — map the columns, preview every row, then import what passes validation.', icon: 'upload', tile: 't-slate', actions: [adminNav(ctx, 'import')] }),
      callout('info', 'Looking for documents instead?', 'Bulk-uploading files (contracts, certificates, photos) goes through the Drive vault importer.', 'hard-drive'),
      h('a.btn.btn-ghost.btn-sm', { href: '#/drive/import', style: 'margin:10px 0 16px' }, icon('hard-drive', 14), 'Open the Drive vault importer'),
      card({ cls: 'solid', style: 'margin-bottom:16px' }, h('div.field', h('label.field-label', 'Collection to import into'), colSelect)),
      body, fileInput);
    redrawBody();
  }
  draw();
  return root;
}
