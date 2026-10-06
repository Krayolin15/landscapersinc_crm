/* =============================================================================
   Keep (#/keep) — quick notes and checklists: colourful cards, pin, archive,
   labels, checklists, share with the team or keep private, search.
   ========================================================================== */

import { h, ensureStyle } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, pageHeader, emptyState, seg, attribution } from '../../ui/components.js';
import { toast, showError, confirm, menu } from '../../ui/overlays.js';
import { sanitizeHTML, htmlToText } from '../../ui/sanitize.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import * as fmt from '../../core/format.js';

const COLORS = { default: 'var(--surface-solid)', green: '#dff3d8', teal: '#d4f0ec', blue: '#dbeafe', gold: '#fdf1c7', clay: '#f8e0cf', rose: '#fbdde2', violet: '#e9e2ff' };
ensureStyle('lsi-keep', `
.keep-grid{columns:4 240px;column-gap:12px}
.note{break-inside:avoid;margin:0 0 12px;border-radius:18px;padding:14px;border:1px solid var(--border);box-shadow:var(--shadow-sm);position:relative;transition:box-shadow .15s,transform .15s;color:#1d2a22}
[data-theme=dark] .note:not(.nd){color:#1d2a22}
.note:hover{box-shadow:var(--shadow-md);transform:translateY(-2px)}
.note h4{margin:0 0 6px}.note .nb{white-space:pre-wrap;font-size:.92rem;max-height:320px;overflow:hidden}
.note .tools{display:flex;gap:2px;margin-top:8px;opacity:.55}.note:hover .tools{opacity:1}
.note .pin{position:absolute;top:8px;right:8px}
.composer{max-width:620px;margin:0 auto 18px;border-radius:18px;padding:12px;background:var(--surface-solid);border:1px solid var(--border);box-shadow:var(--shadow-md)}
.composer input,.composer textarea{border:0;background:transparent;width:100%;outline:none;font:inherit;color:inherit}
.cl-item{display:flex;gap:6px;align-items:center}.cl-item.done span{text-decoration:line-through;opacity:.6}
`);

const me = () => store.get('user') || {};
const visible = n => n.shared !== false || n.created_by === me().id;

function composer(onDone) {
  const st = { title: '', text: '', checklist: false, color: 'default' };
  const title = h('input', { placeholder: 'Title' });
  const body = h('textarea', { rows: 2, placeholder: 'Take a note… (tick “Checklist” to make each line a tick box)' });
  const save = async () => {
    const t = title.value.trim(), b = body.value.trim();
    if (!t && !b) return;
    const rec = { title: t || null, color: st.color, pinned: false, archived: false, shared: true, labels: [] };
    if (st.checklist) rec.checklist = b.split('\n').map(x => x.trim()).filter(Boolean).map(x => ({ text: x, done: false }));
    else { rec.body = sanitizeHTML(fmt.truncate(b, 20000).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')); rec.body_text = b; }
    try { await db.insert('notes', rec); title.value = ''; body.value = ''; onDone && onDone(); } catch (e) { showError(e); }
  };
  return h('div.composer', title, body, h('div.row.gap-8', h('label.row.gap-4.small', h('input', { type: 'checkbox', onChange: e => { st.checklist = e.target.checked; } }), 'Checklist'),
    h('span.spacer'), ...Object.keys(COLORS).map(c => h('button', { title: c, style: `width:18px;height:18px;border-radius:50%;border:1px solid var(--border);background:${COLORS[c]}`, onClick: () => { st.color = c; } })), btn({ label: 'Save', icon: 'check', size: 'sm', variant: 'primary', onClick: save })));
}

function noteCard(n) {
  const upd = patch => db.update('notes', n.id, patch).catch(showError);
  const cl = Array.isArray(n.checklist) ? n.checklist : null;
  return h('div.note', { style: { background: COLORS[n.color] || COLORS.default } },
    h('button.pin.btn.btn-ghost.btn-icon.btn-sm', { title: n.pinned ? 'Unpin' : 'Pin', onClick: () => upd({ pinned: !n.pinned }) }, icon(n.pinned ? 'pin-off' : 'pin', 15)),
    n.title ? h('h4', n.title) : null,
    cl ? h('div.stack.tight', cl.map((it, i) => h('label', { class: ['cl-item', it.done ? 'done' : ''] }, h('input', { type: 'checkbox', checked: !!it.done, onChange: e => { const next = cl.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)); upd({ checklist: next }); } }), h('span', it.text))))
      : h('div.nb', { html: n.body || '' }),
    (n.labels || []).length ? h('div.chips', { style: 'margin-top:8px' }, n.labels.map(l => h('span.chip', l))) : null,
    h('div.small', { style: 'opacity:.7;margin-top:6px' }, attribution(n, { showUpdate: true })),
    h('div.tools',
      h('button.btn.btn-ghost.btn-icon.btn-sm', { title: 'Colour', onClick: e => menu(e.currentTarget, Object.keys(COLORS).map(c => ({ label: c, onClick: () => upd({ color: c }) }))) }, icon('palette', 15)),
      h('button.btn.btn-ghost.btn-icon.btn-sm', { title: 'Label', onClick: async () => { const { prompt } = await import('../../ui/overlays.js'); const l = await prompt('Add a label', { title: 'Label' }); if (l) upd({ labels: [...new Set([...(n.labels || []), l.trim()])] }); } }, icon('tag', 15)),
      h('button.btn.btn-ghost.btn-icon.btn-sm', { title: n.shared === false ? 'Share with the team' : 'Make private', onClick: () => upd({ shared: n.shared === false }) }, icon(n.shared === false ? 'lock' : 'users', 15)),
      h('button.btn.btn-ghost.btn-icon.btn-sm', { title: n.archived ? 'Unarchive' : 'Archive', onClick: () => upd({ archived: !n.archived }) }, icon(n.archived ? 'archive-restore' : 'archive', 15)),
      h('button.btn.btn-ghost.btn-icon.btn-sm', { title: 'Delete', onClick: async () => { if (await confirm('Delete this note?', { danger: true, ok: 'Delete' })) { await db.remove('notes', n.id); toast.success('Moved to trash'); } } }, icon('trash-2', 15))));
}

