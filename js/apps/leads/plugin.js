import { registerBadge, registerCreate } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { registerSkill } from '../../ai/skills.js';
import { db } from '../../core/db.js';
import { formatMoney, sumBy } from '../../core/money.js';
import { today } from '../../core/dates.js';

const OPEN = ['new', 'qualified', 'site_visit', 'quote_sent', 'follow_up'];

export default function () {
  registerBadge('leads', () => { const n = db.filter('leads', l => OPEN.includes(l.stage) && l.follow_up_date && l.follow_up_date <= today()).length; return { n, hot: n > 0 }; });
  registerCreate({ id: 'new-lead', label: 'Lead', icon: 'target', group: 'Sales', app: 'leads', run: async () => { const { openRecordForm } = await import('../../ui/form.js'); openRecordForm('leads', { values: { enquiry_date: today() } }); } });
  registerAlertSource(() => db.filter('leads', l => OPEN.includes(l.stage) && l.follow_up_date && l.follow_up_date <= today()).map(l => ({
    key: `lead-follow|${l.id}|${l.follow_up_date}`, title: l.follow_up_date < today() ? 'Lead follow-up overdue' : 'Lead follow-up today', body: `${l.name}${l.value ? ' · ' + formatMoney(l.value) : ''}${l.next_action ? ' — ' + l.next_action : ''}`,
    link: `#/leads/l/${encodeURIComponent(l.id)}`, due: l.follow_up_date, severity: l.follow_up_date < today() ? 'warn' : 'info', roles: ['manager', 'sales'], icon: 'phone-forwarded', tile: 't-sun'
  })));
  registerCalendarSource({ id: 'lead-followups', label: 'Lead follow-ups', color: '#e0a526', icon: 'target', app: 'leads', defaultOn: true,
    items: (from, to) => db.filter('leads', l => OPEN.includes(l.stage) && l.follow_up_date >= from && l.follow_up_date <= to).map(l => ({ id: `lf-${l.id}`, date: l.follow_up_date, title: `Follow up: ${l.name}`, subtitle: l.next_action || '', link: `#/leads/l/${encodeURIComponent(l.id)}`, category: 'sales' })) });
  registerSkill({
    id: 'leads-pipeline', app: 'leads', label: 'Sales pipeline',
    examples: ['how is the sales pipeline', 'which leads need follow up', 'how many leads did we win', 'where do our leads come from'],
    keywords: ['lead', 'leads', 'pipeline', 'follow up', 'follow-up', 'prospect', 'won', 'lost', 'sales'],
    run: () => {
      const all = db.all('leads'), open = all.filter(l => OPEN.includes(l.stage)), due = open.filter(l => l.follow_up_date && l.follow_up_date <= today());
      const won = all.filter(l => l.stage === 'won'), lost = all.filter(l => l.stage === 'lost');
      return {
        text: `${all.length} leads on record: ${open.length} open worth ${formatMoney(sumBy(open, l => l.value || 0))}, ${won.length} won (${formatMoney(sumBy(won, l => l.value || 0))}) and ${lost.length} lost. ${due.length} follow-up${due.length === 1 ? ' is' : 's are'} due now; ${open.filter(l => !l.follow_up_date).length} open leads have no follow-up date.`,
        cards: [due.length ? { type: 'list', items: due.slice(0, 10).map(l => ({ title: l.name, sub: `${l.follow_up_date} · ${l.next_action || l.stage}`, href: `#/leads/l/${encodeURIComponent(l.id)}`, icon: 'phone-forwarded' })) } : null].filter(Boolean),
        actions: [{ label: 'Open the pipeline', href: '#/leads' }], sources: ['leads']
      };
    }
  });
}
