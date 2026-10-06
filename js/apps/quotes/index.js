/* =============================================================================
   Quotes — build from the price list, send with a branded PDF, get the client's
   acceptance and signature on your phone, then turn it into a job and a deposit
   invoice in one tap. Every legacy quote from the sales workbook is here too.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, pageHeader, kpiTile, tabs, callout } from '../../ui/components.js';
import { dataTable } from '../../ui/table.js';
import { modal, toast, showError, confirm, menu } from '../../ui/overlays.js';
import { entityDetailPage, recordLink } from '../../ui/entity.js';
import { fieldInput } from '../../ui/form.js';
import { celebrate } from '../../ui/animate.js';
import { db } from '../../core/db.js';
import { can } from '../../core/perms.js';
import { today } from '../../core/dates.js';
import { toCents, fromCents, sumBy } from '../../core/money.js';
import * as fmt from '../../core/format.js';
import { docEditor, docPreview, sendSheet, downloadPdf, quoteBadge } from '../_docs.js';

const live = q => (q.status === 'sent' && q.valid_until && q.valid_until < today() ? 'expired' : q.status);
const TABS = [
  { id: 'open', label: 'Open', icon: 'circle-dot', test: q => ['draft', 'sent', 'viewed'].includes(live(q)) },
  { id: 'accepted', label: 'Accepted', icon: 'circle-check', test: q => q.status === 'accepted' },
  { id: 'expired', label: 'Expired', icon: 'timer-off', test: q => live(q) === 'expired' },
  { id: 'rejected', label: 'Declined', icon: 'circle-x', test: q => q.status === 'rejected' },
  { id: 'all', label: 'All', icon: 'list', test: () => true }
];

function listPage(ctx) {
  let tab = ctx.query.tab || 'all';
  const kpis = h('div.grid.cols-4.stagger', { style: 'margin-bottom:18px' });
  const drawKpis = () => {
    const all = db.all('quotes');
    const open = all.filter(TABS[0].test), won = all.filter(q => q.status === 'accepted');
    const decided = all.filter(q => ['accepted', 'rejected', 'expired'].includes(live(q)));
    kpis.replaceChildren(
      kpiTile({ label: 'Open pipeline', value: sumBy(open, q => q.total || 0), format: 'money', icon: 'git-branch', tile: 't-clay', foot: `${open.length} quotes` }),
      kpiTile({ label: 'Accepted', value: sumBy(won, q => q.total || 0), format: 'money', icon: 'handshake', tile: 't-grass', foot: `${won.length} quotes` }),
      kpiTile({ label: 'Win rate', value: decided.length ? (won.length / decided.length) * 100 : 0, format: 'pct', icon: 'trophy', tile: 't-sun', foot: `of ${decided.length} decided` }),
      kpiTile({ label: 'All quotes', value: sumBy(all, q => q.total || 0), format: 'money', icon: 'file-signature', tile: 't-violet', foot: `${all.length} quotes` }));
  };
  const table = dataTable({
    columns: [
      { key: 'number', label: 'Quote', render: r => h('div', h('strong', r.number || (r.legacy_number ? `#${r.legacy_number}` : 'Draft')), r.version > 1 ? h('span.small.muted', ` v${r.version}`) : null), sort: r => r.number || r.legacy_number || '' },
      { key: 'client_name', label: 'Client', render: r => h('div', r.client_name, h('div.small.muted', fmt.truncate(r.title, 60))) },
      { key: 'issue_date', label: 'Issued', render: r => (r.issue_date ? fmt.date(r.issue_date) : h('span.muted', r.issue_date_raw || '—')), sort: true, hide: 'sm' },
      { key: 'valid_until', label: 'Valid until', render: r => (r.valid_until ? fmt.date(r.valid_until) : '—'), sort: true, hide: 'sm' },
      { key: 'salesperson', label: 'By', hide: 'sm' },
      { key: 'total', label: 'Total', num: true, render: r => (r.total != null ? fmt.money(r.total) : h('span.muted', '—')), sort: true, csv: r => r.total },
      { key: 'status', label: 'Status', render: r => quoteBadge(r), sort: r => live(r), csv: r => live(r) }
    ],
    rows: () => db.all('quotes').filter(TABS.find(t => t.id === tab).test), sort: '-issue_date', pageSize: 30, exportName: 'quotes',
    search: ['number', 'legacy_number', 'client_name', 'title', 'salesperson'],
    onRowClick: r => ctx.navigate(`quotes/q/${encodeURIComponent(r.id)}`),
    footer: rs => ['', `${rs.length} quotes`, '', '', '', fmt.money(sumBy(rs, r => r.total || 0)), '']
  });
  ctx.dispose.add(db.on('quotes', () => { drawKpis(); table.refresh(); }));
  drawKpis();
  return h('div',
    pageHeader({ title: 'Quotes', sub: 'Quote fast, follow up on time, and turn yeses into booked jobs.', icon: 'file-signature', tile: 't-clay',
      actions: [can('write', 'quotes') ? btn({ label: 'New quote', icon: 'plus', variant: 'primary', onClick: () => ctx.navigate('quotes/new') }) : null] }),
    kpis,
    tabs(TABS.map(t => ({ id: t.id, label: t.label, icon: t.icon, count: db.all('quotes').filter(t.test).length })), tab, id => { tab = id; table.refresh(); }),
    card({ cls: 'solid', body: table }));
}

/* ---------------- accept on site ---------------- */
function acceptDialog(q, ctx) {
  const v = { approved_name: q.client_name, signature: null, makeJob: true, depositInvoice: !!q.deposit_amount };
  modal({
    title: `Accept ${q.number || 'quote'}`, icon: 'handshake', tile: 't-grass',
    body: h('div.stack',
      h('p', `${q.client_name} accepts “${q.title}” for `, h('strong', fmt.money(q.total)), q.deposit_amount ? ` with a ${fmt.money(q.deposit_amount)} deposit.` : '.'),
      h('div.field', h('label.field-label', 'Accepted by (name)'), fieldInput({ type: 'text' }, v.approved_name, x => { v.approved_name = x; })),
      h('div.field', h('label.field-label', 'Client signature (hand them the phone)'), fieldInput({ type: 'signature' }, null, x => { v.signature = x; })),
      h('label.row.gap-8', fieldInput({ type: 'bool', switchLabel: 'Create the job and put it on the schedule' }, true, x => { v.makeJob = x; })),
      q.deposit_amount ? h('label.row.gap-8', fieldInput({ type: 'bool', switchLabel: `Create the ${fmt.money(q.deposit_amount)} deposit invoice` }, true, x => { v.depositInvoice = x; })) : null),
    actions: [{ label: 'Cancel', variant: 'ghost' }, {
      label: 'Accept quote', icon: 'check', variant: 'primary', onClick: async () => {
        try {
          let job = null;
          if (v.makeJob) job = await db.insert('jobs', { title: q.title, client_id: q.client_id || null, client_name: q.client_name, quote_id: q.id, status: q.deposit_amount ? 'awaiting_deposit' : 'scheduled', value: q.total, deposit: q.deposit_amount || null, deposit_status: q.deposit_amount ? 'requested' : 'not_required', booked_date: today(), salesperson: q.salesperson || null, notes: `From quote ${q.number || q.legacy_number || ''}` });
          await db.update('quotes', q.id, { status: 'accepted', approved_at: new Date().toISOString(), approved_name: v.approved_name, signature: v.signature, job_id: job ? job.id : q.job_id || null, deposit_status: q.deposit_amount ? 'requested' : 'not_required' });
          if (q.lead_id && db.get('leads', q.lead_id)) await db.update('leads', q.lead_id, { stage: 'won' }).catch(() => {});
          celebrate();
          toast.success('Quote accepted — well done!', { text: job ? 'The job is booked.' : '' });
          if (v.depositInvoice) ctx.navigate(`invoices/new?quote=${encodeURIComponent(q.id)}&deposit=1`);
        } catch (e) { showError(e); return false; }
      }
    }]
  });
}

