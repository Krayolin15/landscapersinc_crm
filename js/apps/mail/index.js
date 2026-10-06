/* =============================================================================
   Mail (#/mail) — team and client email: folders, threads, compose with company
   templates and attachments, reply / forward, stars and labels, auto-triage
   (Emergency / Quote / Reschedule / Proof of payment), "create lead" from an
   enquiry, AI-free reply drafts, and the outbox where the Autonomous Core's
   reminders wait for approval. Internal mail is delivered instantly; external
   mail goes through the send-email Edge Function (or your email app in local mode).
   ========================================================================== */

import { h, ensureStyle, uid } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, pageHeader, emptyState, avatar, callout, listItem } from '../../ui/components.js';
import { modal, toast, showError, confirm } from '../../ui/overlays.js';
import { fieldInput, openRecordForm } from '../../ui/form.js';
import { entityListPage } from '../../ui/entity.js';
import { sanitizeHTML, sanitizeToFragment, htmlToText } from '../../ui/sanitize.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { can } from '../../core/perms.js';
import { notify } from '../../core/notify.js';
import { uploadFiles } from '../../core/files.js';
import { CONFIG, IS_SUPABASE } from '../../config.js';
import * as fmt from '../../core/format.js';
import { triage, extractLead, draftReply, threads } from './logic.js';
import { company, waLink } from '../_biz.js';

ensureStyle('lsi-mail', `
.mail{display:grid;grid-template-columns:200px minmax(260px,380px) 1fr;gap:14px;min-height:70vh}
.mail-nav .item{display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;border-radius:12px;color:inherit;background:none;border:0;cursor:pointer;text-align:left}
.mail-nav .item.active{background:var(--primary-soft);font-weight:700}.mail-nav .item .n{margin-left:auto;font-size:var(--fs-xs)}
.mlist{border:1px solid var(--border);border-radius:18px;background:var(--surface-solid);overflow:auto;max-height:78vh}
.mrow{display:block;padding:11px 14px;border-bottom:1px solid var(--border);cursor:pointer;color:inherit;text-decoration:none}
.mrow:hover{background:var(--surface-hover)}.mrow.unread .who,.mrow.unread .sub{font-weight:750}.mrow.sel{background:var(--primary-soft)}
.mrow .who{display:flex;gap:6px;align-items:center}.mrow .when{margin-left:auto;font-size:var(--fs-xs);color:var(--muted)}
.mrow .sub{font-size:.92rem;margin-top:2px}.mrow .snip{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mread{border:1px solid var(--border);border-radius:18px;background:var(--surface-solid);padding:18px;overflow:auto;max-height:78vh}
.msg{border-top:1px solid var(--border);padding:14px 0}.msg:first-of-type{border-top:0}
.msg .body{margin-top:10px;line-height:1.55;overflow-wrap:anywhere}
@media (max-width: 980px){.mail{grid-template-columns:1fr}.mail-nav{display:flex;overflow-x:auto;gap:4px}.mail-nav .item{white-space:nowrap}}
`);

const FOLDERS = [['inbox', 'Inbox', 'inbox'], ['starred', 'Starred', 'star'], ['sent', 'Sent', 'send'], ['drafts', 'Drafts', 'file-pen'], ['scheduled', 'Scheduled', 'clock'], ['archive', 'Archive', 'archive'], ['trash', 'Trash', 'trash-2']];
const me = () => store.get('user') || {};
const myFlag = mid => db.find('mail_flags', f => f.message_id === mid && f.user_id === me().id);
const inFolder = (f, folder) => (folder === 'starred' ? f.starred && f.folder !== 'trash' : f.folder === folder);

