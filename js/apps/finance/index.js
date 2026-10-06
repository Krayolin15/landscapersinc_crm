/* =============================================================================
   Finance — the income statement month by month (the figures exactly as the
   company recorded them, next to what the live system now shows), revenue vs
   expenses, the expense ledger by category, margin per job and per suburb,
   payroll, owner funding and a 3-month cash outlook.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, pageHeader, kpiTile, tabs, emptyState, callout, listItem } from '../../ui/components.js';
import { dataTable } from '../../ui/table.js';
import { entityListPage, entityDetailPage, recordLink } from '../../ui/entity.js';
import { openRecordForm } from '../../ui/form.js';
import { chart } from '../../ui/charts.js';
import { db } from '../../core/db.js';
import { can } from '../../core/perms.js';
import { today, monthLabel, addMonths } from '../../core/dates.js';
import { toCents, fromCents, sumBy } from '../../core/money.js';
import * as fmt from '../../core/format.js';
import { EXPENSE_CATEGORIES } from '../../schema/business.js';
import { mrr, lastMonths, isOpen, balanceOf, ageing } from '../_biz.js';

const cents = (rows, f) => rows.reduce((s, r) => s + toCents(typeof f === 'function' ? f(r) : r[f] || 0), 0);

/** One row per month: recorded statement figures (if imported) + live figures from the system. */
export function monthRows(months) {
  return months.map(m => {
    const st = db.find('financial_periods', p => p.period === m);
    const inv = db.filter('invoices', i => (i.period || String(i.issue_date).slice(0, 7)) === m && !['void', 'draft'].includes(i.status) && i.kind !== 'balance');
    const invoiced = cents(inv, i => (i.kind === 'credit_note' ? -(i.total || 0) : i.total || 0));
    const received = cents(db.filter('payments', p => p.status === 'verified' && String(p.date).startsWith(m)), 'amount');
    const exp = db.filter('expenses', e => e.period === m);
    const expOps = cents(exp.filter(e => !e.is_capital), 'amount'), expCap = cents(exp.filter(e => e.is_capital), 'amount');
    const staff = cents(db.filter('payroll', p => p.period === m), p => p.gross || 0);
    const live = { invoiced: fromCents(invoiced), received: fromCents(received), operating: fromCents(expOps), capital: fromCents(expCap), staff: fromCents(staff) };
    live.net = fromCents(invoiced - expOps - expCap - staff);
    const income = st && st.income_recorded != null ? st.income_recorded : live.invoiced;
    const costs = st ? fromCents(toCents(st.staff_costs || 0) + toCents(st.operation_costs_lines ?? st.operation_costs_recorded ?? 0)) : fromCents(expOps + expCap + staff);
    return { period: m, statement: st || null, live, income, costs, net: st && st.net_recorded != null ? st.net_recorded : live.net, owner: st ? st.owner_funding : null, source: st ? 'Income statement' : 'Live system' };
  });
}
function allMonths() {
  const set = new Set(db.all('financial_periods').map(p => p.period));
  lastMonths(6).forEach(m => set.add(m));
  return [...set].filter(Boolean).sort();
}

