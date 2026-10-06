/* =============================================================================
   Slides (#/slides) — presentations and client proposals.
   · Decks built from real records: client proposal from a quote, monthly business
     review, toolbox talk, company profile — or start blank.
   · Editor: slide rail (drag to reorder), live 16:9 stage, content & design panel,
     9 layouts, 5 themes, pictures from Drive (before/after photos) or upload.
   · Present: full screen, keyboard / click / swipe, speaker notes, timer.
   · Export: branded PDF (jsPDF) — every slide, pictures included.
   Stored in slides.slides (see lib.js); autosaves.
   ========================================================================== */

import { h, ensureStyle, debounce } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, card, pageHeader, emptyState, listItem, callout, attribution } from '../../ui/components.js';
import { toast, showError, confirm, modal, menu } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { can } from '../../core/perms.js';
import { getBlob, fileUrl, uploadFiles, fromFolder, NEEDS_LOADING } from '../../core/files.js';
import { today, addDays } from '../../core/dates.js';
import * as fmt from '../../core/format.js';
import { company, invoiceState } from '../_biz.js';
import { THEMES, LAYOUTS, blankSlide, normaliseDeck, parseBody, parseStats, parseTable, wordCount, deckFromQuote, deckMonthly, deckFromTalk, deckCompanyProfile } from './lib.js';
import { ensureLib } from '../../core/lazy.js';
import { LOGO_DATA_URL } from '../../core/logo.js';

const LOGO = 'assets__landscapers-logo.jpg';

