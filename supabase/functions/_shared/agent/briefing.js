/* =============================================================================
   Executive briefing — a short, human summary of what the agent decided
   overnight and what today looks like, composed entirely from records passed
   in (never invented).

   PURE MODULE: no DOM, no Deno APIs, no npm imports.
   ========================================================================== */

import { formatMoney } from '../../../../js/core/money.js';

function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

/** Short "why" line for a weather reschedule decision, for the headline. */
function weatherHighlights(decisions) {
  return decisions.filter(d => d.kind === 'weather_reschedule').map(d => {
    const a = d.affected || {};
    return `Shifted ${a.site_name || 'a visit'}${a.suburb ? ` (${a.suburb})` : ''} due to weather${a.to_date ? ` — moved to ${a.to_date}` : ''}${a.substitute_task ? `, substituted ${a.substitute_task.toLowerCase()}` : ''}.`;
  });
}

/**
 * composeBriefing({ date, decisions, plan, weather, overdueInvoices, awaitingPop,
 *   expiring, approvals, todayEvents, kpis }) -> { headline, sections:[{title,icon,items:[{text,link?,severity?}]}] }
 */
export function composeBriefing(o = {}) {
  const decisions = o.decisions || [];
  const plan = o.plan || { assignments: [], decisions: [] };
  const weatherHi = weatherHighlights(decisions.length ? decisions : plan.decisions || []);
  const overdue = o.overdueInvoices || [];
  const awaitingPop = o.awaitingPop || [];
  const expiring = o.expiring || [];
  const approvals = o.approvals || [];
  const events = o.todayEvents || [];

  const totalVisits = (plan.assignments || []).reduce((a, x) => a + (x.visits ? x.visits.length : 0), 0);
  const totalKm = (plan.assignments || []).reduce((a, x) => a + (x.km || 0), 0);
  const overdueTotal = overdue.reduce((a, i) => a + (i.balance ?? Math.max(0, (i.total || 0) - (i.amount_paid || 0))), 0);

  const headlineParts = [];
  if (totalVisits) headlineParts.push(`${plural(totalVisits, 'visit')} planned across ${plural((plan.assignments || []).length, 'crew')}`);
  if (weatherHi.length) headlineParts.push(weatherHi[0]);
  if (overdue.length) headlineParts.push(`${plural(overdue.length, 'invoice')} overdue (${formatMoney(overdueTotal)})`);
  if (approvals.length) headlineParts.push(`${plural(approvals.length, 'approval')} waiting`);
  const headline = headlineParts.length ? headlineParts.join(' · ') : `Quiet day ahead, ${o.date || ''}`.trim();

  const sections = [];

  sections.push({
    title: "Today's dispatch", icon: 'route',
    items: totalVisits
      ? [{ text: `${plural(totalVisits, 'visit')} across ${plural((plan.assignments || []).length, 'crew')} — ${Math.round(totalKm)} km planned.`, link: '#/agent' }, ...weatherHi.slice(0, 4).map(text => ({ text, severity: 'warn' }))]
      : [{ text: 'No visits scheduled or nothing to plan today.', link: '#/schedule' }]
  });

  if (o.weather) sections.push({ title: 'Weather', icon: 'cloud-sun', items: Object.entries(o.weather).map(([suburb, w]) => ({ text: `${suburb}: ${w.summary || w.risk}`, severity: ['storm', 'wet'].includes(w.risk) ? 'danger' : w.risk === 'windy' ? 'warn' : 'info' })) });

  sections.push({
    title: 'Money', icon: 'banknote',
    items: [
      ...(overdue.length ? [{ text: `${plural(overdue.length, 'invoice')} overdue — ${formatMoney(overdueTotal)} outstanding.`, link: '#/payments', severity: 'danger' }] : [{ text: 'No overdue invoices.', link: '#/invoices' }]),
      ...(awaitingPop.length ? [{ text: `${plural(awaitingPop.length, 'proof of payment')} waiting to be verified.`, link: '#/payments', severity: 'warn' }] : [])
    ]
  });

  sections.push({
    title: 'Compliance & expiries', icon: 'shield-alert',
    items: expiring.length ? expiring.slice(0, 8).map(e => ({ text: e.title || e.label, link: `#/record/${e.collection}/${encodeURIComponent(e.record_id)}`, severity: e.severity })) : [{ text: 'Nothing expiring in the next 30 days.' }]
  });

  sections.push({
    title: 'Approvals', icon: 'clipboard-check',
    items: approvals.length ? approvals.slice(0, 8).map(a => ({ text: a.title, link: '#/agent', severity: 'warn' })) : [{ text: 'No approvals waiting.' }]
  });

  if (events.length) sections.push({ title: "Today's calendar", icon: 'calendar-days', items: events.slice(0, 6).map(e => ({ text: `${e.time ? e.time + ' — ' : ''}${e.title}`, link: e.link })) });

  if (o.kpis && Object.keys(o.kpis).length) sections.push({ title: 'Key numbers', icon: 'gauge', items: Object.entries(o.kpis).map(([label, value]) => ({ text: `${label}: ${value}` })) });

  return { headline, sections };
}
