import { registerBadge, registerCreate } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { registerSkill } from '../../ai/skills.js';
import { db } from '../../core/db.js';
import { formatMoney, sumBy } from '../../core/money.js';
import { today, addDays } from '../../core/dates.js';

const open = q => ['sent', 'viewed'].includes(q.status) && !(q.valid_until && q.valid_until < today());

export default function () {
  registerBadge('quotes', () => ({ n: db.filter('quotes', open).length, hot: false }));
  registerCreate({ id: 'new-quote', label: 'Quote', icon: 'file-signature', group: 'Sales', app: 'quotes', run: () => (location.hash = '#/quotes/new') });
  registerAlertSource(() => db.filter('quotes', q => open(q) && q.valid_until && q.valid_until <= addDays(today(), 3)).map(q => ({
    key: `quote-expiring|${q.id}`, title: 'Quote about to expire', body: `${q.number || q.legacy_number || ''} · ${q.client_name} · ${formatMoney(q.total || 0)} — follow up before ${q.valid_until}`,
    link: `#/quotes/q/${encodeURIComponent(q.id)}`, due: q.valid_until, severity: 'warn', roles: ['manager', 'sales'], icon: 'timer', tile: 't-clay'
  })));
  registerCalendarSource({ id: 'quote-expiry', label: 'Quote expiry', color: '#c2703d', icon: 'file-signature', app: 'quotes', defaultOn: false,
    items: (from, to) => db.filter('quotes', q => open(q) && q.valid_until >= from && q.valid_until <= to).map(q => ({ id: `qt-${q.id}`, date: q.valid_until, title: `Quote expires: ${q.client_name}`, subtitle: formatMoney(q.total || 0), link: `#/quotes/q/${encodeURIComponent(q.id)}`, category: 'sales' })) });
  registerSkill({
    id: 'quotes-pipeline', app: 'quotes', label: 'Quotes & win rate',
    examples: ['how many quotes are open', 'quote win rate', 'accepted quotes', 'quotes this month'],
    keywords: ['quote', 'quotes', 'quotation', 'win rate', 'accepted', 'pipeline'],
    run: () => {
      const all = db.all('quotes'), op = all.filter(q => ['draft', 'sent', 'viewed'].includes(q.status)), won = all.filter(q => q.status === 'accepted');
      const decided = all.filter(q => ['accepted', 'rejected', 'expired'].includes(q.status) || (q.status === 'sent' && q.valid_until && q.valid_until < today()));
      const rate = decided.length ? (won.length / decided.length) * 100 : 0;
      return { text: `${all.length} quotes worth ${formatMoney(sumBy(all, q => q.total || 0))}. ${op.length} still open (${formatMoney(sumBy(op, q => q.total || 0))}); ${won.length} accepted (${formatMoney(sumBy(won, q => q.total || 0))}) — a ${rate.toFixed(1)}% win rate on decided quotes.`,
        cards: [{ type: 'kpis', items: [{ label: 'Open', value: sumBy(op, q => q.total || 0), format: 'money' }, { label: 'Accepted', value: sumBy(won, q => q.total || 0), format: 'money' }, { label: 'Win rate', value: rate, format: 'pct' }] }],
        actions: [{ label: 'Open quotes', href: '#/quotes' }], sources: ['quotes'] };
    }
  });
}
