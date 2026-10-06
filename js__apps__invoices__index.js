/* =============================================================================
   Invoices — create anywhere (office or on site), send by WhatsApp/email with the
   PDF, track Paid / Unpaid / Partially paid / Overdue / Awaiting POP, 3-7-14 day
   reminders, the monthly maintenance billing run and every legacy invoice.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, pageHeader, kpiTile, tabs, emptyState, callout, kv, listItem } from '../../ui/components.js';
import { dataTable } from '../../ui/table.js';
import { modal, toast, showError, confirm, menu } from '../../ui/overlays.js';
import { entityDetailPage, recordLink } from '../../ui/entity.js';
import { chart } from '../../ui/charts.js';
import { db } from '../../core/db.js';
import { can } from '../../core/perms.js';
import { today, addDays, monthLabel } from '../../core/dates.js';
import { toCents, fromCents, sumBy } from '../../core/money.js';
import * as fmt from '../../core/format.js';
import { invoiceState, balanceOf, isOpen, ageing, reminderPlan, remindersDue, contractInvoiceDraft, withTotals, nextNumber, paymentsFor, lastMonths, company } from '../_biz.js';
import { docEditor, docPreview, sendSheet, paymentDialog, downloadPdf, invoiceBadge, INVOICE_STATE_BADGE, verifyPayment } from '../_docs.js';

const STATE_TABS = [
  { id: 'open', label: 'Open', icon: 'circle-dot', test: i => isOpen(i) },
  { id: 'overdue', label: 'Overdue', icon: 'alarm-clock', test: i => invoiceState(i) === 'overdue' },
  { id: 'awaiting_pop', label: 'Awaiting POP', icon: 'file-search', test: i => invoiceState(i) === 'awaiting_pop' },
  { id: 'partially_paid', label: 'Part-paid', icon: 'circle-dashed', test: i => invoiceState(i) === 'partially_paid' },
  { id: 'paid', label: 'Paid', icon: 'circle-check', test: i => invoiceState(i) === 'paid' },
  { id: 'draft', label: 'Drafts', icon: 'pencil', test: i => i.status === 'draft' },
  { id: 'not_recorded', label: 'Legacy', icon: 'archive', test: i => i.status === 'not_recorded' },
  { id: 'all', label: 'All', icon: 'list', test: () => true }
];

function listPage(ctx) {
  let tab = ctx.query.tab || (db.filter('invoices', i => isOpen(i)).length ? 'open' : 'all');
  const kpis = h('div.grid.cols-4.stagger', { style: 'margin-bottom:18px' });
  const rows = () => db.all('invoices').filter(STATE_TABS.find(t => t.id === tab).test);
  const drawKpis = () => {
    const all = db.all('invoices'); const a = ageing(all);
    const thisMonth = today().slice(0, 7);
    const paidThisMonth = db.filter('payments', p => p.status === 'verified' && String(p.date).startsWith(thisMonth));
    const months = lastMonths(6);
    const billed = months.map(m => fromCents(all.filter(i => String(i.issue_date).startsWith(m) && i.status !== 'void' && i.kind !== 'balance').reduce((s, i) => s + toCents(i.total || 0), 0)));
    kpis.replaceChildren(
      kpiTile({ label: 'Outstanding', value: a.total, format: 'money', icon: 'hourglass', tile: 't-violet', foot: `${a.count} open invoice${a.count === 1 ? '' : 's'}`, onClick: () => setTab('open') }),
      kpiTile({ label: 'Overdue', value: fromCents(all.filter(i => invoiceState(i) === 'overdue').reduce((s, i) => s + toCents(balanceOf(i)), 0)), format: 'money', icon: 'alarm-clock', tile: 't-rose', foot: `${all.filter(i => invoiceState(i) === 'overdue').length} invoices`, onClick: () => setTab('overdue') }),
      kpiTile({ label: 'Received this month', value: sumBy(paidThisMonth, 'amount'), format: 'money', icon: 'banknote', tile: 't-grass', foot: `${paidThisMonth.length} payment${paidThisMonth.length === 1 ? '' : 's'}` }),
      kpiTile({ label: 'Billed this month', value: billed[billed.length - 1], format: 'money', icon: 'receipt', tile: 't-forest', spark: billed, foot: 'last 6 months →' }));
  };
  const table = dataTable({
    columns: [
      { key: 'number', label: 'Invoice', render: r => h('div', h('strong', r.number || r.legacy_number || 'Draft'), r.number && r.legacy_number ? h('div.small.muted', r.legacy_number) : null), sort: r => r.number || r.legacy_number || '' },
      { key: 'client_name', label: 'Client', render: r => h('div', r.client_name, h('div.small.muted', [r.kind === 'maintenance' ? 'Maintenance' : r.kind === 'adhoc' ? 'Ad-hoc' : fmt.titleCase(String(r.kind || '').replace(/_/g, ' ')), r.period].filter(Boolean).join(' · '))) },
      { key: 'issue_date', label: 'Date', render: r => fmt.date(r.issue_date), sort: true, hide: 'sm' },
      { key: 'due_date', label: 'Due', render: r => (r.due_date ? h('span', { class: invoiceState(r) === 'overdue' ? 'danger-text' : '' }, fmt.dueLabel(r.due_date)) : '—'), sort: true, hide: 'sm' },
      { key: 'total', label: 'Total', num: true, render: r => fmt.money(r.total), sort: true, csv: r => r.total },
      { key: 'balance', label: 'Balance', num: true, render: r => (balanceOf(r) ? h('strong', fmt.money(balanceOf(r))) : h('span.muted', '—')), sort: r => balanceOf(r), csv: r => balanceOf(r) },
      { key: 'status', label: 'Status', render: r => invoiceBadge(r), sort: r => invoiceState(r), csv: r => (INVOICE_STATE_BADGE[invoiceState(r)] || [invoiceState(r)])[0] }
    ],
    rows, sort: '-issue_date', pageSize: 30, exportName: 'invoices', search: ['number', 'legacy_number', 'client_name', 'reference', 'period'],
    onRowClick: r => ctx.navigate(`invoices/i/${encodeURIComponent(r.id)}`),
    footer: rs => ['', `${rs.length} invoices`, '', '', fmt.money(sumBy(rs, 'total')), fmt.money(fromCents(rs.reduce((s, r) => s + toCents(balanceOf(r)), 0))), ''],
    empty: { icon: 'receipt', title: 'No invoices here', text: 'Nothing matches this view.' }
  });
  const tabBar = tabs(STATE_TABS.map(t => ({ id: t.id, label: t.label, icon: t.icon, count: db.all('invoices').filter(t.test).length })), tab, id => { tab = id; table.refresh(); });
  const setTab = id => { tab = id; tabBar.setActive(id); table.refresh(); };
  const due = remindersDue(db.all('invoices'));
  ctx.dispose.add(db.on('invoices', () => { drawKpis(); table.refresh(); }));
  ctx.dispose.add(db.on('payments', drawKpis));
  drawKpis();
  return h('div',
    pageHeader({ title: 'Invoices', sub: 'Issue on site, send with the PDF, and let the system chase payment.', icon: 'receipt', tile: 't-violet',
      actions: [can('write', 'invoices') ? btn({ label: 'Monthly billing run', icon: 'calendar-sync', onClick: () => ctx.navigate('invoices/run') }) : null, can('write', 'invoices') ? btn({ label: 'New invoice', icon: 'plus', variant: 'primary', onClick: () => ctx.navigate('invoices/new') }) : null] }),
    due.length ? callout('warning', `${due.length} payment reminder${due.length === 1 ? '' : 's'} due`, h('div.stack.tight', due.slice(0, 6).map(d => h('div.row.gap-8', h('span', `${d.inv.number || d.inv.legacy_number || ''} · ${d.inv.client_name} · ${fmt.money(balanceOf(d.inv))} — ${d.day}-day reminder`), h('div.spacer'), btn({ label: 'Send', icon: 'send', size: 'sm', onClick: () => sendSheet('invoice', d.inv, d.day) })))), 'bell-ring') : null,
    kpis, tabBar, card({ cls: 'solid', body: table }));
}

/* ---------------- monthly billing run ---------------- */
function billingRun(ctx) {
  const next = new Date(); const def = today().slice(0, 7);
  let period = ctx.query.period || def;
  const out = h('div');
  const picked = new Set();
  const draw = () => {
    const contracts = db.filter('contracts', c => c.status === 'active' && Number(c.monthly_value) > 0);
    const billed = new Set(db.filter('invoices', i => i.period === period && i.contract_id && i.status !== 'void').map(i => i.contract_id));
    const todo = contracts.filter(c => !billed.has(c.id));
    picked.clear(); todo.forEach(c => picked.add(c.id));
    const total = fromCents(todo.reduce((s, c) => s + toCents(c.monthly_value), 0));
    out.replaceChildren(
      h('div.grid.cols-3.stagger', { style: 'margin-bottom:16px' },
        kpiTile({ label: 'Active contracts', value: contracts.length, icon: 'file-check', tile: 't-forest' }),
        kpiTile({ label: 'Already billed for ' + monthLabel(period), value: billed.size, icon: 'check-check', tile: 't-grass' }),
        kpiTile({ label: 'To bill now', value: total, format: 'money', icon: 'receipt', tile: 't-violet', foot: `${todo.length} invoices` })),
      todo.length ? card({ title: `Draft invoices for ${monthLabel(period)}`, sub: 'Per-visit rates stay exact (e.g. 4 × R630.315 = R2,521.26) and are rounded once on the total.', icon: 'list-checks', cls: 'solid' },
        h('div.list.divider-list', todo.map(c => {
          const d = withTotals(contractInvoiceDraft(c, period));
          const cb = h('input', { type: 'checkbox', checked: true, onChange: e => (e.target.checked ? picked.add(c.id) : picked.delete(c.id)) });
          return h('label.list-item', cb, h('div.li-main', h('div.li-title', `${c.legacy_code ? c.legacy_code + ' · ' : ''}${d.client_name}`), h('div.li-sub', d.lines[0].description)), h('strong.num', fmt.money(d.total)));
        })),
        h('div.row', { style: 'margin-top:14px' }, h('div.spacer'),
          btn({ label: 'Create drafts', icon: 'file-plus', onClick: e => create(false) }),
          btn({ label: 'Create & issue all', icon: 'send', variant: 'primary', onClick: e => create(true) })))
        : emptyState({ icon: 'party-popper', title: `Everything is billed for ${monthLabel(period)}`, text: 'Every active maintenance contract already has an invoice for this month.' }));
  };
  const create = async issue => {
    const list = db.filter('contracts', c => picked.has(c.id));
    if (!list.length) return toast.info('Nothing selected');
    if (!(await confirm(`${issue ? 'Create and issue' : 'Create draft'} ${list.length} invoice${list.length === 1 ? '' : 's'} for ${monthLabel(period)}?`, { ok: issue ? 'Issue invoices' : 'Create drafts' }))) return;
    let n = 0;
    for (const c of list) {
      try {
        const d = withTotals(contractInvoiceDraft(c, period));
        if (issue) { d.number = await nextNumber('invoice'); d.status = 'unpaid'; d.reference = d.reference || d.number; }
        await db.insert('invoices', d); n++;
      } catch (e) { showError(e, `Could not create the invoice for ${c.name}`); }
    }
    toast.success(`${n} invoice${n === 1 ? '' : 's'} created`, { text: issue ? 'Send them from the Invoices list.' : 'Review the drafts, then issue.' });
    draw();
  };
  draw();
  const months = [-1, 0, 1].map(o => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  void next;
  return h('div',
    pageHeader({ title: 'Monthly billing run', sub: 'Turns every active maintenance contract into this month’s invoice in one go — nothing is missed, nothing is billed twice.', icon: 'calendar-sync', tile: 't-violet', crumbs: [{ label: 'Invoices', href: '#/invoices' }, { label: 'Billing run' }],
      actions: [h('select.select', { style: 'width:auto', onChange: e => { period = e.target.value; draw(); } }, months.map(m => h('option', { value: m, selected: m === period }, monthLabel(m))))] }),
    out);
}

/* ---------------- detail ---------------- */
function detailPage(ctx, id = decodeURIComponent(ctx.params.id)) {
  return entityDetailPage('invoices', id, ctx, {
    backHref: '#/invoices', backLabel: 'Invoices',
    title: r => `${r.number || r.legacy_number || 'Draft invoice'}`,
    sub: r => h('span', r.client_name, ' · ', fmt.money(r.total), r.issue_date ? ` · ${fmt.date(r.issue_date, 'long')}` : ''),
    badges: r => [invoiceBadge(r), r.kind ? badge(fmt.titleCase(String(r.kind).replace(/_/g, ' ')), 'gray') : null, r.period ? badge(monthLabel(r.period), 'blue') : null, r.sent_at ? badge(`Sent ${fmt.relative(r.sent_at)} via ${(r.sent_via || []).join(', ')}`, 'green') : null, r.client_id ? h('a.chip', { href: recordLink('clients', r.client_id) }, icon('user', 13), 'Client') : null],
    actions: r => {
      const st = invoiceState(r), w = can('write', 'invoices');
      return [
        w && r.status === 'draft' ? btn({ label: 'Issue', icon: 'stamp', variant: 'primary', onClick: async () => { try { const number = r.number || await nextNumber('invoice'); await db.update('invoices', r.id, { number, status: 'unpaid', reference: r.reference || number }); sendSheet('invoice', db.get('invoices', r.id)); } catch (e) { showError(e); } } }) : null,
        r.status !== 'draft' && r.status !== 'void' ? btn({ label: 'Send', icon: 'send', variant: st === 'paid' ? undefined : 'primary', onClick: () => sendSheet('invoice', r) }) : null,
        w && isOpen(r) || (w && r.status === 'not_recorded') ? btn({ label: 'Record payment', icon: 'wallet', onClick: () => paymentDialog(r) }) : null,
        btn({ label: 'PDF', icon: 'download', variant: 'ghost', onClick: () => downloadPdf('invoice', r) }),
        w ? h('button.btn.btn-ghost', { onClick: e => menu(e.currentTarget, [
          !r.total_override_reason ? { label: 'Edit lines', icon: 'pencil-line', onClick: () => ctx.navigate(`invoices/edit/${encodeURIComponent(r.id)}`) } : null,
          { label: 'Upload proof of payment', icon: 'file-up', onClick: () => paymentDialog(r, { pop: true }) },
          { label: 'Duplicate', icon: 'copy', onClick: () => ctx.navigate(`invoices/new?from=${encodeURIComponent(r.id)}`) },
          { label: 'Credit note', icon: 'undo-2', onClick: () => ctx.navigate(`invoices/new?credit=${encodeURIComponent(r.id)}`) },
          r.status !== 'void' ? '-' : null,
          r.status !== 'void' ? { label: 'Void invoice', icon: 'ban', danger: true, onClick: async () => { if (await confirm(`Void ${r.number || r.legacy_number}? It stays on record but no longer counts as owed.`, { danger: true, ok: 'Void' })) await db.update('invoices', r.id, { status: 'void' }); } } : null
        ]) }, icon('ellipsis'), 'More') : null
      ];
    },
    summary: r => h('div.grid.cols-4.stagger', { style: 'margin-bottom:16px' },
      kpiTile({ label: 'Total', value: r.total, format: 'money', icon: 'receipt', tile: 't-violet' }),
      kpiTile({ label: 'Paid', value: r.amount_paid || 0, format: 'money', icon: 'banknote', tile: 't-grass' }),
      kpiTile({ label: 'Balance', value: balanceOf(r), format: 'money', icon: 'hourglass', tile: balanceOf(r) ? 't-rose' : 't-forest' }),
      kpiTile({ label: 'Due', value: r.due_date ? fmt.dueLabel(r.due_date) : 'On receipt', icon: 'calendar-clock', tile: 't-sun' })),
    tabs: [
      { id: 'doc', label: 'Invoice', icon: 'file-text', render: r => h('div', r.total_override_reason ? callout('warning', 'Printed total differs from the lines', r.total_override_reason, 'triangle-alert') : null, docPreview('invoice', r)) },
      { id: 'payments', label: 'Payments', icon: 'wallet', count: r => paymentsFor(r.id).length, render: r => paymentsTab(r) },
      { id: 'reminders', label: 'Reminders', icon: 'bell-ring', render: r => remindersTab(r) }
    ]
  });
}
function paymentsTab(r) {
  const pays = paymentsFor(r.id);
  return h('div.stack',
    pays.length ? h('div.list.divider-list', pays.map(p => listItem({
      title: `${fmt.money(p.amount)} · ${fmt.titleCase(p.method || '')}`, sub: `${fmt.date(p.date, 'long')}${p.reference ? ' · Ref ' + p.reference : ''} · recorded by ${p.created_by_name || '—'}`,
      icon: p.status === 'verified' ? 'circle-check' : p.status === 'rejected' ? 'circle-x' : 'file-search', tile: p.status === 'verified' ? 't-grass' : p.status === 'rejected' ? 't-rose' : 't-violet',
      right: p.status === 'awaiting_verification' && can('write', 'payments') ? h('div.row.gap-4', btn({ label: 'Verify', icon: 'check', size: 'sm', variant: 'primary', onClick: () => verifyPayment(p, true) }), btn({ label: 'Reject', size: 'sm', variant: 'ghost', onClick: () => verifyPayment(p, false) })) : badge(p.status === 'verified' ? 'Verified' : p.status === 'rejected' ? 'Rejected' : 'Awaiting', p.status === 'verified' ? 'green' : p.status === 'rejected' ? 'red' : 'violet')
    }))) : emptyState({ icon: 'wallet', title: 'No payments yet', text: r.status === 'not_recorded' ? 'This invoice came from the old system, where payments were not recorded. Record the payment if it has been paid.' : 'Record a payment or upload the client’s proof of payment.' }),
    can('write', 'invoices') && r.status !== 'void' ? h('div.row.gap-8', btn({ label: 'Record payment', icon: 'wallet', variant: 'primary', onClick: () => paymentDialog(r) }), btn({ label: 'Upload POP', icon: 'file-up', onClick: () => paymentDialog(r, { pop: true }) })) : null);
}
function remindersTab(r) {
  const plan = reminderPlan(r);
  if (!r.due_date) return emptyState({ icon: 'bell-off', title: 'No due date', text: 'Reminders are scheduled from the due date.' });
  return h('div.stack',
    h('p.muted', 'Friendly reminders go out 3, 7 and 14 days after the due date while money is still owed. The Autonomous Core sends them automatically when messaging is connected; you can also send any of them now.'),
    h('div.list.divider-list', plan.map(p => listItem({
      title: `${p.day}-day reminder`, sub: p.sent ? `Sent ${fmt.dateTime(p.sent.at)} via ${p.sent.via}${p.sent.by ? ' by ' + p.sent.by : ''}` : `${p.due ? 'Due since' : 'Scheduled for'} ${fmt.date(p.date, 'long')}`,
      icon: p.sent ? 'check' : p.due ? 'bell-ring' : 'clock', tile: p.sent ? 't-grass' : p.due ? 't-rose' : 't-slate',
      right: !p.sent && isOpen(r) ? btn({ label: 'Send now', icon: 'send', size: 'sm', onClick: () => sendSheet('invoice', r, p.day) }) : null
    }))));
}

/* ---------------- new / edit ---------------- */
function newPage(ctx) {
  const q = ctx.query;
  let values = {};
  if (q.client) { const c = db.get('clients', q.client); if (c) values = { client_id: c.id, client_name: c.name, bill_to: [c.name, c.address, c.suburb].filter(Boolean).join('\n'), reference: c.legacy_code || null }; }
  if (q.from) { const s = db.get('invoices', q.from); if (s) { const { id, number, legacy_number, status, amount_paid, sent_at, sent_via, reminders_sent, created_at, created_by, created_by_name, updated_at, updated_by, updated_by_name, signature, total_override_reason, source_file, _src, _seed, ...rest } = s; values = { ...rest, issue_date: today(), due_date: addDays(today(), Number(company().default_due_days) || 7), status: 'draft' }; } }
  if (q.credit) { const s = db.get('invoices', q.credit); if (s) values = { client_id: s.client_id, client_name: s.client_name, bill_to: s.bill_to, kind: 'credit_note', reference: s.number || s.legacy_number, lines: (s.lines || []).map(l => ({ ...l })), notes: `Credit note against ${s.number || s.legacy_number}` }; }
  if (q.job) { const j = db.get('jobs', q.job); if (j) values = { job_id: j.id, client_id: j.client_id || null, client_name: j.client_name || '', kind: 'adhoc', lines: [{ description: j.title, qty: 1, unit_price: j.value || null }] }; }
  if (q.quote) { const qt = db.get('quotes', q.quote); if (qt) values = { quote_id: qt.id, client_id: qt.client_id || null, client_name: qt.client_name, kind: q.deposit ? 'deposit' : 'adhoc', lines: q.deposit ? [{ description: `Deposit (${qt.deposit_pct}%) — ${qt.title} (quote ${qt.number || qt.legacy_number || ''})`, qty: 1, unit_price: qt.deposit_amount }] : (qt.lines || []).map(l => ({ ...l })), vat_applied: qt.vat_applied, discount: q.deposit ? 0 : qt.discount }; }
  return docEditor('invoice', ctx, { values });
}

export default {
  id: 'invoices',
  routes: {
    '': listPage,
    new: newPage,
    run: billingRun,
    'edit/:id': ctx => docEditor('invoice', ctx, { id: decodeURIComponent(ctx.params.id) }),
    'i/:id': ctx => detailPage(ctx)
  },
  detail: { invoices: (id, ctx) => detailPage(ctx, id) }
};