ensureStyle('lsi-slides', `
.sl{position:relative;aspect-ratio:16/9;width:100%;container-type:inline-size;overflow:hidden;border-radius:10px;background:var(--sl-bg);color:var(--sl-fg);box-shadow:0 10px 30px rgba(0,0,0,.18);isolation:isolate}
.sl .deco{position:absolute;right:-12%;bottom:-38%;width:62%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,var(--sl-bg2),transparent 68%);opacity:.6;z-index:-1}
.sl .deco2{position:absolute;left:-8%;top:-30%;width:34%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,var(--sl-accent),transparent 70%);opacity:.12;z-index:-1}
.sl .in{position:absolute;inset:5.5cqw 7cqw 6cqw;display:flex;flex-direction:column;gap:1.8cqw;min-height:0}
.sl h1{font-size:5cqw;line-height:1.08;margin:0;font-weight:800;letter-spacing:-.02em;color:inherit;background:none;-webkit-text-fill-color:currentColor}
.sl h1,.sl p,.sl li,.sl td,.sl blockquote{color:inherit}
.sl .sub{font-size:2.1cqw;color:var(--sl-muted);margin:0}
.sl .bar{width:8cqw;height:.55cqw;border-radius:1cqw;background:var(--sl-accent);flex:none}
.sl ul{margin:0;padding-left:2.6cqw;font-size:2.05cqw;line-height:1.42;list-style:none}
.sl ul li{position:relative;margin:.35cqw 0}.sl ul li::before{content:'';position:absolute;left:-2.1cqw;top:.72em;width:.8cqw;height:.8cqw;border-radius:50%;background:var(--sl-accent);transform:translateY(-50%)}
.sl ul li.l2{margin-left:2.6cqw;font-size:1.75cqw;opacity:.88}.sl ul li.l2::before{background:transparent;border:.18cqw solid var(--sl-accent)}
.sl ul li.tx{margin-left:-2.6cqw;font-weight:700;color:var(--sl-accent)}.sl ul li.tx::before{display:none}
.sl.l-title .in,.sl.l-quote .in{justify-content:center}
.sl.l-title h1{font-size:6.2cqw}.sl.l-title .sub{font-size:2.4cqw}
.sl.l-section{background:linear-gradient(135deg,var(--sl-bg) 40%,var(--sl-bg2))}.sl.l-section .in{justify-content:flex-end}.sl.l-section h1{font-size:6cqw}
.sl .cols{display:grid;grid-template-columns:1fr 1fr;gap:4cqw;flex:1;min-height:0}
.sl.l-image-right .cols{grid-template-columns:1.05fr 1fr;gap:3cqw}
.sl .pic{width:100%;height:100%;object-fit:cover;border-radius:1.4cqw;background:color-mix(in srgb,var(--sl-fg) 10%,transparent);display:block;min-height:0}
.sl .pic.empty{display:grid;place-items:center;color:var(--sl-muted);font-size:1.6cqw;border:.2cqw dashed color-mix(in srgb,var(--sl-fg) 30%,transparent)}
.sl.l-image-full .pic{position:absolute;inset:0;border-radius:0;height:100%;z-index:-1}
.sl.l-image-full .in{justify-content:flex-end;inset:auto 0 0 0;padding:6cqw 7cqw 5cqw;background:linear-gradient(transparent,rgba(0,0,0,.72));color:#fff}.sl.l-image-full .sub{color:rgba(255,255,255,.85)}
.sl .stats{display:grid;grid-template-columns:repeat(var(--n,3),1fr);gap:2cqw;flex:1;align-content:center}
.sl .stat{background:color-mix(in srgb,var(--sl-fg) 7%,transparent);border-radius:1.6cqw;padding:2.4cqw 2cqw;border-top:.5cqw solid var(--sl-accent)}
.sl .stat b{display:block;font-size:3.9cqw;line-height:1.1;color:var(--sl-accent);font-variant-numeric:tabular-nums;word-break:break-word}.sl .stat span{display:block;margin-top:.8cqw;font-size:1.65cqw;color:var(--sl-muted)}
.sl table{width:100%;border-collapse:collapse;font-size:1.6cqw}.sl th{text-align:left;padding:.7cqw .8cqw;border-bottom:.3cqw solid var(--sl-accent);color:var(--sl-accent)}.sl td{padding:.7cqw .8cqw;border-bottom:.1cqw solid color-mix(in srgb,var(--sl-fg) 18%,transparent)}
.sl td:not(:first-child),.sl th:not(:first-child){text-align:right;white-space:nowrap}
.sl .tbl{flex:1;min-height:0;overflow:hidden}
.sl blockquote{margin:0;font-size:3.8cqw;line-height:1.25;font-weight:600;font-style:italic}.sl blockquote::before{content:'“';display:block;font-size:9cqw;line-height:.6;color:var(--sl-accent)}
.sl .logo{position:absolute;right:2.6cqw;bottom:2.2cqw;width:5.2cqw;height:5.2cqw;object-fit:cover;border-radius:1.1cqw;opacity:.9}
.sl .pg{position:absolute;left:3cqw;bottom:2.4cqw;font-size:1.2cqw;color:var(--sl-muted);letter-spacing:.08em}
.sl.l-image-full .pg{color:rgba(255,255,255,.75)}
.sd{display:grid;grid-template-columns:190px minmax(0,1fr) 310px;gap:14px;align-items:start}
@media (max-width:1100px){.sd{grid-template-columns:150px minmax(0,1fr)}.sd .sd-panel{grid-column:1/-1}}
@media (max-width:700px){.sd{grid-template-columns:1fr}.sd .sd-rail{display:flex;overflow-x:auto;gap:8px}.sd .sd-rail .th{min-width:130px}}
.sd .sd-rail{display:flex;flex-direction:column;gap:10px;max-height:calc(100vh - 170px);overflow:auto;padding:2px 4px 8px}
.sd .th{position:relative;cursor:pointer;border-radius:12px;padding:4px;border:2px solid transparent;transition:border-color .15s,transform .15s}
.sd .th:hover{transform:translateY(-1px)}.sd .th.on{border-color:var(--primary)}.sd .th.drop{border-color:var(--accent,orange);border-style:dashed}
.sd .th .n{position:absolute;left:-2px;top:-2px;background:var(--surface-solid);border-radius:8px;font-size:.68rem;font-weight:700;padding:1px 6px;box-shadow:0 1px 3px rgba(0,0,0,.2);z-index:2}
.sd .th .sl{box-shadow:none;border-radius:7px}
.sd .sd-stage{position:sticky;top:12px}
.sd .sd-panel textarea{font-family:inherit}
.theme-pick{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.theme-pick button{aspect-ratio:1.5;border-radius:10px;border:2px solid transparent;cursor:pointer}.theme-pick button.on{border-color:var(--primary);box-shadow:0 0 0 2px var(--surface-solid) inset}
.lay-pick{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.lay-pick button{font-size:.72rem;padding:6px 4px;border-radius:10px;border:1px solid var(--border);background:var(--surface);cursor:pointer}.lay-pick button.on{background:var(--primary-soft);border-color:var(--primary);color:var(--primary);font-weight:700}
.pic-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;max-height:52vh;overflow:auto}.pic-grid button{border:2px solid transparent;border-radius:10px;padding:0;overflow:hidden;cursor:pointer;background:var(--surface-2);aspect-ratio:4/3}.pic-grid button:hover{border-color:var(--primary)}.pic-grid img{width:100%;height:100%;object-fit:cover;display:block}
.present{position:fixed;inset:0;z-index:9999;background:#050806;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:none}
.present.ui{cursor:default}
.present .frame{width:min(100vw,calc(100vh * 16 / 9));max-height:100vh}
.present .frame .sl{border-radius:0;box-shadow:none}
.present .frame.go-next .sl{animation:slIn .42s cubic-bezier(.2,.8,.2,1)}.present .frame.go-prev .sl{animation:slInR .42s cubic-bezier(.2,.8,.2,1)}
@keyframes slIn{from{opacity:0;transform:translateX(3%) scale(.985)}to{opacity:1;transform:none}}
@keyframes slInR{from{opacity:0;transform:translateX(-3%) scale(.985)}to{opacity:1;transform:none}}
.present .hud{position:fixed;left:0;right:0;bottom:0;display:flex;gap:12px;align-items:center;padding:10px 16px;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.75));opacity:0;transition:opacity .25s;font-size:.85rem}
.present.ui .hud{opacity:1}
.present .hud button{background:rgba(255,255,255,.14);color:#fff;border:0;border-radius:10px;padding:6px 10px;cursor:pointer}
.present .notes{position:fixed;left:16px;right:16px;bottom:58px;max-height:32vh;overflow:auto;background:rgba(10,20,14,.92);color:#e9f3ec;border-radius:14px;padding:14px 18px;font-size:1rem;line-height:1.5;white-space:pre-wrap;display:none}
.present.shownotes .notes{display:block}
.present .prog{position:fixed;left:0;top:0;height:3px;background:#9be15d;transition:width .3s}
.present.black .frame{visibility:hidden}
`);

/* ---------------- pictures ---------------- */
const urlCache = new Map();
function imageUrl(fileId) {
  if (!fileId) return Promise.resolve(null);
  if (!urlCache.has(fileId)) urlCache.set(fileId, (async () => { const f = db.get('files', fileId); if (!f) return null; return fileUrl(f).catch(() => null); })());
  return urlCache.get(fileId);
}
const isImage = f => /^image\//.test(f.mime || '') || /\.(jpe?g|png|webp|gif)$/i.test(f.name || '');

