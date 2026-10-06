// =============================================================================
// Autonomous Core — cloud runner (Deno Edge Function).
//
// Invoked by pg_cron (js__sql__cron.js, Admin → Go live step 07) via net.http_post, or manually for
// testing:
//   curl -X POST https://<ref>.supabase.co/functions/v1/agent-run \
//        -H "x-cron-secret: <CRON_SECRET>" -H "Content-Type: application/json" \
//        -d '{"job":"morning_dispatch"}'
//
// Body: { job: 'morning_dispatch' | 'executive_briefing' | 'payment_reminders'
//              | 'expiry_watch' | 'pop_matching' | 'all' }
//
// This is the SAME decision-making logic the in-browser agent runs
// (js__agent__runner.js + js__agent__adapters.js) — both call the pure modules in
// supabase/functions/_shared/agent/*.js, so a job planned by the cloud at
// 05:00 and one run later from an open browser tab never disagree. The only
// difference is the IO layer: the browser reads/writes js__core__db.js
// (IndexedDB + Supabase sync); this file reads/writes Postgres directly with
// the service-role key, because nobody needs to have the app open for this to
// run — that is the whole point of deploying it (see the "How the agent runs"
// card in js__apps__agent__index.js).
//
// Required secrets (`supabase secrets set NAME=value`):
//   CRON_SECRET                 shared secret pg_cron sends as x-cron-secret (see js__sql__cron.js)
//   SUPABASE_URL                 auto-provided by the platform
//   SUPABASE_SERVICE_ROLE_KEY    auto-provided by the platform — NEVER exposed to the browser
// Optional (a channel is left `queued`/`needs_approval` in the outbox when its secret is absent):
//   RESEND_API_KEY               sends queued outbox emails via Resend (https://resend.com)
//   MAIL_FROM                    the sender, e.g. "Landscapers Inc <accounts@yourdomain.co.za>" — the SAME secret send-email uses;
//                                it must be an address on a domain verified in Resend (RESEND_FROM is still read if set)
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM   WhatsApp via Twilio's WhatsApp API
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

import { DEPOT, resolveLocation } from '../_shared/agent/geo.js';
import { fetchForecast, assess, WORK_WINDOW_DEFAULT } from '../_shared/agent/weather.js';
import { planDay } from '../_shared/agent/dispatch.js';
import { composeBriefing } from '../_shared/agent/briefing.js';
import { debtorReminders, expiryAlerts } from '../_shared/agent/reminders.js';
import { matchPayment, AUTO_APPLY_THRESHOLD } from '../_shared/agent/pop-match.js';
import { today, addDays } from '../../../js__core__dates.js';
import { isWorkingDay } from '../../../js__core__holidays.js';
import { toCents, fromCents, sub, sumBy } from '../../../js__core__money.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
// never guess a sender: Resend rejects domains you have not verified
const MAIL_FROM = Deno.env.get('MAIL_FROM') || Deno.env.get('RESEND_FROM') || '';
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
const TWILIO_WHATSAPP_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? '';

const JOBS = ['morning_dispatch', 'executive_briefing', 'payment_reminders', 'expiry_watch', 'pop_matching'];
const AGENT_NAME = 'Autonomous Agent';
const ACTOR = { id: 'agent', name: AGENT_NAME };

function client() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set for this function.');
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Postgres row -> plain record, same shape js__core__db.js hands to the app (known columns + jsonb `data` merged). */
function fromRow(row) {
  const { data, ...rest } = row || {};
  return { ...(data && typeof data === 'object' ? data : {}), ...rest };
}

async function loadAll(sb, table, extra) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select('*').is('deleted_at', null).range(from, from + 999);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw new Error(`load ${table}: ${error.message}`);
    out.push(...data.map(fromRow));
    if (data.length < 1000) break;
  }
  return out;
}

