/* =============================================================================
   Generic entity screens, driven by the schema.

   entityListPage(col, ctx, opts)        full page: header, KPIs, filters, table, create
   entityDetailPage(col, id, ctx, opts)  full page: summary, tabs (overview, related,
                                         files, comments, history) + edit/delete
   fieldValue(col, field, rec)           consistent display of any field value
   recordLink(col, id)                   universal link '#/record/<col>/<id>'
   recordComments / recordHistory / recordFiles  — embeddable panels
   ========================================================================== */

import { h } from './dom.js';
import { icon } from './icons.js';
import { btn, badge, statusBadge, pageHeader, card, kv, attribution, emptyState, tabs as tabsC, avatar } from './components.js';
import { dataTable } from './table.js';
import { openRecordForm } from './form.js';
import { confirm, toast, showError, menu } from './overlays.js';
import { db } from '../core/db.js';
import { getDef, SCHEMA, optionLabel } from '../core/schema.js';
import { can, canSeeField } from '../core/perms.js';
import * as fmt from '../core/format.js';
import { navigate } from '../core/router.js';

export const recordLink = (col, id) => `#/record/${col}/${encodeURIComponent(id)}`;

/** Display any field consistently. */
export function fieldValue(col, name, rec) {
  const def = getDef(col);
  const f = (def && def.fields && def.fields[name]) || {};
  const v = rec ? rec[name] : undefined;
  if (!canSeeField(col, name)) return h('span.faint', { 'data-tip': 'Hidden for your role' }, icon('eye-off', 14));
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return h('span.faint', '—');
  switch (f.type) {
    case 'money': return h('span.num', fmt.money(v));
    case 'number': return h('span.num', fmt.num(v, Number.isInteger(v) ? 0 : 2));
    case 'int': return h('span.num', fmt.num(v));
    case 'percent': return h('span.num', fmt.pct(v));
    case 'date': return h('span.nowrap', fmt.date(v));
    case 'datetime': return h('span.nowrap', fmt.dateTime(v));
    case 'time': return fmt.time(v);
    case 'bool': return v ? badge('Yes', 'green') : badge('No', 'gray');
    case 'enum': return /status|stage|state|outcome|result/.test(name) ? statusBadge(v, optionLabel(f, v)) : badge(optionLabel(f, v), 'forest');
    case 'tags': case 'multi': return h('span.chips', [].concat(v).map(t => badge(optionLabel(f, t), 'gray')));
    case 'phone': return h('span.row.gap-4', h('a', { href: `tel:${String(v).replace(/\s/g, '')}` }, fmt.phone(v)), h('a', { href: `https://wa.me/${fmt.phoneIntl(v)}`, target: '_blank', rel: 'noopener', 'data-tip': 'WhatsApp', style: 'color:var(--success)' }, icon('message-circle', 14)));
    case 'email': return h('a', { href: `mailto:${v}` }, v);
    case 'url': return h('a', { href: v, target: '_blank', rel: 'noopener' }, v.replace(/^https?:\/\//, ''));
    case 'ref': {
      const r = db.get(f.ref, v);
      return r ? h('a', { href: recordLink(f.ref, v) }, db.label(f.ref, r)) : h('span.faint', String(v));
    }
    case 'refs': return h('span.chips', [].concat(v).map(id => h('a.chip', { href: recordLink(f.ref, id) }, db.label(f.ref, id))));
    case 'color': return h('span.row.gap-4', h('span', { style: { width: '14px', height: '14px', borderRadius: '4px', background: v } }), v);
    case 'richtext': return h('div', { html: v });
    case 'longtext': return h('div', { style: 'white-space:pre-wrap' }, v);
    case 'signature': return h('img', { src: v, alt: 'Signature', style: 'max-height:80px;background:#fff;border-radius:8px' });
    case 'sa_id': return h('span.mono', v);
    case 'json': return h('code', { style: 'white-space:pre-wrap;font-size:11px' }, JSON.stringify(v, null, 1).slice(0, 400));
    default: return String(v);
  }
}

function defaultColumns(col) {
  const def = getDef(col);
  const listed = Object.entries(def.fields).filter(([, f]) => f.list);
  const use = (listed.length ? listed : Object.entries(def.fields).slice(0, 6)).filter(([n]) => canSeeField(col, n));
  return use.map(([n, f]) => ({
    key: n, label: f.label || fmt.titleCase(n.replace(/_/g, ' ')), num: ['money', 'number', 'int', 'percent'].includes(f.type),
    render: r => fieldValue(col, n, r),
    sort: f.type === 'ref' ? r => db.label(f.ref, r[n]) : undefined,
    searchText: f.type === 'ref' ? r => db.label(f.ref, r[n]) : undefined,
    csv: f.type === 'ref' ? r => (r[n] ? db.label(f.ref, r[n]) : '') : undefined
  }));
}

/**
 * entityListPage(col, ctx, {
 *   title, sub, icon, tile, where(row)->bool, columns, filters, kpis(rows)->[nodes], actions:[nodes],
 *   onOpen(row), createLabel, createFields, createValues, canCreate, exportName, rowClass, footer, pageSize, sort, empty, above, below
 * })
 */
export function entityListPage(col, ctx, o = {}) {
  const def = getDef(col);
  const rows = () => db.all(col).filter(o.where || (() => true));
  const kpiBox = h('div.grid.cols-4.stagger', { style: 'margin-bottom:18px' });
  const drawKpis = () => { if (o.kpis) kpiBox.replaceChildren(...o.kpis(rows())); };
  const canCreate = o.canCreate ?? can('write', col);
  const table = dataTable({
    columns: o.columns || defaultColumns(col),
    rows,
    filters: o.filters || Object.entries(def.fields).filter(([, f]) => f.type === 'enum' && f.list).slice(0, 3).map(([n, f]) => ({ key: n, label: f.label || n, options: (f.options || []).map(x => (typeof x === 'object' ? x : { value: x, label: fmt.titleCase(String(x).replace(/_/g, ' ')) })) })),
    sort: o.sort || def.sort,
    pageSize: o.pageSize || 25,
    exportName: o.exportName ?? col,
    onRowClick: o.onOpen || (r => navigate(recordLink(col, r.id).slice(2))),
    rowClass: o.rowClass,
    footer: o.footer,
    selectable: can('delete', col),
    bulkActions: can('delete', col) ? [{ label: 'Move to trash', icon: 'trash-2', danger: true, onClick: async sel => { if (await confirm(`Move ${sel.length} ${sel.length === 1 ? def.singular.toLowerCase() : def.label.toLowerCase()} to the trash?`, { danger: true, ok: 'Move to trash' })) { for (const r of sel) await db.remove(col, r.id); toast.success(`${sel.length} moved to trash`); } } }] : undefined,
    empty: o.empty || { icon: def.icon, title: `No ${def.label.toLowerCase()} yet`, text: canCreate ? `Add the first ${def.singular.toLowerCase()} to get started.` : '' }
  });
  ctx.dispose.add(db.on(col, () => { table.refresh(); drawKpis(); }));
  drawKpis();
  const createBtn = canCreate && o.canCreate !== false ? btn({ label: o.createLabel || `New ${def.singular.toLowerCase()}`, icon: 'plus', variant: 'primary', onClick: () => openRecordForm(col, { fields: o.createFields, values: typeof o.createValues === 'function' ? o.createValues() : o.createValues, onSaved: o.onCreated }) }) : null;
  return h('div',
    pageHeader({ title: o.title || def.label, sub: o.sub, icon: o.icon || def.icon, tile: o.tile || def.tile, actions: [...(o.actions || []), createBtn] }),
    o.above || null,
    o.kpis ? kpiBox : null,
    card({ cls: 'solid', body: table }),
    o.below || null);
}

/**
 * entityDetailPage(col, id, ctx, { backHref, backLabel, title(rec), sub(rec), badges(rec)->[nodes], actions(rec)->[nodes],
 *                                   summary(rec)->Node, tabs:[{id,label,icon,render(rec)}], editFields, hideDefaultTabs })
 */
export function entityDetailPage(col, id, ctx, o = {}) {
  const def = getDef(col);
  const root = h('div');
  const draw = () => {
    const rec = db.get(col, id);
    if (!rec) { root.replaceChildren(emptyState({ icon: 'search-x', title: `${def.singular} not found`, text: 'It may have been deleted.', action: o.backHref ? h('a.btn', { href: o.backHref }, 'Back') : null })); return; }
    const actions = [
      ...(o.actions ? o.actions(rec) : []),
      can('update', col) ? btn({ label: 'Edit', icon: 'pencil', onClick: () => openRecordForm(col, { id, fields: o.editFields }) }) : null,
      h('button.btn.btn-ghost.btn-icon', { 'aria-label': 'More', onClick: e => menu(e.currentTarget, [
        { label: 'Copy link', icon: 'link', onClick: () => { navigator.clipboard && navigator.clipboard.writeText(location.origin + location.pathname + recordLink(col, id)); toast.success('Link copied'); } },
        { label: 'Print', icon: 'printer', onClick: () => print() },
        can('delete', col) ? '-' : null,
        can('delete', col) ? { label: rec.deleted_at ? 'Restore from trash' : 'Move to trash', icon: rec.deleted_at ? 'rotate-ccw' : 'trash-2', danger: !rec.deleted_at, onClick: async () => {
          try {
            if (rec.deleted_at) { await db.restore(col, id); toast.success('Restored'); }
            else if (await confirm(`Move “${db.label(col, rec)}” to the trash? You can restore it later.`, { danger: true, ok: 'Move to trash' })) { await db.remove(col, id); toast.success('Moved to trash'); if (o.backHref) location.hash = o.backHref; }
          } catch (e) { showError(e); }
        } } : null
      ], { align: 'right' }) }, icon('ellipsis-vertical'))
    ];
    const tabDefs = [
      ...(o.tabs || []),
      ...(o.hideDefaultTabs ? [] : [
        { id: 'details', label: 'All details', icon: 'list', render: r => detailsGrid(col, r) },
        ...relatedTabs(col, rec),
        { id: 'files', label: 'Files', icon: 'paperclip', render: r => recordFiles(col, r.id, ctx) },
        { id: 'comments', label: 'Comments', icon: 'message-square-text', render: r => recordComments(col, r.id, ctx) },
        { id: 'history', label: 'History', icon: 'history', render: r => recordHistory(col, r.id) }
      ])
    ];
    const content = h('div');
    const show = tid => { const t = tabDefs.find(x => x.id === tid) || tabDefs[0]; content.replaceChildren(h('div.anim-fade', t.render(db.get(col, id)))); };
    root.replaceChildren(
      pageHeader({
        crumbs: o.backHref ? [{ label: o.backLabel || def.label, href: o.backHref }, { label: db.label(col, rec) }] : undefined,
        title: o.title ? o.title(rec) : db.label(col, rec), sub: o.sub ? o.sub(rec) : attribution(rec),
        icon: def.icon, tile: def.tile, actions
      }),
      rec.deleted_at ? h('div.callout.danger', { style: 'margin-bottom:14px' }, icon('trash-2'), h('div', `In the trash since ${fmt.dateTime(rec.deleted_at)} (by ${rec.deleted_by_name || '—'}).`)) : null,
      o.badges ? h('div.chips', { style: 'margin:-8px 0 16px' }, o.badges(rec)) : null,
      o.summary ? o.summary(rec) : null,
      tabDefs.length ? tabsC(tabDefs.map(t => ({ id: t.id, label: t.label, icon: t.icon, count: t.count ? t.count(rec) : undefined })), tabDefs[0].id, show) : null,
      content);
    if (tabDefs.length) show(tabDefs[0].id);
  };
  draw();
  ctx.dispose.add(db.on(col, e => { if (!e.rec || e.rec.id === id || (e.prev && e.prev.id === id)) draw(); }));
  return root;
}

export function detailsGrid(col, rec) {
  const def = getDef(col);
  const groups = {};
  for (const [n, f] of Object.entries(def.fields)) {
    if (f.hidden && f.type !== 'json') continue;
    if (f.type === 'json' && f.hidden) continue;
    const g = f.group || 'Details';
    (groups[g] = groups[g] || []).push([f.label || fmt.titleCase(n.replace(/_/g, ' ')), fieldValue(col, n, rec)]);
  }
  const extra = Object.keys(rec).filter(k => !def.fields[k] && !['id', 'data', 'created_at', 'created_by', 'created_by_name', 'updated_at', 'updated_by', 'updated_by_name', 'deleted_at', 'deleted_by', 'deleted_by_name', '_seed'].includes(k) && rec[k] != null && rec[k] !== '');
  return h('div.grid.cols-2',
    Object.entries(groups).map(([g, pairs]) => card({ title: g, cls: 'solid' }, kv(pairs))),
    extra.length ? card({ title: 'Additional information', icon: 'info', cls: 'solid' }, kv(extra.map(k => [k === '_src' ? 'Source document' : fmt.titleCase(k.replace(/_/g, ' ')), typeof rec[k] === 'object' ? h('code', { style: 'white-space:pre-wrap;font-size:11px' }, JSON.stringify(rec[k], null, 1)) : String(rec[k])]))) : null,
    card({ title: 'Record', icon: 'fingerprint', cls: 'solid' }, kv([
      ['Created', h('span', fmt.dateTime(rec.created_at), ' by ', h('b', rec.created_by_name || '—'))],
      ['Last change', h('span', fmt.dateTime(rec.updated_at), ' by ', h('b', rec.updated_by_name || '—'))],
      ['Record ID', h('code', rec.id)]
    ])));
}

/** Tabs listing records in other collections that reference this one. */
function relatedTabs(col, rec) {
  const out = [];
  for (const [other, def] of Object.entries(SCHEMA)) {
    for (const [fname, f] of Object.entries(def.fields || {})) {
      if ((f.type === 'ref' || f.type === 'refs') && f.ref === col && !['profiles'].includes(other) && can('read', other)) {
        const rows = db.all(other).filter(r => (f.type === 'ref' ? r[fname] === rec.id : Array.isArray(r[fname]) && r[fname].includes(rec.id)));
        if (!rows.length) continue;
        out.push({
          id: `rel-${other}-${fname}`, label: def.label, icon: def.icon, count: () => rows.length,
          render: () => card({ cls: 'solid', body: dataTable({ columns: defaultColumns(other), rows: () => db.all(other).filter(r => (f.type === 'ref' ? r[fname] === rec.id : Array.isArray(r[fname]) && r[fname].includes(rec.id))), onRowClick: r => navigate(recordLink(other, r.id).slice(2)), exportName: `${col}-${other}`, pageSize: 15 }) })
        });
      }
    }
  }
  return out;
}

export function recordHistory(col, id) {
  const entries = db.all('audit_log').filter(a => a.collection === col && a.record_id === id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const rec = db.get(col, id);
  const verbs = { create: 'created this', update: 'changed', delete: 'moved this to the trash', restore: 'restored this', purge: 'permanently deleted this', import: 'imported' };
  return card({ title: 'Change history', icon: 'history', cls: 'solid' },
    entries.length || rec ? h('div.timeline',
      entries.map(a => h('div.tl-item', { style: { '--tl-color': a.action === 'delete' ? 'var(--danger)' : a.action === 'create' ? 'var(--success)' : 'var(--accent)' } },
        h('div', h('b', a.user_name), ' ', verbs[a.action] || a.action, a.changes ? h('span', ' ', Object.keys(a.changes).filter(k => !k.startsWith('_')).map(k => (getDef(col)?.fields?.[k]?.label || k)).join(', ')) : null),
        a.changes ? h('div.small.muted', Object.entries(a.changes).filter(([k]) => !k.startsWith('_') && canSeeField(col, k)).slice(0, 6).map(([k, [was, now]]) => h('div', `${getDef(col)?.fields?.[k]?.label || k}: `, h('s', short(was)), ' → ', h('b', short(now))))) : null,
        h('div.tl-time', fmt.dateTime(a.at)))),
      rec && !entries.some(e => e.action === 'create') ? h('div.tl-item', h('div', h('b', rec.created_by_name || 'System'), rec._seed ? ' imported this from the company records' : ' created this', rec._src ? h('div.small.muted', 'Source: ', rec._src) : null), h('div.tl-time', fmt.dateTime(rec.created_at))) : null)
      : emptyState({ icon: 'history', title: 'No history yet' }));
}
const short = v => (v == null || v === '' ? '∅' : typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 60));

export function recordComments(col, id, ctx) {
  const list = h('div.stack');
  const draw = () => {
    const rows = db.all('comments').filter(c => c.collection === col && c.record_id === id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    list.replaceChildren(...(rows.length ? rows.map(c => h('div.row.top.anim-in', avatar({ name: c.created_by_name }), h('div', { style: 'flex:1;background:var(--surface-2);border-radius:14px;padding:10px 14px' }, h('div.row', h('b', c.created_by_name), h('span.small.faint', fmt.relative(c.created_at))), h('div', { style: 'white-space:pre-wrap' }, c.body)))) : [h('p.muted', 'No comments yet — start the conversation.')]));
  };
  const input = h('textarea.textarea', { rows: 2, placeholder: 'Write a comment… (@name to mention)' });
  const send = async () => {
    const body = input.value.trim(); if (!body) return;
    try {
      const mentions = db.all('profiles').filter(p => body.toLowerCase().includes('@' + p.name.split(' ')[0].toLowerCase())).map(p => p.id);
      await db.insert('comments', { collection: col, record_id: id, body, mentions });
      for (const uid of mentions) await db.insert('notifications', { user_id: uid, title: 'You were mentioned', body: `${body.slice(0, 120)}`, icon: 'at-sign', link: recordLink(col, id), kind: 'mention' });
      input.value = '';
    } catch (e) { showError(e); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); });
  draw();
  if (ctx) ctx.dispose.add(db.on('comments', draw));
  return card({ title: 'Comments', icon: 'message-square-text', cls: 'solid' }, list, h('div.row.top', { style: 'margin-top:14px' }, input, btn({ icon: 'send', variant: 'primary', onClick: send, tip: 'Send (Ctrl+Enter)' })));
}

export function recordFiles(col, id, ctx) {
  const wrap = h('div');
  const draw = async () => {
    const { filesFor, openFile, uploadFiles } = await import('../core/files.js');
    const rows = filesFor(col, id);
    const input = h('input', { type: 'file', multiple: true, style: 'display:none', onChange: async e => { await uploadFiles(Array.from(e.target.files), { linked: [{ collection: col, id }] }); } });
    wrap.replaceChildren(card({ title: 'Files', icon: 'paperclip', cls: 'solid', actions: [btn({ label: 'Attach', icon: 'upload', size: 'sm', onClick: () => input.click() }), input] },
      rows.length ? h('div.list', rows.map(f => h('button.list-item', { style: 'width:100%;text-align:left', onClick: () => openFile(f) }, h('div.li-ico.t-grass', icon(f.mime && f.mime.includes('pdf') ? 'file-text' : f.mime && f.mime.startsWith('image') ? 'image' : 'file', 18)), h('div.li-main', h('div.li-title', f.name), h('div.li-sub', `${fmt.fileSize(f.size)} · ${f.created_by_name || ''} · ${fmt.date(f.created_at)}`)), f.kind === 'pending' ? badge('Not uploaded yet', 'gold') : null)))
        : emptyState({ icon: 'paperclip', title: 'No files attached', text: 'Attach contracts, photos, certificates or proof of payment.' })));
  };
  draw();
  if (ctx) ctx.dispose.add(db.on('files', draw));
  return wrap;
}
