/* =============================================================================
   Docs (#/docs) — company documents: letters on the letterhead, policies, SOPs,
   minutes, proposals. A real editor (toolbar, tables, images, headings), autosave,
   version history with restore, outline, comments, "read & acknowledge" for
   policies, and export to Word / HTML / text / print-to-PDF.
   ========================================================================== */

import { h, ensureStyle, downloadText } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, pageHeader, emptyState, callout, attribution, tabs } from '../../ui/components.js';
import { toast, showError, confirm, prompt, menu, drawer } from '../../ui/overlays.js';
import { recordComments } from '../../ui/entity.js';
import { sanitizeHTML, sanitizeToFragment, htmlToText } from '../../ui/sanitize.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { can } from '../../core/perms.js';
import { today } from '../../core/dates.js';
import * as fmt from '../../core/format.js';
import { company } from '../_biz.js';
import { fillTemplate, outline, pushVersion, wordCount, reviewStatus, toWordHtml } from './lib.js';

ensureStyle('lsi-docs-editor', `
.dz{display:grid;grid-template-columns:220px 1fr 280px;gap:14px}
.dz-page{background:#fff;color:#1d2a22;max-width:820px;margin:0 auto;min-height:1000px;padding:56px 64px;border-radius:6px;box-shadow:var(--shadow-lg);outline:none;line-height:1.6;font-size:15px}
.dz-page h2{color:#175a33}.dz-page table{border-collapse:collapse;width:100%}.dz-page td,.dz-page th{border:1px solid #bbb;padding:6px}
.dz-page img{max-width:100%}
.dz-bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:2px;align-items:center;padding:6px;border-radius:14px;background:var(--glass);backdrop-filter:blur(12px);border:1px solid var(--border);margin-bottom:12px}
.dz-bar .sep{width:1px;height:22px;background:var(--border);margin:0 4px}
.dz-side{font-size:.88rem}.dz-side a{display:block;padding:3px 0;color:inherit;text-decoration:none}.dz-side a:hover{color:var(--primary)}
.tpl{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:18px}
.tpl button{border:1px solid var(--border);background:var(--surface-solid);border-radius:16px;padding:14px;text-align:left;cursor:pointer;transition:transform .12s}
.tpl button:hover{transform:translateY(-3px);box-shadow:var(--shadow-md)}
@media (max-width:1100px){.dz{grid-template-columns:1fr}.dz-side{display:none}.dz-page{padding:28px 20px}}
@media print{.app-shell>*:not(main),.dz-bar,.dz-side,.page-header,.no-print{display:none!important}.dz-page{box-shadow:none;padding:0}}
`);

