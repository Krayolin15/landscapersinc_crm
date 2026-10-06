/* =============================================================================
   Payments & debtors — who owes what (0–30 / 31–60 / 60+ ageing), the proof-of-
   payment verification queue, the POP matcher, every receipt, and client
   statements (PDF).
   ========================================================================== */

import { h, downloadBlob } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, pageHeader, kpiTile, tabs, emptyState, listItem, callout } from '../../ui/components.js';
import { dataTable } from '../../ui/table.js';
import { modal, showError } from '../../ui/overlays.js';
import { entityListPage, entityDetailPage, recordLink } from '../../ui/entity.js';
import { chart } from '../../ui/charts.js';
import { db } from '../../core/db.js';
import { can } from '../../core/perms.js';
import { today } from '../../core/dates.js';
import { toCents, fromCents, sumBy, formatMoney } from '../../core/money.js';
import * as fmt from '../../core/format.js';
import { ageing, ageBucket, balanceOf, isOpen, invoiceState, company, printBank, lastMonths } from '../_biz.js';
import { paymentDialog, verifyPayment, popMatcher, invoiceBadge, sendSheet, statementPdf } from '../_docs.js';

function debtorsRows() {
  const map = new Map();
  for (const inv of db.all('invoices')) {
    if (!isOpen(inv)) continue;
    const key = inv.client_id || `name:${inv.client_name}`;
    const r = map.get(key) || { id: key, client_id: inv.client_id, client_name: inv.client_name, b0: 0, b31: 0, b60: 0, total: 0, count: 0, oldest: inv.issue_date, overdue: 0 };
    const c = toCents(balanceOf(inv)), b = ageBucket(inv);
    if (b === '0-30') r.b0 += c; else if (b === '31-60') r.b31 += c; else r.b60 += c;
    r.total += c; r.count++; if (inv.issue_date < r.oldest) r.oldest = inv.issue_date; if (invoiceState(inv) === 'overdue') r.overdue++;
    map.set(key, r);
  }
  return [...map.values()].map(r => ({ ...r, b0: fromCents(r.b0), b31: fromCents(r.b31), b60: fromCents(r.b60), total: fromCents(r.total) }));
}

