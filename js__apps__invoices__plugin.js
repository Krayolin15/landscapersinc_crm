import { registerBadge, registerCreate } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerAction } from '../../core/search.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { registerSkill } from '../../ai/skills.js';
import { db } from '../../core/db.js';
import { formatMoney, toCents, fromCents } from '../../core/money.js';
import { today } from '../../core/dates.js';
import { invoiceState, balanceOf, isOpen, remindersDue, ageing, lastMonths } from '../_biz.js';

export default function () {
  registerBadge('invoices', () => { const n = db.filter('invoices', i => invoiceState(i) === 'overdue').length; return { n, hot: n > 0 }; });
  registerCreate({ id: 'new-invoice', label: 'Invoice', icon: 'receipt', group: 'Money', app: 'invoices', run: () => (location.hash = '#/invoices/new') });
  registerAction({ id: 'inv-run', label: 'Run this month’s maintenance billing', icon: 'calendar-sync', keywords: 'billing run monthly invoices contracts', app: 'invoices', run: () => (location.hash = '#/invoices/run') });
  registerAction({ id: 'inv-overdue', label: 'Show overdue invoices', icon: 'alarm-clock', keywords: 'overdue late unpaid debtors', app: 'invoices', run: () => (location.hash = '#/invoices?tab=overdue') });

  registerAlertSource(() => {
    const out = [];
    for (const d of remindersDue(db.all('invoices'))) out.push({ key: `inv-reminder|${d.inv.id}|${d.day}`, title: `${d.day}-day payment reminder due`, body: `${d.inv.number || d.inv.legacy_number || 'Invoice'} · ${d.inv.client_name} owes ${formatMoney(balanceOf(d.inv))}`, link: `#/invoices/i/${encodeURIComponent(d.inv.id)}`, due: d.date, severity: d.day >= 14 ? 'danger' : 'warn', roles: ['manager', 'finance'], icon: 'bell-ring', tile: 't-rose' });
    for (const i of db.filter('invoices', x => invoiceState(x) === 'awaiting_pop')) out.push({ key: `inv-pop|${i.id}`, title: 'Proof of payment to verify', body: `${i.number || i.legacy_number || 'Invoice'} · ${i.client_name} · ${formatMoney(i.total)}`, link: `#/invoices/i/${encodeURIComponent(i.id)}`, severity: 'info', roles: ['manager', 'finance'], icon: 'file-search', tile: 't-violet' });
    return out;
  });

  registerCalendarSource({ id: 'invoice-due', label: 'Invoice due dates', color: 'var(--violet-500, #8b5cf6)', icon: 'receipt', app: 'invoices', defaultOn: true,
    items: (from, to) => db.filter('invoices', i => i.due_date && i.due_date >= from && i.due_date <= to && isOpen(i)).map(i => ({ id: `inv-due-${i.id}`, date: i.due_date, title: `Invoice due: ${i.client_name}`, subtitle: `${i.number || i.legacy_number || ''} · ${formatMoney(balanceOf(i))}`, link: `#/invoices/i/${encodeURIComponent(i.id)}`, category: 'finance' })) });

  registerSkill({
    id: 'invoices-outstanding', app: 'invoices', label: 'Outstanding & overdue invoices',
    examples: ['who owes us money?', 'overdue invoices', 'how much is outstanding', 'debtors ageing'],
    keywords: ['owe', 'owing', 'outstanding', 'debtor', 'unpaid', 'overdue', 'ageing', 'aging', 'balance'],
    run: () => {
      const all = db.all('invoices'), a = ageing(all);
      const open = all.filter(i => isOpen(i)).sort((x, y) => toCents(balanceOf(y)) - toCents(balanceOf(x)));
      const byClient = new Map();
      for (const i of open) byClient.set(i.client_name, (byClient.get(i.client_name) || 0) + toCents(balanceOf(i)));
      const top = [...byClient.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10);
      const overdue = open.filter(i => invoiceState(i) === 'overdue');
      return {
        text: open.length ? `${open.length} invoice${open.length === 1 ? ' is' : 's are'} open, ${formatMoney(a.total)} in total. ${overdue.length} ${overdue.length === 1 ? 'is' : 'are'} overdue. Ageing: ${formatMoney(a['0-30'])} (0–30 days), ${formatMoney(a['31-60'])} (31–60), ${formatMoney(a['60+'])} (60+).` : 'Nothing is outstanding — every recorded invoice is paid.',
        cards: [{ type: 'kpis', items: [{ label: 'Outstanding', value: a.total, format: 'money' }, { label: '0–30 days', value: a['0-30'], format: 'money' }, { label: '31–60 days', value: a['31-60'], format: 'money' }, { label: '60+ days', value: a['60+'], format: 'money' }] },
          top.length ? { type: 'table', columns: [{ key: 'client', label: 'Client' }, { key: 'owed', label: 'Owes', format: 'money' }], rows: top.map(([client, c]) => ({ client, owed: fromCents(c) })) } : null].filter(Boolean),
        actions: [{ label: 'Open invoices', href: '#/invoices?tab=open' }, { label: 'Debtors & ageing', href: '#/payments' }],
        sources: ['invoices', 'payments']
      };
    }
  });
  registerSkill({
    id: 'invoices-billed', app: 'invoices', label: 'Invoiced per month',
    examples: ['how much did we invoice this month', 'billing per month', 'invoiced in july'],
    keywords: ['invoiced', 'billed', 'billing', 'invoice total', 'turnover', 'revenue', 'income', 'sales'],
    run: (q, ents) => {
      const months = ents.months && ents.months.length ? ents.months : lastMonths(6);
      const rows = months.map(m => { const list = db.filter('invoices', i => (i.period || String(i.issue_date).slice(0, 7)) === m && i.status !== 'void' && i.kind !== 'balance'); return { month: m, count: list.length, total: fromCents(list.reduce((s, i) => s + toCents(i.total || 0), 0)) }; });
      const last = rows[rows.length - 1];
      return { text: `${last.month}: ${last.count} invoices worth ${formatMoney(last.total)}.`, cards: [{ type: 'chart', chart: { type: 'bar', labels: rows.map(r => r.month), series: [{ label: 'Invoiced', data: rows.map(r => r.total) }], money: true } }, { type: 'table', columns: [{ key: 'month', label: 'Month' }, { key: 'count', label: 'Invoices' }, { key: 'total', label: 'Total', format: 'money' }], rows }], sources: ['invoices'] };
    }
  });
  void today;
}
