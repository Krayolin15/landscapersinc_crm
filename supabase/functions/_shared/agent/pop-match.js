/* =============================================================================
   Proof-of-payment matcher — ranks open invoices against a bank payment
   (amount, reference, date, payer name) and decides whether to auto-apply
   or queue for human verification.

   PURE MODULE: no DOM, no Deno APIs, no npm imports.
   ========================================================================== */

import { toCents, fromCents } from '../../../../js/core/money.js';

export const AUTO_APPLY_THRESHOLD = 0.95;

const normRef = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normNameWords = v => String(v || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);

function balanceOfInvoice(inv) {
  if (inv.status === 'void' || inv.kind === 'credit_note') return 0;
  return fromCents(Math.max(0, toCents(inv.total || 0) - toCents(inv.amount_paid || 0)));
}

/** Share of `words` that appear as a substring of `name` (0..1). */
function nameSimilarity(words, name) {
  if (!words.length) return 0;
  const hay = String(name || '').toLowerCase();
  const hits = words.filter(w => hay.includes(w)).length;
  return hits / words.length;
}

/**
 * matchPayment({ amount, reference, date, payer_name }, openInvoices) ->
 *   { candidates: [{ invoice, confidence, reasons, balance }] (best first), best, decision }
 * decision: 'auto_apply' (confidence >= 0.95) | 'queue_for_verification' | 'no_match'
 *
 * Confidence bands per spec: exact reference/invoice-number match 0.98;
 * amount equals balance + payer name similarity 0.9; amount equals balance
 * or total only 0.6; a plausible partial payment scores lower and always
 * queues for a human to confirm.
 */
export function matchPayment(payment = {}, openInvoices = []) {
  const ref = normRef(payment.reference);
  const amtCents = payment.amount != null && payment.amount !== '' ? toCents(payment.amount) : null;
  const nameWords = normNameWords(payment.payer_name);

  const candidates = openInvoices.map(inv => {
    const balance = balanceOfInvoice(inv);
    const balCents = toCents(balance), totalCents = toCents(inv.total || 0);
    const invNumbers = [inv.number, inv.legacy_number, inv.reference].filter(Boolean).map(normRef);
    const refMatch = !!ref && invNumbers.some(n => n && (n === ref || n.includes(ref) || ref.includes(n)));
    const nameSim = nameSimilarity(nameWords, inv.client_name);
    const amountMatchesBalance = amtCents != null && balCents > 0 && amtCents === balCents;
    const amountMatchesTotal = amtCents != null && totalCents > 0 && amtCents === totalCents;
    const isPartial = amtCents != null && balCents > 0 && amtCents > 0 && amtCents < balCents;

    let confidence = 0; const reasons = [];
    if (refMatch) { confidence = 0.98; reasons.push('Reference matches the invoice number'); }
    else if (amountMatchesBalance && nameSim >= 0.5) { confidence = 0.9; reasons.push('Amount matches the balance and the payer name matches the client'); }
    else if (amountMatchesBalance || amountMatchesTotal) { confidence = 0.6; reasons.push(amountMatchesBalance ? 'Amount matches the outstanding balance' : 'Amount matches the invoice total'); }
    else if (isPartial) { confidence = Math.min(0.55, 0.3 + (amtCents / balCents) * 0.25); reasons.push('Amount looks like a partial payment on this invoice'); }
    if (nameSim >= 0.5 && confidence < 0.5) { confidence = Math.max(confidence, 0.4); reasons.push('Payer name matches the client'); }
    if (payment.date && inv.issue_date && payment.date >= inv.issue_date && confidence > 0) { confidence = Math.min(1, confidence + 0.01); reasons.push('Paid on or after the invoice date'); }

    return { invoice: inv, confidence: Math.round(Math.min(1, confidence) * 100) / 100, reasons, balance };
  }).filter(c => c.confidence > 0).sort((a, b) => b.confidence - a.confidence || b.balance - a.balance);

  const best = candidates[0] || null;
  const decision = best && best.confidence >= AUTO_APPLY_THRESHOLD ? 'auto_apply' : best ? 'queue_for_verification' : 'no_match';
  return { candidates, best, decision };
}
