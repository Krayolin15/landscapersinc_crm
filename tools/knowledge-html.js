// Text dumps of company documents (DOCX / PDF) → clean, escaped HTML for the Docs app.
// Used by the private data-pack builder (data-tools/seed/80-knowledge.js); tested in tests/biz.test.js.
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Text dump → clean HTML. DOCX dumps carry "[Heading 2] …" style markers; PDF dumps are plain lines. */
export function dumpToHtml(raw) {
  const lines = String(raw).replace(/\r/g, '').split('\n');
  const out = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${esc(para.join(' ').replace(/\s+/g, ' ').trim())}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<ul>${list.map(i => `<li>${esc(i.trim())}</li>`).join('')}</ul>`); list = null; } };
  if (/^# DOCX/.test(lines[0] || '')) {
    for (const l of lines.slice(1)) {
      const m = /^\[([^\]]+)\]\s?(.*)$/.exec(l);
      if (!m) { if (l.trim().startsWith('|')) { flushList(); out.push(`<p class="tbl">${esc(l.trim())}</p>`); } else if (l.trim()) { flushList(); out.push(`<p>${esc(l.trim())}</p>`); } continue; }
      const [, style, text] = m;
      if (!text.trim()) continue;
      const h = /^Heading (\d)/i.exec(style) || (/^Title/i.test(style) ? [0, 1] : null);
      if (h) { flushList(); const n = Math.min(4, Number(h[1]) + 1); out.push(`<h${n}>${esc(text.trim())}</h${n}>`); }
      else if (/list|bullet/i.test(style)) { (list = list || []).push(text); }
      else { flushList(); out.push(`<p>${esc(text.trim())}</p>`); }
    }
    flushList();
    return out.join('\n');
  }
  let bullet = false;
  for (let l of lines) {
    if (/^# (PDF|PPTX|XLSX)/.test(l) || /^=== (PAGE|SLIDE) \d+ ===/.test(l)) { flushPara(); continue; }
    l = l.replace(/\s+$/, '');
    if (!l.trim()) { if (bullet) continue; flushPara(); flushList(); continue; }
    if (/^\s*[•●▪◦\-]\s*$/.test(l)) { flushPara(); list = list || []; list.push(''); bullet = true; continue; }
    const b = /^\s*[•●▪◦]\s+(.*)$/.exec(l);
    if (b) { flushPara(); (list = list || []).push(b[1]); bullet = true; continue; }
    if (bullet && list) { list[list.length - 1] += (list[list.length - 1] ? ' ' : '') + l.trim(); if (/[.;:]$/.test(l.trim())) bullet = false; continue; }
    flushList();
    const t = l.trim();
    if (!para.length && t.length < 70 && !/[.,;:]$/.test(t) && (/^[A-Z0-9 &/()'’\-–]+$/.test(t) || /^\d+(\.\d+)*\.?\s+[A-Z]/.test(t))) { out.push(`<h3>${esc(t)}</h3>`); continue; }
    para.push(t);
    if (/[.!?:]$/.test(t) && t.length < 60) flushPara();
  }
  flushPara(); flushList();
  return out.join('\n');
}