function statementTab(ctx) {
  const rows = monthRows(allMonths());
  const tot = k => fromCents(rows.reduce((s, r) => s + toCents(r[k] || 0), 0));
  return h('div.stack',
    card({ title: 'Revenue vs expenses', icon: 'chart-line', cls: 'solid' }, h('div', { style: 'height:280px' }, chart({ type: 'bar', labels: rows.map(r => monthLabel(r.period, true)), series: [{ label: 'Income', data: rows.map(r => r.income || 0), color: 'var(--c2)' }, { label: 'Costs', data: rows.map(r => r.costs || 0), color: 'var(--c6)' }, { label: 'Net', data: rows.map(r => r.net || 0), type: 'line', color: 'var(--c1)' }], money: true, dispose: ctx.dispose }))),
    card({ cls: 'solid', body: dataTable({
      columns: [
        { key: 'period', label: 'Month', render: r => h('div', h('strong', monthLabel(r.period)), h('div.small.muted', r.source)) },
        { key: 'income', label: 'Income', num: true, render: r => (r.statement && !r.statement.income_captured ? h('span', { title: 'Not captured in the sheet' }, h('span.muted', 'not captured'), r.live.invoiced ? h('div.small', `live ${fmt.money(r.live.invoiced)}`) : null) : fmt.money(r.income || 0)) },
        { key: 'staff', label: 'Staff', num: true, render: r => fmt.money(r.statement ? r.statement.staff_costs || 0 : r.live.staff) },
        { key: 'ops', label: 'Operating', num: true, render: r => fmt.money(r.statement ? r.statement.operation_costs_lines ?? r.statement.operation_costs_recorded ?? 0 : fromCents(toCents(r.live.operating) + toCents(r.live.capital))) },
        { key: 'net', label: 'Net', num: true, render: r => h('strong', { style: `color:${(r.net || 0) < 0 ? 'var(--danger)' : 'var(--success)'}` }, fmt.money(r.net || 0)) },
        { key: 'owner', label: 'Owner funding', num: true, render: r => (r.owner != null ? fmt.money(r.owner) : '—') },
        { key: 'flag', label: '', render: r => (r.statement && r.statement.notes ? h('span', { title: r.statement.notes }, badge('note', 'gold')) : null) }
      ],
      rows, sort: 'period', pageSize: 24, exportName: 'income-statement',
      onRowClick: r => (r.statement ? ctx.navigate(`finance/financial_periods/${encodeURIComponent(r.statement.id)}`) : null),
      footer: rs => ['Total', fmt.money(tot('income')), '', '', fmt.money(tot('net')), fmt.money(fromCents(rs.reduce((s, r) => s + toCents(r.owner || 0), 0))), '']
    }) }),
    callout('info', 'How to read this', 'Imported months show the figures exactly as recorded in the LSI income statements (including cells the sheet left blank or totals that skip a row — see each month’s note). Months without a statement are calculated live from invoices, expenses and payroll in this system.', 'info'));
}

function expensesTab(ctx) {
  const exp = db.all('expenses');
  const byCat = EXPENSE_CATEGORIES.map(c => ({ c, v: sumBy(exp.filter(e => e.category === c), 'amount') })).filter(x => x.v).sort((a, b) => b.v - a.v);
  const months = [...new Set(exp.map(e => e.period))].sort();
  return h('div.stack',
    h('div.grid.cols-2',
      card({ title: 'Spend by category', icon: 'chart-pie', cls: 'solid' }, h('div', { style: 'height:300px' }, chart({ type: 'doughnut', labels: byCat.map(x => x.c), series: [{ label: 'Spend', data: byCat.map(x => x.v) }], money: true, dispose: ctx.dispose }))),
      card({ title: 'Operating vs capital per month', icon: 'chart-column-stacked', cls: 'solid' }, h('div', { style: 'height:300px' }, chart({ type: 'bar', stacked: true, labels: months.map(m => monthLabel(m, true)), series: [{ label: 'Operating', data: months.map(m => sumBy(exp.filter(e => e.period === m && !e.is_capital), 'amount')) }, { label: 'Capital', data: months.map(m => sumBy(exp.filter(e => e.period === m && e.is_capital), 'amount')) }], money: true, dispose: ctx.dispose })))),
    entityListPage('expenses', ctx, { title: 'Expense ledger', sub: 'Every expense line by month. Capital purchases (vehicles, design contracts) are flagged so monthly running costs stay honest.', onOpen: r => ctx.navigate(`finance/expenses/${encodeURIComponent(r.id)}`) }));
}

