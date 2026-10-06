/* =============================================================================
   Reusable components. Every app composes its screens from these so the whole
   system looks and behaves as one product.
   ========================================================================== */

import { h, hashIndex } from './dom.js';
import { icon } from './icons.js';
import { countUp } from './animate.js';
import * as fmt from '../core/format.js';
import { db } from '../core/db.js';

const AVATAR_GRADS = ['var(--g-forest)', 'var(--g-river)', 'var(--g-clay)', 'var(--g-sun)', 'var(--g-violet)', 'var(--g-rose)', 'var(--g-grass)', 'var(--g-sky)'];

/** btn({ label, icon, variant:'primary'|'brand'|'soft'|'ghost'|'danger'|'ai', size:'sm'|'lg', onClick, href, title, block, disabled }) */
export function btn(o = {}) {
  const cls = ['btn', o.variant ? `btn-${o.variant}` : '', o.size ? `btn-${o.size}` : '', o.block ? 'btn-block' : '', !o.label && o.icon ? 'btn-icon' : '', 'ripple-host', o.cls || ''];
  const kids = [o.icon ? icon(o.icon, o.size === 'sm' ? 15 : 17) : null, o.label || null, o.trailing ? icon(o.trailing, 15) : null];
  const attrs = { class: cls, title: o.title || (!o.label ? o.tip : undefined), 'data-tip': o.tip, disabled: o.disabled, type: o.type || 'button' };
  if (o.href) return h('a', { ...attrs, href: o.href, target: o.target }, ...kids);
  return h('button', { ...attrs, onClick: o.onClick }, ...kids);
}
/** Put a button into a loading state while an async action runs. */
export async function busy(button, fn) {
  const kids = Array.from(button.childNodes);
  button.disabled = true;
  button.replaceChildren(h('span.spinner'), ...kids.filter(k => k.nodeType === 3));
  try { return await fn(); } finally { button.disabled = false; button.replaceChildren(...kids); }
}

export function badge(text, color = 'gray', o = {}) {
  return h('span', { class: ['badge', `b-${color}`, o.dot ? 'dot' : ''], title: o.title }, o.icon ? icon(o.icon, 12) : null, text);
}

/** Map common status words to colours so statuses look the same everywhere. */
const STATUS_COLORS = {
  paid: 'green', active: 'green', done: 'green', completed: 'green', won: 'green', accepted: 'green', valid: 'green', fit: 'green', closed: 'gray', approved: 'green', confirmed: 'green', current: 'green', pass: 'green', delivered: 'green', sent: 'blue', received: 'green', resolved: 'green',
  partial: 'gold', partially_paid: 'gold', pending: 'gold', draft: 'gray', open: 'blue', new: 'blue', in_progress: 'blue', scheduled: 'blue', quoted: 'gold', follow_up: 'gold', contacted: 'blue', tentative: 'gold', expiring: 'gold', due: 'gold', waiting: 'gold', review: 'gold', submitted: 'blue', reviewed: 'violet', actioned: 'green', queued: 'gold',
  overdue: 'red', lost: 'red', declined: 'red', rejected: 'red', expired: 'red', cancelled: 'gray', inactive: 'gray', suspended: 'red', failed: 'red', unfit: 'red', fail: 'red', missing: 'red', void: 'gray', churned: 'red', high: 'red', urgent: 'red', medium: 'gold', normal: 'blue', low: 'gray'
};
export function statusBadge(status, labelOverride) {
  if (!status) return badge('—', 'gray');
  const key = String(status).toLowerCase().replace(/[\s-]+/g, '_');
  return badge(labelOverride || fmt.titleCase(String(status).replace(/_/g, ' ')), STATUS_COLORS[key] || 'gray', { dot: true });
}

/** avatar(nameOrProfile, { size:'sm'|'lg'|'xl', title }) */
export function avatar(who, o = {}) {
  const p = typeof who === 'object' && who ? who : (who && db.get('profiles', who)) || { name: who };
  const name = p.name || String(who || '?');
  const bg = p.color ? p.color : AVATAR_GRADS[hashIndex(name, AVATAR_GRADS.length)];
  return h('span', { class: ['avatar', o.size || ''], style: { background: bg }, title: o.title || name, 'aria-label': name }, fmt.initials(name));
}
export function avatarStack(list, max = 4) {
  const shown = list.slice(0, max);
  return h('span.avatar-stack', shown.map(p => avatar(p, { size: 'sm' })), list.length > max ? h('span.avatar.sm', { style: { background: 'var(--slate-400)' } }, `+${list.length - max}`) : null);
}

