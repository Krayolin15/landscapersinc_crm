/* =============================================================================
   The business prediction tasks and forecasts the system learns from its own
   records. Each task says which records have a KNOWN outcome (used to train and
   test), which records to score now, and which features to learn from.
   Registered at boot by plugin.js; trained automatically (engine.autoTrain).
   ========================================================================== */

import { defineTask, defineForecast } from '../../ml/engine.js';
import { db } from '../../core/db.js';
import { diffDays, today } from '../../core/dates.js';
import { toCents } from '../../core/money.js';

const OPEN_LEAD = ['new', 'qualified', 'site_visit', 'quote_sent', 'follow_up'];
const month = d => (d ? Number(String(d).slice(5, 7)) : null);
const season = d => { const m = month(d); return m == null ? null : [12, 1, 2].includes(m) ? 'summer' : [3, 4, 5].includes(m) ? 'autumn' : [6, 7, 8].includes(m) ? 'winter' : 'spring'; };
const workKind = t => { t = String(t || '').toLowerCase(); return /design|landscap/.test(t) ? 'design' : /pav|brick|rock|hardscap|stone/.test(t) ? 'hardscape' : /lawn|grass|sod|turf/.test(t) ? 'lawn' : /tree|palm|fell/.test(t) ? 'tree' : /clean|rubble|clear/.test(t) ? 'cleanup' : /maint/.test(t) ? 'maintenance' : /irrigat/.test(t) ? 'irrigation' : 'other'; };
const lastPaymentDate = inv => db.filter('payments', p => p.invoice_id === inv.id && p.status === 'verified').map(p => p.date).sort().pop() || null;
const paidInFull = inv => toCents(inv.amount_paid || 0) >= toCents(inv.total || 0) && toCents(inv.total || 0) > 0;
const clientPrevLate = inv => db.filter('invoices', i => i.client_id && i.client_id === inv.client_id && i.id !== inv.id && i.issue_date < inv.issue_date && i.due_date && paidInFull(i) && (lastPaymentDate(i) || '') > i.due_date).length;
const contractOf = clientId => db.find('contracts', c => c.client_id === clientId);