/* ---------------- one slide ---------------- */
export function slideView(s, themeKey = 'forest', { index, total } = {}) {
  const th = THEMES[themeKey] || THEMES.forest;
  const el = h('div', { class: ['sl', `l-${s.layout}`], style: `--sl-bg:${th.bg};--sl-bg2:${th.bg2};--sl-fg:${th.fg};--sl-muted:${th.muted};--sl-accent:${th.accent}` }, h('div.deco'), h('div.deco2'));
  const bullets = text => { const items = parseBody(text); return items.length ? h('ul', items.map(b => h('li', { class: b.type === 'bullet' ? (b.level === 2 ? 'l2' : '') : 'tx' }, b.text))) : null; };
  const pic = () => { const img = h('img.pic', { alt: '' }); if (s.image_file_id) imageUrl(s.image_file_id).then(u => { if (u) img.src = u; else img.replaceWith(h('div.pic.empty', 'Picture not available on this device')); }); return s.image_file_id ? img : h('div.pic.empty', icon('image', 22), ' Add a picture'); };
  const head = () => [h('h1', s.title || ' '), s.subtitle ? h('p.sub', s.subtitle) : null];
  let inner;
  switch (s.layout) {
    case 'title': inner = h('div.in', h('div.bar'), ...head()); break;
    case 'section': inner = h('div.in', h('div.bar'), ...head()); break;
    case 'two': inner = h('div.in', ...head(), h('div.cols', h('div', bullets(s.body)), h('div', bullets(s.body2)))); break;
    case 'image-right': inner = h('div.in', ...head(), h('div.cols', h('div', bullets(s.body)), pic())); break;
    case 'image-full': el.appendChild(pic()); inner = h('div.in', ...head()); break;
    case 'stats': { const st = parseStats(s.body); inner = h('div.in', ...head(), h('div.stats', { style: `--n:${Math.max(1, st.length)}` }, st.map(x => h('div.stat', h('b', x.value), h('span', x.label))))); break; }
    case 'table': { const rows = parseTable(s.body); inner = h('div.in', ...head(), h('div.tbl', rows.length ? h('table', h('thead', h('tr', rows[0].map(c => h('th', c)))), h('tbody', rows.slice(1).map(r => h('tr', r.map(c => h('td', c)))))) : null)); break; }
    case 'quote': inner = h('div.in', h('blockquote', s.title || ''), s.subtitle ? h('p.sub', `— ${s.subtitle}`) : null); break;
    default: inner = h('div.in', ...head(), bullets(s.body));
  }
  el.appendChild(inner);
  if (s.layout !== 'image-full') el.appendChild(h('img.logo', { src: LOGO, alt: '' }));
  if (index != null && s.layout !== 'title') el.appendChild(h('div.pg', `${index + 1}${total ? ` / ${total}` : ''}`));
  return el;
}

/* ---------------- present ---------------- */
export function present(deck, themeKey, start = 0) {
  let i = Math.max(0, Math.min(start, deck.length - 1)), t0 = Date.now(), hideT = null;
  const frame = h('div.frame'), prog = h('div.prog'), notes = h('div.notes'), counter = h('span'), clock = h('span', { style: 'margin-left:auto;font-variant-numeric:tabular-nums' });
  const root = h('div.present', { tabindex: -1, role: 'dialog', 'aria-label': 'Presentation' }, prog, frame, notes,
    h('div.hud', h('button', { onClick: e => { e.stopPropagation(); go(i - 1); } }, '‹ Back'), h('button', { onClick: e => { e.stopPropagation(); go(i + 1); } }, 'Next ›'), counter,
      h('button', { onClick: e => { e.stopPropagation(); root.classList.toggle('shownotes'); } }, 'Notes (N)'), clock, h('button', { onClick: e => { e.stopPropagation(); close(); } }, 'Exit (Esc)')));
  const draw = dir => {
    frame.className = `frame ${dir ? `go-${dir}` : ''}`;
    frame.replaceChildren(slideView(deck[i], themeKey, { index: i, total: deck.length }));
    notes.textContent = deck[i].notes || 'No speaker notes for this slide.';
    counter.textContent = `${i + 1} / ${deck.length}`; prog.style.width = `${((i + 1) / deck.length) * 100}%`;
  };
  const go = n => { if (n < 0 || n >= deck.length) return; const dir = n > i ? 'next' : 'prev'; i = n; draw(dir); };
  const tick = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); clock.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }, 1000);
  const showUi = () => { root.classList.add('ui'); clearTimeout(hideT); hideT = setTimeout(() => root.classList.remove('ui'), 2200); };
  const key = e => {
    const k = e.key;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); go(i + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); go(i - 1); }
    else if (k === 'Home') go(0); else if (k === 'End') go(deck.length - 1);
    else if (k === 'Escape') close();
    else if (k.toLowerCase() === 'n') root.classList.toggle('shownotes');
    else if (k.toLowerCase() === 'b' || k === '.') root.classList.toggle('black');
  };
  let sx = null;
  root.addEventListener('pointerdown', e => { sx = e.clientX; });
  root.addEventListener('pointerup', e => { if (e.target.closest('.hud') || sx == null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 40) go(dx < 0 ? i + 1 : i - 1); else go(e.clientX > innerWidth / 3 ? i + 1 : i - 1); });
  root.addEventListener('pointermove', showUi);
  function close() { clearInterval(tick); document.removeEventListener('keydown', key, true); document.removeEventListener('fullscreenchange', fsc); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); root.remove(); }
  const fsc = () => { if (!document.fullscreenElement && root.isConnected && root.dataset.fs) close(); };
  document.addEventListener('keydown', key, true);
  document.addEventListener('fullscreenchange', fsc);
  document.body.appendChild(root);
  draw(null); showUi(); root.focus();
  if (root.requestFullscreen) root.requestFullscreen().then(() => { root.dataset.fs = '1'; }).catch(() => {});
  return close;
}