function marginsTab(ctx) {
  const jobs = db.filter('jobs', j => j.value != null);
  const jobRows = jobs.map(j => {
    const extra = cents(db.filter('job_costs', c => c.job_id === j.id), 'amount');
    const cost = fromCents(toCents(j.cost || 0) + extra);
    const margin = j.profit != null && !extra ? j.profit : fromCents(toCents(j.value || 0) - toCents(cost));
    return { ...j, cost_total: cost, margin, margin_pct: j.value ? (margin / j.value) * 100 : null, has_cost: !!(j.cost || extra || j.profit != null) };
  });
  const clientSuburb = id => { const c = id && db.get('clients', id); return c ? c.suburb || c.region || 'Unknown' : 'Unknown'; };
  const sub = new Map();
  for (const i of db.filter('invoices', x => !['void', 'draft'].includes(x.status) && x.kind !== 'balance')) { const s = clientSuburb(i.client_id); const r = sub.get(s) || { suburb: s, revenue: 0, invoices: 0, clients: new Set() }; r.revenue += toCents(i.total || 0); r.invoices++; if (i.client_id) r.clients.add(i.client_id); sub.set(s, r); }
  const subRows = [...sub.values()].map(r => ({ suburb: r.suburb, revenue: fromCents(r.revenue), invoices: r.invoices, clients: r.clients.size, per_client: r.clients.size ? fromCents(r.revenue / r.clients.size) : 0 })).sort((a, b) => b.revenue - a.revenue);
  const withCost = jobRows.filter(j => j.has_cost);
  return h('div.stack',
    h('div.grid.cols-3.stagger',
      kpiTile({ label: 'Jobs with costs captured', value: withCost.length, icon: 'calculator', tile: 't-clay', foot: `of ${jobRows.length} jobs with a value` }),
      kpiTile({ label: 'Total margin (those jobs)', value: sumBy(withCost, 'margin'), format: 'money', icon: 'trending-up', tile: 't-grass' }),
      kpiTile({ label: 'Average margin', value: withCost.length ? withCost.reduce((s, j) => s + (j.margin_pct || 0), 0) / withCost.length : 0, format: 'pct', icon: 'percent', tile: 't-forest' })),
    card({ title: 'Margin per job', icon: 'shovel', cls: 'solid', body: dataTable({
      columns: [{ key: 'title', label: 'Job', render: j => h('div', h('strong', j.title), h('div.small.muted', [j.client_name, j.month || j.start_date].filter(Boolean).join(' · '))) },
        { key: 'value', label: 'Value', num: true, render: j => fmt.money(j.value) }, { key: 'cost_total', label: 'Cost', num: true, render: j => (j.has_cost ? fmt.money(j.cost_total) : h('span.muted', 'not captured')) },
        { key: 'margin', label: 'Margin', num: true, render: j => (j.has_cost ? h('strong', { style: `color:${j.margin < 0 ? 'var(--danger)' : 'var(--success)'}` }, fmt.money(j.margin)) : '—') },
        { key: 'margin_pct', label: '%', num: true, render: j => (j.has_cost && j.margin_pct != null ? fmt.pct(j.margin_pct) : '—') }],
      rows: jobRows, sort: '-value', exportName: 'job-margins', onRowClick: j => ctx.navigate(`record/jobs/${encodeURIComponent(j.id)}`) }) }),
    card({ title: 'Revenue per suburb', sub: 'Invoiced revenue grouped by the client’s suburb — where the money is, for route planning and marketing.', icon: 'map', cls: 'solid', body: dataTable({
      columns: [{ key: 'suburb', label: 'Suburb' }, { key: 'clients', label: 'Clients', num: true }, { key: 'invoices', label: 'Invoices', num: true }, { key: 'revenue', label: 'Revenue', num: true, render: r => fmt.money(r.revenue) }, { key: 'per_client', label: 'Per client', num: true, render: r => fmt.money(r.per_client) }],
      rows: subRows, sort: '-revenue', exportName: 'revenue-by-suburb' }) }));
}

function outlookTab(ctx) {
  const m0 = today().slice(0, 7);
  const future = [0, 1, 2].map(i => addMonths(`${m0}-01`, i).slice(0, 7));
  const hist = monthRows(lastMonths(4, `${m0}-01`).slice(0, 3)); // the three completed months before this one
  const avgCost = hist.length ? fromCents(hist.reduce((s, r) => s + toCents(r.costs || 0), 0) / hist.length) : 0;
  const open = db.all('invoices').filter(i => isOpen(i));
  const rows = future.map(m => {
    const due = fromCents(open.filter(i => (i.due_date || i.issue_date || '').slice(0, 7) === m || (m === m0 && (i.due_date || '') < `${m0}-01`)).reduce((s, i) => s + toCents(balanceOf(i)), 0));
    const inflow = fromCents(toCents(mrr()) + toCents(due));
    return { m, recurring: mrr(), debtors: due, inflow, outflow: avgCost, net: fromCents(toCents(inflow) - toCents(avgCost)) };
  });
  return h('div.stack',
    callout('info', 'Cash outlook — a planning estimate', `Money in = active maintenance contracts (${fmt.money(mrr())}/month) plus open invoices falling due that month (overdue ones counted now). Money out = the average of the last three months’ recorded costs (${fmt.money(avgCost)}). Update expenses and payroll to sharpen it.`, 'telescope'),
    card({ title: 'Next three months', icon: 'calendar-range', cls: 'solid' }, h('div', { style: 'height:260px' }, chart({ type: 'bar', labels: rows.map(r => monthLabel(r.m)), series: [{ label: 'Money in', data: rows.map(r => r.inflow), color: 'var(--c2)' }, { label: 'Money out', data: rows.map(r => r.outflow), color: 'var(--c6)' }, { label: 'Net', data: rows.map(r => r.net), type: 'line', color: 'var(--c1)' }], money: true, dispose: ctx.dispose })),
      dataTable({ columns: [{ key: 'm', label: 'Month', render: r => monthLabel(r.m) }, { key: 'recurring', label: 'Contracts', num: true, render: r => fmt.money(r.recurring) }, { key: 'debtors', label: 'Debtors due', num: true, render: r => fmt.money(r.debtors) }, { key: 'outflow', label: 'Costs (avg)', num: true, render: r => fmt.money(r.outflow) }, { key: 'net', label: 'Net', num: true, render: r => h('strong', { style: `color:${r.net < 0 ? 'var(--danger)' : 'var(--success)'}` }, fmt.money(r.net)) }], rows, sort: 'm' })));
}