/** "Added by Wayne · 2 Sep, 14:03" — used on events, notes, records. */
export function attribution(rec, { verb = 'Added', showUpdate = true } = {}) {
  if (!rec) return null;
  const name = rec.created_by_name || 'System';
  const parts = [h('span.attribution', avatar({ name, color: (db.get('profiles', rec.created_by) || {}).color }), h('span', `${verb} by `, h('b', name), ` · ${fmt.relative(rec.created_at)}`))];
  if (showUpdate && rec.updated_by_name && rec.updated_at && rec.updated_at !== rec.created_at && rec.updated_by !== rec.created_by) {
    parts.push(h('span.attribution', { style: 'margin-left:10px' }, icon('pencil', 12), `Edited by ${rec.updated_by_name} · ${fmt.relative(rec.updated_at)}`));
  }
  return h('span.row.wrap.gap-8', parts);
}

export function card({ title, sub, icon: ic, actions, body, footer, cls = '', accent, style } = {}, ...children) {
  // style may be an object or a CSS string
  const st = typeof style === 'string' ? `${accent ? `--card-accent:${accent};` : ''}${style}` : { ...(accent ? { '--card-accent': accent } : {}), ...(style || {}) };
  return h('section', { class: ['card', cls, accent ? 'accent-top' : ''], style: st },
    title || actions ? h('div.card-header',
      h('div.card-title', ic ? icon(ic, 17) : null, h('span', title), sub ? h('span.card-sub', sub) : null),
      actions ? h('div.row.gap-4', actions) : null) : null,
    h('div.card-body', body, children),
    footer ? h('div.card-footer', footer) : null);
}

/**
 * kpiTile({ label, value, format:'money'|'num'|'pct'|fn, icon, tile, delta (number %), deltaLabel, spark:[numbers], foot, onClick, glow })
 */
export function kpiTile(o) {
  const f = typeof o.format === 'function' ? o.format : o.format === 'money' ? v => fmt.money(v) : o.format === 'pct' ? v => fmt.pct(v) : o.format === 'compact' ? v => fmt.moneyCompact(v) : v => fmt.num(v, o.decimals || 0);
  const valueEl = h('div.k-value', typeof o.value === 'number' ? f(0) : (o.value ?? '—'));
  if (typeof o.value === 'number') countUp(valueEl, o.value, f);
  const up = o.delta > 0, good = o.inverse ? !up : up;
  return h(o.onClick || o.href ? (o.href ? 'a' : 'button') : 'div', {
    class: ['kpi', o.onClick || o.href ? 'hover' : ''], href: o.href, onClick: o.onClick,
    style: { '--kpi-glow': o.glow || undefined, textAlign: 'left', color: 'inherit', textDecoration: 'none', display: 'block', width: '100%' }
  },
  h('div.k-top', o.icon ? h('div', { class: ['k-ico', o.tile || 't-forest'] }, icon(o.icon, 18)) : null, h('div.k-label', o.label)),
  valueEl,
  h('div.k-foot',
    o.delta != null && isFinite(o.delta) ? h('span', { class: ['k-delta', good ? 'up' : 'down'] }, icon(up ? 'trending-up' : 'trending-down', 13), fmt.pct(Math.abs(o.delta))) : null,
    o.foot ? h('span', o.foot) : null),
  o.spark && o.spark.length > 1 ? sparkline(o.spark, { cls: 'k-spark', color: o.sparkColor }) : null);
}

