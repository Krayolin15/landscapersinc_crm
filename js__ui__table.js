/* =============================================================================
   dataTable — the one table used everywhere.

   dataTable({
     columns: [{ key, label, render(row) -> Node|string, sort: true|fn(row)->value,
                 num: true, width, csv(row) -> value, hide: 'sm' }],
     rows: [...] | () => [...],
     search: true | ['fields'],   // searchable fields (default: all column keys)
     filters: [{ key, label, options:[{value,label}] | fn(rows) }],
     sort: 'key' | '-key',
     pageSize: 25,
     onRowClick: row => {},
     rowClass: row => 'cls',
     selectable: true, bulkActions: [{ label, icon, onClick(selectedRows), danger }],
     exportName: 'clients',       // shows CSV + Excel export
     footer: rows => [cells],     // totals row
     empty: { icon, title, text },
     toolbar: [nodes]             // extra buttons in the toolbar
   }) -> element with .refresh(newRows?)
   ========================================================================== */

import { h, toCSV, downloadText } from './dom.js';
import { icon } from './icons.js';
import { emptyState, searchBox } from './components.js';
import { ensureLib, prefetchLib } from '../core/lazy.js';

export function dataTable(o) {
  const state = { q: '', sort: o.sort || null, page: 0, filters: {}, selected: new Set() };
  const pageSize = o.pageSize || 25;
  const getRows = () => (typeof o.rows === 'function' ? o.rows() : o.rows) || [];
  const cols = o.columns.filter(Boolean);
  const idOf = r => r.id ?? JSON.stringify(r);

  const wrap = h('div.dt');
  const tools = h('div.table-tools');
  const filterBar = h('div.chips');
  const tableWrap = h('div.table-wrap');
  const pager = h('div.table-pager');
  const bulkBar = h('div.row.wrap', { style: 'display:none;padding:8px 12px;margin-bottom:10px;border-radius:12px;background:var(--primary-soft)' });

  if (o.search !== false) tools.appendChild(searchBox({ placeholder: o.searchPlaceholder || 'Search…', onInput: v => { state.q = v; state.page = 0; render(); }, width: 'min(340px,100%)' }));
  (o.filters || []).forEach(f => {
    const sel = h('select.select', { style: 'width:auto;min-width:150px;height:38px;border-radius:999px', onChange: e => { state.filters[f.key] = e.target.value; state.page = 0; render(); } },
      h('option', { value: '' }, f.label + ': all'));
    const opts = typeof f.options === 'function' ? f.options(getRows()) : f.options;
    (opts || []).forEach(op => sel.appendChild(h('option', { value: typeof op === 'object' ? op.value : op }, typeof op === 'object' ? op.label : op)));
    tools.appendChild(sel);
  });
  tools.appendChild(h('div.spacer'));
  (o.toolbar || []).forEach(t => tools.appendChild(t));
  if (o.exportName) {
    tools.appendChild(h('button.btn.btn-ghost.btn-sm', { onClick: () => exportCSV(), 'data-tip': 'Download as CSV' }, icon('download', 15), 'CSV'));
    tools.appendChild(h('button.btn.btn-ghost.btn-sm', { onClick: () => exportXLSX(), onPointerenter: () => prefetchLib('xlsx'), onFocus: () => prefetchLib('xlsx'), 'data-tip': 'Download as Excel' }, icon('file-spreadsheet', 15), 'Excel'));
  }
  wrap.append(tools, filterBar, bulkBar, tableWrap, pager);

  function sortValue(col, r) {
    if (typeof col.sort === 'function') return col.sort(r);
    const v = r[col.key];
    return v;
  }
  function processed() {
    let rows = getRows();
    const fKeys = Object.entries(state.filters).filter(([, v]) => v !== '' && v != null);
    if (fKeys.length) rows = rows.filter(r => fKeys.every(([k, v]) => {
      const f = (o.filters || []).find(x => x.key === k);
      if (f && f.test) return f.test(r, v);
      return String(r[k] ?? '') === String(v);
    }));
    if (state.q) {
      const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      const keys = Array.isArray(o.search) ? o.search : cols.map(c => c.key);
      rows = rows.filter(r => {
        const hay = keys.map(k => { const c = cols.find(x => x.key === k); return c && c.searchText ? c.searchText(r) : r[k]; }).join(' ').toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }
    if (state.sort) {
      const desc = state.sort.startsWith('-');
      const key = desc ? state.sort.slice(1) : state.sort;
      const col = cols.find(c => c.key === key) || { key };
      rows = [...rows].sort((a, b) => {
        const x = sortValue(col, a), y = sortValue(col, b);
        if (x == null && y == null) return 0;
        if (x == null || x === '') return 1;
        if (y == null || y === '') return -1;
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true, sensitivity: 'base' });
        return desc ? -c : c;
      });
    }
    return rows;
  }

  function render() {
    const rows = processed();
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    if (state.page >= pages) state.page = pages - 1;
    const slice = rows.slice(state.page * pageSize, (state.page + 1) * pageSize);

    if (!getRows().length && o.empty) { tableWrap.replaceChildren(emptyState(o.empty)); pager.replaceChildren(); return; }

    const thead = h('thead', h('tr',
      o.selectable ? h('th', { style: 'width:36px' }, h('input', { type: 'checkbox', class: 'check', checked: slice.length > 0 && slice.every(r => state.selected.has(idOf(r))), onChange: e => { slice.forEach(r => (e.target.checked ? state.selected.add(idOf(r)) : state.selected.delete(idOf(r)))); render(); } })) : null,
      cols.map(c => {
        const sorted = state.sort === c.key || state.sort === '-' + c.key;
        return h('th', {
          class: [c.num ? 'num' : '', c.sort !== false ? 'sortable' : '', sorted ? 'sorted' : '', c.hide === 'sm' ? 'hide-sm' : ''], style: c.width ? { width: c.width } : undefined,
          onClick: c.sort === false ? undefined : () => { state.sort = state.sort === c.key ? '-' + c.key : state.sort === '-' + c.key ? null : c.key; render(); }
        }, c.label, c.sort !== false ? h('span.sort-ind', state.sort === c.key ? '▲' : state.sort === '-' + c.key ? '▼' : '↕') : null);
      })));
    const tbody = h('tbody', slice.map((r, i) => h('tr', {
      class: [o.onRowClick ? 'clickable' : '', state.selected.has(idOf(r)) ? 'selected' : '', o.rowClass ? o.rowClass(r) : ''],
      style: { animation: `fadeUp 320ms var(--ease-out) ${Math.min(i, 12) * 18}ms both` },
      onClick: o.onRowClick ? e => { if (!e.target.closest('input,button,a,select')) o.onRowClick(r); } : undefined
    },
    o.selectable ? h('td', h('input', { type: 'checkbox', checked: state.selected.has(idOf(r)), onChange: e => { e.target.checked ? state.selected.add(idOf(r)) : state.selected.delete(idOf(r)); render(); } })) : null,
    cols.map(c => {
      let v = c.render ? c.render(r) : r[c.key];
      if (v == null || v === '') v = h('span.faint', '—');
      return h('td', { class: [c.num ? 'num' : '', c.hide === 'sm' ? 'hide-sm' : '', c.cls || ''], 'data-label': c.label }, v);
    }))));
    const tfoot = o.footer ? h('tfoot', h('tr', o.selectable ? h('td') : null, o.footer(rows).map((cell, i) => h('td', { class: cols[i] && cols[i].num ? 'num' : '' }, cell ?? '')))) : null;
    tableWrap.replaceChildren(h('table', { class: ['table', 'responsive', o.compact ? 'compact' : ''] }, thead, tbody, tfoot));
    if (!rows.length) tableWrap.appendChild(h('div.empty', { style: 'padding:28px' }, h('p', state.q || Object.values(state.filters).some(Boolean) ? 'No matches for this search / filter.' : 'No records yet.')));

    pager.replaceChildren(
      h('span', `${rows.length.toLocaleString()} ${rows.length === 1 ? 'record' : 'records'}${rows.length !== getRows().length ? ` (of ${getRows().length.toLocaleString()})` : ''}`),
      pages > 1 ? h('span.row.gap-4',
        h('button.btn.btn-ghost.btn-sm.btn-icon', { disabled: state.page === 0, onClick: () => { state.page--; render(); }, 'aria-label': 'Previous page' }, icon('chevron-left', 16)),
        h('span', `${state.page + 1} / ${pages}`),
        h('button.btn.btn-ghost.btn-sm.btn-icon', { disabled: state.page >= pages - 1, onClick: () => { state.page++; render(); }, 'aria-label': 'Next page' }, icon('chevron-right', 16))) : null);

    if (o.selectable && o.bulkActions) {
      const sel = getRows().filter(r => state.selected.has(idOf(r)));
      bulkBar.style.display = sel.length ? 'flex' : 'none';
      bulkBar.replaceChildren(h('b', `${sel.length} selected`), h('div.spacer'),
        ...o.bulkActions.map(a => h('button', { class: ['btn', 'btn-sm', a.danger ? 'btn-danger-soft' : 'btn-soft'], onClick: async () => { await a.onClick(sel); state.selected.clear(); render(); } }, a.icon ? icon(a.icon, 14) : null, a.label)),
        h('button.btn.btn-ghost.btn-sm', { onClick: () => { state.selected.clear(); render(); } }, 'Clear'));
    }
  }

  function exportRows() {
    return processed().map(r => Object.fromEntries(cols.filter(c => c.export !== false).map(c => [c.label, c.csv ? c.csv(r) : (typeof r[c.key] === 'object' && r[c.key] !== null ? JSON.stringify(r[c.key]) : r[c.key])])));
  }
  function exportCSV() {
    const rows = exportRows();
    const csv = toCSV(rows, Object.keys(rows[0] || {}).map(k => ({ key: k, label: k })));
    downloadText('﻿' + csv, `${o.exportName}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
  }
  async function exportXLSX() {
    let X; try { X = await ensureLib('xlsx'); } catch { return exportCSV(); } // no Excel library (offline, first use): CSV instead
    const ws = X.utils.json_to_sheet(exportRows());
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, String(o.exportName).slice(0, 30));
    X.writeFile(wb, `${o.exportName}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  render();
  wrap.refresh = newRows => { if (newRows) o.rows = newRows; render(); };
  wrap.getRows = processed;
  return wrap;
}
