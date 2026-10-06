/* =============================================================================
   Clients — the client list and the client dossier: property intelligence for
   the crews (gate code, guardhouse, pets, irrigation, outlets, instructions),
   health score, monthly value, lifetime value, balance, contracts, invoices,
   quotes, jobs, visits and photos. One tap to WhatsApp, call, quote or invoice.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, pageHeader, kpiTile, tabs, emptyState, listItem, callout, ring, kv, statusBadge } from '../../ui/components.js';
import { dataTable } from '../../ui/table.js';
import { entityDetailPage, entityListPage, recordLink, recordFiles } from '../../ui/entity.js';
import { openRecordForm } from '../../ui/form.js';
import { chart } from '../../ui/charts.js';
import { db } from '../../core/db.js';
import { can } from '../../core/perms.js';
import { toCents, fromCents, sumBy } from '../../core/money.js';
import * as fmt from '../../core/format.js';
import { FREQUENCIES } from '../../schema/business.js';
import { clientBalance, clientHealth, clientLTV, clientContracts, contractMonthly, mrr, clientInvoices, invoiceState, balanceOf, waLink } from '../_biz.js';
import { invoiceBadge, quoteBadge } from '../_docs.js';

const STATUS = [{ id: 'active', label: 'Active', icon: 'circle-check' }, { id: 'adhoc', label: 'Ad-hoc', icon: 'shovel' }, { id: 'paused', label: 'Paused', icon: 'circle-pause' }, { id: 'unverified', label: 'Needs review', icon: 'circle-help' }, { id: 'left', label: 'Left', icon: 'log-out' }, { id: 'all', label: 'All', icon: 'list' }];
const clientMonthly = id => fromCents(clientContracts(id).reduce((s, c) => s + toCents(contractMonthly(c)), 0));

function listPage(ctx) {
  let tab = ctx.query.tab || 'active';
  const kpis = h('div.grid.cols-4.stagger', { style: 'margin-bottom:18px' });
  const drawKpis = () => {
    const cl = db.all('clients');
    const active = cl.filter(c => c.status === 'active');
    const atRisk = active.filter(c => clientHealth(c).score < 50);
    kpis.replaceChildren(
      kpiTile({ label: 'Active clients', value: active.length, icon: 'users', tile: 't-forest', foot: `${cl.length} on record` }),
      kpiTile({ label: 'Monthly recurring revenue', value: mrr(), format: 'money', icon: 'repeat', tile: 't-grass', foot: `${db.filter('contracts', c => c.status === 'active').length} active contracts`, href: '#/clients/contracts' }),
      kpiTile({ label: 'Owed by clients', value: fromCents(cl.reduce((s, c) => s + toCents(clientBalance(c.id)), 0)), format: 'money', icon: 'hand-coins', tile: 't-rose', href: '#/payments' }),
      kpiTile({ label: 'At risk', value: atRisk.length, icon: 'heart-crack', tile: 't-clay', foot: 'health score under 50', onClick: () => { tab = 'active'; table.refresh(); } }));
  };
  const table = dataTable({
    columns: [
      { key: 'name', label: 'Client', render: r => h('div.row.gap-8', h('div', { class: ['li-ico', 't-forest'], style: 'width:34px;height:34px;border-radius:11px;display:grid;place-items:center;color:#fff;flex:none;font-weight:700;font-size:.8rem' }, fmt.initials(r.name)), h('div', h('strong', r.name), h('div.small.muted', [r.legacy_code, r.company].filter(Boolean).join(' · ')))), sort: 'name' },
      { key: 'suburb', label: 'Area', render: r => r.suburb || r.region || '—', hide: 'sm' },
      { key: 'phone', label: 'Phone', render: r => (r.phone ? h('a', { href: `tel:${r.phone}`, onClick: e => e.stopPropagation() }, fmt.phone(r.phone)) : '—'), hide: 'sm' },
      { key: 'monthly', label: 'Monthly', num: true, render: r => { const m = clientMonthly(r.id); return m ? fmt.money(m) : h('span.muted', '—'); }, sort: r => clientMonthly(r.id), csv: r => clientMonthly(r.id) },
      { key: 'balance', label: 'Owes', num: true, render: r => { const b = clientBalance(r.id); return b ? h('strong', { style: 'color:var(--danger)' }, fmt.money(b)) : h('span.muted', '—'); }, sort: r => clientBalance(r.id), csv: r => clientBalance(r.id) },
      { key: 'health', label: 'Health', render: r => { const hl = clientHealth(r); return badge(`${hl.score} · ${hl.label}`, hl.score >= 75 ? 'green' : hl.score >= 50 ? 'gold' : 'red'); }, sort: r => clientHealth(r).score, csv: r => clientHealth(r).score },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status), hide: 'sm' }
    ],
    rows: () => db.all('clients').filter(c => tab === 'all' || c.status === tab),
    search: ['name', 'legacy_code', 'company', 'contact_name', 'phone', 'email', 'address', 'suburb'],
    filters: [{ key: 'client_type', label: 'Type', options: [{ value: 'residential', label: 'Residential' }, { value: 'commercial', label: 'Commercial' }, { value: 'body_corporate', label: 'Body corporate' }, { value: 'managing_agent', label: 'Managing agent' }] }, { key: 'region', label: 'Region', options: rows => [...new Set(rows.map(r => r.region).filter(Boolean))].sort().map(v => ({ value: v, label: v })) }],
    sort: 'name', pageSize: 30, exportName: 'clients',
    onRowClick: r => ctx.navigate(`clients/c/${encodeURIComponent(r.id)}`),
    footer: rs => ['', `${rs.length} clients`, '', '', fmt.money(fromCents(rs.reduce((s, r) => s + toCents(clientMonthly(r.id)), 0))), fmt.money(fromCents(rs.reduce((s, r) => s + toCents(clientBalance(r.id)), 0))), '', '']
  });
  ctx.dispose.add(db.on('clients', () => { drawKpis(); table.refresh(); }));
  ctx.dispose.add(db.on('invoices', drawKpis));
  drawKpis();
  const review = db.filter('clients', c => c.status === 'unverified').length;
  return h('div',
    pageHeader({ title: 'Clients', sub: 'Everyone you look after — tap a client for their full dossier.', icon: 'users', tile: 't-forest',
      actions: [btn({ label: 'Contracts', icon: 'file-check', onClick: () => ctx.navigate('clients/contracts') }), btn({ label: 'Sites', icon: 'map-pin', variant: 'ghost', onClick: () => ctx.navigate('clients/sites') }), can('write', 'clients') ? btn({ label: 'New client', icon: 'user-plus', variant: 'primary', onClick: () => openRecordForm('clients', { onSaved: r => ctx.navigate(`clients/c/${encodeURIComponent(r.id)}`) }) }) : null] }),
    review ? callout('info', `${review} client record${review === 1 ? '' : 's'} need a quick review`, 'These names appear on invoices or the debtors list but in no copy of the CRM workbook. Open them to confirm the details (or merge them into the right client).', 'circle-help') : null,
    kpis,
    tabs(STATUS.map(s => ({ ...s, count: s.id === 'all' ? db.count('clients') : db.filter('clients', c => c.status === s.id).length })), tab, id => { tab = id; table.refresh(); }),
    card({ cls: 'solid', body: table }));
}

/* ---------------- dossier ---------------- */
function dossierPanel(c) {
  const items = [
    ['key-round', 'Gate / access code', c.gate_code], ['shield', 'Guardhouse protocol', c.guardhouse], ['dog', 'Pet alerts', c.pets],
    ['droplets', 'Irrigation zones', c.irrigation], ['plug-zap', 'Outlets & water points', c.power_water], ['car', 'Parking', c.parking],
    ['sprout', 'Grass', c.grass_type], ['ruler', 'Garden size', c.property_size_m2 ? `${fmt.num(c.property_size_m2)} m²` : null], ['mountain', 'Slope', c.slope]
  ].filter(x => x[2]);
  return card({ title: 'Property dossier', sub: 'What the crew needs to know before they arrive', icon: 'clipboard-list', cls: 'solid', actions: can('write', 'clients') ? [btn({ label: 'Edit', icon: 'pencil', size: 'sm', variant: 'ghost', onClick: () => openRecordForm('clients', { id: c.id, fields: ['standing_instructions', 'gate_code', 'guardhouse', 'pets', 'irrigation', 'power_water', 'parking', 'grass_type', 'property_size_m2', 'slope', 'preferred_channel'], title: 'Property dossier' }) })] : [] },
    c.standing_instructions ? callout('warning', 'Standing instructions', c.standing_instructions, 'megaphone') : null,
    items.length ? h('div.grid.cols-2', { style: 'gap:10px' }, items.map(([ic, l, v]) => h('div.row.gap-8', { style: 'align-items:flex-start;padding:10px;border-radius:12px;background:var(--surface-2)' }, h('div', { class: ['li-ico', 't-grass'], style: 'width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#fff;flex:none' }, icon(ic, 15)), h('div', h('div.small.muted', l), h('div', { style: 'white-space:pre-line;font-weight:600' }, v)))))
      : h('p.muted.small', 'No property details yet — add the gate code, pets, irrigation and outlets so every crew arrives prepared.'));
}
function overviewTab(c, ctx) {
  const hl = clientHealth(c), bal = clientBalance(c.id), monthly = clientMonthly(c.id), ltv = clientLTV(c.id);
  const contracts = clientContracts(c.id), invs = clientInvoices(c.id).sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)));
  const sites = db.filter('sites', s => s.client_id === c.id);
  return h('div.stack',
    h('div.grid', { style: 'grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px' },
      card({ title: 'Client health', icon: 'heart-pulse', cls: 'solid' },
        h('div.row.gap-16', { style: 'align-items:center' }, ring(hl.score, { label: String(hl.score), sub: hl.label, color: hl.score >= 75 ? 'var(--c2)' : hl.score >= 50 ? 'var(--c4)' : 'var(--c6)' }),
          h('ul.small', { style: 'margin:0;padding-left:18px' }, hl.factors.map(f => h('li', f))))),
      card({ title: 'Contact', icon: 'contact', cls: 'solid' }, kv([
        ['Contact', c.contact_name || c.name], ['Mobile', c.phone ? h('a', { href: `tel:${c.phone}` }, fmt.phone(c.phone)) : null], ['Other', c.phone_alt ? fmt.phone(c.phone_alt) : null],
        ['Email', c.email ? h('a', { href: `mailto:${c.email}` }, c.email) : null], ['Prefers', c.preferred_channel ? fmt.titleCase(c.preferred_channel) : null],
        ['Address', [c.address, c.suburb].filter(Boolean).join(', ')], ['Client since', c.since_date ? fmt.date(c.since_date, 'long') : null], ['Salesperson', c.salesperson]]))),
    h('div.grid.cols-4.stagger',
      kpiTile({ label: 'Monthly value', value: monthly, format: 'money', icon: 'repeat', tile: 't-grass' }),
      kpiTile({ label: 'Lifetime billed', value: ltv, format: 'money', icon: 'gem', tile: 't-violet' }),
      kpiTile({ label: 'Balance owing', value: bal, format: 'money', icon: 'hand-coins', tile: bal ? 't-rose' : 't-forest' }),
      kpiTile({ label: 'Invoices', value: invs.length, icon: 'receipt', tile: 't-sky' })),
    dossierPanel(c),
    h('div.grid.cols-2',
      card({ title: 'Maintenance contracts', icon: 'file-check', cls: 'solid', actions: can('write', 'contracts') ? [btn({ label: 'Add', icon: 'plus', size: 'sm', variant: 'ghost', onClick: () => openRecordForm('contracts', { values: { client_id: c.id, name: c.name, legacy_code: c.legacy_code } }) })] : [] },
        contracts.length ? h('div.list.divider-list', contracts.map(k => listItem({ title: `${k.name} · ${(FREQUENCIES.find(f => f.value === k.frequency) || {}).label || k.frequency || ''}`, sub: `${fmt.money(k.monthly_value || 0)} / month${k.per_visit_rate ? ` · ${fmt.money(k.per_visit_rate, { decimals: 3 })} per visit` : ''}`, icon: 'file-check', tile: k.status === 'active' ? 't-forest' : 't-slate', href: recordLink('contracts', k.id), right: statusBadge(k.status) }))) : h('p.small.muted', 'No contract on record.'),
        sites.length ? h('div', { style: 'margin-top:10px' }, h('div.small.muted', 'Sites'), h('div.chips', sites.map(s => h('a.chip', { href: recordLink('sites', s.id) }, icon('map-pin', 13), s.name)))) : null),
      card({ title: 'Recent invoices', icon: 'receipt', cls: 'solid', actions: [btn({ label: 'New', icon: 'plus', size: 'sm', variant: 'ghost', onClick: () => ctx.navigate(`invoices/new?client=${encodeURIComponent(c.id)}`) })] },
        invs.length ? h('div.list.divider-list', invs.slice(0, 6).map(i => listItem({ title: `${i.number || i.legacy_number || 'Invoice'} · ${fmt.money(i.total)}`, sub: `${fmt.date(i.issue_date)}${balanceOf(i) && invoiceState(i) !== 'not_recorded' ? ' · owes ' + fmt.money(balanceOf(i)) : ''}`, icon: 'receipt', tile: 't-violet', href: `#/invoices/i/${encodeURIComponent(i.id)}`, right: invoiceBadge(i) }))) : h('p.small.muted', 'No invoices yet.'))),
    c.notes ? card({ title: 'Notes', icon: 'notebook-pen', cls: 'solid' }, h('p', { style: 'white-space:pre-line;margin:0' }, c.notes)) : null);
}
function relatedList(col, where, render, emptyText) {
  const rows = db.filter(col, where);
  return rows.length ? h('div.list.divider-list', rows.map(render)) : emptyState({ icon: 'inbox', title: emptyText });
}
function detailPage(ctx, id = decodeURIComponent(ctx.params.id)) {
  return entityDetailPage('clients', id, ctx, {
    backHref: '#/clients', backLabel: 'Clients',
    sub: c => [c.legacy_code, c.company, c.suburb].filter(Boolean).join(' · ') || 'Client',
    badges: c => [statusBadge(c.status), c.client_type ? badge(fmt.titleCase(String(c.client_type).replace(/_/g, ' ')), 'gray') : null, c.segment ? badge(c.segment, 'blue') : null, ...(c.tags || []).map(t => badge(t, 'violet'))],
    actions: c => [
      c.phone ? h('a.btn', { href: waLink(c.phone, `Good day ${String(c.contact_name || c.name).split(' ')[0]}, `), target: '_blank', rel: 'noopener' }, icon('message-circle', 16), 'WhatsApp') : null,
      c.phone ? h('a.btn.btn-ghost', { href: `tel:${c.phone}` }, icon('phone', 16), 'Call') : null,
      can('write', 'invoices') ? btn({ label: 'Invoice', icon: 'receipt', onClick: () => ctx.navigate(`invoices/new?client=${encodeURIComponent(c.id)}`) }) : null,
      can('write', 'quotes') ? btn({ label: 'Quote', icon: 'file-signature', variant: 'ghost', onClick: () => ctx.navigate(`quotes/new?client=${encodeURIComponent(c.id)}`) }) : null
    ],
    tabs: [
      { id: 'overview', label: 'Overview', icon: 'layout-dashboard', render: c => overviewTab(c, ctx) },
      { id: 'invoices', label: 'Invoices', icon: 'receipt', count: c => clientInvoices(c.id).length, render: c => relatedList('invoices', i => i.client_id === c.id, i => listItem({ title: `${i.number || i.legacy_number || 'Invoice'} · ${fmt.money(i.total)}`, sub: `${fmt.date(i.issue_date, 'long')}${i.period ? ' · ' + i.period : ''}`, icon: 'receipt', tile: 't-violet', href: `#/invoices/i/${encodeURIComponent(i.id)}`, right: invoiceBadge(i) }), 'No invoices') },
      { id: 'quotes', label: 'Quotes', icon: 'file-signature', count: c => db.filter('quotes', q => q.client_id === c.id).length, render: c => relatedList('quotes', q => q.client_id === c.id, q => listItem({ title: `${q.number || q.legacy_number || 'Quote'} · ${q.title}`, sub: q.total != null ? fmt.money(q.total) : '', icon: 'file-signature', tile: 't-clay', href: `#/quotes/q/${encodeURIComponent(q.id)}`, right: quoteBadge(q) }), 'No quotes') },
      { id: 'work', label: 'Jobs & visits', icon: 'shovel', render: c => h('div.stack',
        relatedList('jobs', j => j.client_id === c.id, j => listItem({ title: j.title, sub: [j.start_date ? fmt.date(j.start_date) : j.month, j.value != null ? fmt.money(j.value) : null].filter(Boolean).join(' · '), icon: 'shovel', tile: 't-clay', href: recordLink('jobs', j.id), right: statusBadge(j.status) }), 'No jobs'),
        relatedList('visits', v => v.client_id === c.id, v => listItem({ title: `${fmt.date(v.date, 'long')} · ${v.crew_name || v.team || ''}`, sub: v.notes || v.status || '', icon: 'route', tile: 't-river', href: recordLink('visits', v.id), right: statusBadge(v.status) }), 'No visits on record')) },
      { id: 'gallery', label: 'Photos & files', icon: 'images', render: c => recordFiles('clients', c.id, ctx) }
    ]
  });
}

