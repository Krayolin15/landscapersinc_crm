/* =============================================================================
   Shared business logic for quotes, invoices, payments, clients and contracts.
   Pure calculations first (unit tested in tests__biz.test.js), then the few
   helpers that read or write the database. All money goes through core/money.
   ========================================================================== */

import { db } from '../core/db.js';
import { toCents, fromCents, sumBy, formatMoney } from '../core/money.js';
import { today, diffDays, addDays, parse, iso, MONTHS } from '../core/dates.js';
import { visitsPerMonth } from '../schema/business.js';

/* ---------------- company profile (settings key 'company_profile') ---------------- */
import { COMPANY_DEFAULTS } from './_docdefaults.js';
export { COMPANY_DEFAULTS };
export function company() {
  const r = db.find('settings', s => s.key === 'company_profile');
  const v = { ...COMPANY_DEFAULTS, ...((r && r.value) || {}) };
  for (const k of Object.keys(COMPANY_DEFAULTS)) if (v[k] === null || v[k] === '') v[k] = COMPANY_DEFAULTS[k] || v[k];
  return v;
}
export function printBank() {
  const all = db.all('bank_accounts');
  return all.find(b => b.is_default) || all[0] || null;
}

/* ---------------- document maths (pure — js__apps___docmath.js) ---------------- */
import { cleanLines, totalsOf, withTotals, balanceOf, printedTotals } from './_docmath.js';
export { cleanLines, totalsOf, withTotals, balanceOf, printedTotals };

/**
 * The live status of an invoice. Stored statuses 'draft', 'void', 'awaiting_pop' and
 * 'not_recorded' are respected; everything else is derived from money and dates, so a
 * sent invoice becomes 'overdue' by itself the day after its due date.
 */
export function invoiceState(inv, on = today()) {
  if (!inv) return 'draft';
  if (['draft', 'void', 'not_recorded'].includes(inv.status)) return inv.status;
  const total = toCents(inv.total || 0), paid = toCents(inv.amount_paid || 0);
  if (total > 0 && paid >= total) return 'paid';
  if (inv.status === 'awaiting_pop') return 'awaiting_pop';
  if (inv.due_date && inv.due_date < on) return 'overdue';
  if (paid > 0) return 'partially_paid';
  return 'unpaid';
}
export const OPEN_STATES = ['unpaid', 'partially_paid', 'overdue', 'awaiting_pop'];
export const isOpen = (inv, on) => OPEN_STATES.includes(invoiceState(inv, on)) && balanceOf(inv) > 0;
export function daysOverdue(inv, on = today()) { return inv.due_date && inv.due_date < on ? diffDays(inv.due_date, on) : 0; }
/** Debt ageing by invoice date: '0-30', '31-60', '60+'. */
export function ageBucket(inv, on = today()) {
  const d = inv.issue_date ? diffDays(inv.issue_date, on) : 0;
  return d <= 30 ? '0-30' : d <= 60 ? '31-60' : '60+';
}
export function ageing(invoices, on = today()) {
  const out = { '0-30': 0, '31-60': 0, '60+': 0, total: 0, count: 0 };
  const c = { '0-30': 0, '31-60': 0, '60+': 0 };
  for (const inv of invoices) { if (!isOpen(inv, on)) continue; const b = ageBucket(inv, on); c[b] += toCents(balanceOf(inv)); out.count++; }
  for (const k of Object.keys(c)) out[k] = fromCents(c[k]);
  out.total = fromCents(c['0-30'] + c['31-60'] + c['60+']);
  return out;
}

/** Friendly reminders at 3, 7 and 14 days after the due date (spec). */
export const REMINDER_DAYS = [3, 7, 14];
export function reminderPlan(inv, on = today()) {
  const sent = Array.isArray(inv.reminders_sent) ? inv.reminders_sent : [];
  if (!inv.due_date) return [];
  return REMINDER_DAYS.map(d => {
    const date = addDays(inv.due_date, d);
    const s = sent.find(x => x.day === d);
    return { day: d, date, sent: s || null, due: !s && date <= on && isOpen(inv, on) };
  });
}
export function remindersDue(invoices, on = today()) {
  return invoices.flatMap(inv => reminderPlan(inv, on).filter(r => r.due).map(r => ({ inv, ...r })));
}

/* ---------------- numbering ---------------- */
export function formatNumber(prefix, n) { return `${prefix || ''}${String(n).padStart(4, '0')}`; }
/** Next free document number; bumps the counter in the company profile. */
export async function nextNumber(kind) {
  const col = kind === 'quote' ? 'quotes' : 'invoices';
  const c = company();
  const pKey = kind === 'quote' ? 'quote_prefix' : 'invoice_prefix', nKey = kind === 'quote' ? 'next_quote_no' : 'next_invoice_no';
  const used = new Set(db.all(col).map(r => r.number).filter(Boolean));
  let n = Number(c[nKey]) || 1001;
  while (used.has(formatNumber(c[pKey], n))) n++;
  const number = formatNumber(c[pKey], n);
  const rec = db.find('settings', s => s.key === 'company_profile');
  const value = { ...((rec && rec.value) || {}), [nKey]: n + 1 };
  try { rec ? await db.update('settings', rec.id, { value }) : await db.insert('settings', { key: 'company_profile', value, description: 'Company details used on quotes, invoices and letterheads.' }); } catch { /* non-admins cannot bump the counter; uniqueness check above still holds */ }
  return number;
}