async function insertRow(sb, table, values) {
  const now = new Date().toISOString();
  const row = { created_at: now, created_by: ACTOR.id, created_by_name: ACTOR.name, updated_at: now, updated_by: ACTOR.id, updated_by_name: ACTOR.name, ...values };
  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) throw new Error(`insert ${table}: ${error.message}`);
  return fromRow(data);
}
async function updateRow(sb, table, id, patch) {
  const { data, error } = await sb.from(table).update({ ...patch, updated_at: new Date().toISOString(), updated_by: ACTOR.id, updated_by_name: ACTOR.name }).eq('id', id).select().single();
  if (error) throw new Error(`update ${table} ${id}: ${error.message}`);
  return fromRow(data);
}

/* ------------------------------------------------------------------ small pure re-implementations
   (js__apps___biz.js can't be imported here — it reaches into js__core__db.js, which is IndexedDB/browser
   only. These few lines mirror its invoice-state logic exactly; see js__apps___biz.js for the original.) */
function balanceOf(inv) { return inv.status === 'void' || inv.kind === 'credit_note' ? 0 : Math.max(0, sub(inv.total || 0, inv.amount_paid || 0)); }
function invoiceState(inv, on = today()) {
  if (!inv) return 'draft';
  if (['draft', 'void', 'not_recorded'].includes(inv.status)) return inv.status;
  const total = toCents(inv.total || 0), paid = toCents(inv.amount_paid || 0);
  if (total > 0 && paid >= total) return 'paid';
  if (inv.status === 'awaiting_pop') return 'awaiting_pop';
  if (inv.due_date && inv.due_date < on) return 'overdue';
  if (paid > 0) return 'partially_paid';
  return 'unpaid';
}
const OPEN_STATES = ['unpaid', 'partially_paid', 'overdue', 'awaiting_pop'];
const isOpen = (inv, on) => OPEN_STATES.includes(invoiceState(inv, on)) && balanceOf(inv) > 0;

/* ------------------------------------------------------------------ agent settings + company profile */
async function loadSettings(sb) {
  const { data, error } = await sb.from('settings').select('*').in('key', ['agent_settings', 'company_profile']).is('deleted_at', null);
  if (error) throw new Error(`load settings: ${error.message}`);
  const rows = (data || []).map(fromRow);
  const agent = (rows.find(r => r.key === 'agent_settings') || {}).value || {};
  const companyProfile = (rows.find(r => r.key === 'company_profile') || {}).value || {};
  return {
    reminderStages: agent.reminderStages && agent.reminderStages.length ? agent.reminderStages : [3, 7, 14],
    fuelPriceRandPerLitre: agent.fuelPriceRandPerLitre || 23,
    defaultFuelL100km: agent.defaultFuelL100km || 12,
    workWindow: agent.workWindow || WORK_WINDOW_DEFAULT,
    jobsEnabled: agent.jobsEnabled || {},
    autoApply: { popAutoApplyThreshold: AUTO_APPLY_THRESHOLD, ...(agent.autoApply || {}) },
    weatherKeywords: agent.weatherKeywords,
    depot: agent.depot || null,
    companyProfile
  };
}
async function loadBank(sb) {
  const rows = await loadAll(sb, 'bank_accounts');
  return rows.find(b => b.is_default) || rows[0] || null;
}

/* ------------------------------------------------------------------ run bookkeeping (agent_runs) */
async function startRun(sb, kind) { return insertRow(sb, 'agent_runs', { kind, runner: 'cloud', started_at: new Date().toISOString(), status: 'running' }); }
async function finishRun(sb, run, patch) { return updateRow(sb, 'agent_runs', run.id, { finished_at: new Date().toISOString(), status: 'ok', summary: '', stats: {}, error: null, ...patch }); }
async function alreadyRanToday(sb, kind, date) {
  const { data, error } = await sb.from('agent_runs').select('id').eq('kind', kind).in('status', ['ok', 'warning']).gte('started_at', `${date}T00:00:00.000Z`).lt('started_at', `${addDays(date, 1)}T00:00:00.000Z`).limit(1);
  if (error) throw new Error(error.message);
  return !!(data && data.length);
}