/* ---------------- sending ---------------- */
async function deliver(draft, { sendNow = true } = {}) {
  const user = me();
  const to = draft.to || [];
  const internal = to.filter(r => r.user_id), external = to.filter(r => !r.user_id && r.email);
  const html = sanitizeHTML(draft.body_html || '');
  const rec = await db.insert('mail_messages', {
    thread_id: draft.thread_id || uid(), direction: external.length ? 'outbound' : 'internal', from_user_id: user.id, from_name: user.name, from_email: user.email || null,
    to, cc: draft.cc || [], to_text: to.map(r => r.name || r.email).join(', '), subject: draft.subject || '(no subject)', body_html: html, body_text: htmlToText(html),
    attachments: draft.attachments || [], is_draft: !sendNow, sent_at: sendNow ? new Date().toISOString() : null, scheduled_for: draft.scheduled_for || null,
    status: !sendNow ? 'draft' : external.length ? (IS_SUPABASE() ? 'queued' : 'sent') : 'delivered', labels: draft.labels || [], related_collection: draft.related_collection || null, related_id: draft.related_id || null, template_key: draft.template_key || null
  });
  await db.insert('mail_flags', { message_id: rec.id, user_id: user.id, folder: sendNow ? (draft.scheduled_for ? 'scheduled' : 'sent') : 'drafts', read: true });
  if (!sendNow) return rec;
  for (const r of internal) {
    await db.insert('mail_flags', { message_id: rec.id, user_id: r.user_id, folder: 'inbox', read: false }).catch(() => {});
  }
  if (internal.length) notify(internal.map(r => r.user_id), { title: `New mail from ${user.name}`, body: rec.subject, icon: 'mail', tile: 't-rose', link: `#/mail?m=${rec.id}`, kind: 'mail', source_key: `mail|${rec.id}` }).catch(() => {});
  if (external.length) {
    if (IS_SUPABASE() && db.client) {
      const { data, error } = await db.client.functions.invoke(CONFIG.functions.sendEmail, { body: { message_id: rec.id } });
      if (error || (data && data.error)) { await db.update('mail_messages', rec.id, { status: 'failed', error: String((data && data.error) || error.message) }); throw new Error('The email could not be sent: ' + ((data && data.error) || error.message)); }
    } else {
      window.location.href = `mailto:${external.map(r => r.email).join(',')}?subject=${encodeURIComponent(rec.subject)}&body=${encodeURIComponent(rec.body_text)}`;
      toast.info('Opened in your email app', { text: 'Local mode hands external email to the device’s mail app. It is saved here in Sent.' });
    }
  }
  return rec;
}

/* ---------------- compose ---------------- */
export function compose(pre = {}) {
  const v = { to: [], cc: [], subject: '', body_html: '', attachments: [], ...pre };
  const chips = h('div.chips');
  const drawChips = () => chips.replaceChildren(...v.to.map((r, i) => h('span.chip.active', r.name || r.email, h('button.x', { type: 'button', onClick: () => { v.to.splice(i, 1); drawChips(); } }, icon('x', 12)))));
  const people = [...db.all('profiles').filter(p => p.status !== 'suspended').map(p => ({ name: p.name, email: p.email, user_id: p.id })), ...db.all('clients').filter(c => c.email).map(c => ({ name: c.name, email: c.email })), ...db.all('contacts').filter(c => c.email).map(c => ({ name: c.name, email: c.email }))];
  const toInput = h('input.input', { list: 'mail-people', placeholder: 'Name or email, then Enter', onKeydown: e => {
    if (e.key !== 'Enter' && e.key !== ',') return; e.preventDefault();
    const val = e.target.value.trim(); if (!val) return;
    const p = people.find(x => x.name === val || x.email === val.toLowerCase()) || (/\S+@\S+\.\S+/.test(val) ? { name: val, email: val.toLowerCase() } : null);
    if (!p) return toast.error('Pick a person from the list or type an email address');
    v.to.push(p); e.target.value = ''; drawChips();
  } });
  drawChips();
  const body = fieldInput({ type: 'richtext' }, v.body_html, x => { v.body_html = x; });
  const tpl = h('select.select', { style: 'width:auto', onChange: e => { const t = db.get('mail_templates', e.target.value); if (!t) return; v.subject = v.subject || t.subject; subj.value = v.subject; v.body_html = t.body_html; v.template_key = t.key; body.querySelector('[contenteditable]').replaceChildren(sanitizeToFragment(t.body_html || '')); } },
    h('option', { value: '' }, 'Use a template…'), db.all('mail_templates').map(t => h('option', { value: t.id }, t.name)));
  const subj = h('input.input', { value: v.subject, placeholder: 'Subject', onInput: e => { v.subject = e.target.value; } });
  const files = h('input', { type: 'file', multiple: true, onChange: async e => { try { const recs = await uploadFiles(e.target.files, { drive_id: null, linked: [] }); v.attachments.push(...recs.map(r => ({ file_id: r.id, name: r.name, size: r.size }))); attList.replaceChildren(...v.attachments.map(a => h('span.chip', icon('paperclip', 12), a.name))); } catch (err) { showError(err, 'Upload failed'); } } });
  const attList = h('div.chips', v.attachments.map(a => h('span.chip', icon('paperclip', 12), a.name)));
  modal({
    title: pre.subject && /^re:/i.test(pre.subject) ? 'Reply' : 'New message', icon: 'mail', tile: 't-rose', size: 'wide', dismissable: false,
    body: h('div.stack', h('datalist#mail-people', people.map(p => h('option', { value: p.email || p.name }, p.name))),
      h('div.field', h('label.field-label', 'To'), chips, toInput), h('div.row.gap-8', subj, tpl), body, h('div.row.gap-8', h('label.btn.btn-ghost.btn-sm', icon('paperclip', 15), 'Attach', files, { style: 'position:relative' }), attList),
      h('div.small.muted', 'Team members receive it instantly in their inbox. Clients receive it by email.')),
    actions: [{ label: 'Save draft', variant: 'ghost', onClick: async () => { try { await deliver(v, { sendNow: false }); toast.success('Draft saved'); } catch (e) { showError(e); return false; } } },
      { label: 'Send', icon: 'send', variant: 'primary', onClick: async () => { if (!v.to.length) { toast.error('Add at least one recipient'); return false; } try { await deliver(v); toast.success('Sent'); } catch (e) { showError(e); return false; } } }]
  });
  files.style.display = 'none';
}