export function registerBusinessModels() {
  defineTask({
    key: 'lead_win', app: 'leads', label: 'Lead win probability', collection: 'leads',
    description: 'Learns from every lead that was won or lost which kinds of enquiries turn into work, then scores the open pipeline so the team calls the best leads first.',
    positive: 'Likely to win', negative: 'Unlikely to win', minRows: 20,
    labelled: () => db.filter('leads', l => ['won', 'lost'].includes(l.stage)),
    target: l => (l.stage === 'won' ? 1 : l.stage === 'lost' ? 0 : null),
    unlabelled: () => db.filter('leads', l => OPEN_LEAD.includes(l.stage)),
    features: [
      { name: 'source', type: 'cat' }, { name: 'segment', type: 'cat' }, { name: 'value', type: 'num' },
      { name: 'has_email', type: 'bool', get: l => !!l.email }, { name: 'has_phone', type: 'bool', get: l => !!l.phone },
      { name: 'listed_by', type: 'cat', minCount: 2 }, { name: 'season', type: 'cat', get: l => season(l.enquiry_date) },
      { name: 'days_in_contact', type: 'num', get: l => (l.enquiry_date && l.last_contact ? diffDays(l.enquiry_date, l.last_contact) : null) },
      { name: 'work', type: 'cat', get: l => workKind(`${l.name} ${l.notes || ''} ${l.next_action || ''}`) }
    ]
  });
  defineTask({
    key: 'quote_accept', app: 'quotes', label: 'Quote acceptance', collection: 'quotes',
    description: 'Learns from accepted vs declined/expired quotes; scores open quotes so follow-ups go where a yes is most likely — and shows which price bands convert (pricing elasticity).',
    positive: 'Likely to accept', negative: 'Unlikely', minRows: 15,
    labelled: () => db.filter('quotes', q => q.status === 'accepted' || q.status === 'rejected' || q.status === 'expired' || (q.status === 'sent' && q.valid_until && q.valid_until < today())),
    target: q => (q.status === 'accepted' ? 1 : ['rejected', 'expired'].includes(q.status) || (q.status === 'sent' && q.valid_until && q.valid_until < today()) ? 0 : null),
    unlabelled: () => db.filter('quotes', q => ['draft', 'sent', 'viewed'].includes(q.status) && !(q.valid_until && q.valid_until < today())),
    features: [
      { name: 'total', type: 'num' }, { name: 'log_total', type: 'num', get: q => (q.total > 0 ? Math.log10(q.total) : null) },
      { name: 'salesperson', type: 'cat' }, { name: 'from_lead', type: 'bool', get: q => !!q.lead_id },
      { name: 'work', type: 'cat', get: q => workKind(q.title) }, { name: 'season', type: 'cat', get: q => season(q.issue_date) },
      { name: 'deposit_pct', type: 'num' }
    ]
  });
  defineTask({
    key: 'invoice_late', app: 'invoices', label: 'Late-payment risk', collection: 'invoices',
    description: 'Learns from paid invoices whether a client paid after the due date, then flags open invoices likely to be paid late so reminders go out early.',
    positive: 'Likely late', negative: 'Likely on time', minRows: 20,
    labelled: () => db.filter('invoices', i => i.due_date && paidInFull(i) && lastPaymentDate(i)),
    target: i => { const d = lastPaymentDate(i); return d && i.due_date ? (d > i.due_date ? 1 : 0) : null; },
    unlabelled: () => db.filter('invoices', i => i.due_date && !paidInFull(i) && !['void', 'draft', 'not_recorded'].includes(i.status)),
    features: [
      { name: 'kind', type: 'cat' }, { name: 'total', type: 'num' }, { name: 'terms_days', type: 'num', get: i => (i.issue_date && i.due_date ? diffDays(i.issue_date, i.due_date) : null) },
      { name: 'client_prev_late', type: 'num', get: clientPrevLate }, { name: 'sent_whatsapp', type: 'bool', get: i => (i.sent_via || []).includes('whatsapp') },
      { name: 'client_type', type: 'cat', get: i => (db.get('clients', i.client_id) || {}).client_type }, { name: 'issue_month', type: 'cat', get: i => month(i.issue_date) }
    ]
  });
  defineTask({
    key: 'client_churn', app: 'clients', label: 'Client retention risk', collection: 'clients',
    description: 'Compares clients who left with those who stayed and scores every active client’s risk of leaving, so the team can reach out before it happens.',
    positive: 'At risk of leaving', negative: 'Likely to stay', minRows: 20,
    labelled: () => db.filter('clients', c => ['active', 'left'].includes(c.status)),
    target: c => (c.status === 'left' ? 1 : c.status === 'active' ? 0 : null),
    unlabelled: () => db.filter('clients', c => c.status === 'active'),
    features: [
      { name: 'client_type', type: 'cat' }, { name: 'region', type: 'cat', minCount: 2 }, { name: 'suburb', type: 'cat', minCount: 3 },
      { name: 'frequency', type: 'cat', get: c => (contractOf(c.id) || {}).frequency }, { name: 'monthly_value', type: 'num', get: c => (contractOf(c.id) || {}).monthly_value },
      { name: 'has_email', type: 'bool', get: c => !!c.email }, { name: 'preferred_channel', type: 'cat' }
    ]
  });
  defineTask({
    key: 'job_value', kind: 'regression', app: 'jobs', label: 'Job value estimate', collection: 'jobs', unit: 'R',
    description: 'Estimates what a job is worth from its type, area and season — a sanity check when quoting new work.',
    minRows: 15,
    labelled: () => db.filter('jobs', j => Number(j.value) > 0),
    target: j => Number(j.value),
    unlabelled: () => db.filter('jobs', j => !(Number(j.value) > 0) && !['cancelled'].includes(j.status)),
    features: [
      { name: 'service_type', type: 'cat' }, { name: 'work', type: 'cat', get: j => workKind(j.title) }, { name: 'suburb', type: 'cat', minCount: 2 },
      { name: 'season', type: 'cat', get: j => season(j.start_date || (j.month ? j.month + '-15' : null)) }
    ]
  });

  const monthlySeries = (fn, from = '2026-01') => {
    const months = new Set();
    db.all('financial_periods').forEach(p => months.add(p.period));
    db.all('invoices').forEach(i => i.issue_date && months.add(String(i.issue_date).slice(0, 7)));
    return [...months].filter(m => m && m >= from && m < today().slice(0, 7)).sort().map(m => ({ period: m, value: fn(m) }));
  };
  defineForecast({
    key: 'income_monthly', label: 'Monthly income', unit: 'R', horizon: 3, minPoints: 6,
    description: 'Income per month (the income statements where captured, live invoicing afterwards), forecast three months ahead with Holt’s exponential smoothing and back-tested against a naive forecast.',
    series: () => monthlySeries(m => { const p = db.find('financial_periods', x => x.period === m); if (p && p.income_recorded != null) return p.income_recorded; const inv = db.filter('invoices', i => String(i.issue_date).startsWith(m) && !['void', 'draft'].includes(i.status) && i.kind !== 'balance'); return inv.length ? inv.reduce((s, i) => s + (Number(i.total) || 0), 0) : NaN; })
  });
  defineForecast({
    key: 'costs_monthly', label: 'Monthly costs', unit: 'R', horizon: 3, minPoints: 6,
    description: 'Staff plus operating costs per month (capital purchases excluded so one-off vehicle and design purchases do not distort the trend).',
    series: () => monthlySeries(m => { const p = db.find('financial_periods', x => x.period === m); const cap = db.filter('expenses', e => e.period === m && e.is_capital).reduce((s, e) => s + (Number(e.amount) || 0), 0); if (p) return (p.staff_costs || 0) + (p.operation_costs_lines ?? p.operation_costs_recorded ?? 0) - cap; return NaN; })
  });
  defineForecast({
    key: 'leads_monthly', label: 'New enquiries per month', unit: 'leads', horizon: 3, minPoints: 5,
    description: 'How many new enquiries arrive each month — for planning sales capacity and marketing.',
    series: () => { const by = {}; db.all('leads').forEach(l => { if (l.enquiry_date) { const m = l.enquiry_date.slice(0, 7); by[m] = (by[m] || 0) + 1; } }); return Object.keys(by).sort().filter(m => m < today().slice(0, 7)).map(m => ({ period: m, value: by[m] })); }
  });
}