/** Resolve a site/client pairing to a suburb name + approximate coordinates — same rule as js__agent__adapters.js. */
function locationFor(site, client) {
  if (site && site.lat != null && site.lng != null) return { name: site.suburb || site.estate || site.name, lat: site.lat, lng: site.lng, approx: false };
  const text = (site && (site.suburb || site.estate || site.region || site.address)) || (client && (client.suburb || client.region || client.address)) || '';
  return resolveLocation(text);
}
function nextWorkingDates(date, n = 5) { const out = []; let d = date; while (out.length < n) { d = addDays(d, 1); if (isWorkingDay(d)) out.push(d); } return out; }

async function loadEnrichedVisits(sb, date) {
  const [visits, sites, clients, contracts] = await Promise.all([
    loadAll(sb, 'visits', q => q.eq('date', date)),
    loadAll(sb, 'sites'),
    loadAll(sb, 'clients'),
    loadAll(sb, 'contracts')
  ]);
  const sitesById = Object.fromEntries(sites.map(s => [s.id, s]));
  const clientsById = Object.fromEntries(clients.map(c => [c.id, c]));
  const contractsById = Object.fromEntries(contracts.map(c => [c.id, c]));
  return visits.filter(v => !['cancelled', 'weather_postponed'].includes(v.status)).map(v => {
    const site = v.site_id ? sitesById[v.site_id] : null;
    const client = v.client_id ? clientsById[v.client_id] : (site && site.client_id ? clientsById[site.client_id] : null);
    const loc = locationFor(site, client);
    const contractHint = v.contract_id && contractsById[v.contract_id] ? contractsById[v.contract_id].service_type || '' : '';
    return {
      id: v.id, site_id: v.site_id, site_name: v.site_name || (site && site.name) || '', client_id: v.client_id, client_name: v.client_name,
      suburb: loc ? loc.name : null, lat: loc ? loc.lat : null, lng: loc ? loc.lng : null,
      kind: `${v.kind || ''} ${contractHint}`.trim(), instructions: v.instructions || (site && site.instructions) || '',
      start_time: v.start_time || (site && site.start_at) || null, finish_by: v.finish_by || (site && site.finish_by) || null,
      planned_minutes: v.planned_minutes || null, actual_minutes: v.actual_minutes || null, status: v.status,
      preferred_crew_id: v.crew_id || null, contract_id: v.contract_id || null
    };
  });
}

async function weatherForVisits(visits, dates, workWindow) {
  const sensitive = visits.filter(v => v.suburb && /mow|lawn cut|lawn dress|lawn lay|spray|fertilis|fertiliz/i.test(`${v.instructions} ${v.kind}`));
  const suburbs = [...new Set(sensitive.map(v => v.suburb))];
  const out = {};
  for (const suburb of suburbs) {
    const loc = resolveLocation(suburb);
    if (!loc) continue;
    out[suburb] = {};
    try {
      const forecast = await fetchForecast({ lat: loc.lat, lng: loc.lng, days: 5, fetchImpl: fetch });
      for (const d of dates) out[suburb][d] = assess(forecast.hourly, workWindow, { date: d });
    } catch (e) { console.warn(`[agent] weather unavailable for ${suburb}:`, e.message); }
  }
  return out;
}