function page(ctx) {
  let view = 'notes', q = '', label = null;
  const grid = h('div');
  const draw = () => {
    const all = db.all('notes').filter(visible).filter(n => (view === 'archive' ? n.archived : !n.archived) && (!label || (n.labels || []).includes(label)) && (!q || `${n.title || ''} ${n.body_text || htmlToText(n.body || '')} ${(n.checklist || []).map(c => c.text).join(' ')}`.toLowerCase().includes(q)));
    const pinned = all.filter(n => n.pinned), rest = all.filter(n => !n.pinned);
    const sort = a => a.sort((x, y) => String(y.updated_at || y.created_at).localeCompare(String(x.updated_at || x.created_at)));
    grid.replaceChildren(...(all.length ? [pinned.length ? h('div.small.muted', { style: 'margin:4px 0 8px;font-weight:700' }, 'PINNED') : null, pinned.length ? h('div.keep-grid', sort(pinned).map(noteCard)) : null,
      pinned.length && rest.length ? h('div.small.muted', { style: 'margin:10px 0 8px;font-weight:700' }, 'OTHERS') : null, h('div.keep-grid.stagger', sort(rest).map(noteCard))]
      : [emptyState({ icon: 'sticky-note', title: view === 'archive' ? 'Nothing archived' : 'No notes yet', text: 'Notes you add appear here.' })]));
  };
  ctx.dispose.add(db.on('notes', draw));
  draw();
  const labels = [...new Set(db.all('notes').flatMap(n => n.labels || []))];
  return h('div',
    pageHeader({ title: 'Keep', sub: 'Quick notes and checklists — shared with the team or private to you.', icon: 'sticky-note', tile: 't-sun' }),
    view === 'notes' ? composer(draw) : null,
    h('div.row.wrap.gap-8', { style: 'margin-bottom:12px' }, seg([{ id: 'notes', label: 'Notes', icon: 'sticky-note' }, { id: 'archive', label: 'Archive', icon: 'archive' }], view, id => { view = id; draw(); }),
      ...labels.map(l => h('button.chip', { onClick: e => { label = label === l ? null : l; e.currentTarget.classList.toggle('active'); draw(); } }, icon('tag', 13), l)),
      h('span.spacer'), h('input.input', { placeholder: 'Search notes…', style: 'max-width:240px', onInput: e => { q = e.target.value.toLowerCase(); draw(); } })),
    grid);
}

export default { id: 'keep', routes: { '': page } };