async function revise(q, ctx) {
  const { id, number, status, approved_at, approved_name, signature, sent_at, sent_via, created_at, created_by, created_by_name, updated_at, updated_by, updated_by_name, _src, _seed, ...rest } = q;
  try {
    const nv = await db.insert('quotes', { ...rest, status: 'draft', number: null, version: (q.version || 1) + 1, parent_id: q.id, issue_date: today(), issue_date_raw: null, notes: [q.notes, `Revision of ${q.number || q.legacy_number || 'quote'}`].filter(Boolean).join('\n') });
    await db.update('quotes', q.id, { status: 'superseded' });
    ctx.navigate(`quotes/edit/${encodeURIComponent(nv.id)}`);
  } catch (e) { showError(e); }
}

function detailPage(ctx, id = decodeURIComponent(ctx.params.id)) {
  return entityDetailPage('quotes', id, ctx, {
    backHref: '#/quotes', backLabel: 'Quotes',
    title: r => `${r.number || (r.legacy_number ? 'Quote #' + r.legacy_number : 'Draft quote')}${r.version > 1 ? ` (v${r.version})` : ''}`,
    sub: r => h('span', r.client_name, ' · ', r.title, r.total != null ? ` · ${fmt.money(r.total)}` : ''),
    badges: r => [quoteBadge(r), r.deposit_amount ? badge(`Deposit ${fmt.money(r.deposit_amount)} · ${fmt.titleCase(String(r.deposit_status || '').replace(/_/g, ' '))}`, r.deposit_status === 'paid' ? 'green' : 'gold') : null, r.lead_id ? h('a.chip', { href: recordLink('leads', r.lead_id) }, icon('target', 13), 'Lead') : null, r.job_id ? h('a.chip', { href: recordLink('jobs', r.job_id) }, icon('shovel', 13), 'Job') : null],
    actions: r => {
      const w = can('write', 'quotes'), open = ['draft', 'sent', 'viewed'].includes(r.status);
      return [
        w && open ? btn({ label: 'Client accepts', icon: 'handshake', variant: 'primary', onClick: () => acceptDialog(r, ctx) }) : null,
        r.status !== 'superseded' ? btn({ label: 'Send', icon: 'send', onClick: () => sendSheet('quote', r) }) : null,
        btn({ label: 'PDF', icon: 'download', variant: 'ghost', onClick: () => downloadPdf('quote', r) }),
        w ? h('button.btn.btn-ghost', { onClick: e => menu(e.currentTarget, [
          open && Array.isArray(r.lines) && r.lines.length ? { label: 'Edit lines', icon: 'pencil-line', onClick: () => ctx.navigate(`quotes/edit/${encodeURIComponent(r.id)}`) } : null,
          { label: 'Revise (new version)', icon: 'git-branch-plus', onClick: () => revise(r, ctx) },
          { label: 'Convert to invoice', icon: 'receipt', onClick: () => ctx.navigate(`invoices/new?quote=${encodeURIComponent(r.id)}`) },
          r.deposit_amount ? { label: 'Deposit invoice', icon: 'piggy-bank', onClick: () => ctx.navigate(`invoices/new?quote=${encodeURIComponent(r.id)}&deposit=1`) } : null,
          { label: 'Duplicate', icon: 'copy', onClick: () => ctx.navigate(`quotes/new?from=${encodeURIComponent(r.id)}`) },
          open ? '-' : null,
          open ? { label: 'Client declined', icon: 'circle-x', danger: true, onClick: async () => { const reason = await (await import('../../ui/overlays.js')).prompt('Why did they decline? (helps the learning models)', { title: 'Quote declined', ok: 'Save' }); if (reason === null) return; await db.update('quotes', r.id, { status: 'rejected', notes: [r.notes, reason ? `Declined: ${reason}` : null].filter(Boolean).join('\n') }); if (r.lead_id) await db.update('leads', r.lead_id, { stage: 'lost', lost_reason: reason || null }).catch(() => {}); } } : null
        ]) }, icon('ellipsis'), 'More') : null
      ];
    },
    tabs: [{ id: 'doc', label: 'Quote', icon: 'file-text', render: r => h('div', !Array.isArray(r.lines) || !r.lines.length ? callout('info', 'Imported from the sales workbook', 'The old quote register only kept the description and total — use "Revise" to rebuild it with line items.', 'archive') : null, docPreview('quote', { ...r, lines: Array.isArray(r.lines) && r.lines.length ? r.lines : [{ description: r.title, qty: 1, unit_price: r.total || 0, amount: r.total || 0 }] })) }]
  });
}

