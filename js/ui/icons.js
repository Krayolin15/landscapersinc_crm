/* =============================================================================
   Icons — Lucide (ISC licence, vendored in /vendor/lucide.min.js).
   icon('hard-drive') or icon('HardDrive') returns a fresh <svg> element.
   ========================================================================== */

const SVG_NS = 'http://www.w3.org/2000/svg';
const cache = new Map();

function pascal(name) {
  return String(name)
    .replace(/(^|[-_\s])(\w)/g, (_, __, c) => c.toUpperCase())
    .replace(/[^A-Za-z0-9]/g, '');
}

function build(node) {
  const [tag, attrs, children] = node;
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  (children || []).forEach(c => el.appendChild(build(c)));
  return el;
}

const FALLBACK = ['svg', { xmlns: SVG_NS, width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [['circle', { cx: 12, cy: 12, r: 9 }]]];

/**
 * icon(name, { size=18, stroke=2, cls, title })  or  icon(name, 20)  or  icon(name, 20, { cls })
 */
export function icon(name, opts = {}, extra = {}) {
  const { size = 18, stroke = 2, cls = '', title } = typeof opts === 'number' ? { ...extra, size: opts } : (opts || {});
  const key = pascal(name);
  let node = cache.get(key);
  if (!node) {
    const lib = globalThis.lucide && globalThis.lucide.icons;
    node = (lib && (lib[key] || lib[key.replace(/Icon$/, '')])) || FALLBACK;
    cache.set(key, node);
  }
  const svg = build(node);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('stroke-width', stroke);
  svg.setAttribute('aria-hidden', title ? 'false' : 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('ic');
  if (cls) cls.split(' ').filter(Boolean).forEach(c => svg.classList.add(c));
  if (title) {
    const t = document.createElementNS(SVG_NS, 'title');
    t.textContent = title;
    svg.prepend(t);
  }
  return svg;
}

export const hasIcon = name => !!(globalThis.lucide && globalThis.lucide.icons && globalThis.lucide.icons[pascal(name)]);