/* ---------------- PDF ---------------- */
const hexRgb = h6 => { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h6 || '#000000'); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0]; };
const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
const imgSize = src => new Promise(res => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res(null); i.src = src; });
let leftOut = 0; // original photos the PDF had to leave out (app opened from the folder, documents not loaded)
async function pdfImage(fileId) {
  const f = db.get('files', fileId); if (!f) return null;
  const blob = await getBlob(f).catch(() => null); if (!blob) { if (f.vault_path && fromFolder()) leftOut++; return null; }
  let url = await blobToDataUrl(blob);
  // jsPDF takes JPEG/PNG — convert anything else (webp, gif) through a canvas
  if (!/^data:image\/(jpeg|jpg|png)/i.test(url)) { const s = await imgSize(url); if (!s) return null; const c = document.createElement('canvas'); c.width = s.w; c.height = s.h; const im = new Image(); im.src = url; await im.decode().catch(() => {}); c.getContext('2d').drawImage(im, 0, 0); url = c.toDataURL('image/jpeg', 0.9); }
  const size = await imgSize(url); if (!size) return null;
  return { url, fmt: /png/i.test(url.slice(0, 20)) ? 'PNG' : 'JPEG', ...size };
}
export async function exportPdf(title, deck, themeKey) {
  let J; try { J = (await ensureLib('jspdf')).jsPDF; } catch { throw new Error('The PDF library could not load — check your connection and try again.'); }
  const W = 960, H = 540, M = 67, th = THEMES[themeKey] || THEMES.forest;
  const doc = new J({ orientation: 'landscape', unit: 'pt', format: [W, H] });
  const logo = LOGO_DATA_URL; // built in: a page opened from the folder cannot fetch() its own files
  leftOut = 0;
  const color = (fn, hex) => doc[fn](...hexRgb(hex));
  const text = (str, x, y, { size = 20, bold = false, col = th.fg, width = W - 2 * M, lh = 1.3, align = 'left' } = {}) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); color('setTextColor', col); const lines = doc.splitTextToSize(String(str || ''), width); doc.text(lines, x, y, { lineHeightFactor: lh, align, baseline: 'top' }); return y + lines.length * size * lh; };
  const bulletsAt = (body, x, y, width) => { for (const b of parseBody(body)) { if (y > H - 60) break; if (b.type === 'bullet') { color('setFillColor', th.accent); const ind = b.level === 2 ? 22 : 0; doc.circle(x + ind + 4, y + 10, b.level === 2 ? 2.5 : 3.5, 'F'); y = text(b.text, x + ind + 16, y, { size: b.level === 2 ? 16 : 19, width: width - ind - 16 }) + 6; } else y = text(b.text, x, y, { size: 19, bold: true, col: th.accent, width }) + 6; } return y; };
  const fit = (im, x, y, w, hh) => { const r = Math.min(w / im.w, hh / im.h); const dw = im.w * r, dh = im.h * r; doc.addImage(im.url, im.fmt, x + (w - dw) / 2, y + (hh - dh) / 2, dw, dh); };
  for (let n = 0; n < deck.length; n++) {
    const s = deck[n];
    if (n) doc.addPage([W, H], 'landscape');
    color('setFillColor', th.bg); doc.rect(0, 0, W, H, 'F');
    try { doc.setGState(new doc.GState({ opacity: 0.35 })); color('setFillColor', th.bg2); doc.circle(W - 60, H + 40, 300, 'F'); doc.setGState(new doc.GState({ opacity: 1 })); } catch { /* old jsPDF: no transparency */ }
    let y = M;
    const heading = (size = 40) => { color('setFillColor', th.accent); doc.roundedRect(M, y, 70, 5, 2, 2, 'F'); y += 20; y = text(s.title, M, y, { size, bold: true }); if (s.subtitle) y = text(s.subtitle, M, y + 6, { size: 18, col: th.muted }); return y + 18; };
    switch (s.layout) {
      case 'title': case 'section': y = s.layout === 'title' ? H / 2 - 70 : H - 200; heading(s.layout === 'title' ? 52 : 46); break;
      case 'quote': color('setTextColor', ...hexRgb(th.accent)); text('“', M, H / 2 - 120, { size: 90, col: th.accent }); y = text(s.title, M, H / 2 - 50, { size: 32, bold: true }); if (s.subtitle) text(`— ${s.subtitle}`, M, y + 14, { size: 18, col: th.muted }); break;
      case 'two': { y = heading(); const cw = (W - 2 * M - 40) / 2; bulletsAt(s.body, M, y, cw); bulletsAt(s.body2, M + cw + 40, y, cw); break; }
      case 'image-right': { y = heading(); const cw = (W - 2 * M - 30) / 2; bulletsAt(s.body, M, y, cw); const im = s.image_file_id ? await pdfImage(s.image_file_id) : null; if (im) fit(im, M + cw + 30, y, cw, H - y - 60); break; }
      case 'image-full': { const im = s.image_file_id ? await pdfImage(s.image_file_id) : null; if (im) fit(im, 0, 0, W, H); doc.setFillColor(0, 0, 0); try { doc.setGState(new doc.GState({ opacity: 0.55 })); doc.rect(0, H - 150, W, 150, 'F'); doc.setGState(new doc.GState({ opacity: 1 })); } catch { /* */ } y = H - 125; text(s.title, M, y, { size: 36, bold: true, col: '#ffffff' }); if (s.subtitle) text(s.subtitle, M, y + 50, { size: 18, col: '#e6e6e6' }); break; }
      case 'stats': { y = heading(); const st = parseStats(s.body); const gap = 18, bw = (W - 2 * M - gap * (st.length - 1)) / Math.max(1, st.length), bh = 150; st.forEach((x, k) => { const bx = M + k * (bw + gap); try { doc.setGState(new doc.GState({ opacity: 0.12 })); color('setFillColor', th.fg); doc.roundedRect(bx, y + 20, bw, bh, 12, 12, 'F'); doc.setGState(new doc.GState({ opacity: 1 })); } catch { /* */ } color('setFillColor', th.accent); doc.rect(bx, y + 20, bw, 5, 'F'); text(x.value, bx + 16, y + 44, { size: 30, bold: true, col: th.accent, width: bw - 32 }); text(x.label, bx + 16, y + 110, { size: 15, col: th.muted, width: bw - 32 }); }); break; }
      case 'table': { y = heading(34); const rows = parseTable(s.body); if (rows.length && doc.autoTable) doc.autoTable({ startY: y, head: [rows[0]], body: rows.slice(1), theme: 'plain', margin: { left: M, right: M }, styles: { fontSize: 13, textColor: hexRgb(th.fg), cellPadding: 6 }, headStyles: { textColor: hexRgb(th.accent), fontStyle: 'bold', lineWidth: { bottom: 2 }, lineColor: hexRgb(th.accent) }, columnStyles: Object.fromEntries(rows[0].slice(1).map((_, k) => [k + 1, { halign: 'right' }])) }); break; }
      default: y = heading(); bulletsAt(s.body, M, y, W - 2 * M);
    }
    if (logo && s.layout !== 'image-full') doc.addImage(logo, 'JPEG', W - 78, H - 72, 50, 50);
    if (s.layout !== 'title') text(`${n + 1} / ${deck.length}`, 30, H - 34, { size: 10, col: s.layout === 'image-full' ? '#dddddd' : th.muted });
  }
  doc.save(`${String(title || 'presentation').replace(/[\\/:*?"<>|]+/g, ' ').trim()}.pdf`);
  if (leftOut) toast.warn(`${leftOut} original photo${leftOut === 1 ? '' : 's'} left out of the PDF`, { text: NEEDS_LOADING });
}