function home(ctx) {
  let tab = ctx.query.tab || 'debtors';
  const body = h('div');
  const kpis = h('div.grid.cols-4.stagger', { style: 'margin-bottom:18px' });
  const drawKpis = () => {
    const a = ageing(db.all('invoices'));
    kpis.replaceChildren(
      kpiTile({ label: 'Total owed to us', value: a.total, format: 'money', icon: 'hand-coins', tile: 't-rose', foot: `${a.count} open invoices` }),
      kpiTile({ label: '0–30 days', value: a['0-30'], format: 'money', icon: 'clock-3', tile: 't-grass' }),
      kpiTile({ label: '31–60 days', value: a['31-60'], format: 'money', icon: 'clock-8', tile: 't-sun' }),
      kpiTile({ label: '60+ days', value: a['60+'], format: 'money', icon: 'siren', tile: 't-rose' }));
  };
  const views = {
    debtors: () => {
      const rows = debtorsRows();
      if (!rows.length) return emptyState({ icon: 'party-popper', title: 'Nobody owes you anything', text: 'Every recorded invoice is paid.' });
      const a = ageing(db.all('invoices'));
      return h('div.grid', { style: 'grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:16px' },
        card({ cls: 'solid', body: dataTable({
          columns: [
            { key: 'client_name', label: 'Client', render: r => (r.client_id ? h('a', { href: recordLink('clients', r.client_id), onClick: e => e.stopPropagation() }, r.client_name) : r.client_name) },
            { key: 'count', label: 'Invoices', num: true },
            { key: 'b0', label: '0–30', num: true, render: r => (r.b0 ? fmt.money(r.b0) : '—') },
            { key: 'b31', label: '31–60', num: true, render: r => (r.b31 ? h('span', { style: 'color:var(--warning)' }, fmt.money(r.b31)) : '—') },
            { key: 'b60', label: '60+', num: true, render: r => (r.b60 ? h('strong', { style: 'color:var(--danger)' }, fmt.money(r.b60)) : '—') },
            { key: 'total', label: 'Total', num: true, render: r => h('strong', fmt.money(r.total)) }
          ],
          rows, sort: '-total', exportName: 'debtors-ageing', onRowClick: r => statementDialog(r),
          footer: rs => ['Total', rs.reduce((s, r) => s + r.count, 0), fmt.money(sumBy(rs, 'b0')), fmt.money(sumBy(rs, 'b31')), fmt.money(sumBy(rs, 'b60')), fmt.money(sumBy(rs, 'total'))]
        }) }),
        card({ title: 'Debt ageing', icon: 'chart-pie', cls: 'solid' }, h('div', { style: 'height:240px' }, chart({ type: 'doughnut', labels: ['0–30 days', '31–60 days', '60+ days'], series: [{ label: 'Owed', data: [a['0-30'], a['31-60'], a['60+']], colors: ['var(--c2)', 'var(--c4)', 'var(--c6)'] }], money: true, dispose: ctx.dispose })),
          h('p.small.muted', { style: 'margin-top:10px' }, 'Click a client for their statement. Ageing counts from the invoice date.')));
    },
    pop: () => {
      const q = db.filter('payments', p => p.status === 'awaiting_verification');
      return h('div.stack',
        card({ title: 'Find the invoice for a proof of payment', icon: 'scan-search', cls: 'solid' }, popMatcher(inv => paymentDialog(inv, { pop: true }))),
        card({ title: 'Waiting for bank verification', sub: q.length ? `${q.length} proof${q.length === 1 ? '' : 's'} of payment` : 'Nothing waiting', icon: 'file-search', cls: 'solid' },
          q.length ? h('div.list.divider-list', q.map(p => listItem({ title: `${p.client_name || 'Payment'} · ${fmt.money(p.amount)}`, sub: `${fmt.date(p.date, 'long')} · ref ${p.reference || '—'} · uploaded by ${p.created_by_name || '—'}`, icon: 'file-search', tile: 't-violet', href: p.invoice_id ? `#/invoices/i/${encodeURIComponent(p.invoice_id)}` : undefined,
            right: can('write', 'payments') ? h('div.row.gap-4', btn({ label: 'In bank', icon: 'check', size: 'sm', variant: 'primary', onClick: e => { e.preventDefault(); verifyPayment(p, true); } }), btn({ label: 'Not received', size: 'sm', variant: 'ghost', onClick: e => { e.preventDefault(); verifyPayment(p, false); } })) : null }))) : emptyState({ icon: 'check-check', title: 'All proofs of payment are verified' })));
    },
    received: () => {
      const months = lastMonths(12);
      const byM = months.map(m => sumBy(db.filter('payments', p => p.status === 'verified' && String(p.date).startsWith(m)), 'amount'));
      return h('div.stack',
        card({ title: 'Money received per month', icon: 'chart-column', cls: 'solid' }, h('div', { style: 'height:220px' }, chart({ type: 'bar', labels: months.map(m => fmt.date(m + '-01', 'short').replace(/^\d+\s/, '')), series: [{ label: 'Received', data: byM, color: 'var(--c2)' }], money: true, dispose: ctx.dispose }))),
        entityListPage('payments', ctx, { title: 'All payments', sub: 'Every receipt, who recorded it and how it was verified.' }));
    }
  };
  const draw = () => body.replaceChildren(views[tab]());
  ctx.dispose.add(db.on('invoices', () => { drawKpis(); if (tab !== 'received') draw(); }));
  ctx.dispose.add(db.on('payments', () => { drawKpis(); draw(); }));
  drawKpis(); draw();
  const popCount = db.filter('payments', p => p.status === 'awaiting_verification').length;
  return h('div',
    pageHeader({ title: 'Payments & debtors', sub: 'What is owed, how old it is, and every rand that came in.', icon: 'wallet', tile: 't-rose',
      actions: [btn({ label: 'Match a POP', icon: 'scan-search', onClick: () => { tab = 'pop'; tb.setActive('pop'); draw(); } })] }),
    kpis,
    (tb = tabs([{ id: 'debtors', label: 'Debtors & ageing', icon: 'hand-coins' }, { id: 'pop', label: 'Proof of payment', icon: 'file-search', count: popCount || undefined }, { id: 'received', label: 'Received', icon: 'banknote' }], tab, id => { tab = id; draw(); })),
    body);
}
let tb;

