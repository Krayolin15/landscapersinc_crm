/* =============================================================================
   Agent adapters — the browser-side "IO" layer. Reads js__core__db.js into the
   plain-object shapes the pure supabase/functions/_shared/agent/*.js modules
   expect, runs them, then writes the results back through db (validated,
   attributed, real records — never a shadow store).

   Everything here is browser-only (db.js needs IndexedDB); the actual
   decision-making logic lives in the pure shared modules so it is identical
   to what the cloud Edge Function runs.
   ========================================================================== */

import { db } from '../core/db.js';
import { store } from '../core/bus.js';
import { today, addDays, iso } from '../core/dates.js';
import { isWorkingDay } from '../core/holidays.js';
import { toCents, fromCents } from '../core/money.js';
import { DEPOT, resolveLocation } from '../core/geo.js';
import { assessDay } from '../core/weather.js';
import { planDay, WEATHER_SENSITIVE_KEYWORDS } from '../../supabase__functions___shared__agent__dispatch.js';
import { composeBriefing } from '../../supabase__functions___shared__agent__briefing.js';
import { debtorReminders, expiryAlerts } from '../../supabase__functions___shared__agent__reminders.js';
import { matchPayment } from '../../supabase__functions___shared__agent__pop-match.js';
import { company, printBank, invoiceState, balanceOf, isOpen } from '../apps/_biz.js';

export const JOBS = ['morning_dispatch', 'executive_briefing', 'payment_reminders', 'expiry_watch', 'pop_matching'];

// Every write the agent itself makes (as opposed to a human clicking Approve/Reject/Revert)
// is attributed to this actor — not to whoever happens to have the browser tab open when the
// 05:00 job fires — so "Added by" on a decision/run/reminder always tells the truth.
const AGENT_ACTOR = { id: 'agent', name: 'Autonomous Agent' };

export const AGENT_SETTINGS_DEFAULTS = {
  reminderStages: [3, 7, 14],
  fuelPriceRandPerLitre: 23,
  defaultFuelL100km: 12,
  workWindow: { start: '07:00', end: '16:00' },
  jobsEnabled: { morning_dispatch: true, executive_briefing: true, payment_reminders: true, expiry_watch: true, pop_matching: true },
  autoApply: { weatherRescheduleWithoutFixedTime: true, paymentReminders: true, popAutoApplyThreshold: 0.95 },
  weatherKeywords: WEATHER_SENSITIVE_KEYWORDS
};

export function agentSettings() {
  const r = db.find('settings', s => s.key === 'agent_settings');
  const v = (r && r.value) || {};
  return {
    ...AGENT_SETTINGS_DEFAULTS, ...v,
    jobsEnabled: { ...AGENT_SETTINGS_DEFAULTS.jobsEnabled, ...(v.jobsEnabled || {}) },
    autoApply: { ...AGENT_SETTINGS_DEFAULTS.autoApply, ...(v.autoApply || {}) },
    workWindow: { ...AGENT_SETTINGS_DEFAULTS.workWindow, ...(v.workWindow || {}) }
  };
}
export async function saveAgentSettings(patch) {
  const r = db.find('settings', s => s.key === 'agent_settings');
  const value = { ...(r ? r.value : {}), ...patch };
  return r ? db.update('settings', r.id, { value }) : db.insert('settings', { key: 'agent_settings', value, description: 'Autonomous agent: reminder stages, fuel price, work window, which jobs run, auto-apply thresholds.' });
}

function depot() { const s = agentSettings(); return s.depot || DEPOT; }

/** Resolve a site/client pairing to a suburb name + approximate coordinates. */
export function locationFor(site, client) {
  if (site && site.lat != null && site.lng != null) return { name: site.suburb || site.estate || site.name, lat: site.lat, lng: site.lng, approx: false };
  const text = (site && (site.suburb || site.estate || site.region || site.address)) || (client && (client.suburb || client.region || client.address)) || '';
  return resolveLocation(text);
}

/** Next `n` working days after `date` (skips weekends and SA public/company holidays). */
export function nextWorkingDates(date, n = 5) {
  const out = []; let d = date;
  while (out.length < n) { d = addDays(d, 1); if (isWorkingDay(d)) out.push(d); }
  return out;
}