/* ---------------- deck builders wired to live data ---------------- */
const monthLabel = m => `${fmt.titleCase(new Date(`${m}-01T12:00:00`).toLocaleString('en-ZA', { month: 'long' }))} ${m.slice(0, 4)}`;
function monthFigures(month) {
  const inM = d => String(d || '').slice(0, 7) === month;
  const sum = (list, k) => Math.round(list.reduce((s, x) => s + (Number(x[k]) || 0), 0) * 100) / 100;
  const invs = db.all('invoices').filter(i => i.status !== 'void' && (inM(i.issue_date) || (!i.issue_date && i.period === month)));
  const exps = db.all('expenses').filter(e => e.period === month);
  const visits = db.all('visits').filter(v => inM(v.date));
  const endOn = month === today().slice(0, 7) ? today() : addDays(`${month}-01`, 40).slice(0, 7) + '-01';
  const byClient = {}; invs.forEach(i => { const k = i.client_name || 'Unknown'; byClient[k] = byClient[k] || { name: k, count: 0, total: 0 }; byClient[k].count++; byClient[k].total += Number(i.total) || 0; });
  const byCat = {}; exps.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + (Number(e.amount) || 0); });
  return {
    month, monthLabel: monthLabel(month), invoiced: sum(invs, 'total'), received: sum(db.all('payments').filter(p => inM(p.date)), 'amount'), expenses: sum(exps, 'amount'),
    visitsDone: visits.filter(v => v.status === 'completed').length, visitsPlanned: visits.filter(v => v.status === 'scheduled').length,
    newLeads: db.all('leads').filter(l => inM(l.enquiry_date || l.created_at)).length,
    overdue: db.all('invoices').filter(i => invoiceState(i, endOn) === 'overdue').length,
    topClients: Object.values(byClient).sort((a, b) => b.total - a.total).slice(0, 6).map(c => ({ ...c, total: Math.round(c.total * 100) / 100 })),
    expenseByCat: Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
  };
}
function servicesByCategory() {
  const out = {};
  db.all('services').filter(s => s.active !== false).forEach(s => { const c = fmt.titleCase(String(s.category || 'other').replace(/_/g, ' ')); (out[c] = out[c] || []).push(s.name); });
  Object.values(out).forEach(l => l.sort());
  return out;
}
async function createDeck(title, slides, extra = {}) {
  const d = await db.insert('slides', { title, theme: extra.theme || 'forest', slides, drive_id: extra.drive_id || null, folder_id: extra.folder_id || null });
  if (extra.drive_id || extra.folder_id) await db.insert('files', { name: title, kind: 'slides', ref_id: d.id, drive_id: extra.drive_id || null, folder_id: extra.folder_id || null, mime: 'application/vnd.lsi.slides' }).catch(() => {});
  return d;
}
function pickDialog({ title, icon: ic, items, empty, onPick }) {
  let q = '';
  const list = h('div.list.divider-list', { style: 'max-height:55vh;overflow:auto' });
  const draw = () => list.replaceChildren(...(items.filter(it => !q || `${it.title} ${it.sub}`.toLowerCase().includes(q)).slice(0, 80).map(it => listItem({ title: it.title, sub: it.sub, icon: ic, tile: 't-sun', onClick: () => { m.close(); onPick(it.value); } }))));
  const m = modal({ title, icon: ic, tile: 't-sun', body: items.length ? h('div.stack', h('input.input', { placeholder: 'Search…', onInput: e => { q = e.target.value.toLowerCase(); draw(); } }), list) : emptyState({ icon: ic, title: empty }) });
  draw();
}
const TEMPLATES = [
  { key: 'blank', name: 'Blank', icon: 'presentation', desc: 'Start with a title slide', run: make => make('Untitled presentation', [blankSlide('title', { title: 'Untitled presentation' }), blankSlide('content')]) },
  { key: 'proposal', name: 'Client proposal', icon: 'file-signature', desc: 'From any quote — scope, price, deposit, next steps', run: make => {
    const qs = db.all('quotes').sort((a, b) => String(b.issue_date || b.created_at || '').localeCompare(String(a.issue_date || a.created_at || '')));
    pickDialog({ title: 'Which quote?', icon: 'file-signature', empty: 'No quotes yet', items: qs.map(q => ({ title: `${q.client_name || 'Client'} — ${q.title || 'Quote'}`, sub: `${fmt.money(q.total || 0)} · ${fmt.titleCase(q.status || 'draft')}${q.issue_date ? ' · ' + fmt.date(q.issue_date) : ''}`, value: q })),
      onPick: q => { const client = db.get('clients', q.client_id); const site = q.site_id ? db.get('sites', q.site_id) : (client ? db.find('sites', s => s.client_id === client.id) : null); const services = db.all('services').filter(s => s.active !== false).map(s => s.name).sort(); make(`Proposal — ${q.client_name || 'client'}`, deckFromQuote(q, { client, site, company: company(), services })); } });
  } },
  { key: 'monthly', name: 'Monthly review', icon: 'chart-no-axes-combined', desc: 'Invoiced, expenses, visits, leads and top clients for a month', run: make => {
    const months = [...new Set([...db.all('invoices').map(i => String(i.issue_date || i.period || '').slice(0, 7)), ...db.all('expenses').map(e => e.period), ...db.all('visits').map(v => String(v.date || '').slice(0, 7))].filter(m => /^\d{4}-\d{2}$/.test(m) && m <= today().slice(0, 7)))].sort().reverse();
    pickDialog({ title: 'Which month?', icon: 'calendar', empty: 'No activity recorded yet', items: months.map(m => ({ title: monthLabel(m), sub: m, value: m })), onPick: m => make(`Monthly review — ${monthLabel(m)}`, deckMonthly(monthFigures(m), company())) });
  } },
  { key: 'toolbox', name: 'Toolbox talk', icon: 'hard-hat', desc: 'From a recorded toolbox talk', run: make => {
    const talks = db.all('toolbox_talks').sort((a, b) => String(b.date).localeCompare(String(a.date)));
    pickDialog({ title: 'Which toolbox talk?', icon: 'hard-hat', empty: 'No toolbox talks recorded', items: talks.map(t => ({ title: t.topic || 'Toolbox talk', sub: `${t.date || ''} · ${t.presenter || ''}`, value: t })), onPick: t => make(`Toolbox talk — ${t.topic || t.date}`, deckFromTalk(t), { theme: 'charcoal' }) });
  } },
  { key: 'profile', name: 'Company profile', icon: 'building-2', desc: 'Who we are, every service, contact details', run: make => make('Company profile', deckCompanyProfile(company(), servicesByCategory())) }
];