/* ------------------------------------------------------------------ 1. morning dispatch */
async function runMorningDispatch(sb, { date, force }) {
  if (!force && (await alreadyRanToday(sb, 'morning_dispatch', date))) return { skipped: true };
  const run = await startRun(sb, 'morning_dispatch');
  try {
    const settings = await loadSettings(sb);
    const visits = await loadEnrichedVisits(sb, date);
    const candidateDates = nextWorkingDates(date, 5);
    const weatherBySuburb = await weatherForVisits(visits, [date, ...candidateDates], settings.workWindow);
    const [crews, employees, vehicles, services] = await Promise.all([
      loadAll(sb, 'crews', q => q.eq('active', true)), loadAll(sb, 'employees'), loadAll(sb, 'vehicles'), loadAll(sb, 'services')
    ]);
    const isWeekendOnly = [0, 6].includes(new Date(date + 'T00:00:00').getDay());
    const result = planDay({
      date, isHoliday: !isWorkingDay(date) && !isWeekendOnly, isWeekend: isWeekendOnly,
      visits, crews, employees, vehicles, services, depot: settings.depot || DEPOT, weatherBySuburb, candidateDates,
      settings: { fuelPriceRandPerLitre: settings.fuelPriceRandPerLitre, defaultFuelL100km: settings.defaultFuelL100km, weatherKeywords: settings.weatherKeywords }
    });
    for (const dec of result.decisions) {
      const rec = await insertRow(sb, 'agent_decisions', { run_id: run.id, kind: dec.kind, title: dec.title, detail: dec.detail || '', affected: dec.affected || {}, requires_approval: !!dec.requires_approval, status: dec.status || 'applied' });
      if (dec.kind === 'weather_reschedule' && dec.status === 'applied') await applyWeatherReschedule(sb, rec);
    }
    await finishRun(sb, run, { status: 'ok', summary: `${result.assignments.length} crew(s), ${result.assignments.reduce((a, x) => a + x.visits.length, 0)} visit(s) planned for ${date}.`, stats: { assignments: result.assignments.length, decisions: result.decisions.length } });
    return { run, ...result };
  } catch (e) { await finishRun(sb, run, { status: 'failed', error: String(e.message || e) }); throw e; }
}

async function applyWeatherReschedule(sb, decisionRec) {
  const a = decisionRec.affected || {};
  if (!a.visit_id) return;
  const { data: visitRows } = await sb.from('visits').select('*').eq('id', a.visit_id).limit(1);
  const visit = (visitRows && visitRows[0]) ? fromRow(visitRows[0]) : null;
  if (!visit) return;
  await updateRow(sb, 'visits', visit.id, { status: 'weather_postponed', reschedule_reason: decisionRec.detail || 'Postponed by the autonomous agent — unsuitable weather.' });
  let newVisitId = null;
  if (a.to_date) {
    const created = await insertRow(sb, 'visits', {
      date: a.to_date, site_id: visit.site_id, site_name: visit.site_name, client_id: visit.client_id, client_name: visit.client_name,
      contract_id: visit.contract_id, job_id: visit.job_id, kind: visit.kind, crew_id: visit.crew_id, crew_names: visit.crew_names,
      start_time: visit.start_time, finish_by: visit.finish_by, planned_minutes: visit.planned_minutes, instructions: visit.instructions,
      status: 'scheduled', rescheduled_from: visit.date, notes: visit.notes
    });
    newVisitId = created.id;
  }
  await updateRow(sb, 'agent_decisions', decisionRec.id, { revert: { visit_id: visit.id, from_status: visit.status, new_visit_id: newVisitId } });
}

