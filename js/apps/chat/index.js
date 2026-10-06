/* =============================================================================
   Chat (#/chat) — team spaces, groups and direct messages: @mentions (with a
   notification), replies, emoji reactions, pins, edit/delete your own messages,
   photo & file attachments, "start a video call" in the thread, unread counts.
   Live across devices through Supabase realtime (db.on).
   ========================================================================== */

import { h, ensureStyle } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, pageHeader, emptyState, avatar } from '../../ui/components.js';
import { modal, toast, showError, confirm, menu } from '../../ui/overlays.js';
import { fieldInput } from '../../ui/form.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { notify } from '../../core/notify.js';
import { uploadFiles, fileUrl } from '../../core/files.js';
import { CONFIG } from '../../config.js';
import * as fmt from '../../core/format.js';

ensureStyle('lsi-chat', `
.chat{display:grid;grid-template-columns:260px 1fr;gap:14px;height:calc(100vh - 190px);min-height:480px}
.ch-list{border:1px solid var(--border);border-radius:18px;background:var(--surface-solid);overflow:auto;padding:8px}
.ch-item{display:flex;align-items:center;gap:8px;width:100%;padding:9px 10px;border-radius:12px;border:0;background:none;color:inherit;cursor:pointer;text-align:left}
.ch-item.active{background:var(--primary-soft)}.ch-item .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ch-item.unread .nm{font-weight:800}
.ch-main{border:1px solid var(--border);border-radius:18px;background:var(--surface-solid);display:flex;flex-direction:column;min-height:0}
.ch-head{padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}
.ch-msgs{flex:1;overflow:auto;padding:12px 16px;display:flex;flex-direction:column;gap:2px}
.cm{display:flex;gap:10px;padding:6px 8px;border-radius:12px}.cm:hover{background:var(--surface-hover)}.cm .b{flex:1;min-width:0}
.cm .who{font-weight:700}.cm .when{font-size:var(--fs-xs);color:var(--muted);margin-left:6px}.cm .txt{white-space:pre-wrap;overflow-wrap:anywhere}
.cm .mention{background:var(--primary-soft);border-radius:6px;padding:0 3px;font-weight:600}
.cm .reacts{display:flex;gap:4px;margin-top:4px}.cm .reacts button{border:1px solid var(--border);background:var(--surface);border-radius:999px;padding:0 8px;font-size:.8rem;cursor:pointer}
.cm .reply{font-size:var(--fs-xs);color:var(--muted);border-left:3px solid var(--border);padding-left:8px;margin-bottom:3px}
.cm img{max-width:260px;border-radius:12px;margin-top:6px}
.cm.sys{justify-content:center;color:var(--muted);font-size:var(--fs-xs)}
.ch-compose{border-top:1px solid var(--border);padding:10px;display:flex;gap:8px;align-items:flex-end}
.ch-compose textarea{flex:1;resize:none;border:1px solid var(--border);border-radius:14px;padding:10px 12px;font:inherit;background:var(--surface);color:inherit;max-height:140px}
@media (max-width:820px){.chat{grid-template-columns:1fr;height:auto}.ch-list{max-height:220px}.ch-main{height:70vh}}
`);

const me = () => store.get('user') || {};
const REACTS = ['👍', '✅', '😂', '🙏', '🌿', '🔥'];
const visible = c => !c.private && c.kind === 'space' || (c.members || []).includes(me().id) || c.created_by === me().id;
const dmName = c => (c.members || []).filter(id => id !== me().id).map(id => (db.get('profiles', id) || {}).name || 'Someone').join(', ') || 'Just you';
const chName = c => (c.kind === 'dm' ? dmName(c) : c.name);
const lastRead = cid => (db.find('chat_reads', r => r.channel_id === cid && r.user_id === me().id) || {}).last_read_at || '';
const unreadIn = c => db.filter('chat_messages', m => m.channel_id === c.id && m.created_by !== me().id && String(m.created_at) > lastRead(c.id)).length;

async function markRead(cid) {
  const r = db.find('chat_reads', x => x.channel_id === cid && x.user_id === me().id);
  const at = new Date().toISOString();
  try { r ? await db.update('chat_reads', r.id, { last_read_at: at }, { silent: true }) : await db.insert('chat_reads', { channel_id: cid, user_id: me().id, last_read_at: at }, { silent: true }); } catch { /* ignore */ }
}