/* ---------------- reading ---------------- */
function reader(th, ctx, refresh) {
  if (!th) return emptyState({ icon: 'mail-open', title: 'Select a conversation', text: 'Pick a message on the left.' });
  const last = th.last;
  const cat = triage({ subject: last.subject, body: last.body_text, attachments: last.attachments });
  th.messages.forEach(m => { const f = myFlag(m.id); if (f && !f.read) db.update('mail_flags', f.id, { read: true }).catch(() => {}); });
  const inbound = th.messages.filter(m => m.direction === 'inbound');
  const lead = inbound.length ? extractLead(inbound[inbound.length - 1]) : null;
  const flag = myFlag(last.id) || {};
  const setFlag = patch => (flag.id ? db.update('mail_flags', flag.id, patch) : db.insert('mail_flags', { message_id: last.id, user_id: me().id, folder: 'inbox', read: true, ...patch })).then(refresh).catch(showError);
  const replyTo = () => { const src = inbound[inbound.length - 1] || last; return src.direction === 'inbound' || src.from_user_id !== me().id ? [{ name: src.from_name, email: src.from_email, user_id: src.from_user_id || null }] : src.to || []; };
  return h('div',
    h('div.row.wrap.gap-8', { style: 'margin-bottom:10px' }, h('h2', { style: 'margin:0;font-size:1.25rem' }, last.subject || '(no subject)'), h('span.spacer'),
      cat.key !== 'general' ? badge(cat.label, cat.color) : null,
      h('button.btn.btn-ghost.btn-icon', { title: flag.starred ? 'Unstar' : 'Star', onClick: () => setFlag({ starred: !flag.starred }) }, icon('star', 16)),
      h('button.btn.btn-ghost.btn-icon', { title: 'Archive', onClick: () => setFlag({ folder: 'archive' }) }, icon('archive', 16)),
      h('button.btn.btn-ghost.btn-icon', { title: 'Delete', onClick: () => setFlag({ folder: 'trash' }) }, icon('trash-2', 16))),
    cat.key === 'emergency' ? callout('danger', 'Emergency / storm damage', 'Call the client now and dispatch a crew. Log it as an urgent job.', 'siren') : null,
    ...th.messages.map(m => h('div.msg', h('div.row.gap-8', avatar(m.from_name || m.from_email || '?'), h('div', h('strong', m.from_name || m.from_email), h('div.small.muted', `to ${m.to_text || (m.to || []).map(r => r.name || r.email).join(', ')}`)), h('span.spacer'), h('span.small.muted', fmt.dateTime(m.sent_at || m.created_at))),
      h('div.body', { html: m.body_html || fmt.truncate(m.body_text || '', 20000).replace(/</g, '&lt;').replace(/\n/g, '<br>') }),
      (m.attachments || []).length ? h('div.chips', { style: 'margin-top:8px' }, m.attachments.map(a => h('a.chip', { href: a.file_id ? `#/record/files/${a.file_id}` : '#', title: a.name }, icon('paperclip', 12), a.name))) : null,
      m.status === 'failed' ? callout('danger', 'Not delivered', m.error || '', 'circle-x') : m.status === 'queued' ? h('div.small.muted', 'Queued for sending…') : null)),
    h('div.row.wrap.gap-8', { style: 'margin-top:14px' },
      btn({ label: 'Reply', icon: 'reply', variant: 'primary', onClick: () => compose({ to: replyTo(), subject: `Re: ${String(last.subject || '').replace(/^re:\s*/i, '')}`, thread_id: last.thread_id }) }),
      btn({ label: 'Draft a reply', icon: 'wand-sparkles', onClick: () => compose({ to: replyTo(), subject: `Re: ${String(last.subject || '').replace(/^re:\s*/i, '')}`, thread_id: last.thread_id, body_html: draftReply(inbound[inbound.length - 1] || last, cat, company().trading_name).replace(/</g, '&lt;').replace(/\n/g, '<br>') }) }),
      btn({ label: 'Forward', icon: 'forward', variant: 'ghost', onClick: () => compose({ subject: `Fwd: ${last.subject || ''}`, body_html: `<p>---------- Forwarded message ----------<br>From: ${fmt.truncate(last.from_name || '', 80).replace(/</g, '')}</p>${last.body_html || ''}`, attachments: last.attachments || [] }) }),
      cat.key === 'pop' ? h('a.btn', { href: '#/payments?tab=pop' }, icon('scan-search', 15), 'Match this POP') : null,
      lead && (cat.key === 'quote' || cat.key === 'emergency') && can('write', 'leads') ? btn({ label: 'Create lead', icon: 'target', onClick: () => openRecordForm('leads', { values: { name: lead.name, contact_name: lead.name, email: lead.email, phone: lead.phone, address: [lead.address, lead.suburb].filter(Boolean).join(', ') || null, source: 'Email', stage: 'new', enquiry_date: String(last.sent_at || last.created_at).slice(0, 10), notes: `From email “${last.subject}”. Services mentioned: ${lead.services.join(', ') || '—'}.` } }) }) : null),
    lead ? h('div.small.muted', { style: 'margin-top:8px' }, `Detected: ${[lead.phone, lead.email, lead.suburb, lead.services.join('/')].filter(Boolean).join(' · ') || 'no contact details'}`) : null);
}