const me = () => store.get('user') || {};
const LETTERHEAD = () => { const c = company(); return `<p style="text-align:right"><strong>${c.trading_name}</strong><br>${c.legal_name}${c.reg_no ? ` · Reg. ${c.reg_no}` : ''}<br>${String(c.address || '').replace(/\n/g, '<br>')}<br>${[c.phone, c.email].filter(Boolean).join(' · ')}</p><hr>`; };
export const TEMPLATES = [
  { key: 'blank', name: 'Blank document', icon: 'file', category: 'general', html: '<p></p>' },
  { key: 'letter', name: 'Letter (letterhead)', icon: 'mail', category: 'letter', html: () => `${LETTERHEAD()}<p>{{date}}</p><p>{{recipient}}</p><p>Dear {{recipient_first}},</p><p><strong>RE: {{subject}}</strong></p><p></p><p>Kind regards,</p><p>{{sender}}<br>${company().trading_name}</p>` },
  { key: 'policy', name: 'Policy', icon: 'shield-check', category: 'policy', html: () => `${LETTERHEAD()}<h2>{{title}}</h2><p>Document code: POL ___ · Version 00 · Effective {{date}} · Next revision ____</p><h3>1. Purpose</h3><p></p><h3>2. Scope</h3><p></p><h3>3. Policy</h3><ul><li></li></ul><h3>4. Responsibilities</h3><p></p><h3>Approval</h3><p>Signed: ____________________ (CEO)  Date: ________</p>` },
  { key: 'sop', name: 'Standard operating procedure', icon: 'list-ordered', category: 'sop', html: () => `<h2>{{title}} — Standard Operating Procedure</h2><h3>Purpose</h3><p></p><h3>Scope</h3><p></p><h3>Responsibilities</h3><ul><li></li></ul><h3>Procedure</h3><ol><li></li></ol><h3>Records / registers updated</h3><ul><li></li></ul><h3>Review</h3><p>Reviewed annually.</p>` },
  { key: 'minutes', name: 'Meeting minutes', icon: 'notebook-pen', category: 'minutes', html: () => `<h2>Minutes — {{title}}</h2><p><strong>Date:</strong> {{date}} · <strong>Venue:</strong> · <strong>Chair:</strong></p><p><strong>Present:</strong></p><h3>1. Opening</h3><p></p><h3>2. Matters discussed</h3><p></p><h3>3. Action items</h3><table><tr><th>#</th><th>Action</th><th>Owner</th><th>Due</th></tr><tr><td>3.1</td><td></td><td></td><td></td></tr></table><h3>4. Next meeting</h3><p></p>` },
  { key: 'jd', name: 'Job description', icon: 'id-card', category: 'job_description', html: () => `<h2>{{title}} — Job Description</h2><p><strong>Reports to:</strong> </p><h3>Purpose of the role</h3><p></p><h3>Key responsibilities</h3><ul><li></li></ul><h3>Authority</h3><ul><li></li></ul><h3>Acknowledgement</h3><p>Employee signature: ____________ Date: ________</p>` },
  { key: 'proposal', name: 'Client proposal', icon: 'presentation', category: 'report', html: () => `${LETTERHEAD()}<h2>Proposal — {{title}}</h2><p>Prepared for {{recipient}} · {{date}}</p><h3>Understanding your needs</h3><p></p><h3>Our proposal</h3><ul><li></li></ul><h3>Maintenance plan</h3><p></p><h3>Investment</h3><p>See the attached quotation.</p><h3>Why ${company().trading_name}</h3><p>Structured. Reliable. Compliant. Professional estate landscaping.</p>` },
  { key: 'incident', name: 'Incident report', icon: 'siren', category: 'report', html: () => `<h2>Incident report</h2><p><strong>Date / time:</strong> · <strong>Site:</strong> · <strong>Reported by:</strong></p><h3>What happened</h3><p></p><h3>People involved</h3><p></p><h3>Immediate action taken</h3><p></p><h3>Root cause</h3><p></p><h3>Corrective action</h3><p></p>` }
];

export async function createDoc(tplKey = 'blank', extra = {}) {
  const t = TEMPLATES.find(x => x.key === tplKey) || TEMPLATES[0];
  const title = extra.title || (tplKey === 'blank' ? 'Untitled document' : t.name);
  const html = fillTemplate(typeof t.html === 'function' ? t.html() : t.html, { date: fmt.date(today(), 'long'), title, sender: me().name, recipient: extra.recipient || '', recipient_first: String(extra.recipient || '').split(' ')[0], subject: extra.subject || '' });
  const doc = await db.insert('docs', { title, content: sanitizeHTML(html), text: htmlToText(html), category: t.category, drive_id: extra.drive_id || null, folder_id: extra.folder_id || null, locked: false, versions: [] });
  if (extra.drive_id || extra.folder_id) await db.insert('files', { name: title, kind: 'doc', ref_id: doc.id, drive_id: extra.drive_id || null, folder_id: extra.folder_id || null, mime: 'application/vnd.lsi.doc' }).catch(() => {});
  return doc;
}