/* ------------------------------------------------------------------ 2. executive briefing */
async function runExecutiveBriefing(sb, { date, force }) {
  if (!force && (await alreadyRanToday(sb, 'executive_briefing', date))) return { skipped: true };
  const run = await startRun(sb, 'executive_briefing');
  try {
    const settings = await loadSettings(sb);
    const [invoices, certificates, medicals, vehicles, complianceDocs, appointments, events, decisionsToday, dispatchRuns] = await Promise.all([
      loadAll(sb, 'invoices'), loadAll(sb, 'certificates'), loadAll(sb, 'medicals'), loadAll(sb, 'vehicles'),
      loadAll(sb, 'compliance_docs'), loadAll(sb, 'appointments'), loadAll(sb, 'events', q => q.eq('start_date', date)),
      loadAll(sb, 'agent_decisions', q => q.eq('requires_approval', true).eq('status', 'pending')),
      loadAll(sb, 'agent_runs', q => q.eq('kind', 'morning_dispatch').gte('started_at', `${date}T00:00:00.000Z`).lt('started_at', `${addDays(date, 1)}T00:00:00.000Z`))
    ]);
    const overdueInvoices = invoices.filter(i => invoiceState(i) === 'overdue').map(i => ({ ...i, balance: balanceOf(i) }));
    const awaitingPop = invoices.filter(i => invoiceState(i) === 'awaiting_pop');
    const expiring = expiryAlerts({ certificates, medicals, vehicles, compliance_docs: complianceDocs, appointments }, date).filter(x => x.days <= 30);
    const todayEvents = events.map(e => ({ time: e.start_time, title: e.title, link: `#/calendar/event/${e.id}` }));
    const visits = await loadEnrichedVisits(sb, date);
    const suburbs = [...new Set(visits.map(v => v.suburb).filter(Boolean))].slice(0, 6);
    const weather = {};
    for (const suburb of suburbs) {
      const loc = resolveLocation(suburb);
      if (!loc) continue;
      try { const f = await fetchForecast({ lat: loc.lat, lng: loc.lng, days: 2, fetchImpl: fetch }); weather[suburb] = assess(f.hourly, settings.workWindow, { date }); } catch { /* offline */ }
    }
    const dispatchRun = dispatchRuns[0];
    const planDecisions = dispatchRun ? await loadAll(sb, 'agent_decisions', q => q.eq('run_id', dispatchRun.id)) : [];
    const openInvoices = invoices.filter(i => isOpen(i));
    const briefing = composeBriefing({ date, decisions: planDecisions, plan: { assignments: [], decisions: planDecisions }, weather, overdueInvoices, awaitingPop, expiring, approvals: decisionsToday, todayEvents, kpis: { 'Open invoices': fromCents(sumBy(openInvoices, i => toCents(balanceOf(i)))) } });
    const rec = await insertRow(sb, 'briefings', { date, generated_at: new Date().toISOString(), runner: 'cloud', headline: briefing.headline, sections: briefing.sections, weather });
    const managers = await loadAll(sb, 'profiles', q => q.in('role', ['owner', 'admin', 'manager']));
    for (const m of managers) {
      const exists = await sb.from('notifications').select('id').eq('user_id', m.id).eq('source_key', `briefing|${date}`).limit(1);
      if (exists.data && exists.data.length) continue;
      await insertRow(sb, 'notifications', { user_id: m.id, title: "Today's briefing is ready", body: briefing.headline, icon: 'sunrise', tile: 't-sun', link: '#/home', kind: 'briefing', source_key: `briefing|${date}` });
    }
    await finishRun(sb, run, { status: 'ok', summary: briefing.headline, stats: { sections: briefing.sections.length } });
    return { run, briefing: rec };
  } catch (e) { await finishRun(sb, run, { status: 'failed', error: String(e.message || e) }); throw e; }
}

/* ------------------------------------------------------------------ 3. payment reminders */
async function runPaymentReminders(sb, { date }) {
  const run = await startRun(sb, 'payment_reminders');
  try {
    const settings = await loadSettings(sb);
    const bank = await loadBank(sb);
    const [invoices, clients] = await Promise.all([loadAll(sb, 'invoices'), loadAll(sb, 'clients')]);
    const { outboxRecords, decisions, invoiceUpdates } = debtorReminders({
      invoices, clients, today: date,
      settings: { reminderStages: settings.reminderStages, companyName: settings.companyProfile.trading_name || 'Landscapers Inc', bank: bank ? { bank: bank.bank, account_name: bank.account_name, account_no: bank.account_no, branch_code: bank.branch_code } : null }
    });
    for (const rec of outboxRecords) {
      const saved = await insertRow(sb, 'outbox', rec);
      await sendOutboxMessage(sb, saved);
    }
    for (const dec of decisions) await insertRow(sb, 'agent_decisions', { run_id: run.id, kind: dec.kind, title: dec.title, detail: dec.detail, affected: dec.affected, requires_approval: false, status: 'applied' });
    for (const u of invoiceUpdates) await updateRow(sb, 'invoices', u.id, { reminders_sent: u.reminders_sent });
    await finishRun(sb, run, { status: 'ok', summary: `${outboxRecords.length} reminder(s) queued.`, stats: { queued: outboxRecords.length } });
    return { run, outboxRecords, decisions };
  } catch (e) { await finishRun(sb, run, { status: 'failed', error: String(e.message || e) }); throw e; }
}