function contractServiceHint(visit) {
  if (!visit.contract_id) return '';
  const c = db.get('contracts', visit.contract_id);
  return c ? c.service_type || '' : '';
}

/** db visits (+ site/client/contract) for a date -> the shape dispatch.js expects. */
export function enrichedVisits(date) {
  return db.filter('visits', v => v.date === date && !['cancelled', 'weather_postponed'].includes(v.status)).map(v => {
    const site = v.site_id ? db.get('sites', v.site_id) : null;
    const client = v.client_id ? db.get('clients', v.client_id) : (site && site.client_id ? db.get('clients', site.client_id) : null);
    const loc = locationFor(site, client);
    return {
      id: v.id, site_id: v.site_id, site_name: v.site_name || (site && site.name) || '', client_id: v.client_id, client_name: v.client_name,
      suburb: loc ? loc.name : null, lat: loc ? loc.lat : null, lng: loc ? loc.lng : null,
      kind: `${v.kind || ''} ${contractServiceHint(v)}`.trim(), instructions: v.instructions || (site && site.instructions) || '',
      start_time: v.start_time || (site && site.start_at) || null, finish_by: v.finish_by || (site && site.finish_by) || null,
      planned_minutes: v.planned_minutes || null, actual_minutes: v.actual_minutes || null, status: v.status,
      preferred_crew_id: v.crew_id || null, contract_id: v.contract_id || null
    };
  });
}

/** Weather assessment per suburb per date, only for suburbs that actually have a weather-sensitive visit today. */
async function weatherForVisits(visits, dates, settings) {
  const sensitive = visits.filter(v => (v.suburb) && /mow|lawn cut|lawn dress|lawn lay|spray|fertilis|fertiliz/i.test(`${v.instructions} ${v.kind}`));
  const suburbs = [...new Set(sensitive.map(v => v.suburb))];
  const out = {};
  for (const suburb of suburbs) {
    const loc = resolveLocation(suburb);
    if (!loc) continue;
    out[suburb] = {};
    for (const d of dates) { try { out[suburb][d] = await assessDay(loc.lat, loc.lng, d, settings.workWindow); } catch { /* offline / API unreachable — plan without this suburb's forecast */ } }
  }
  return out;
}

/* ------------------------------------------------------------------ run bookkeeping */

async function startRun(kind, runner) { return db.insert('agent_runs', { kind, runner, started_at: new Date().toISOString(), status: 'running' }, { skipValidate: true, silent: true, as: AGENT_ACTOR }); }
async function finishRun(run, { status, summary, stats, error } = {}) { return db.update('agent_runs', run.id, { finished_at: new Date().toISOString(), status: status || 'ok', summary: summary || '', stats: stats || {}, error: error || null }, { skipValidate: true, silent: true, as: AGENT_ACTOR }); }

/** A job already ran (ok or warning) for this date today — used for once-a-day idempotency. */
export function alreadyRanToday(kind, date = today()) {
  return db.find('agent_runs', r => r.kind === kind && ['ok', 'warning'].includes(r.status) && String(r.started_at || '').slice(0, 10) === date);
}

/* ------------------------------------------------------------------ 1. morning dispatch */

