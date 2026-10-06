/* =============================================================================
   Small shared lookups for the Autonomous Core app — kept in their own module
   (no imports of its own) so index.js, dispatch-tab.js, queues.js and
   settings-tab.js can all use them without creating an import cycle.
   ========================================================================== */

export const JOB_META = {
  morning_dispatch: { label: 'Morning dispatch', icon: 'route', tile: 't-river', schedule: '05:00 SAST, daily', time: '05:00', kind: 'daily', blurb: 'Plans today’s crew routes, applies weather postponements.' },
  executive_briefing: { label: 'Executive briefing', icon: 'sunrise', tile: 't-sun', schedule: '05:30 SAST, daily', time: '05:30', kind: 'daily', blurb: 'Composes the morning summary on the Home page.' },
  payment_reminders: { label: 'Payment reminders', icon: 'banknote', tile: 't-violet', schedule: 'Hourly, 07:00–18:00 SAST', kind: 'hourly', blurb: 'Overdue invoices at 3 / 7 / 14 days past due.' },
  expiry_watch: { label: 'Expiry watch', icon: 'shield-alert', tile: 't-rose', schedule: 'Hourly, 07:00–18:00 SAST', kind: 'hourly', blurb: 'Certificates, medicals, licences, compliance docs due in 60 / 30 / 7 days.' },
  pop_matching: { label: 'POP matching', icon: 'wallet', tile: 't-forest', schedule: 'Continuously while a browser tab is open', kind: 'continuous', blurb: 'Matches proof-of-payment against open invoices.' }
};

export const DECISION_KIND_LABEL = {
  weather_reschedule: 'Weather reschedule', crew_assignment: 'Crew assignment', route_plan: 'Route plan',
  payment_reminder: 'Payment reminder', pop_match: 'POP match', invoice_draft: 'Invoice draft', mail_triage: 'Mail triage',
  reply_draft: 'Reply draft', lead_created: 'Lead created', maintenance_due: 'Maintenance due', client_outreach: 'Client outreach',
  expiry_alert: 'Expiry alert', other: 'Other'
};

/** Best-effort link from an agent_decisions.affected payload to the record it concerns. */
export function decisionLink(d) {
  const a = d.affected || {};
  if (a.visit_id) return `#/record/visits/${encodeURIComponent(a.visit_id)}`;
  if (a.invoice_id) return `#/record/invoices/${encodeURIComponent(a.invoice_id)}`;
  if (a.payment_id) return `#/record/payments/${encodeURIComponent(a.payment_id)}`;
  if (a.collection && a.record_id) return `#/record/${a.collection}/${encodeURIComponent(a.record_id)}`;
  if (a.crew_id) return '#/schedule';
  return null;
}