/* ------------------------------------------------------------------ 4. expiry watch */
async function runExpiryWatch(sb, { date }) {
  const run = await startRun(sb, 'expiry_watch');
  try {
    const [certificates, medicals, vehicles, complianceDocs, appointments] = await Promise.all([
      loadAll(sb, 'certificates'), loadAll(sb, 'medicals'), loadAll(sb, 'vehicles'), loadAll(sb, 'compliance_docs'), loadAll(sb, 'appointments')
    ]);
    const alerts = expiryAlerts({ certificates, medicals, vehicles, compliance_docs: complianceDocs, appointments }, date);
    let created = 0;
    for (const a of alerts) {
      const { data: existing } = await sb.from('agent_decisions').select('id').eq('kind', 'expiry_alert').contains('affected', { key: a.key }).limit(1);
      if (existing && existing.length) continue;
      await insertRow(sb, 'agent_decisions', { run_id: run.id, kind: 'expiry_alert', title: a.title, detail: a.label, affected: { key: a.key, collection: a.collection, record_id: a.record_id, days: a.days }, requires_approval: false, status: 'applied' });
      created++;
    }
    await finishRun(sb, run, { status: 'ok', summary: `${created} new expiry alert(s) (of ${alerts.length} checked).`, stats: { created, checked: alerts.length } });
    return { run, created, checked: alerts.length };
  } catch (e) { await finishRun(sb, run, { status: 'failed', error: String(e.message || e) }); throw e; }
}

/* ------------------------------------------------------------------ 5. POP matching */
async function runPopMatching(sb) {
  const run = await startRun(sb, 'pop_matching');
  try {
    const settings = await loadSettings(sb);
    const invoices = await loadAll(sb, 'invoices');
    const open = invoices.filter(i => isOpen(i) || i.status === 'not_recorded');
    const pending = (await loadAll(sb, 'payments')).filter(p => p.status === 'awaiting_verification' && !p.invoice_id);
    let matched = 0, queued = 0;
    for (const p of pending) {
      const { best, decision } = matchPayment({ amount: p.amount, reference: p.reference, date: p.date, payer_name: p.client_name }, open);
      if (!best) continue;
      if (decision === 'auto_apply' && best.confidence >= settings.autoApply.popAutoApplyThreshold) {
        await updateRow(sb, 'payments', p.id, { invoice_id: best.invoice.id, status: 'verified', matched_by: 'auto_reference', match_confidence: best.confidence });
        await recomputeInvoiceCloud(sb, best.invoice.id);
        await insertRow(sb, 'agent_decisions', { run_id: run.id, kind: 'pop_match', title: `Matched payment to ${best.invoice.number || best.invoice.legacy_number}`, detail: best.reasons.join(', '), affected: { payment_id: p.id, invoice_id: best.invoice.id, confidence: best.confidence }, requires_approval: false, status: 'applied' });
        matched++;
      } else {
        await insertRow(sb, 'agent_decisions', { run_id: run.id, kind: 'pop_match', title: `Possible match: payment · ${best.invoice.client_name}`, detail: `${Math.round(best.confidence * 100)}% confidence — ${best.reasons.join(', ')}`, affected: { payment_id: p.id, invoice_id: best.invoice.id, confidence: best.confidence }, requires_approval: true, status: 'pending' });
        queued++;
      }
    }
    await finishRun(sb, run, { status: 'ok', summary: `${matched} auto-matched, ${queued} queued for review.`, stats: { matched, queued, checked: pending.length } });
    return { run, matched, queued };
  } catch (e) { await finishRun(sb, run, { status: 'failed', error: String(e.message || e) }); throw e; }
}
async function recomputeInvoiceCloud(sb, invId) {
  const { data: invRows } = await sb.from('invoices').select('*').eq('id', invId).limit(1);
  const inv = invRows && invRows[0] ? fromRow(invRows[0]) : null;
  if (!inv) return;
  const pays = (await loadAll(sb, 'payments')).filter(p => p.invoice_id === invId);
  const verified = pays.filter(p => p.status === 'verified');
  const paid = sumBy(verified, 'amount');
  const awaiting = pays.some(p => p.status === 'awaiting_verification');
  let status = inv.status;
  if (!['draft', 'void'].includes(status)) {
    if (toCents(paid) >= toCents(inv.total || 0) && toCents(inv.total || 0) > 0) status = 'paid';
    else if (awaiting) status = 'awaiting_pop';
    else if (status === 'not_recorded' && !pays.length) status = 'not_recorded';
    else status = paid > 0 ? 'partially_paid' : 'unpaid';
  }
  const amount_paid = pays.length ? paid : inv.amount_paid || 0;
  if (toCents(amount_paid) !== toCents(inv.amount_paid || 0) || status !== inv.status) await updateRow(sb, 'invoices', invId, { amount_paid, status });
}