export async function runMorningDispatch({ date = today(), runner = 'browser', force = false } = {}) {
  if (!force && alreadyRanToday('morning_dispatch', date)) return { skipped: true };
  const run = await startRun('morning_dispatch', runner);
  try {
    const settings = agentSettings();
    const visits = enrichedVisits(date);
    const candidateDates = nextWorkingDates(date, 5);
    const weatherBySuburb = await weatherForVisits(visits, [date, ...candidateDates], settings);
    const crews = db.filter('crews', c => c.active !== false);
    const employees = db.all('employees');
    const vehicles = db.all('vehicles');
    const services = db.all('services');
    const result = planDay({
      date, isHoliday: !isWorkingDay(date) && !isWeekendOnly(date), isWeekend: isWeekendOnly(date),
      visits, crews, employees, vehicles, services, depot: depot(), weatherBySuburb, candidateDates,
      settings: { fuelPriceRandPerLitre: settings.fuelPriceRandPerLitre, defaultFuelL100km: settings.defaultFuelL100km, weatherKeywords: settings.weatherKeywords }
    });
    for (const d of result.decisions) {
      const rec = await db.insert('agent_decisions', { run_id: run.id, kind: d.kind, title: d.title, detail: d.detail || '', affected: d.affected || {}, requires_approval: !!d.requires_approval, status: d.status || 'applied' }, { skipValidate: true, silent: true, as: AGENT_ACTOR });
      if (d.kind === 'weather_reschedule' && d.status === 'applied') await applyWeatherReschedule(rec);
    }
    await finishRun(run, { status: 'ok', summary: `${result.assignments.length} crew(s), ${result.assignments.reduce((a, x) => a + x.visits.length, 0)} visit(s) planned for ${date}.`, stats: { assignments: result.assignments.length, decisions: result.decisions.length } });
    return { run, ...result };
  } catch (e) { await finishRun(run, { status: 'failed', error: String(e.message || e) }); throw e; }
}
function isWeekendOnly(date) { const d = new Date(date + 'T00:00:00'); return d.getDay() === 0 || d.getDay() === 6; }

/** Perform the DB side-effects of an already-decided weather_reschedule: mark the
    original visit postponed and (when a target date was found) create the moved one. */
export async function applyWeatherReschedule(decisionRec) {
  const a = decisionRec.affected || {};
  const visit = a.visit_id ? db.get('visits', a.visit_id) : null;
  if (!visit) return decisionRec;
  await db.update('visits', visit.id, { status: 'weather_postponed', reschedule_reason: decisionRec.detail || 'Postponed by the autonomous agent — unsuitable weather.' }, { skipValidate: true, as: AGENT_ACTOR });
  let newVisitId = null;
  if (a.to_date) {
    const created = await db.insert('visits', {
      date: a.to_date, site_id: visit.site_id, site_name: visit.site_name, client_id: visit.client_id, client_name: visit.client_name,
      contract_id: visit.contract_id, job_id: visit.job_id, kind: visit.kind, crew_id: visit.crew_id, crew_names: visit.crew_names,
      start_time: visit.start_time, finish_by: visit.finish_by, planned_minutes: visit.planned_minutes, instructions: visit.instructions,
      status: 'scheduled', rescheduled_from: visit.date, notes: visit.notes
    }, { skipValidate: true, as: AGENT_ACTOR });
    newVisitId = created.id;
  }
  return db.update('agent_decisions', decisionRec.id, { revert: { visit_id: visit.id, from_status: visit.status, new_visit_id: newVisitId } }, { skipValidate: true, silent: true, as: AGENT_ACTOR });
}

/* ------------------------------------------------------------------ 2. executive briefing */

export async function runExecutiveBriefing({ date = today(), runner = 'browser', force = false } = {}) {
  if (!force && alreadyRanToday('executive_briefing', date)) return { skipped: true };
  const run = await startRun('executive_briefing', runner);
  try {
    const invoices = db.all('invoices');
    const overdueInvoices = invoices.filter(i => invoiceState(i) === 'overdue').map(i => ({ ...i, balance: balanceOf(i) }));
    const awaitingPop = invoices.filter(i => invoiceState(i) === 'awaiting_pop');
    const expiring = expiryAlerts({ certificates: db.all('certificates'), medicals: db.all('medicals'), vehicles: db.all('vehicles'), compliance_docs: db.all('compliance_docs'), appointments: db.all('appointments') }, date).filter(x => x.days <= 30);
    const approvals = db.filter('agent_decisions', d => d.requires_approval && d.status === 'pending');
    const todayEvents = db.filter('events', e => e.start_date === date).map(e => ({ time: e.start_time, title: e.title, link: `#/calendar/event/${e.id}` }));
    const dispatchRun = db.find('agent_runs', r => r.kind === 'morning_dispatch' && String(r.started_at || '').slice(0, 10) === date);
    const settings = agentSettings();
    const visits = enrichedVisits(date);
    const suburbs = [...new Set(visits.map(v => v.suburb).filter(Boolean))].slice(0, 6);
    const weather = {};
    for (const suburb of suburbs) { const loc = resolveLocation(suburb); if (loc) { try { weather[suburb] = await assessDay(loc.lat, loc.lng, date, settings.workWindow); } catch { /* offline */ } } }
    const planDecisions = dispatchRun ? db.filter('agent_decisions', d => d.run_id === dispatchRun.id) : [];
    const briefing = composeBriefing({ date, decisions: planDecisions, plan: { assignments: [], decisions: planDecisions }, weather, overdueInvoices, awaitingPop, expiring, approvals, todayEvents, kpis: { 'Open invoices': fromCents(invoices.reduce((a, i) => a + (isOpen(i) ? toCents(balanceOf(i)) : 0), 0)) } });
    const rec = await db.insert('briefings', { date, generated_at: new Date().toISOString(), runner, headline: briefing.headline, sections: briefing.sections, weather }, { skipValidate: true, silent: true, as: AGENT_ACTOR });
    const managers = db.filter('profiles', p => ['owner', 'admin', 'manager'].includes(p.role)).map(p => p.id);
    if (managers.length) await import('../core/notify.js').then(m => m.notify(managers, { title: "Today's briefing is ready", body: briefing.headline, icon: 'sunrise', tile: 't-sun', link: '#/home', kind: 'briefing', source_key: `briefing|${date}` }));
    await finishRun(run, { status: 'ok', summary: briefing.headline, stats: { sections: briefing.sections.length } });
    return { run, briefing: rec };
  } catch (e) { await finishRun(run, { status: 'failed', error: String(e.message || e) }); throw e; }
}