/* ---------------- home ---------------- */
function home(ctx) {
  const list = h('div');
  const draw = () => {
    const rows = db.all('slides').sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
    list.replaceChildren(rows.length ? h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px' }, rows.map(d => {
      const deck = normaliseDeck(d.slides);
      return h('a', { href: `#/slides/${encodeURIComponent(d.id)}`, style: 'text-decoration:none;color:inherit', class: 'card solid hover' },
        h('div', { style: 'padding:10px 10px 0' }, slideView(deck[0], d.theme)),
        h('div', { style: 'padding:10px 12px 12px' }, h('strong', d.title), h('div.small.muted', `${deck.length} slide${deck.length === 1 ? '' : 's'} · ${fmt.relative(d.updated_at || d.created_at)}${d.updated_by_name ? ' · ' + d.updated_by_name : ''}`)));
    })) : emptyState({ icon: 'presentation', title: 'No presentations yet', text: 'Build a proposal from a quote in one click.' }));
  };
  draw();
  ctx.dispose.add(db.on('slides', draw));
  const make = async (title, slides, extra) => { try { const d = await createDeck(title, slides, extra); ctx.navigate(`slides/${encodeURIComponent(d.id)}`); } catch (e) { showError(e, 'Could not create the presentation'); } };
  return h('div',
    pageHeader({ title: 'Slides', sub: 'Proposals and presentations built from your real numbers.', icon: 'presentation', tile: 't-sun', actions: [can('write', 'slides') ? btn({ label: 'New presentation', icon: 'plus', variant: 'primary', onClick: () => TEMPLATES[0].run(make) }) : null] }),
    can('write', 'slides') ? card({ title: 'Start from your data', icon: 'sparkles', cls: 'solid', style: 'margin-bottom:14px' }, h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px' }, TEMPLATES.map(t => h('button', { type: 'button', class: 'card hover', style: 'text-align:left;padding:14px;cursor:pointer;border:1px solid var(--border)', onClick: () => t.run(make) },
      h('div', { class: ['li-ico', 't-sun'], style: 'width:36px;height:36px;border-radius:12px;display:grid;place-items:center;color:#fff;margin-bottom:8px' }, icon(t.icon, 18)), h('strong', t.name), h('div.small.muted', t.desc))))) : null,
    card({ title: 'Presentations', icon: 'folder-open', cls: 'solid' }, list));
}