/* ---------------- outbox (agent messages awaiting approval) ---------------- */
function outboxView() {
  return entityListPage('outbox', { dispose: { add() {} }, params: {}, query: {} }, {
    title: 'Outbox', sub: 'Every WhatsApp / email the system sends or prepares — reminders from the Autonomous Core wait here for approval.',
    columns: [{ key: 'channel', label: 'Channel', render: r => badge(r.channel, r.channel === 'whatsapp' ? 'green' : 'blue') }, { key: 'to_name', label: 'To', render: r => h('div', r.to_name || r.to, h('div.small.muted', r.subject || fmt.truncate(r.body, 70))) },
      { key: 'status', label: 'Status', render: r => badge(r.status, r.status === 'sent' ? 'green' : r.status === 'failed' ? 'red' : r.status === 'needs_approval' ? 'gold' : 'gray') }, { key: 'created_at', label: 'Created', render: r => fmt.relative(r.created_at) },
      { key: 'go', label: '', render: r => (['needs_approval', 'queued', 'draft'].includes(r.status) ? h('div.row.gap-4', { onClick: e => e.stopPropagation() },
        btn({ label: r.channel === 'whatsapp' ? 'Send on WhatsApp' : 'Send', size: 'sm', variant: 'primary', onClick: async () => {
          try {
            if (r.channel === 'whatsapp') window.open(waLink(r.to, r.body), '_blank', 'noopener');
            else if (IS_SUPABASE() && db.client) { const { error } = await db.client.functions.invoke(CONFIG.functions.sendEmail, { body: { outbox_id: r.id } }); if (error) throw error; }
            else window.location.href = `mailto:${r.to}?subject=${encodeURIComponent(r.subject || '')}&body=${encodeURIComponent(r.body)}`;
            await db.update('outbox', r.id, { status: 'sent', sent_at: new Date().toISOString() });
            if (r.related_collection === 'invoices' && r.template_key && /reminder_(\d+)/.test(r.template_key)) { const inv = db.get('invoices', r.related_id); const day = Number(r.template_key.match(/reminder_(\d+)/)[1]); if (inv) await db.update('invoices', inv.id, { reminders_sent: [...(inv.reminders_sent || []), { day, at: new Date().toISOString(), via: r.channel, by: me().name }] }); }
            toast.success('Sent');
          } catch (e) { showError(e); }
        } }), btn({ label: 'Cancel', size: 'sm', variant: 'ghost', onClick: () => db.update('outbox', r.id, { status: 'cancelled' }) })) : null) }],
    canCreate: false
  });
}