/* ---------------- payments ---------------- */
export const paymentsFor = invId => db.filter('payments', p => p.invoice_id === invId).sort((a, b) => String(a.date).localeCompare(String(b.date)));
/** Re-derives amount_paid (verified payments only) and the stored status. */
export async function recomputeInvoice(invId) {
  const inv = db.get('invoices', invId); if (!inv) return null;
  const pays = paymentsFor(invId);
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
  // Legacy invoices that already carry an amount_paid but no payment records keep their figure.
  const amount_paid = pays.length ? paid : inv.amount_paid || 0;
  if (toCents(amount_paid) !== toCents(inv.amount_paid || 0) || status !== inv.status) return db.update('invoices', invId, { amount_paid, status });
  return inv;
}
export async function recordPayment(inv, p) {
  const rec = await db.insert('payments', {
    date: p.date || today(), client_id: inv.client_id || null, client_name: inv.client_name, invoice_id: inv.id,
    amount: p.amount, method: p.method || 'eft', reference: p.reference || inv.number || inv.legacy_number || null,
    status: p.status || 'verified', pop_file_id: p.pop_file_id || null, matched_by: p.matched_by || 'manual', match_confidence: p.match_confidence ?? null, notes: p.notes || null
  });
  await recomputeInvoice(inv.id);
  return rec;
}

/**
 * Proof-of-payment matcher: scores open invoices against an amount / reference / name.
 * Returns [{ inv, score (0-1), reasons[] }] best first.
 */
