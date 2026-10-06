/* Admin → Audit log: filters, per-record diff viewer, CSV/Excel export. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { pageHeader, card, badge } from '../../ui/components.js';
import { dataTable } from '../../ui/table.js';
import { modal } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { getDef } from '../../core/schema.js';
import { recordLink } from '../../ui/entity.js';
import * as fmt from '../../core/format.js';
import { adminNav } from './nav.js';

const ACTION_COLOR = { create: 'green', update: 'blue', delete: 'red', restore: 'gold', purge: 'gray', import: 'violet' };
const short = v => (v == null || v === '' ? '∅' : typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 80));

function diffModal(entry) {
  const def = getDef(entry.collection);
  const rows = Object.entries(entry.changes || {}).map(([k, [was, now]]) => h('tr', h('td', (def && def.fields && def.fields[k] && def.fields[k].label) || k), h('td', h('s.small.muted', short(was))), h('td', h('b', short(now)))));
  modal({
    title: `${entry.user_name} ${entry.action} ${entry.label}`, icon: 'scroll-text', tile: 't-violet', size: 'wide',
    body: h('div',
      h('p.small.muted', `${fmt.dateTime(entry.at)} · ${entry.collection}${entry.record_id ? ' · ' + entry.record_id : ''}`),
      rows.length ? h('table.table', { style: 'margin-top:10px' }, h('thead', h('tr', h('th', 'Field'), h('th', 'Was'), h('th', 'Now'))), h('tbody', rows))
        : h('p.muted', { style: 'margin-top:10px' }, 'No field-level changes recorded for this entry.'),
      def && entry.record_id ? h('a.btn.btn-ghost.btn-sm', { href: recordLink(entry.collection, entry.record_id), style: 'margin-top:14px' }, icon('arrow-right', 14), 'Open the record') : null),
    actions: [{ label: 'Close', variant: 'primary' }]
  });
}

export function auditPage(ctx) {
  const range = { from: '', to: '' };
  const table = dataTable({
    columns: [
      { key: 'at', label: 'When', render: r => h('span.nowrap', fmt.dateTime(r.at)), sort: r => r.at },
      { key: 'user_name', label: 'Who' },
      { key: 'action', label: 'Action', render: r => badge(fmt.titleCase(r.action), ACTION_COLOR[r.action] || 'gray') },
      { key: 'collection', label: 'Collection', render: r => (getDef(r.collection) || {}).label || r.collection },
      { key: 'label', label: 'Record' },
      { key: 'changes', label: 'Fields changed', hide: 'sm', render: r => (r.changes ? Object.keys(r.changes).length : 0) }
    ],
    rows: () => db.all('audit_log').filter(r => (!range.from || r.at >= range.from) && (!range.to || r.at <= range.to + 'T23:59:59')),
    search: ['user_name', 'action', 'collection', 'label'],
    filters: [
      { key: 'user_name', label: 'User', options: rows => [...new Set(rows.map(r => r.user_name))].filter(Boolean).sort() },
      { key: 'action', label: 'Action', options: ['create', 'update', 'delete', 'restore', 'purge', 'import'] },
      { key: 'collection', label: 'Collection', options: rows => [...new Set(rows.map(r => r.collection))].filter(Boolean).sort() }
    ],
    sort: '-at',
    onRowClick: diffModal,
    exportName: 'audit-log',
    empty: { icon: 'scroll-text', title: 'Nothing logged yet', text: 'Every write anyone makes will show up here.' }
  });

  const fromInput = h('input.input', { type: 'date', style: 'width:auto', onChange: e => { range.from = e.target.value; table.refresh(); } });
  const toInput = h('input.input', { type: 'date', style: 'width:auto', onChange: e => { range.to = e.target.value; table.refresh(); } });

  return h('div',
    pageHeader({ title: 'Audit log', sub: 'Every create, edit and delete, attributed and timestamped. Click a row to see what changed.', icon: 'scroll-text', tile: 't-violet', actions: [adminNav(ctx, 'audit')] }),
    card({ cls: 'solid' },
      h('div.row.wrap.gap-8', { style: 'margin-bottom:12px' }, h('span.small.muted', 'From'), fromInput, h('span.small.muted', 'to'), toInput),
      table));
}