/** Inline SVG sparkline (no library). */
export function sparkline(values, { width = 96, height = 34, color = 'var(--c1)', fill = true, cls = '' } = {}) {
  const v = values.map(Number).filter(x => isFinite(x));
  if (v.length < 2) return h('span');
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((x, i) => [(i / (v.length - 1)) * width, height - 3 - ((x - min) / span) * (height - 6)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const gid = 'sg' + Math.random().toString(36).slice(2, 8);
  return h('svg', { class: cls, viewBox: `0 0 ${width} ${height}`, width, height, preserveAspectRatio: 'none' },
    h('defs', h('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, h('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': 0.35 }), h('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }))),
    fill ? h('path', { d: `${d} L${width},${height} L0,${height} Z`, fill: `url(#${gid})` }) : null,
    h('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: `stroke-dasharray:400;stroke-dashoffset:400;animation:ringDraw 1.2s var(--ease-out) forwards;--ring-len:400` }));
}

export function progress(pct, color = '') {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return h('div', { class: ['progress', color] }, h('i', { style: { width: p + '%' } }));
}

/** ring(pct, { size, stroke, color, label, sub }) */
export function ring(pct, { size = 88, stroke = 9, color = 'var(--c1)', label, sub } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, Number(pct) || 0));
  return h('div.ring', { style: { width: size + 'px', height: size + 'px' } },
    h('svg', { width: size, height: size },
      h('circle', { class: 'ring-bg', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke }),
      h('circle', { class: 'ring-fg', cx: size / 2, cy: size / 2, r, fill: 'none', stroke: color, 'stroke-width': stroke, 'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - p / 100), style: `--ring-len:${c}` })),
    h('div.ring-label', h('b', label ?? fmt.pct(p, 0)), sub ? h('small', sub) : null));
}

/** tabs([{id,label,icon,count}], active, onChange) */
export function tabs(items, active, onChange) {
  const el = h('div.tabs', { role: 'tablist' });
  const render = a => {
    el.replaceChildren(...items.map(t => h('button', {
      class: ['tab', t.id === a ? 'active' : ''], role: 'tab', 'aria-selected': t.id === a ? 'true' : 'false',
      onClick: () => { render(t.id); onChange && onChange(t.id); }
    }, t.icon ? icon(t.icon, 15) : null, t.label, t.count != null ? h('span.badge', t.count) : null)));
  };
  render(active);
  el.setActive = render;
  return el;
}
export function seg(items, active, onChange) {
  const el = h('div.seg');
  const render = a => el.replaceChildren(...items.map(t => h('button', { class: t.id === a ? 'active' : '', onClick: () => { render(t.id); onChange && onChange(t.id); } }, t.icon ? icon(t.icon, 14) : null, t.label)));
  render(active);
  return el;
}

export function emptyState({ icon: ic = 'leaf', title = 'Nothing here yet', text, action } = {}) {
  return h('div.empty.anim-in', h('div.e-art', icon(ic, 40)), h('h3', title), text ? h('p', text) : null, action || null);
}
export function skeleton(lines = 3) {
  return h('div.stack', Array.from({ length: lines }, (_, i) => h('div.skeleton', { style: { height: i === 0 ? '22px' : '14px', width: `${90 - i * 12}%` } })));
}

/** pageHeader({ title, sub, icon, tile, actions:[nodes], crumbs:[{label,href}] }) */
export function pageHeader(o) {
  return h('header.page-header',
    h('div.titles',
      o.crumbs ? h('nav.crumbs', o.crumbs.map((c, i) => [i ? icon('chevron-right', 13) : null, c.href ? h('a', { href: c.href }, c.label) : h('span', c.label)])) : null,
      h('div.page-title', o.icon ? h('div', { class: ['ico', o.tile || 't-forest'] }, icon(o.icon, 22)) : null, h('h1', o.title)),
      o.sub ? h('div.page-sub', o.sub) : null),
    o.actions ? h('div.page-actions', o.actions) : null);
}

export function kv(pairs) {
  return h('dl.kv', pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', k), h('dd', v == null || v === '' ? h('span.faint', '—') : v)]));
}

export function listItem({ title, sub, icon: ic, tile, avatar: av, right, href, onClick }) {
  return h(href ? 'a' : onClick ? 'button' : 'div', { class: 'list-item', href, onClick, style: onClick ? 'width:100%;text-align:left' : undefined },
    av ? avatar(av) : ic ? h('div', { class: ['li-ico', tile || 't-forest'] }, icon(ic, 18)) : null,
    h('div.li-main', h('div.li-title', title), sub ? h('div.li-sub', sub) : null),
    right || null);
}

export function callout(kind, title, text, ic) {
  const icons = { info: 'info', warn: 'triangle-alert', danger: 'octagon-alert', success: 'circle-check', ai: 'sparkles' };
  return h('div', { class: ['callout', kind] }, h('span.c-ico', icon(ic || icons[kind] || 'info', 18)), h('div', title ? h('b', title) : null, text ? h('div', text) : null));
}

/** Search box with debounce. */
export function searchBox({ placeholder = 'Search…', value = '', onInput, width } = {}) {
  let t;
  const input = h('input.input', { type: 'search', placeholder, value, 'aria-label': placeholder, onInput: e => { clearTimeout(t); t = setTimeout(() => onInput && onInput(e.target.value), 160); } });
  return h('label.search-input', { style: width ? { width } : undefined }, icon('search', 16), input);
}

export function money(v) { return h('span.num', fmt.money(v)); }
export function dot(color) { return h('span', { style: { display: 'inline-block', width: '9px', height: '9px', borderRadius: '50%', background: color, flex: 'none' } }); }