/* ------------------------------------------------------------------ 3. payment reminders */

export async function runPaymentReminders({ date = today(), runner = 'browser', force = false } = {}) {
  const run = await startRun('payment_reminders', runner);
  try {
    const c = company(), bank = printBank();
    const settings = agentSettings();
    const { outboxRecords, decisions, invoiceUpdates } = debtorReminders({
      invoices: db.all('invoices'), clients: db.all('clients'), today: date,
      settings: { reminderStages: settings.reminderStages, companyName: c.trading_name, bank: bank ? { bank: bank.bank, account_name: bank.account_name, account_no: bank.account_no, branch_code: bank.branch_code } : null }
    });
    for (const rec of outboxRecords) await db.insert('outbox', rec, { skipValidate: true, as: AGENT_ACTOR });
    for (const d of decisions) await db.insert('agent_decisions', { run_id: run.id, kind: d.kind, title: d.title, detail: d.detail, affected: d.affected, requires_approval: false, status: 'applied' }, { skipValidate: true, silent: true, as: AGENT_ACTOR });
    for (const u of invoiceUpdates) await db.update('invoices', u.id, { reminders_sent: u.reminders_sent }, { skipValidate: true, silent: true, as: AGENT_ACTOR });
    void force;
    await finishRun(run, { status: 'ok', summary: `${outboxRecords.length} reminder(s) queued.`, stats: { queued: outboxRecords.length } });
    return { run, outboxRecords, decisions };
  } catch (e) { await finishRun(run, { status: 'failed', error: String(e.message || e) }); throw e; }
}

/* ------------------------------------------------------------------ 4. expiry watch */

export async function runExpiryWatch({ date = today(), runner = 'browser' } = {}) {
  const run = await startRun('expiry_watch', runner);
  try {
    const alerts = expiryAlerts({ certificates: db.all('certificates'), medicals: db.all('medicals'), vehicles: db.all('vehicles'), compliance_docs: db.all('compliance_docs'), appointments: db.all('appointments') }, date);
    let created = 0;
    for (const a of alerts) {
      if (db.find('agent_decisions', d => d.kind === 'expiry_alert' && d.affected && d.affected.key === a.key)) continue;
      await db.insert('agent_decisions', { run_id: run.id, kind: 'expiry_alert', title: a.title, detail: a.label, affected: { key: a.key, collection: a.collection, record_id: a.record_id, days: a.days }, requires_approval: false, status: 'applied' }, { skipValidate: true, silent: true, as: AGENT_ACTOR });
      created++;
    }
    await finishRun(run, { status: 'ok', summary: `${created} new expiry alert(s) (of ${alerts.length} checked).`, stats: { created, checked: alerts.length } });
    return { run, alerts, created };
  } catch (e) { await finishRun(run, { status: 'failed', error: String(e.message || e) }); throw e; }
}