/* ---------------- home ---------------- */
function home(ctx) {
  let q = '', cat = ctx.query.cat || 'all', scope = 'all';
  const list = h('div');
  const draw = () => {
    const rows = db.all('docs').filter(d => (cat === 'all' || d.category === cat) && (scope === 'all' || d.created_by === me().id) && (!q || `${d.title} ${d.doc_code || ''} ${d.text || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
    list.replaceChildren(rows.length ? h('div.fgrid.stagger', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px' }, rows.map(d => {
      const rs = reviewStatus(d, today());
      return h('a.card.solid.hover', { href: `#/docs/${encodeURIComponent(d.id)}`, style: 'display:block;padding:14px;text-decoration:none;color:inherit' },
        h('div.row.gap-8', h('div.li-ico.t-river', { style: 'width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:#fff' }, icon(d.locked ? 'lock' : 'file-text', 16)), h('span.spacer'), d.doc_code ? badge(d.doc_code, 'gray') : null),
        h('div', { style: 'font-weight:700;margin:8px 0 4px' }, d.title), h('div.small.muted', { style: 'height:3.2em;overflow:hidden' }, fmt.truncate(d.text || '', 140)),
        h('div.row.gap-4', { style: 'margin-top:8px' }, badge(fmt.titleCase(String(d.category || 'general').replace(/_/g, ' ')), 'blue'), rs.key !== 'none' && ['policy', 'procedure', 'sop'].includes(d.category) ? badge(rs.label, rs.color) : null),
        h('div.small.muted', { style: 'margin-top:6px' }, `${d.updated_by_name || d.created_by_name || 'Imported'} · ${fmt.relative(d.updated_at || d.created_at)}`));
    })) : emptyState({ icon: 'file-text', title: 'No documents', text: 'Start one from a template above.' }));
  };
  ctx.dispose.add(db.on('docs', draw));
  draw();
  const cats = [...new Set(db.all('docs').map(d => d.category).filter(Boolean))].sort();
  return h('div',
    pageHeader({ title: 'Docs', sub: 'Letters, policies, SOPs, minutes and proposals — all in one place.', icon: 'file-text', tile: 't-river' }),
    can('write', 'docs') ? h('div.tpl', TEMPLATES.map(t => h('button', { onClick: async () => { try { const d = await createDoc(t.key, { drive_id: ctx.query.drive || null, folder_id: ctx.query.folder || null }); ctx.navigate(`docs/${encodeURIComponent(d.id)}`); } catch (e) { showError(e); } } }, h('div.li-ico.t-river', { style: 'width:36px;height:36px;border-radius:11px;display:grid;place-items:center;color:#fff;margin-bottom:8px' }, icon(t.icon, 18)), h('strong', t.name)))) : null,
    h('div.row.wrap.gap-8', { style: 'margin-bottom:12px' }, h('input.input', { placeholder: 'Search titles and text…', style: 'max-width:300px', onInput: e => { q = e.target.value.toLowerCase(); draw(); } }),
      h('select.select', { style: 'width:auto', onChange: e => { cat = e.target.value; draw(); } }, h('option', { value: 'all' }, 'All categories'), cats.map(c => h('option', { value: c, selected: c === cat }, fmt.titleCase(c.replace(/_/g, ' '))))),
      h('select.select', { style: 'width:auto', onChange: e => { scope = e.target.value; draw(); } }, h('option', { value: 'all' }, 'Owned by anyone'), h('option', { value: 'me' }, 'Owned by me'))),
    list);
}

