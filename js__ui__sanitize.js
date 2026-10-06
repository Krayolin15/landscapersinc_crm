/* =============================================================================
   Allowlist HTML sanitiser for user-authored rich text (Docs, Mail, Notes).
   Parses into an inert <template>, walks every node and rebuilds only the
   tags / attributes / URL schemes listed below. Scripts, event handlers,
   iframes, forms, styles with url()/expression, javascript: links — gone.
   ========================================================================== */

const ALLOWED_TAGS = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'mark', 'sub', 'sup', 'small', 'code', 'pre', 'kbd',
  'p', 'div', 'span', 'br', 'hr', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'img', 'figure', 'figcaption', 'label', 'input', 'font'
]);
const ALLOWED_ATTRS = {
  '*': ['class', 'style', 'title', 'align', 'data-check', 'data-mention', 'colspan', 'rowspan', 'dir'],
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height'],
  input: ['type', 'checked', 'disabled'],
  font: ['color', 'face', 'size'],
  td: ['width'], th: ['width'], col: ['width']
};
const ALLOWED_STYLE_PROPS = new Set([
  'color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'font-size', 'font-family',
  'margin-left', 'padding-left', 'list-style-type', 'width', 'height', 'vertical-align', 'border', 'border-collapse', 'line-height'
]);
const SAFE_URL = /^(https?:|mailto:|tel:|#|\/|\.\/|blob:|data:image\/(png|jpe?g|gif|webp);base64,)/i;

function cleanStyle(style) {
  return String(style || '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .map(decl => {
      const i = decl.indexOf(':');
      if (i < 0) return null;
      const prop = decl.slice(0, i).trim().toLowerCase();
      const val = decl.slice(i + 1).trim();
      if (!ALLOWED_STYLE_PROPS.has(prop)) return null;
      if (/url\s*\(|expression\s*\(|javascript:|@import|behavior/i.test(val)) return null;
      return `${prop}: ${val}`;
    })
    .filter(Boolean)
    .join('; ');
}

function cleanNode(node, doc) {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.nodeValue);
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    // Drop dangerous containers entirely; unwrap anything else (keep its text).
    if (['script', 'style', 'iframe', 'object', 'embed', 'form', 'template', 'svg', 'math', 'noscript', 'link', 'meta', 'base'].includes(tag)) return null;
    const f = doc.createDocumentFragment();
    node.childNodes.forEach(c => { const cc = cleanNode(c, doc); if (cc) f.appendChild(cc); });
    return f;
  }
  if (tag === 'input' && (node.getAttribute('type') || '').toLowerCase() !== 'checkbox') return null;
  const out = doc.createElement(tag);
  const allowed = new Set([...(ALLOWED_ATTRS['*'] || []), ...(ALLOWED_ATTRS[tag] || [])]);
  for (const attr of Array.from(node.attributes)) {
    const name = attr.name.toLowerCase();
    if (!allowed.has(name) || name.startsWith('on')) continue;
    let val = attr.value;
    if (name === 'href' || name === 'src') {
      if (!SAFE_URL.test(val.trim())) continue;
    }
    if (name === 'style') {
      val = cleanStyle(val);
      if (!val) continue;
    }
    out.setAttribute(name, val);
  }
  if (tag === 'a') { out.setAttribute('rel', 'noopener noreferrer'); if (!out.getAttribute('target')) out.setAttribute('target', '_blank'); }
  node.childNodes.forEach(c => { const cc = cleanNode(c, doc); if (cc) out.appendChild(cc); });
  return out;
}

/** Returns a DocumentFragment containing only safe nodes. */
export function sanitizeToFragment(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || ''); // inert: <template> content never executes scripts or loads resources
  const frag = document.createDocumentFragment();
  tpl.content.childNodes.forEach(n => { const c = cleanNode(n, document); if (c) frag.appendChild(c); });
  return frag;
}

/** Returns a sanitised HTML string (for storage). */
export function sanitizeHTML(html) {
  const holder = document.createElement('div');
  holder.appendChild(sanitizeToFragment(html));
  return holder.innerHTML;
}

/** Plain-text version of rich HTML (for search, previews, notifications). */
export function htmlToText(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '').replace(/<(br|\/p|\/div|\/li|\/h\d)>/gi, '$&\n');
  return (tpl.content.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}