/* ------------------------------------------------------------------ 5. POP matching */

export async function runPopMatching({ runner = 'browser' } = {}) {
  const run = await startRun('pop_matching', runner);
  try {
    const settings = agentSettings();
    const open = db.filter('invoices', i => isOpen(i) || i.status === 'not_recorded');
    const pending = db.filter('payments', p => p.status === 'awaiting_verification' && !p.invoice_id);
    let matched = 0, queued = 0;
    for (const p of pending) {
      const { best, decision } = matchPayment({ amount: p.amount, reference: p.reference, date: p.date, payer_name: p.client_name }, open);
      if (!best) continue;
      if (decision === 'auto_apply' && best.confidence >= settings.autoApply.popAutoApplyThreshold) {
        await db.update('payments', p.id, { invoice_id: best.invoice.id, status: 'verified', matched_by: 'auto_reference', match_confidence: best.confidence }, { skipValidate: true, as: AGENT_ACTOR });
        await import('../apps/_biz.js').then(m => m.recomputeInvoice(best.invoice.id));
        await db.insert('agent_decisions', { run_id: run.id, kind: 'pop_match', title: `Matched payment to ${best.invoice.number || best.invoice.legacy_number}`, detail: best.reasons.join(', '), affected: { payment_id: p.id, invoice_id: best.invoice.id, confidence: best.confidence }, requires_approval: false, status: 'applied' }, { skipValidate: true, silent: true, as: AGENT_ACTOR });
        matched++;
      } else {
        // already waiting for someone to approve this exact match: don't queue it again every run
        if (db.find('agent_decisions', d => d.kind === 'pop_match' && d.status === 'pending' && d.affected && d.affected.payment_id === p.id && d.affected.invoice_id === best.invoice.id)) continue;
        await db.insert('agent_decisions', { run_id: run.id, kind: 'pop_match', title: `Possible match: payment · ${best.invoice.client_name}`, detail: `${Math.round(best.confidence * 100)}% confidence — ${best.reasons.join(', ')}`, affected: { payment_id: p.id, invoice_id: best.invoice.id, confidence: best.confidence }, requires_approval: true, status: 'pending' }, { skipValidate: true, silent: true, as: AGENT_ACTOR });
        queued++;
      }
    }
    await finishRun(run, { status: 'ok', summary: `${matched} auto-matched, ${queued} queued for review.`, stats: { matched, queued, checked: pending.length } });
    return { run, matched, queued };
  } catch (e) { await finishRun(run, { status: 'failed', error: String(e.message || e) }); throw e; }
}

/* ------------------------------------------------------------------ dispatcher + approvals */

export async function runJob(job, opts = {}) {
  switch (job) {
    case 'morning_dispatch': return runMorningDispatch(opts);
    case 'executive_briefing': return runExecutiveBriefing(opts);
    case 'payment_reminders': return runPaymentReminders(opts);
    case 'expiry_watch': return runExpiryWatch(opts);
    case 'pop_matching': return runPopMatching(opts);
    case 'all': {
      const out = {};
      for (const j of JOBS) out[j] = await runJob(j, opts).catch(e => ({ error: String(e.message || e) }));
      return out;
    }
    default: throw new Error(`Unknown agent job: ${job}`);
  }
}

export async function approveDecision(decision) {
  const who = store.get('user');
  if (decision.kind === 'weather_reschedule') await applyWeatherReschedule(decision);
  return db.update('agent_decisions', decision.id, { status: 'approved', decided_by: who ? who.name : 'System', decided_at: new Date().toISOString() });
}
export async function rejectDecision(decision) {
  const who = store.get('user');
  return db.update('agent_decisions', decision.id, { status: 'rejected', decided_by: who ? who.name : 'System', decided_at: new Date().toISOString() });
}
export async function revertDecision(decision) {
  const r = decision.revert;
  if (r && r.visit_id) {
    await db.update('visits', r.visit_id, { status: r.from_status || 'scheduled' }, { skipValidate: true });
    if (r.new_visit_id) await db.remove('visits', r.new_visit_id);
  }
  return db.update('agent_decisions', decision.id, { status: 'reverted' }, { skipValidate: true });
}