function newPage(ctx) {
  const q = ctx.query; let values = {};
  if (q.lead) { const l = db.get('leads', q.lead); if (l) values = { lead_id: l.id, client_name: l.name, client_id: l.client_id || null, title: l.next_action || '', bill_to: [l.name, l.contact_name, l.address].filter(Boolean).join('\n') }; }
  if (q.client) { const c = db.get('clients', q.client); if (c) values = { client_id: c.id, client_name: c.name, bill_to: [c.name, c.address].filter(Boolean).join('\n') }; }
  if (q.from) { const s = db.get('quotes', q.from); if (s) { const { id, number, legacy_number, status, approved_at, approved_name, signature, sent_at, sent_via, created_at, created_by, created_by_name, updated_at, updated_by, updated_by_name, job_id, _src, _seed, ...rest } = s; values = { ...rest, issue_date: today(), version: 1, parent_id: null }; } }
  return docEditor('quote', ctx, { values });
}

export default {
  id: 'quotes',
  routes: { '': listPage, new: newPage, 'edit/:id': ctx => docEditor('quote', ctx, { id: decodeURIComponent(ctx.params.id) }), 'q/:id': ctx => detailPage(ctx) },
  detail: { quotes: (id, ctx) => detailPage(ctx, id) }
};
void toCents; void fromCents;