/* ---------------- editor ---------------- */
function editor(ctx) {
  const id = decodeURIComponent(ctx.params.id);
  const rec = db.get('slides', id);
  if (!rec) return emptyState({ icon: 'search-x', title: 'Presentation not found', action: btn({ label: 'All presentations', onClick: () => ctx.navigate('slides') }) });
  const writable = can('write', 'slides');
  let deck = normaliseDeck(rec.slides), title = rec.title, theme = THEMES[rec.theme] ? rec.theme : 'forest';
  let cur = Math.min(Math.max(0, Number(ctx.query.s) || 0), deck.length - 1), lastLocal = 0;
  const undo = [];
  const saveState = h('span.small.muted', 'All changes saved');
  const save = debounce(async () => { try { saveState.textContent = 'Saving…'; await db.update('slides', id, { title, theme, slides: deck }); saveState.textContent = `Saved ${fmt.time(new Date().toISOString())}`; } catch (e) { saveState.textContent = 'Not saved'; showError(e); } }, 600);
  const change = (mut, { rail = true, panel = false, snapshot = true } = {}) => {
    if (!writable) return toast.error('You have read-only access to Slides');
    if (snapshot) { undo.push(JSON.stringify({ deck, theme, cur })); if (undo.length > 60) undo.shift(); }
    mut(); lastLocal = Date.now(); save(); drawStage(); if (rail) drawRail(); if (panel) drawPanel();
  };
  const s = () => deck[cur];

  const rail = h('div.sd-rail'), stage = h('div.sd-stage'), panel = h('div.sd-panel');
  let dragFrom = null;
  function drawRail() {
    rail.replaceChildren(...deck.map((sl, i) => h('div', { class: ['th', i === cur ? 'on' : ''], draggable: writable, title: sl.title || `Slide ${i + 1}`,
      onClick: () => { cur = i; drawRail(); drawStage(); drawPanel(); },
      onDragstart: e => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; },
      onDragover: e => { e.preventDefault(); e.currentTarget.classList.add('drop'); }, onDragleave: e => e.currentTarget.classList.remove('drop'),
      onDrop: e => { e.preventDefault(); e.currentTarget.classList.remove('drop'); if (dragFrom == null || dragFrom === i) return; const from = dragFrom; dragFrom = null; change(() => { const [m] = deck.splice(from, 1); deck.splice(i, 0, m); cur = i; }, { panel: true }); },
      onContextmenu: e => { if (!writable) return; e.preventDefault(); menu(e, [{ label: 'Duplicate', icon: 'copy', onClick: () => dup(i) }, i > 0 ? { label: 'Move up', icon: 'arrow-up', onClick: () => move(i, -1) } : null, i < deck.length - 1 ? { label: 'Move down', icon: 'arrow-down', onClick: () => move(i, 1) } : null, deck.length > 1 ? { label: 'Delete slide', icon: 'trash-2', danger: true, onClick: () => del(i) } : null]); } },
      h('span.n', i + 1), slideView(sl, theme))),
      writable ? btn({ label: 'Add slide', icon: 'plus', size: 'sm', variant: 'ghost', onClick: e => menu(e.currentTarget, LAYOUTS.map(([k, l]) => ({ label: l, onClick: () => change(() => { deck.splice(cur + 1, 0, blankSlide(k, { title: k === 'quote' ? '' : 'New slide' })); cur += 1; }, { panel: true }) }))) }) : null);
    const on = rail.querySelector('.th.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const dup = i => change(() => { deck.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(deck[i])), id: blankSlide().id }); cur = i + 1; }, { panel: true });
  const move = (i, d) => change(() => { const [m] = deck.splice(i, 1); deck.splice(i + d, 0, m); cur = i + d; }, { panel: true });
  const del = async i => { if (!(await confirm('Delete this slide?', { danger: true, ok: 'Delete' }))) return; change(() => { deck.splice(i, 1); cur = Math.max(0, Math.min(cur, deck.length - 1)); }, { panel: true }); };

  const tip = h('div.small.muted', { style: 'margin-top:8px;min-height:1.2em' });
  function drawStage() {
    stage.replaceChildren(slideView(s(), theme, { index: cur, total: deck.length }), tip,
      h('div.row.gap-8', { style: 'margin-top:8px;justify-content:center' }, btn({ icon: 'chevron-left', size: 'sm', variant: 'ghost', title: 'Previous slide', disabled: cur === 0, onClick: () => { cur--; drawRail(); drawStage(); drawPanel(); } }), h('span.small', `${cur + 1} / ${deck.length}`), btn({ icon: 'chevron-right', size: 'sm', variant: 'ghost', title: 'Next slide', disabled: cur >= deck.length - 1, onClick: () => { cur++; drawRail(); drawStage(); drawPanel(); } })));
    const w = wordCount(s());
    tip.textContent = w > 70 ? `${w} words — consider splitting this slide; audiences read about 40 words per slide comfortably.` : '';
  }

  const field = (label, key, { rows = 0, placeholder = '', hint } = {}) => {
    const input = rows ? h('textarea.textarea', { rows, placeholder, disabled: !writable, value: s()[key] || '' }) : h('input.input', { placeholder, disabled: !writable, value: s()[key] || '' });
    let first = true;
    input.addEventListener('input', () => { change(() => { s()[key] = input.value; }, { rail: false, snapshot: first }); first = false; drawRailSoon(); });
    return h('div.field', h('label.field-label', label), input, hint ? h('div.small.muted', hint) : null);
  };
  const drawRailSoon = debounce(() => drawRail(), 400);
  function drawPanel() {
    const sl = s(), L = sl.layout;
    const bodyHint = { stats: 'One per line: value | label  (e.g. R21,624.25 | Expenses)', table: 'One row per line, cells separated by |  — the first row is the header', two: 'Left column. Start lines with - for bullets' }[L] || 'Start a line with - for a bullet, two spaces + - for a sub-bullet';
    panel.replaceChildren(
      card({ title: 'Layout', icon: 'layout-template', cls: 'solid' }, h('div.lay-pick', LAYOUTS.map(([k, l]) => h('button', { type: 'button', class: L === k ? 'on' : '', disabled: !writable, onClick: () => change(() => { sl.layout = k; }, { panel: true }) }, l)))),
      card({ title: 'Content', icon: 'type', cls: 'solid', style: 'margin-top:12px' },
        field(L === 'quote' ? 'Quote' : 'Title', 'title', { rows: L === 'quote' ? 3 : 0 }),
        field(L === 'quote' ? 'Who said it' : 'Subtitle', 'subtitle'),
        ['content', 'two', 'image-right', 'stats', 'table'].includes(L) ? field(L === 'two' ? 'Left column' : L === 'stats' ? 'Numbers' : L === 'table' ? 'Table' : 'Bullets', 'body', { rows: 7, hint: bodyHint }) : null,
        L === 'two' ? field('Right column', 'body2', { rows: 7 }) : null,
        ['image-right', 'image-full'].includes(L) ? h('div.field', h('label.field-label', 'Picture'), h('div.row.gap-8', btn({ label: sl.image_file_id ? 'Change picture' : 'Choose picture', icon: 'image', size: 'sm', disabled: !writable, onClick: pickPicture }), sl.image_file_id ? btn({ label: 'Remove', icon: 'x', size: 'sm', variant: 'ghost', onClick: () => change(() => { sl.image_file_id = null; }, { panel: true }) }) : null)) : null),
      card({ title: 'Speaker notes', icon: 'notebook-pen', cls: 'solid', style: 'margin-top:12px' }, field('Only you see these while presenting (press N)', 'notes', { rows: 4 })),
      card({ title: 'Theme', icon: 'palette', cls: 'solid', style: 'margin-top:12px' }, h('div.theme-pick', Object.entries(THEMES).map(([k, t]) => h('button', { type: 'button', title: t.name, class: theme === k ? 'on' : '', disabled: !writable, style: `background:linear-gradient(135deg,${t.bg} 55%,${t.accent})`, onClick: () => change(() => { theme = k; }, { panel: true }) })))));
  }
  function pickPicture() {
    const imgs = db.all('files').filter(f => isImage(f) && f.kind !== 'pending' && !f.deleted_at).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    let q = '';
    const grid = h('div.pic-grid');
    const draw = () => grid.replaceChildren(...imgs.filter(f => !q || `${f.name} ${f.description || ''} ${(f.tags || []).join(' ')}`.toLowerCase().includes(q)).slice(0, 120).map(f => { const img = h('img', { alt: f.name, loading: 'lazy' }); imageUrl(f.id).then(u => { if (u) img.src = u; }); return h('button', { type: 'button', title: f.name, onClick: () => { m.close(); change(() => { s().image_file_id = f.id; }, { panel: true }); } }, img); }));
    const up = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onChange: async () => { const recs = await uploadFiles(up.files, { drive_id: 'drive-sales', description: `Picture for presentation “${title}”` }); if (recs[0]) { m.close(); change(() => { s().image_file_id = recs[0].id; }, { panel: true }); } } });
    const m = modal({ title: 'Choose a picture', icon: 'image', tile: 't-sun', size: 'lg', body: h('div.stack', h('div.row.gap-8', h('input.input', { placeholder: `Search ${imgs.length} pictures in Drive…`, onInput: e => { q = e.target.value.toLowerCase(); draw(); } }), up, btn({ label: 'Upload', icon: 'upload', onClick: () => up.click() })), imgs.length ? grid : emptyState({ icon: 'image', title: 'No pictures in Drive yet', text: 'Upload one, or import the document vault in Drive.' })) });
    draw();
  }

  /* keyboard shortcuts while editing (not inside text fields) */
  const keys = e => {
    if (document.querySelector('.modal-backdrop, .present')) return;
    if (e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && undo.length) { e.preventDefault(); const st = JSON.parse(undo.pop()); deck = st.deck; theme = st.theme; cur = Math.min(st.cur, deck.length - 1); save(); drawRail(); drawStage(); drawPanel(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); dup(cur); return; }
    if (e.key === 'F5' || (mod && e.key === 'Enter')) { e.preventDefault(); present(deck, theme, cur); return; }
    if (['ArrowDown', 'ArrowRight', 'PageDown'].includes(e.key) && cur < deck.length - 1) { e.preventDefault(); cur++; drawRail(); drawStage(); drawPanel(); }
    else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key) && cur > 0) { e.preventDefault(); cur--; drawRail(); drawStage(); drawPanel(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && writable && deck.length > 1) { e.preventDefault(); del(cur); }
  };
  document.addEventListener('keydown', keys); ctx.dispose.add(() => document.removeEventListener('keydown', keys));

  /* someone else changed this deck */
  ctx.dispose.add(db.on('slides', p => {
    if (!p || !p.rec || p.rec.id !== id || !p.remote || Date.now() - lastLocal < 3000 || document.activeElement && document.activeElement.closest('.sd-panel')) return;
    deck = normaliseDeck(p.rec.slides); theme = THEMES[p.rec.theme] ? p.rec.theme : theme; title = p.rec.title; cur = Math.min(cur, deck.length - 1);
    titleIn.value = title; drawRail(); drawStage(); drawPanel(); toast.info(`${p.rec.updated_by_name || 'Someone'} updated this presentation`);
  }));

  const titleIn = h('input.input', { value: title, disabled: !writable, 'aria-label': 'Presentation title', style: 'font-size:1.15rem;font-weight:700;border:0;background:transparent;padding:4px 0;max-width:520px', onChange: e => { const v = e.target.value.trim() || 'Untitled presentation'; change(() => { title = v; }, { rail: false }); } });
  const exporting = { on: false };
  const root = h('div',
    h('div.row.gap-8', { style: 'margin-bottom:10px;align-items:center;flex-wrap:wrap' },
      h('a.btn.btn-ghost.btn-icon', { href: '#/slides', title: 'All presentations' }, icon('arrow-left', 18)), h('div', { class: ['li-ico', 't-sun'], style: 'width:34px;height:34px;border-radius:11px;display:grid;place-items:center;color:#fff' }, icon('presentation', 17)), titleIn, h('span.spacer'), saveState,
      btn({ label: 'PDF', icon: 'file-down', variant: 'ghost', onClick: async () => { if (exporting.on) return; exporting.on = true; toast.info('Building PDF…'); try { await exportPdf(title, deck, theme); } catch (e) { showError(e, 'PDF export failed'); } finally { exporting.on = false; } } }),
      btn({ label: 'Present', icon: 'play', variant: 'primary', onClick: () => present(deck, theme, cur) })),
    h('div.small.muted', { style: 'margin:-4px 0 10px 44px' }, attribution(rec, { verb: 'Created' })),
    !writable ? callout('info', 'Read-only', 'You can present and download this presentation but not change it.', 'lock') : null,
    h('div.sd', rail, stage, panel));
  drawRail(); drawStage(); drawPanel();
  return root;
}

/* ---------------- new (from Drive) ---------------- */
function newDeck(ctx) {
  const box = h('div', emptyState({ icon: 'loader', title: 'Creating presentation…' }));
  createDeck('Untitled presentation', [blankSlide('title', { title: 'Untitled presentation' }), blankSlide('content')], { drive_id: ctx.query.drive || null, folder_id: ctx.query.folder || null })
    .then(d => ctx.navigate(`slides/${encodeURIComponent(d.id)}`, { replace: true })).catch(e => { showError(e); ctx.navigate('slides'); });
  return box;
}

export { monthFigures, createDeck };
export default {
  id: 'slides',
  routes: { '': home, new: newDeck, ':id': editor },
  detail: { slides: (id, ctx) => editor({ ...ctx, params: { id }, query: ctx.query || {} }) }
};
