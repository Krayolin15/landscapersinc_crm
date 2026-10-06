/* =============================================================================
   Contacts (#/contacts) — one address book for everyone the company deals with:
   the contacts list itself plus clients, leads, prospects, suppliers, staff and
   references (read live from their own records — nothing is copied). Call,
   WhatsApp or email in one tap; export any selection as vCards for a phone.
   ========================================================================== */

import { h, downloadText } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, pageHeader, emptyState, tabs, avatar, card, kv } from '../../ui/components.js';
import { dataTable } from '../../ui/table.js';
import { openRecordForm } from '../../ui/form.js';
import { entityDetailPage, recordLink } from '../../ui/entity.js';
import { db } from '../../core/db.js';
import { can } from '../../core/perms.js';
import * as fmt from '../../core/format.js';
import { waLink } from '../_biz.js';

const KIND = { contacts: ['Contact', 'blue'], clients: ['Client', 'green'], leads: ['Lead', 'gold'], prospects: ['Prospect', 'gold'], suppliers: ['Supplier', 'clay'], employees: ['Staff', 'violet'], references: ['Reference', 'gray'], profiles: ['Team', 'forest'] };
/** Every person/organisation with a way to reach them, as one flat list. */
export function directory() {
  const out = [];
  const push = (col, r, o) => { if (o.name) out.push({ id: `${col}:${r.id}`, col, recId: r.id, kind: col === 'contacts' ? r.kind || 'other' : col, ...o }); };
  const safe = col => { try { return db.all(col); } catch { return []; } };
  for (const r of safe('contacts')) push('contacts', r, { name: r.name, company: r.company, phone: r.phone, phone2: r.phone_alt, email: r.email, address: r.address, position: r.position });
  for (const r of safe('clients')) push('clients', r, { name: r.contact_name && r.contact_name !== r.name ? `${r.contact_name}` : r.name, company: r.contact_name && r.contact_name !== r.name ? r.name : r.company, phone: r.phone, phone2: r.phone_alt, email: r.email, address: [r.address, r.suburb].filter(Boolean).join(', '), position: r.legacy_code });
  for (const r of safe('leads')) push('leads', r, { name: r.contact_name || r.name, company: r.contact_name ? r.name : null, phone: r.phone, email: r.email, address: r.address, position: r.stage });
  for (const r of safe('prospects')) push('prospects', r, { name: r.name, company: r.campaign, phone: r.phone, email: r.email, address: r.area, position: r.category });
  for (const r of safe('suppliers')) push('suppliers', r, { name: r.contact_name || r.name, company: r.contact_name ? r.name : r.category, phone: r.phone, email: r.email, address: r.address });
  for (const r of safe('employees')) push('employees', r, { name: r.full_name, company: 'Landscapers Inc', phone: r.phone, email: r.email, position: [r.position, r.known_as && `“${r.known_as}”`].filter(Boolean).join(' ') });
  for (const r of safe('references')) push('references', r, { name: r.from_name, company: r.organisation, phone: (String(r.contact || '').match(/0\d[\d ]{8,}/) || [])[0] || null, email: (String(r.contact || '').match(/\S+@\S+/) || [])[0] || null });
  for (const r of safe('profiles')) push('profiles', r, { name: r.name, company: 'Landscapers Inc', phone: r.phone, email: r.email, position: r.title });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function vcard(c) {
  const esc = s => String(s || '').replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  return ['BEGIN:VCARD', 'VERSION:3.0', `FN:${esc(c.name)}`, c.company ? `ORG:${esc(c.company)}` : null, c.position ? `TITLE:${esc(c.position)}` : null,
    c.phone ? `TEL;TYPE=CELL:${c.phone}` : null, c.phone2 ? `TEL;TYPE=WORK:${c.phone2}` : null, c.email ? `EMAIL:${c.email}` : null, c.address ? `ADR;TYPE=WORK:;;${esc(c.address)};;;;` : null,
    `NOTE:${esc(`${(KIND[c.col] || [c.col])[0]} in Landscapers Inc HQ`)}`, 'END:VCARD'].filter(Boolean).join('\r\n');
}

function page(ctx) {
  let tab = ctx.query.tab || 'all';
  const all = directory();
  const table = dataTable({
    columns: [
      { key: 'name', label: 'Name', render: c => h('div.row.gap-8', avatar(c.name), h('div', h('strong', c.name), h('div.small.muted', [c.company, c.position].filter(Boolean).join(' · ')))), sort: 'name' },
      { key: 'kind', label: 'Type', render: c => badge(...(KIND[c.col] || [fmt.titleCase(c.kind), 'gray'])), sort: c => c.col },
      { key: 'phone', label: 'Phone', render: c => (c.phone ? fmt.phone(c.phone) : '—'), hide: 'sm' },
      { key: 'email', label: 'Email', render: c => c.email || '—', hide: 'sm' },
      { key: 'act', label: '', render: c => h('div.row.gap-4', { onClick: e => e.stopPropagation() },
        c.phone ? h('a.btn.btn-ghost.btn-icon.btn-sm', { href: `tel:${c.phone}`, title: 'Call' }, icon('phone', 15)) : null,
        c.phone ? h('a.btn.btn-ghost.btn-icon.btn-sm', { href: waLink(c.phone, `Good day ${c.name.split(' ')[0]}, `), target: '_blank', rel: 'noopener', title: 'WhatsApp' }, icon('message-circle', 15)) : null,
        c.email ? h('a.btn.btn-ghost.btn-icon.btn-sm', { href: `mailto:${c.email}`, title: 'Email' }, icon('mail', 15)) : null) }
    ],
    rows: () => all.filter(c => tab === 'all' || c.col === tab || (tab === 'contacts' && c.col === 'contacts')), search: ['name', 'company', 'phone', 'email', 'address', 'position'],
    sort: 'name', pageSize: 40, exportName: 'contacts', selectable: true,
    bulkActions: [{ label: 'Export vCards', icon: 'contact', onClick: sel => downloadText(sel.map(vcard).join('\r\n'), `contacts-${sel.length}.vcf`, 'text/vcard') }],
    onRowClick: c => (location.hash = c.col === 'profiles' ? `#/record/profiles/${encodeURIComponent(c.recId)}` : recordLink(c.col, c.recId))
  });
  const counts = Object.fromEntries(Object.keys(KIND).map(k => [k, all.filter(c => c.col === k).length]));
  return h('div',
    pageHeader({ title: 'Contacts', sub: 'Everyone you deal with — clients, leads, suppliers, staff and more, always up to date.', icon: 'contact', tile: 't-clay',
      actions: [btn({ label: 'Export all (vCard)', icon: 'download', variant: 'ghost', onClick: () => downloadText(all.map(vcard).join('\r\n'), 'landscapers-inc-contacts.vcf', 'text/vcard') }), can('write', 'contacts') ? btn({ label: 'New contact', icon: 'user-plus', variant: 'primary', onClick: () => openRecordForm('contacts') }) : null] }),
    tabs([{ id: 'all', label: 'All', count: all.length }, ...Object.entries(KIND).filter(([k]) => counts[k]).map(([k, [l]]) => ({ id: k, label: `${l}s`, count: counts[k] }))], tab, id => { tab = id; table.refresh(); }),
    card({ cls: 'solid', body: table }));
}

export default {
  id: 'contacts',
  routes: { '': page },
  detail: { contacts: (id, ctx) => entityDetailPage('contacts', id, ctx, { backHref: '#/contacts', backLabel: 'Contacts', actions: c => [c.phone ? h('a.btn', { href: `tel:${c.phone}` }, icon('phone', 16), 'Call') : null, c.phone ? h('a.btn.btn-ghost', { href: waLink(c.phone, ''), target: '_blank', rel: 'noopener' }, icon('message-circle', 16), 'WhatsApp') : null, btn({ label: 'vCard', icon: 'download', variant: 'ghost', onClick: () => downloadText(vcard({ ...c, col: 'contacts', phone2: c.phone_alt }), `${c.name}.vcf`, 'text/vcard') })] }) }
};
void emptyState; void kv;