export function matchPop({ amount, reference, name, date } = {}, invoices = db.all('invoices'), on = today()) {
  const ref = String(reference || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const nm = String(name || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const amt = amount != null && amount !== '' ? toCents(amount) : null;
  return invoices.filter(i => isOpen(i, on) || invoiceState(i, on) === 'not_recorded').map(inv => {
    let score = 0; const reasons = [];
    const bal = toCents(balanceOf(inv) || inv.total || 0);
    const nums = [inv.number, inv.legacy_number, inv.reference].filter(Boolean).map(s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, ''));
    if (ref && nums.some(n => n && (ref.includes(n) || n.includes(ref)))) { score += 0.55; reasons.push('reference matches'); }
    if (amt != null) {
      if (amt === bal) { score += 0.35; reasons.push('exact balance'); }
      else if (amt === toCents(inv.total || 0)) { score += 0.3; reasons.push('exact invoice total'); }
      else if (bal && Math.abs(amt - bal) / bal < 0.02) { score += 0.15; reasons.push('amount within 2%'); }
    }
    const cn = String(inv.client_name || '').toLowerCase();
    if (nm.length && nm.some(w => cn.includes(w))) { score += 0.2; reasons.push('name matches'); }
    if (date && inv.issue_date && date >= inv.issue_date) score += 0.02;
    return { inv, score: Math.min(1, score), reasons };
  }).filter(m => m.score >= 0.2).sort((a, b) => b.score - a.score);
}

/* ---------------- clients & contracts ---------------- */
export function clientInvoices(clientId) { return db.filter('invoices', i => i.client_id === clientId); }
export function clientBalance(clientId, on) { return fromCents(clientInvoices(clientId).filter(i => isOpen(i, on)).reduce((a, i) => a + toCents(balanceOf(i)), 0)); }
export function clientContracts(clientId) { return db.filter('contracts', c => c.client_id === clientId); }
export function contractMonthly(c) { return c.status === 'active' ? Number(c.monthly_value) || 0 : 0; }
export function mrr(contracts = db.all('contracts')) { return fromCents(contracts.reduce((a, c) => a + toCents(contractMonthly(c)), 0)); }
/** Lifetime value = everything invoiced (not void) + legacy balances. */
export function clientLTV(clientId) { return fromCents(clientInvoices(clientId).filter(i => i.status !== 'void' && i.kind !== 'credit_note').reduce((a, i) => a + toCents(i.total || 0), 0)); }
/**
 * Client health 0–100 from payment behaviour, tenure and service continuity.
 * Returns { score, label, factors[] } — every factor is shown to the user.
 */
export function clientHealth(client, on = today()) {
  const f = [];
  let s = 70;
  const inv = clientInvoices(client.id);
  const overdue = inv.filter(i => invoiceState(i, on) === 'overdue');
  if (overdue.length) { s -= Math.min(35, overdue.length * 12); f.push(`${overdue.length} overdue invoice${overdue.length > 1 ? 's' : ''}`); }
  const bal = clientBalance(client.id, on);
  if (bal > 0) { s -= 5; f.push(`Owes ${formatMoney(bal)}`); }
  const paid = inv.filter(i => invoiceState(i, on) === 'paid');
  if (paid.length) { s += Math.min(15, paid.length * 3); f.push(`${paid.length} paid invoice${paid.length > 1 ? 's' : ''}`); }
  const active = clientContracts(client.id).filter(c => c.status === 'active');
  if (active.length) { s += 10; f.push('Active maintenance contract'); } else if (client.status === 'active') { s -= 5; f.push('No active contract on record'); }
  if (client.since_date) { const m = diffDays(client.since_date, on) / 30.4; if (m > 12) { s += 5; f.push('Client for over a year'); } }
  if (['left'].includes(client.status)) { s = Math.min(s, 20); f.push('Client has left'); }
  if (client.status === 'paused') { s -= 10; f.push('Service paused'); }
  s = Math.max(0, Math.min(100, Math.round(s)));
  return { score: s, label: s >= 75 ? 'Healthy' : s >= 50 ? 'Watch' : 'At risk', factors: f };
}
/** Draft monthly maintenance invoice for a contract and period (YYYY-MM). */
export function contractInvoiceDraft(contract, period, client = db.get('clients', contract.client_id)) {
  const [y, m] = period.split('-').map(Number);
  const vpm = contract.visits_per_month || visitsPerMonth(contract.frequency) || 1;
  const rate = contract.per_visit_rate != null ? Number(contract.per_visit_rate) : Number(contract.monthly_value || 0) / vpm;
  const c = company();
  const issue = `${period}-01` > today() ? `${period}-01` : today();
  return {
    client_id: contract.client_id, client_name: (client && client.name) || contract.name, bill_to: client ? [client.name, client.address].filter(Boolean).join('\n') : null,
    kind: 'maintenance', period, issue_date: issue, due_date: addDays(issue, Number(c.default_due_days) || 7), contract_id: contract.id,
    reference: contract.legacy_code || (client && client.legacy_code) || null,
    lines: [{ description: `Garden maintenance — ${contract.name} — month of ${MONTHS[m - 1]} ${y} (${vpm} visit${vpm > 1 ? 's' : ''})`, qty: vpm, unit_price: rate, discount_pct: 0 }],
    vat_applied: !!c.vat_registered, discount: 0, status: 'draft', amount_paid: 0, terms: c.invoice_terms
  };
}

/* ---------------- messages ---------------- */
export function intlPhone(v) {
  let d = String(v || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '27' + d.slice(1);
  return /^\d{10,13}$/.test(d) ? d : null;
}
export const waLink = (phone, text) => { const p = intlPhone(phone); return `https://wa.me/${p || ''}?text=${encodeURIComponent(text)}`; };
export const mailtoLink = (to, subject, body) => `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
function bankLines() {
  const b = printBank();
  return b ? `Bank: ${b.bank}\nAccount name: ${b.account_name}\nAccount no: ${b.account_no}${b.branch_code ? `\nBranch code: ${b.branch_code}` : ''}` : '';
}
export function invoiceMessage(inv, kind = 'send') {
  const c = company(), bal = balanceOf(inv), no = inv.number || inv.legacy_number || '';
  const first = String(inv.client_name || '').split(/\s+/)[0] || 'there';
  const ref = inv.reference || no;
  if (kind === 'send') return `Good day ${first},\n\nPlease find attached invoice ${no} from ${c.trading_name} for ${formatMoney(inv.total)}${inv.due_date ? `, due on ${inv.due_date}` : ''}.\n\n${bankLines()}\nReference: ${ref}\n\nKindly send the proof of payment once paid. Thank you for your support!\n\n${c.trading_name}`;
  const tone = kind === 14 ? `This is a final reminder that invoice ${no} is now 14 days overdue.` : kind === 7 ? `A friendly follow-up: invoice ${no} is now a week overdue.` : `Just a gentle reminder that invoice ${no} was due on ${inv.due_date}.`;
  return `Good day ${first},\n\n${tone} The outstanding balance is ${formatMoney(bal)}.\n\n${bankLines()}\nReference: ${ref}\n\nIf you have already paid, please send us the proof of payment and ignore this message. Thank you!\n\n${c.trading_name}`;
}
export function quoteMessage(q) {
  const c = company(); const first = String(q.client_name || '').split(/\s+/)[0] || 'there';
  return `Good day ${first},\n\nThank you for the opportunity. Please find attached our quotation ${q.number || q.legacy_number || ''} for "${q.title}" — ${formatMoney(q.total)}${q.valid_until ? `, valid until ${q.valid_until}` : ''}.\n\n${q.deposit_amount ? `A deposit of ${formatMoney(q.deposit_amount)} confirms your booking.\n\n` : ''}Simply reply "I accept" to go ahead, or let us know if you have any questions.\n\n${c.trading_name}`;
}

/* ---------------- misc ---------------- */
export function monthKey(d) { return iso(parse(d)).slice(0, 7); }
export function lastMonths(n, on = today()) {
  const out = []; const d = parse(on); d.setDate(1);
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`); }
  return out;
}