function renderText(t) {
  const parts = String(t || '').split(/(@[A-Za-z][\w.-]*(?: [A-Z][\w-]*)?)/g);
  return parts.map(p => (p.startsWith('@') ? h('span.mention', p) : p));
}

async function send(channel, body, extra = {}) {
  const text = String(body || '').trim();
  if (!text && !extra.attachments) return;
  const people = db.all('profiles');
  const mentions = people.filter(p => text.toLowerCase().includes('@' + String(p.name).split(' ')[0].toLowerCase())).map(p => p.id);
  const m = await db.insert('chat_messages', { channel_id: channel.id, body: text, kind: extra.kind || 'text', mentions, reply_to: extra.reply_to || null, attachments: extra.attachments || null, reactions: {} });
  await db.update('chat_channels', channel.id, { last_message_at: m.created_at || new Date().toISOString(), last_message_preview: fmt.truncate(`${me().name.split(' ')[0]}: ${text || 'sent a file'}`, 80) }, { silent: true }).catch(() => {});
  const targets = channel.kind === 'dm' ? (channel.members || []).filter(id => id !== me().id) : mentions.filter(id => id !== me().id);
  if (targets.length) notify(targets, { title: channel.kind === 'dm' ? `Message from ${me().name}` : `${me().name} mentioned you in ${channel.name}`, body: fmt.truncate(text, 120), icon: 'message-square', tile: 't-grass', link: `#/chat?c=${channel.id}`, kind: 'chat', source_key: `chat|${m.id}` }).catch(() => {});
  markRead(channel.id);
}

function newChannel(kind, done) {
  const v = { name: '', description: '', members: [me().id], private: kind !== 'space', kind };
  modal({
    title: kind === 'dm' ? 'New direct message' : kind === 'group' ? 'New group' : 'New space', icon: 'message-square-plus', tile: 't-grass',
    body: h('div.stack',
      kind !== 'dm' ? h('div.field', h('label.field-label', 'Name'), fieldInput({ type: 'text' }, '', x => { v.name = x; })) : null,
      kind === 'space' ? h('div.field', h('label.field-label', 'What is it for?'), fieldInput({ type: 'text' }, '', x => { v.description = x; })) : null,
      h('div.field', h('label.field-label', kind === 'dm' ? 'With' : 'Members'), fieldInput({ type: 'refs', ref: 'profiles' }, v.members, x => { v.members = [...new Set([me().id, ...(x || [])])]; })),
      kind === 'space' ? h('label.row.gap-8', fieldInput({ type: 'bool', switchLabel: 'Private (members only)' }, false, x => { v.private = x; })) : null),
    actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Create', icon: 'check', variant: 'primary', onClick: async () => {
      if (kind !== 'dm' && !v.name.trim()) { toast.error('Give it a name'); return false; }
      if (kind === 'dm') { const other = v.members.filter(id => id !== me().id); if (other.length !== 1) { toast.error('Pick one person'); return false; } const ex = db.find('chat_channels', c => c.kind === 'dm' && (c.members || []).length === 2 && c.members.includes(other[0]) && c.members.includes(me().id)); if (ex) { done(ex.id); return; } }
      try { const c = await db.insert('chat_channels', { ...v, name: kind === 'dm' ? 'Direct message' : v.name.trim() }); await db.insert('chat_messages', { channel_id: c.id, body: `${me().name} created ${kind === 'dm' ? 'this conversation' : v.name}`, kind: 'system' }); done(c.id); } catch (e) { showError(e); return false; }
    } }]
  });
}