/* ------------------------------------------------------------------ outbox sending (Resend / Twilio) */
async function sendOutboxMessage(sb, rec) {
  try {
    if (rec.channel === 'email') {
      if (!RESEND_API_KEY || !MAIL_FROM) return; // stays 'queued' — Resend / sender not configured yet
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: MAIL_FROM, to: [rec.to], subject: rec.subject || '(no subject)', text: rec.body })
      });
      if (res.ok) { const j = await res.json().catch(() => ({})); await updateRow(sb, 'outbox', rec.id, { status: 'sent', sent_at: new Date().toISOString(), provider_id: j.id || null }); }
      else await updateRow(sb, 'outbox', rec.id, { status: 'failed', error: `Resend ${res.status}: ${await res.text().catch(() => '')}` });
    } else if (rec.channel === 'whatsapp') {
      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) {
        // No WhatsApp sender configured — leave it for a person to approve & send by hand (wa.me link, see js__apps___biz.js waLink).
        await updateRow(sb, 'outbox', rec.id, { status: 'needs_approval' });
        return;
      }
      const toDigits = String(rec.to).replace(/[^\d+]/g, '');
      const body = new URLSearchParams({ From: `whatsapp:${TWILIO_WHATSAPP_FROM}`, To: `whatsapp:${toDigits}`, Body: rec.body });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST', headers: { Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body
      });
      if (res.ok) { const j = await res.json().catch(() => ({})); await updateRow(sb, 'outbox', rec.id, { status: 'sent', sent_at: new Date().toISOString(), provider_id: j.sid || null }); }
      else await updateRow(sb, 'outbox', rec.id, { status: 'failed', error: `Twilio ${res.status}: ${await res.text().catch(() => '')}` });
    }
    // 'sms' channel: no provider wired up yet — stays queued for manual sending.
  } catch (e) { await updateRow(sb, 'outbox', rec.id, { status: 'failed', error: String(e.message || e) }).catch(() => {}); }
}

/* ------------------------------------------------------------------ dispatcher */
async function runJob(sb, job, opts) {
  switch (job) {
    case 'morning_dispatch': return runMorningDispatch(sb, opts);
    case 'executive_briefing': return runExecutiveBriefing(sb, opts);
    case 'payment_reminders': return runPaymentReminders(sb, opts);
    case 'expiry_watch': return runExpiryWatch(sb, opts);
    case 'pop_matching': return runPopMatching(sb, opts);
    case 'all': {
      const out = {};
      for (const j of JOBS) { try { out[j] = await runJob(sb, j, opts); } catch (e) { out[j] = { error: String(e.message || e) }; } }
      return out;
    }
    default: throw new Error(`Unknown agent job: ${job}`);
  }
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body = {};
  try { body = await req.json(); } catch { /* empty body is fine — defaults to 'all' */ }
  const job = body.job || 'all';
  if (job !== 'all' && !JOBS.includes(job)) return new Response(JSON.stringify({ error: `Unknown job "${job}". Expected one of: ${JOBS.join(', ')}, all` }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const sb = client();
  const date = body.date || today();
  const t0 = Date.now();
  try {
    const result = await runJob(sb, job, { date, force: !!body.force });
    return new Response(JSON.stringify({ ok: true, job, date, ms: Date.now() - t0, result }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error(`[agent-run] ${job} failed:`, e);
    return new Response(JSON.stringify({ ok: false, job, date, ms: Date.now() - t0, error: String(e.message || e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