function page(ctx) {
  let folder = ctx.query.f || 'inbox', selKey = null, q = '';
  const nav = h('div.mail-nav'), list = h('div.mlist'), read = h('div.mread');
  const myMessages = () => {
    const flags = db.filter('mail_flags', f => f.user_id === me().id);
    const byMsg = new Map(flags.map(f => [f.message_id, f]));
    return { flags, list: db.all('mail_messages').filter(m => byMsg.has(m.id) && inFolder(byMsg.get(m.id), folder) && (!q || `${m.subject} ${m.body_text} ${m.from_name} ${m.to_text}`.toLowerCase().includes(q))), byMsg };
  };
  const draw = () => {
    const { flags, list: msgs, byMsg } = myMessages();
    nav.replaceChildren(btn({ label: 'Compose', icon: 'pencil', variant: 'primary', block: true, onClick: () => compose() }),
      ...FOLDERS.map(([id, label, ic]) => { const n = id === 'inbox' ? flags.filter(f => f.folder === 'inbox' && !f.read).length : id === 'drafts' ? flags.filter(f => f.folder === 'drafts').length : 0;
        return h('button', { class: ['item', folder === id ? 'active' : ''], onClick: () => { folder = id; selKey = null; draw(); } }, icon(ic, 16), label, n ? h('span.n', badge(String(n), 'rose')) : null); }),
      h('button', { class: ['item', folder === 'outbox' ? 'active' : ''], onClick: () => { folder = 'outbox'; draw(); } }, icon('send-horizontal', 16), 'Outbox', (() => { const n = db.filter('outbox', o => o.status === 'needs_approval').length; return n ? h('span.n', badge(String(n), 'gold')) : null; })()),
      h('button', { class: ['item', folder === 'templates' ? 'active' : ''], onClick: () => { folder = 'templates'; draw(); } }, icon('layout-template', 16), 'Templates'));
    if (folder === 'outbox' || folder === 'templates') {
      list.replaceChildren(); list.style.display = 'none'; read.style.gridColumn = 'span 2';
      read.replaceChildren(folder === 'outbox' ? outboxView() : entityListPage('mail_templates', { dispose: ctx.dispose, params: {}, query: {} }, { title: 'Email templates', sub: 'Reusable messages for quotes, invoices, reminders and HR letters.' }));
      return;
    }
    list.style.display = ''; read.style.gridColumn = '';
    const ths = threads(msgs);
    if (!selKey && ctx.query.m) { const t = ths.find(x => x.messages.some(m => m.id === ctx.query.m)); if (t) selKey = t.key; }
    list.replaceChildren(h('div', { style: 'padding:10px' }, h('input.input', { placeholder: 'Search mail…', value: q, onInput: e => { q = e.target.value.toLowerCase(); clearTimeout(list._t); list._t = setTimeout(draw, 250); } })),
      ...(ths.length ? ths.map(t => { const m = t.last, f = byMsg.get(m.id) || {}; const cat = triage({ subject: m.subject, body: m.body_text, attachments: m.attachments });
        return h('a', { class: ['mrow', f.read ? '' : 'unread', selKey === t.key ? 'sel' : ''], onClick: () => { selKey = t.key; draw(); } },
          h('div.who', h('span', folder === 'sent' ? `To: ${m.to_text || ''}` : m.from_name || m.from_email || '—'), t.messages.length > 1 ? h('span.small.muted', `(${t.messages.length})`) : null, f.starred ? icon('star', 12) : null, h('span.when', fmt.relative(m.sent_at || m.created_at))),
          h('div.sub', m.subject || '(no subject)', cat.key !== 'general' ? h('span', { style: 'margin-left:6px' }, badge(cat.label, cat.color)) : null), h('div.snip', fmt.truncate(m.body_text || '', 120))); })
        : [emptyState({ icon: folder === 'inbox' ? 'inbox' : 'mail', title: folder === 'inbox' ? 'Inbox zero' : 'Nothing here', text: folder === 'inbox' ? 'New mail from the team and clients lands here.' : '' })]));
    read.replaceChildren(reader(ths.find(t => t.key === selKey), ctx, draw));
  };
  for (const c of ['mail_messages', 'mail_flags', 'outbox']) ctx.dispose.add(db.on(c, () => draw()));
  draw();
  return h('div',
    pageHeader({ title: 'Mail', sub: 'Team and client email with smart triage, templates and one-click leads.', icon: 'mail', tile: 't-rose' }),
    !IS_SUPABASE() ? callout('info', 'Local mode', 'Mail between team members works on this device. To send and receive real email, switch to Supabase mode and deploy the send-email and inbound-email functions (docs/SETUP-SUPABASE.html).', 'info') : null,
    h('div.mail', nav, list, read));
}

export default { id: 'mail', routes: { '': page } };