/* ---------------- contracts ---------------- */
function contractsPage(ctx) {
  const active = () => db.filter('contracts', c => c.status === 'active');
  const byFreq = () => FREQUENCIES.map(f => ({ f, v: sumBy(active().filter(c => c.frequency === f.value), c => c.monthly_value || 0) })).filter(x => x.v);
  return entityListPage('contracts', ctx, {
    title: 'Maintenance contracts', sub: 'Recurring revenue by client and frequency. Per-visit rates stay exact to the cent-fraction.',
    kpis: rows => [
      kpiTile({ label: 'MRR', value: mrr(), format: 'money', icon: 'repeat', tile: 't-grass' }),
      kpiTile({ label: 'Annualised', value: fromCents(toCents(mrr()) * 12), format: 'money', icon: 'calendar-range', tile: 't-forest' }),
      kpiTile({ label: 'Active contracts', value: active().length, icon: 'file-check', tile: 't-sky' }),
      kpiTile({ label: 'Paused / left', value: rows.filter(r => r.status !== 'active').length, icon: 'circle-pause', tile: 't-clay' })],
    above: card({ title: 'MRR by frequency', icon: 'chart-bar', cls: 'solid', style: 'margin-bottom:16px' }, h('div', { style: 'height:200px' }, chart({ type: 'bar', horizontal: true, labels: byFreq().map(x => x.f.label), series: [{ label: 'Monthly value', data: byFreq().map(x => x.v) }], money: true, dispose: ctx.dispose }))),
    columns: [
      { key: 'name', label: 'Contract', render: r => h('div', h('strong', r.name), h('div.small.muted', r.legacy_code || '')) },
      { key: 'frequency', label: 'Frequency', render: r => (FREQUENCIES.find(f => f.value === r.frequency) || {}).label || r.frequency },
      { key: 'monthly_value', label: 'Monthly', num: true, render: r => fmt.money(r.monthly_value || 0), sort: true },
      { key: 'per_visit_rate', label: 'Per visit', num: true, render: r => (r.per_visit_rate != null ? fmt.money(r.per_visit_rate, { decimals: 3 }) : '—'), hide: 'sm' },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) }
    ],
    footer: rs => ['', `${rs.length}`, fmt.money(sumBy(rs.filter(r => r.status === 'active'), r => r.monthly_value || 0)) + ' active', '', '']
  });
}

export default {
  id: 'clients',
  routes: {
    '': listPage,
    contracts: contractsPage,
    sites: ctx => entityListPage('sites', ctx, { sub: 'Every property you service and its standing instructions.' }),
    'c/:id': ctx => detailPage(ctx)
  },
  detail: { clients: (id, ctx) => detailPage(ctx, id) }
};
void tabs; void emptyState;