/* ---------------- editor ---------------- */
function editor(ctx) {
  const id = decodeURIComponent(ctx.params.id);
  const d0 = db.get('docs', id);
  if (!d0) return emptyState({ icon: 'search-x', title: 'Document not found' });
  const readonly = d0.locked || !can('write', 'docs');
  const status = h('span.small.muted', readonly ? (d0.locked ? 'Locked — controlled document' : 'Read only') : 'All changes saved');
  const page = h('div.dz-page', { contenteditable: readonly ? 'false' : 'true', spellcheck: 'true' });
  page.replaceChildren(sanitizeToFragment(d0.content || '<p></p>'));
  const side = h('div.dz-side');
  const title = h('input.input', { value: d0.title, disabled: readonly, style: 'font-size:1.3rem;font-weight:800;border:0;background:transparent;padding:0', onInput: () => schedule() });
  let timer = null, lastSaved = d0.content || '';
  const save = async (force = false) => {
    const html = sanitizeHTML(page.innerHTML);
    if (!force && html === lastSaved && title.value === db.get('docs', id).title) return;
    status.textContent = 'Saving…';
    try {
      const cur = db.get('docs', id);
      const versions = pushVersion(cur.versions, { at: new Date().toISOString(), by: me().name, html: lastSaved });
      await db.update('docs', id, { title: title.value.trim() || 'Untitled document', content: html, text: htmlToText(html), versions }, { skipValidate: true });
      lastSaved = html; status.textContent = `All changes saved · ${wordCount(htmlToText(html))} words`;
      drawSide();
    } catch (e) { status.textContent = 'Not saved'; showError(e); }
  };
  const schedule = () => { if (readonly) return; status.textContent = 'Editing…'; clearTimeout(timer); timer = setTimeout(save, 1000); };
  page.addEventListener('input', schedule);
  ctx.dispose.add(() => { clearTimeout(timer); if (!readonly) save(); });
  const cmd = (c, v) => { document.execCommand(c, false, v); page.focus(); schedule(); };
  const tb = (ic, t, fn) => h('button.btn.btn-ghost.btn-icon.btn-sm', { type: 'button', title: t, onMousedown: e => { e.preventDefault(); fn(); } }, icon(ic, 16));
  const imgIn = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onChange: e => { const f = e.target.files[0]; if (!f) return; if (f.size > 400 * 1024) return toast.error('Image too large for a document (max 400 KB) — upload it to Drive and link it.'); const r = new FileReader(); r.onload = () => cmd('insertImage', r.result); r.readAsDataURL(f); } });
  const bar = readonly ? null : h('div.dz-bar',
    tb('undo-2', 'Undo', () => cmd('undo')), tb('redo-2', 'Redo', () => cmd('redo')), h('span.sep'),
    h('select.select', { style: 'width:auto;height:30px;padding:0 6px', onChange: e => { cmd('formatBlock', e.target.value); e.target.value = ''; } }, h('option', { value: '' }, 'Style'), h('option', { value: 'P' }, 'Normal'), h('option', { value: 'H2' }, 'Heading 1'), h('option', { value: 'H3' }, 'Heading 2'), h('option', { value: 'H4' }, 'Heading 3')),
    tb('bold', 'Bold', () => cmd('bold')), tb('italic', 'Italic', () => cmd('italic')), tb('underline', 'Underline', () => cmd('underline')), tb('strikethrough', 'Strike', () => cmd('strikeThrough')),
    h('input', { type: 'color', title: 'Text colour', value: '#175a33', style: 'width:28px;height:28px;border:0;background:none', onChange: e => cmd('foreColor', e.target.value) }),
    tb('highlighter', 'Highlight', () => cmd('hiliteColor', '#fdf1c7')), h('span.sep'),
    tb('align-left', 'Left', () => cmd('justifyLeft')), tb('align-center', 'Centre', () => cmd('justifyCenter')), tb('align-right', 'Right', () => cmd('justifyRight')), tb('align-justify', 'Justify', () => cmd('justifyFull')), h('span.sep'),
    tb('list', 'Bullets', () => cmd('insertUnorderedList')), tb('list-ordered', 'Numbering', () => cmd('insertOrderedList')), tb('indent-increase', 'Indent', () => cmd('indent')), tb('indent-decrease', 'Outdent', () => cmd('outdent')), h('span.sep'),
    tb('link', 'Link', async () => { const u = await prompt('Link address', { value: 'https://' }); if (u && /^(https?:|mailto:|#)/.test(u)) cmd('createLink', u); }),
    tb('table', 'Table', async () => { const s = await prompt('Rows × columns', { value: '3x3' }); const m = /(\d+)\s*[x×]\s*(\d+)/.exec(s || ''); if (!m) return; const r = Math.min(30, +m[1]), c = Math.min(10, +m[2]); cmd('insertHTML', `<table>${Array.from({ length: r }, (_, i) => `<tr>${Array.from({ length: c }, () => (i ? '<td>&nbsp;</td>' : '<th>&nbsp;</th>')).join('')}</tr>`).join('')}</table><p></p>`); }),
    tb('image', 'Image', () => imgIn.click()), imgIn, tb('minus', 'Line', () => cmd('insertHorizontalRule')), tb('remove-formatting', 'Clear formatting', () => cmd('removeFormat')));
  const drawSide = () => {
    const d = db.get('docs', id);
    const o = outline(d.content);
    side.replaceChildren(
      card({ title: 'Outline', icon: 'list-tree', cls: 'solid' }, o.length ? h('div', o.map(x => h('a', { href: '#', style: `padding-left:${(x.level - 2) * 12}px`, onClick: e => { e.preventDefault(); const hs = page.querySelectorAll('h1,h2,h3,h4'); hs[x.index] && hs[x.index].scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, x.text))) : h('p.small.muted', 'Headings appear here.')));
  };
  drawSide();
  const d = db.get('docs', id);
  const rs = reviewStatus(d, today());
  const acks = Array.isArray(d.acknowledgements) ? d.acknowledgements : [];
  const acked = acks.some(a => a.user_id === me().id);
  const exportMenu = e => menu(e.currentTarget, [
    { label: 'Print / save as PDF', icon: 'printer', onClick: () => window.print() },
    { label: 'Download Word (.doc)', icon: 'file-type', onClick: () => downloadText(toWordHtml(title.value, sanitizeHTML(page.innerHTML)), `${title.value}.doc`, 'application/msword') },
    { label: 'Download HTML', icon: 'code', onClick: () => downloadText(sanitizeHTML(page.innerHTML), `${title.value}.html`, 'text/html') },
    { label: 'Download text', icon: 'file', onClick: () => downloadText(htmlToText(page.innerHTML), `${title.value}.txt`) }]);
  const info = () => drawer({ title: 'Document details', icon: 'info', body: h('div.stack', h('div.small', attribution(d)),
    ...[['doc_code', 'Document code', 'text'], ['revision', 'Revision', 'text'], ['effective_date', 'Effective', 'date'], ['review_date', 'Next review', 'date'], ['category', 'Category', 'text']].map(([k, l, type]) => h('div.field', h('label.field-label', l), h('input.input', { type, value: d[k] || '', disabled: !can('write', 'docs'), onChange: e => db.update('docs', id, { [k]: e.target.value || null }, { skipValidate: true }) }))),
    can('write', 'docs') ? h('label.row.gap-8', h('input', { type: 'checkbox', checked: !!d.locked, onChange: e => db.update('docs', id, { locked: e.target.checked }, { skipValidate: true }) }), 'Locked (read-only controlled document)') : null,
    ['policy', 'procedure', 'sop'].includes(d.category) ? h('div', h('h4', `Acknowledged by ${acks.length}`), h('div.list.divider-list', db.filter('profiles', p => p.status !== 'suspended').map(p => { const a = acks.find(x => x.user_id === p.id); return h('div.list-item', h('div.li-main', h('div.li-title', p.name), h('div.li-sub', a ? `Acknowledged ${fmt.dateTime(a.at)}` : 'Not yet'))); }))) : null) });
  const history = () => drawer({ title: 'Version history', icon: 'history', body: h('div.list.divider-list', [...(db.get('docs', id).versions || [])].reverse().map(v => h('div.list-item', h('div.li-main', h('div.li-title', fmt.dateTime(v.at)), h('div.li-sub', `${v.by} · ${wordCount(htmlToText(v.html))} words`)),
    can('write', 'docs') && !d.locked ? btn({ label: 'Restore', size: 'sm', onClick: async () => { if (await confirm('Restore this version? The current text is kept in history.', { ok: 'Restore' })) { page.replaceChildren(sanitizeToFragment(v.html)); save(true); } } }) : null))) });
  return h('div',
    pageHeader({ title: '', crumbs: [{ label: 'Docs', href: '#/docs' }, { label: d.title }], actions: [status,
      btn({ icon: 'message-square-text', title: 'Comments', variant: 'ghost', onClick: () => drawer({ title: 'Comments', icon: 'message-square-text', body: recordComments('docs', id, ctx) }) }),
      btn({ icon: 'history', title: 'Version history', variant: 'ghost', onClick: history }), btn({ icon: 'info', title: 'Details', variant: 'ghost', onClick: info }),
      h('button.btn', { onClick: exportMenu }, icon('download', 16), 'Export')] }),
    h('div.row.gap-8', { style: 'margin:-8px 0 10px' }, title, d.doc_code ? badge(d.doc_code, 'gray') : null, rs.key !== 'none' && ['policy', 'procedure', 'sop'].includes(d.category) ? badge(rs.label, rs.color) : null),
    ['policy', 'procedure', 'sop'].includes(d.category) ? (acked ? callout('success', 'You have acknowledged this document', `on ${fmt.dateTime(acks.find(a => a.user_id === me().id).at)}`, 'check') : h('div.no-print', { style: 'margin-bottom:10px' }, btn({ label: 'I have read and understood this document', icon: 'check-check', variant: 'primary', onClick: async () => { await db.update('docs', id, { acknowledgements: [...acks, { user_id: me().id, name: me().name, at: new Date().toISOString() }] }, { skipValidate: true }); toast.success('Acknowledged — thank you'); ctx.refresh(); } }))) : null,
    bar, h('div.dz', side, page, h('div.dz-side', d._src ? card({ title: 'Source', icon: 'file-search', cls: 'solid' }, h('p.small', { style: 'word-break:break-all' }, String(d._src).split(' | ')[0])) : null)));
}

export default { id: 'docs', routes: { '': home, new: ctx => { createDoc('blank', { drive_id: ctx.query.drive || null, folder_id: ctx.query.folder || null }).then(d => ctx.navigate(`docs/${encodeURIComponent(d.id)}`)).catch(showError); return emptyState({ icon: 'loader', title: 'Creating…' }); }, ':id': editor }, detail: { docs: (id, ctx) => editor({ ...ctx, params: { id } }) } };
void tabs;
