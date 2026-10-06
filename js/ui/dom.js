/* =============================================================================
   DOM helpers. The h() builder is the ONLY way views create markup.
   User data always becomes a text node — never innerHTML — so a client
   note containing <script> is shown as text, exactly as typed.
   ========================================================================== */

import { sanitizeToFragment } from './sanitize.js';

// Views pass null/false for "nothing here" (as h() and append() allow). The DOM's own
// replaceChildren() would print them as the text "null"/"false" — skip them instead.
if (typeof Element !== 'undefined' && !Element.prototype.replaceChildren.__lsiSafe) {
  for (const P of [Element.prototype, DocumentFragment.prototype]) {
    const native = P.replaceChildren;
    const safe = function (...nodes) { return native.apply(this, nodes.filter(n => n != null && n !== false && n !== true)); };
    safe.__lsiSafe = true;
    P.replaceChildren = safe;
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'defs', 'linearGradient', 'radialGradient', 'stop', 'text', 'tspan', 'ellipse', 'clipPath', 'mask', 'pattern', 'use', 'title', 'foreignObject']);

/**
 * h('div.card.hover#id', { onClick, style, dataset, attrs... }, ...children)
 * - tag may carry .class and #id shorthand
 * - attrs: class/className (string|array|object), style (string|object), dataset (object),
 *   on<Event> handlers (onClick, onInput ...), ref (fn receiving the element),
 *   any other key becomes an attribute (booleans toggle the attribute)
 * - children: strings/numbers (text), Nodes, arrays, null/undefined/false (skipped)
 */
export function h(tag, attrs, ...children) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    if (attrs != null && attrs !== false) children.unshift(attrs);
    attrs = {};
  }
  let name = tag;
  const classes = [];
  let id = null;
  const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(tag);
  if (m) {
    name = m[1] || 'div';
    (m[2].match(/[.#][\w-]+/g) || []).forEach(t => (t[0] === '.' ? classes.push(t.slice(1)) : (id = t.slice(1))));
  }
  const isSvg = SVG_TAGS.has(name) || attrs.__svg;
  const el = isSvg ? document.createElementNS(SVG_NS, name) : document.createElement(name);
  if (id) el.id = id;
  const cls = [...classes, ...toClassList(attrs.class), ...toClassList(attrs.className)];
  if (cls.length) el.setAttribute('class', cls.join(' '));

  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class' || k === 'className' || k === '__svg' || v === undefined || v === null) continue;
    if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else Object.entries(v).forEach(([sk, sv]) => { if (sv != null) (sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv)); });
    } else if (k === 'dataset') {
      Object.entries(v).forEach(([dk, dv]) => { if (dv != null) el.dataset[dk] = dv; });
    } else if (k === 'ref' && typeof v === 'function') {
      queueMicrotask(() => v(el));
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'value' && ('value' in el) && !isSvg) {
      el.value = v;
    } else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'readOnly' || k === 'multiple' || k === 'hidden') {
      el[k] = !!v;
      if (!v) el.removeAttribute(k === 'readOnly' ? 'readonly' : k);
    } else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, ''); else el.removeAttribute(k);
    } else if (k === 'html') {
      // Rich text (Docs / Mail / Notes): always passes through the allowlist sanitiser.
      el.appendChild(sanitizeToFragment(v));
    } else {
      el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function toClassList(c) {
  if (!c) return [];
  if (typeof c === 'string') return c.split(/\s+/).filter(Boolean);
  if (Array.isArray(c)) return c.flatMap(toClassList);
  if (typeof c === 'object') return Object.entries(c).filter(([, on]) => on).map(([k]) => k);
  return [];
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function frag(...children) { return append(document.createDocumentFragment(), children); }
export const text = s => document.createTextNode(s == null ? '' : String(s));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...children) { clear(el); return append(el, children); }
export function replace(oldEl, newEl) { if (oldEl && oldEl.parentNode) oldEl.parentNode.replaceChild(newEl, oldEl); return newEl; }

export function debounce(fn, ms = 200) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}
export function throttle(fn, ms = 100) {
  let last = 0, t;
  return (...a) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else { clearTimeout(t); t = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last)); }
  };
}
export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
/** Stable colour index for a string (avatars, tags). */
export function hashIndex(str, n) {
  let x = 0;
  for (const ch of String(str || '')) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return x % n;
}
export function onOutside(el, cb) {
  const fn = e => { if (!el.contains(e.target)) cb(e); };
  setTimeout(() => document.addEventListener('pointerdown', fn, true), 0);
  return () => document.removeEventListener('pointerdown', fn, true);
}
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
export function downloadText(content, filename, type = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([content], { type }), filename);
}
export function copyText(t) {
  if (navigator.clipboard) return navigator.clipboard.writeText(t);
  const ta = h('textarea', { value: t, style: 'position:fixed;left:-9999px' });
  document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  return Promise.resolve();
}
/** Load an app's stylesheet once: ensureStyle('js/apps/calendar/style.css'),
    or inline CSS under an id: ensureStyle('lsi-chat', `.x{…}`) (set via textContent). */
export function ensureStyle(href, css) {
  if (typeof document === 'undefined' || document.querySelector(`[data-app-style="${href}"]`)) return;
  if (css != null) { const s = document.createElement('style'); s.setAttribute('data-app-style', href); s.textContent = css; document.head.appendChild(s); return; }
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-app-style': href }));
}
export function escapeCSV(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCSV(rows, columns) {
  const cols = columns || Object.keys(rows[0] || {}).map(k => ({ key: k, label: k }));
  const head = cols.map(c => escapeCSV(c.label ?? c.key)).join(',');
  const body = rows.map(r => cols.map(c => escapeCSV(c.csv ? c.csv(r) : r[c.key])).join(',')).join('\r\n');
  return head + '\r\n' + body;
}