function home(ctx) {
  let tab = ctx.query.tab || 'statement';
  const body = h('div');
  const rows = monthRows(allMonths());
  const recent = rows.filter(r => r.period <= today().slice(0, 7)).slice(-3);
  const a = ageing(db.all('invoices'));
  const views = { statement: statementTab, expenses: expensesTab, margins: marginsTab, outlook: outlookTab,
    payroll: c => entityListPage('payroll', c, { sub: 'Wages per person per month, as recorded.', onOpen: r => c.navigate(`finance/payroll/${encodeURIComponent(r.id)}`) }),
    funding: c => entityListPage('owner_funding', c, { sub: 'Money the owner put in to cover monthly shortfalls ("INVESTMENT IN").', kpis: rs => [kpiTile({ label: 'Total owner funding', value: sumBy(rs, 'amount'), format: 'money', icon: 'piggy-bank', tile: 't-sun' })] }),
    banks: c => entityListPage('bank_accounts', c, { sub: 'The account marked "Print on invoices" appears on every invoice and statement.' }) };
  const draw = () => { body.replaceChildren(h('div.anim-fade', views[tab](ctx))); };
  draw();
  return h('div',
    pageHeader({ title: 'Finance', sub: 'Income, costs, margins and cash — recorded history and live figures side by side.', icon: 'landmark', tile: 't-forest',
      actions: [can('write', 'expenses') ? btn({ label: 'Add expense', icon: 'plus', variant: 'primary', onClick: () => openRecordForm('expenses', { values: { period: today().slice(0, 7), date: today() } }) }) : null] }),
    h('div.grid.cols-4.stagger', { style: 'margin-bottom:18px' },
      kpiTile({ label: 'Income, last 3 months', value: fromCents(recent.reduce((s, r) => s + toCents(r.income || 0), 0)), format: 'money', icon: 'trending-up', tile: 't-grass', spark: rows.map(r => r.income || 0) }),
      kpiTile({ label: 'Costs, last 3 months', value: fromCents(recent.reduce((s, r) => s + toCents(r.costs || 0), 0)), format: 'money', icon: 'trending-down', tile: 't-rose', spark: rows.map(r => r.costs || 0) }),
      kpiTile({ label: 'Monthly recurring revenue', value: mrr(), format: 'money', icon: 'repeat', tile: 't-forest', href: '#/clients/contracts' }),
      kpiTile({ label: 'Debtors', value: a.total, format: 'money', icon: 'hand-coins', tile: 't-violet', href: '#/payments', foot: `60+ days: ${fmt.money(a['60+'])}` })),
    tabs([{ id: 'statement', label: 'Income statement', icon: 'scroll-text' }, { id: 'expenses', label: 'Expenses', icon: 'receipt-text' }, { id: 'margins', label: 'Margins', icon: 'percent' }, { id: 'outlook', label: 'Cash outlook', icon: 'telescope' }, { id: 'payroll', label: 'Payroll', icon: 'banknote' }, { id: 'funding', label: 'Owner funding', icon: 'piggy-bank' }, { id: 'banks', label: 'Bank accounts', icon: 'building-2' }], tab, id => { tab = id; draw(); }),
    body);
}

const detail = col => ctx => entityDetailPage(col, decodeURIComponent(ctx.params.id), ctx, { backHref: '#/finance', backLabel: 'Finance' });
export default {
  id: 'finance',
  routes: { '': home, 'expenses/:id': detail('expenses'), 'payroll/:id': detail('payroll'), 'financial_periods/:id': detail('financial_periods') },
  detail: { expenses: (id, ctx) => entityDetailPage('expenses', id, ctx, { backHref: '#/finance?tab=expenses', backLabel: 'Expenses' }) }
};
void icon; void emptyState; void listItem; void recordLink;
