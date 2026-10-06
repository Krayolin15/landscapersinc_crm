import { registerBadge, registerCreate } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { registerSkill } from '../../ai/skills.js';
import { db } from '../../core/db.js';
import { formatMoney, toCents, fromCents } from '../../core/money.js';
import { today } from '../../core/dates.js';
import { mrr, clientHealth, clientBalance, clientContracts, contractMonthly } from '../_biz.js';

export default function () {
  registerBadge('clients', () => ({ n: db.filter('clients', c => c.status === 'unverified').length, hot: false }));
  registerCreate({ id: 'new-client', label: 'Client', icon: 'user-plus', group: 'Sales', app: 'clients', run: async () => { const { openRecordForm } = await import('../../ui/form.js'); openRecordForm('clients', { onSaved: r => (location.hash = `#/clients/c/${encodeURIComponent(r.id)}`) }); } });
  registerAlertSource(() => db.filter('contracts', c => c.status === 'paused' && c.pause_until && c.pause_until <= today()).map(c => ({
    key: `contract-resume|${c.id}|${c.pause_until}`, title: 'Paused contract should resume', body: `${c.name} was paused until ${c.pause_until}${c.pause_reason ? ' (' + c.pause_reason + ')' : ''}. Resume it or extend the pause.`,
    link: `#/record/contracts/${encodeURIComponent(c.id)}`, severity: 'warn', roles: ['manager', 'operations', 'finance'], icon: 'circle-play', tile: 't-forest'
  })));
  registerCalendarSource({ id: 'contract-changes', label: 'Contract changes', color: '#1f7440', icon: 'git-compare-arrows', app: 'clients', defaultOn: true,
    items: (from, to) => db.filter('contract_changes', x => x.effective_date >= from && x.effective_date <= to && x.status !== 'cancelled').map(x => ({ id: `cc-${x.id}`, date: x.effective_date, title: `Contract change: ${x.summary}`, link: `#/record/contract_changes/${encodeURIComponent(x.id)}`, category: 'clients' })) });
  registerSkill({
    id: 'clients-mrr', app: 'clients', label: 'Clients & recurring revenue',
    examples: ['how many active clients do we have', 'what is our monthly recurring revenue', 'which clients are at risk', 'biggest clients'],
    keywords: ['client', 'clients', 'customers', 'mrr', 'recurring', 'monthly revenue', 'at risk', 'biggest'],
    run: () => {
      const active = db.filter('clients', c => c.status === 'active');
      const withVal = db.all('clients').map(c => ({ c, v: fromCents(clientContracts(c.id).reduce((s, k) => s + toCents(contractMonthly(k)), 0)) })).filter(x => x.v).sort((a, b) => b.v - a.v);
      const risk = active.map(c => ({ c, hl: clientHealth(c) })).filter(x => x.hl.score < 50).sort((a, b) => a.hl.score - b.hl.score);
      return {
        text: `${active.length} active clients bring in ${formatMoney(mrr())} a month in maintenance contracts. ${risk.length ? `${risk.length} look at risk (health under 50).` : 'No active client is flagged at risk.'}`,
        cards: [{ type: 'table', columns: [{ key: 'name', label: 'Top clients' }, { key: 'monthly', label: 'Monthly', format: 'money' }], rows: withVal.slice(0, 10).map(x => ({ name: x.c.name, monthly: x.v, id: x.c.id })), link: r => `#/clients/c/${encodeURIComponent(r.id)}` },
          risk.length ? { type: 'list', items: risk.slice(0, 8).map(x => ({ title: `${x.c.name} — ${x.hl.score}`, sub: x.hl.factors.join(' · '), href: `#/clients/c/${encodeURIComponent(x.c.id)}`, icon: 'heart-crack' })) } : null].filter(Boolean),
        sources: ['clients', 'contracts', 'invoices']
      };
    }
  });
  void clientBalance;
}