function page(ctx) {
  let current = ctx.query.c || null, replyTo = null;
  const list = h('div.ch-list'), main = h('div.ch-main');
  const drawList = () => {
    const chans = db.all('chat_channels').filter(visible).sort((a, b) => String(b.last_message_at || b.created_at).localeCompare(String(a.last_message_at || a.created_at)));
    if (!current && chans.length) current = chans[0].id;
    const item = c => { const n = unreadIn(c); return h('button', { class: ['ch-item', c.id === current ? 'active' : '', n ? 'unread' : ''], onClick: () => { current = c.id; replyTo = null; drawAll(); } },
      c.kind === 'dm' ? avatar(dmName(c)) : h('span', { style: 'font-size:1.1rem' }, c.emoji || (c.kind === 'group' ? '👥' : '#')), h('span.nm', chName(c)), n ? badge(String(n), 'rose') : null); };
    list.replaceChildren(
      h('div.row.gap-4', { style: 'margin-bottom:6px' }, btn({ label: 'Space', icon: 'plus', size: 'sm', onClick: () => newChannel('space', id => { current = id; drawAll(); }) }), btn({ label: 'DM', icon: 'user', size: 'sm', variant: 'ghost', onClick: () => newChannel('dm', id => { current = id; drawAll(); }) }), btn({ label: 'Group', icon: 'users', size: 'sm', variant: 'ghost', onClick: () => newChannel('group', id => { current = id; drawAll(); }) })),
      h('div.small.muted', { style: 'margin:8px 6px 4px;font-weight:700' }, 'SPACES'), ...chans.filter(c => c.kind === 'space').map(item),
      h('div.small.muted', { style: 'margin:10px 6px 4px;font-weight:700' }, 'DIRECT & GROUPS'), ...chans.filter(c => c.kind !== 'space').map(item),
      !chans.length ? emptyState({ icon: 'message-square', title: 'No conversations yet', text: 'Create a space for the team, e.g. “Operations” or “Carron Glen project”.' }) : null);
  };
  const drawMain = () => {
    const c = current && db.get('chat_channels', current);
    if (!c) { main.replaceChildren(emptyState({ icon: 'messages-square', title: 'Pick a conversation' })); return; }
    const msgs = db.filter('chat_messages', m => m.channel_id === c.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).slice(-300);
    const box = h('div.ch-msgs');
    let prevDay = '';
    for (const m of msgs) {
      const day = String(m.created_at).slice(0, 10);
      if (day !== prevDay) { box.appendChild(h('div.cm.sys', fmt.date(day, 'full'))); prevDay = day; }
      if (m.kind === 'system') { box.appendChild(h('div.cm.sys', m.body)); continue; }
      const mine = m.created_by === me().id;
      const rep = m.reply_to ? db.get('chat_messages', m.reply_to) : null;
      const reacts = m.reactions && typeof m.reactions === 'object' ? m.reactions : {};
      const react = async e2 => { const users = new Set(reacts[e2] || []); users.has(me().id) ? users.delete(me().id) : users.add(me().id); await db.update('chat_messages', m.id, { reactions: { ...reacts, [e2]: [...users] } }, { silent: true }).catch(showError); };
      const att = (m.attachments || []).map(a => { const f = db.get('files', a.file_id); const el = h('div'); if (f && /^image\//.test(f.mime || '')) fileUrl(f).then(u => u && el.appendChild(h('img', { src: u, alt: f.name }))).catch(() => {}); else el.appendChild(h('a.chip', { href: `#/record/files/${a.file_id}` }, icon('paperclip', 12), a.name)); return el; });
      box.appendChild(h('div.cm', avatar(m.created_by_name || '?'),
        h('div.b', rep ? h('div.reply', `↪ ${rep.created_by_name}: ${fmt.truncate(rep.body, 80)}`) : null,
          h('div', h('span.who', m.created_by_name || 'Someone'), h('span.when', fmt.time(m.created_at)), m.edited_at ? h('span.when', '(edited)') : null, m.pinned ? h('span.when', '📌') : null),
          m.kind === 'meet' ? h('a.btn.btn-sm', { href: m.body.match(/https:\/\/\S+/)?.[0] || '#/meet', target: '_blank', rel: 'noopener', style: 'margin-top:4px' }, icon('video', 14), 'Join video call') : h('div.txt', renderText(m.body)), ...att,
          Object.keys(reacts).some(k => (reacts[k] || []).length) ? h('div.reacts', Object.entries(reacts).filter(([, u]) => u.length).map(([k, u]) => h('button', { title: u.map(id => (db.get('profiles', id) || {}).name).join(', '), onClick: () => react(k) }, `${k} ${u.length}`))) : null),
        h('button.btn.btn-ghost.btn-icon.btn-sm', { title: 'More', onClick: e => menu(e.currentTarget, [
          ...REACTS.map(r => ({ label: `React ${r}`, onClick: () => react(r) })), '-',
          { label: 'Reply', icon: 'reply', onClick: () => { replyTo = m; drawMain(); } },
          { label: m.pinned ? 'Unpin' : 'Pin', icon: 'pin', onClick: () => db.update('chat_messages', m.id, { pinned: !m.pinned }) },
          mine ? { label: 'Edit', icon: 'pencil', onClick: async () => { const { prompt } = await import('../../ui/overlays.js'); const t = await prompt('Edit message', { value: m.body }); if (t !== null) db.update('chat_messages', m.id, { body: t, edited_at: new Date().toISOString() }); } } : null,
          mine ? { label: 'Delete', icon: 'trash-2', danger: true, onClick: async () => { if (await confirm('Delete this message?', { danger: true, ok: 'Delete' })) db.remove('chat_messages', m.id); } } : null
        ], { align: 'right' }) }, icon('ellipsis', 15))));
    }
    const ta = h('textarea', { rows: 1, placeholder: `Message ${chName(c)} — use @name to mention`, onKeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const t = ta.value; ta.value = ''; send(c, t, { reply_to: replyTo && replyTo.id }).then(() => { replyTo = null; }).catch(showError); } } });
    const fileIn = h('input', { type: 'file', multiple: true, style: 'display:none', onChange: async e => { try { const recs = await uploadFiles(e.target.files, { linked: [{ collection: 'chat_channels', id: c.id }] }); await send(c, ta.value || '', { attachments: recs.map(r => ({ file_id: r.id, name: r.name })), kind: 'file' }); ta.value = ''; } catch (err) { showError(err, 'Upload failed'); } } });
    const pinned = msgs.filter(m => m.pinned);
    main.replaceChildren(
      h('div.ch-head', c.kind === 'dm' ? avatar(dmName(c)) : h('span', { style: 'font-size:1.3rem' }, c.emoji || '#'), h('div', h('strong', chName(c)), h('div.small.muted', c.description || `${(c.members || []).length} member${(c.members || []).length === 1 ? '' : 's'}${c.private ? ' · private' : ''}`)), h('span.spacer'),
        pinned.length ? badge(`📌 ${pinned.length}`, 'gray') : null,
        btn({ label: 'Video call', icon: 'video', size: 'sm', onClick: () => { const url = `${CONFIG.meetBaseUrl}LandscapersInc-${String(c.id).replace(/[^a-z0-9]/gi, '').slice(-10)}`; send(c, `${me().name} started a video call: ${url}`, { kind: 'meet' }); window.open(url, '_blank', 'noopener'); } })),
      box,
      replyTo ? h('div.small', { style: 'padding:6px 14px;color:var(--muted)' }, `Replying to ${replyTo.created_by_name}: ${fmt.truncate(replyTo.body, 60)} `, h('button.btn.btn-ghost.btn-sm', { onClick: () => { replyTo = null; drawMain(); } }, 'Cancel')) : null,
      h('div.ch-compose', h('button.btn.btn-ghost.btn-icon', { title: 'Attach', onClick: () => fileIn.click() }, icon('paperclip', 17)), fileIn, ta, btn({ icon: 'send', variant: 'primary', title: 'Send', onClick: () => { const t = ta.value; ta.value = ''; send(c, t, { reply_to: replyTo && replyTo.id }).then(() => { replyTo = null; }).catch(showError); } })));
    requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; ta.focus(); });
    markRead(c.id);
  };
  const drawAll = () => { drawList(); drawMain(); };
  let t;
  for (const col of ['chat_messages', 'chat_channels']) ctx.dispose.add(db.on(col, () => { clearTimeout(t); t = setTimeout(drawAll, 120); }));
  drawAll();
  return h('div', pageHeader({ title: 'Chat', sub: 'Team spaces and direct messages — live on every phone.', icon: 'message-square', tile: 't-grass' }), h('div.chat', list, main));
}

export default { id: 'chat', routes: { '': page } };
export { unreadIn, visible };
