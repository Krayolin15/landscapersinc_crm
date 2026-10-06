/* =============================================================================
   Reminders — polite South African business-tone debtor follow-ups at 3/7/14
   days after due date, and expiry alerts (certificates, medicals, vehicle
   licences/services, compliance documents, appointments) at 60/30/7 days.

   PURE MODULE: no DOM, no Deno APIs, no npm imports. Money always goes
   through js/core/money.js (the one exception to "no core imports" — it is
   itself dependency-free and this keeps every rand figure exact).
   ========================================================================== */

import { toCents, fromCents, formatMoney } from '../../../../js/core/money.js';

export const REMINDER_STAGES_DEFAULT = [3, 7, 14];
export const EXPIRY_WINDOWS_DEFAULT = [60, 30, 7];

function addDaysISO(dateStr, n) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function diffDaysISO(a, b) {
  const [ay, am, ad] = String(a).slice(0, 10).split('-').map(Number);
  const [by, bm, bd] = String(b).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

function balanceOfInvoice(inv) {
  if (inv.status === 'void' || inv.kind === 'credit_note') return 0;
  return fromCents(Math.max(0, toCents(inv.total || 0) - toCents(inv.amount_paid || 0)));
}
function isOpenInvoice(inv, today) {
  if (['draft', 'void'].includes(inv.status)) return false;
  const bal = balanceOfInvoice(inv);
  if (bal <= 0) return false;
  if (inv.status === 'awaiting_pop') return false; // a POP is already in and awaiting verification
  return true;
}

/** Reminder wording — polite South African business tone, invoice number, balance, due date, banking reference. */
function reminderMessage({ inv, day, balance, bank, companyName }) {
  const first = String(inv.client_name || '').split(/\s+/)[0] || 'there';
  const no = inv.number || inv.legacy_number || 'your invoice';
  const ref = inv.reference || inv.number || inv.legacy_number || '';
  const tone = day >= 14
    ? `This is a follow-up to say invoice ${no} is now 14 days overdue.`
    : day >= 7
      ? `A friendly reminder that invoice ${no} is now a week overdue.`
      : `Just a gentle reminder that invoice ${no} was due on ${inv.due_date}.`;
  const bankLines = bank ? `\n\nBanking details:\nBank: ${bank.bank}\nAccount name: ${bank.account_name}\nAccount no: ${bank.account_no}${bank.branch_code ? `\nBranch code: ${bank.branch_code}` : ''}` : '';
  const body = `Good day ${first},\n\n${tone} The outstanding balance is ${formatMoney(balance)}.${bankLines}\nReference: ${ref}\n\nIf you have already paid, please send us the proof of payment and kindly disregard this message. Thank you for your continued support!\n\n${companyName || 'Landscapers Inc'}`;
  const whatsapp = `Good day ${first}, ${tone} Outstanding balance: ${formatMoney(balance)}. Reference: ${ref}. Already paid? Please send your proof of payment. Thank you — ${companyName || 'Landscapers Inc'}.`;
  return { subject: `Reminder: invoice ${no} — ${companyName || 'Landscapers Inc'}`, body, whatsapp };
}

/**
 * debtorReminders({ invoices, clients, today, settings }) ->
 *   { outboxRecords, decisions, invoiceUpdates }
 * One reminder per invoice per stage (3/7/14 days after due, configurable via
 * settings.reminderStages). Never re-sends a stage already recorded in
 * invoices.reminders_sent.
 */
export function debtorReminders({ invoices = [], clients = [], today, settings = {}, now } = {}) {
  const stages = (settings.reminderStages && settings.reminderStages.length) ? settings.reminderStages : REMINDER_STAGES_DEFAULT;
  const bank = settings.bank || null;
  const companyName = settings.companyName || 'Landscapers Inc';
  const at = now || new Date().toISOString();
  const outboxRecords = [];
  const decisions = [];
  const invoiceUpdates = [];

  for (const inv of invoices) {
    if (!inv.due_date || !isOpenInvoice(inv, today)) continue;
    let sent = Array.isArray(inv.reminders_sent) ? inv.reminders_sent : [];
    let changed = false;
    for (const day of stages) {
      const stageDate = addDaysISO(inv.due_date, day);
      if (stageDate > today) continue;
      if (sent.some(s => s.day === day)) continue;
      const balance = balanceOfInvoice(inv);
      if (balance <= 0) continue;
      const client = clients.find(c => c.id === inv.client_id) || null;
      const phone = client && (client.phone || client.phone_alt);
      const email = client && (client.billing_email || client.email);
      const preferEmail = client && client.preferred_channel === 'email';
      const { subject, body, whatsapp } = reminderMessage({ inv, day, balance, bank, companyName });
      let channel, to, status;
      if (phone && !preferEmail) { channel = 'whatsapp'; to = phone; status = 'queued'; }
      else if (email) { channel = 'email'; to = email; status = 'queued'; }
      else if (phone) { channel = 'whatsapp'; to = phone; status = 'queued'; }
      else { channel = 'whatsapp'; to = inv.client_name || 'client'; status = 'needs_approval'; }
      outboxRecords.push({ channel, to, to_name: inv.client_name, subject, body: channel === 'whatsapp' ? whatsapp : body, status, related_collection: 'invoices', related_id: inv.id, template_key: `debtor-reminder-${day}` });
      decisions.push({ kind: 'payment_reminder', title: `${day}-day reminder queued for ${inv.number || inv.legacy_number || 'invoice'}`, detail: `${inv.client_name} owes ${formatMoney(balance)}, due ${inv.due_date}.`, affected: { invoice_id: inv.id, day, channel }, requires_approval: false, status: 'applied' });
      sent = [...sent, { day, at, via: channel, by: 'Agent' }];
      changed = true;
    }
    if (changed) invoiceUpdates.push({ id: inv.id, reminders_sent: sent });
  }
  return { outboxRecords, decisions, invoiceUpdates };
}

function expiryList(rows, field, kind, labelFn, collection, today, windows) {
  const out = [];
  for (const r of rows) {
    if (!r[field]) continue;
    const d = diffDaysISO(today, r[field]);
    let tier = null;
    if (d < 0) tier = 'expired';
    else if (d === 0) tier = 'today';
    else { const w = windows.filter(x => d <= x).sort((a, b) => a - b)[0]; if (w != null) tier = `${w}d`; }
    if (!tier) continue;
    out.push({
      key: `expiry|${collection}|${r.id}|${tier}`, kind, collection, record_id: r.id, days: d, date: r[field],
      label: labelFn(r), severity: d < 0 ? 'danger' : d <= 7 ? 'warn' : 'info',
      title: d < 0 ? `${labelFn(r)} expired` : d === 0 ? `${labelFn(r)} expires today` : `${labelFn(r)} expires in ${d} day${d === 1 ? '' : 's'}`
    });
  }
  return out;
}

/**
 * expiryAlerts({ certificates, medicals, vehicles, compliance_docs, appointments }, today, windows) ->
 *   flat array of { key, kind, collection, record_id, days, date, label, severity, title }
 * Windows default to 60/30/7 days before the expiry date (plus "today" and "expired").
 */
export function expiryAlerts({ certificates = [], medicals = [], vehicles = [], compliance_docs = [], appointments = [] } = {}, today, windows = EXPIRY_WINDOWS_DEFAULT) {
  return [
    ...expiryList(certificates, 'expiry_date', 'certificate', r => `${r.course || 'Certificate'} — ${r.person_name || ''}`.trim(), 'certificates', today, windows),
    ...expiryList(medicals, 'expiry_date', 'medical', r => `${r.person_name || 'Employee'} medical`, 'medicals', today, windows),
    ...expiryList(vehicles, 'licence_expiry', 'vehicle_licence', r => `${r.name || 'Vehicle'} licence`, 'vehicles', today, windows),
    ...expiryList(vehicles, 'next_service_date', 'vehicle_service', r => `${r.name || 'Vehicle'} service`, 'vehicles', today, windows),
    ...expiryList(compliance_docs, 'expiry_date', 'compliance_doc', r => r.name || 'Compliance document', 'compliance_docs', today, windows),
    ...expiryList(appointments, 'review_date', 'appointment', r => `${r.appointment || 'Appointment'} — ${r.person_name || ''}`.trim(), 'appointments', today, windows)
  ].sort((a, b) => a.days - b.days);
}