/* ---------------- statements ---------------- */
function statementDialog(row) {
  const inv = db.all('invoices').filter(i => (row.client_id ? i.client_id === row.client_id : i.client_name === row.client_name) && i.status !== 'void' && i.status !== 'draft').sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date)));
  const pays = db.filter('payments', p => p.status === 'verified' && (row.client_id ? p.client_id === row.client_id : p.client_name === row.client_name));
  const open = inv.filter(i => isOpen(i));
  modal({
    title: `Statement · ${row.client_name}`, icon: 'scroll-text', tile: 't-rose', size: 'wide',
    body: h('div.stack',
      h('div.grid.cols-3', kpiTile({ label: 'Balance', value: row.total, format: 'money', icon: 'hand-coins', tile: 't-rose' }), kpiTile({ label: 'Open invoices', value: open.length, icon: 'receipt', tile: 't-violet' }), kpiTile({ label: 'Paid to date', value: sumBy(pays, 'amount'), format: 'money', icon: 'banknote', tile: 't-grass' })),
      h('div.list.divider-list', open.map(i => listItem({ title: `${i.number || i.legacy_number || 'Invoice'} · ${fmt.money(balanceOf(i))}`, sub: `${fmt.date(i.issue_date, 'long')} · ${ageBucket(i)} days`, icon: 'receipt', tile: 't-violet', href: `#/invoices/i/${encodeURIComponent(i.id)}`, right: invoiceBadge(i) })))),
    actions: [
      { label: 'Close', variant: 'ghost' },
      open[0] ? { label: 'Send reminder', icon: 'send', onClick: () => sendSheet('invoice', open[0], 7) } : null,
      { label: 'Statement PDF', icon: 'download', variant: 'primary', onClick: async () => { try { downloadBlob(await clientStatement(row, inv, pays), `Statement ${row.client_name} ${today()}.pdf`); } catch (e) { showError(e, 'Could not create the PDF'); } return false; } }
    ].filter(Boolean)
  });
}
function clientStatement(row, inv, pays) {
  const cl = row.client_id ? db.get('clients', row.client_id) : null;
  const events = [...inv.map(i => ({ date: i.issue_date, text: `Invoice ${i.number || i.legacy_number || ''}${i.period ? ' (' + i.period + ')' : ''}`, debit: i.kind === 'credit_note' ? 0 : Number(i.total) || 0, credit: i.kind === 'credit_note' ? Number(i.total) || 0 : 0 })),
    ...pays.map(p => ({ date: p.date, text: `Payment received${p.reference ? ' — ' + p.reference : ''}`, debit: 0, credit: Number(p.amount) || 0 }))].sort((x, y) => String(x.date).localeCompare(String(y.date)));
  return statementPdf({ client: { name: row.client_name, bill_to: cl ? [cl.name, cl.company && cl.company !== cl.name ? cl.company : null, cl.address, cl.suburb].filter(Boolean).join('\n') : row.client_name }, events, aging: { b0: row.b0, b31: row.b31, b60: row.b60, total: row.total } });
}

export default {
  id: 'payments',
  routes: { '': home, ':id': ctx => entityDetailPage('payments', decodeURIComponent(ctx.params.id), ctx, { backHref: '#/payments?tab=received', backLabel: 'Payments' }) },
  detail: { payments: (id, ctx) => entityDetailPage('payments', id, ctx, { backHref: '#/payments?tab=received', backLabel: 'Payments' }) }
};
void icon; void callout; void badge;
