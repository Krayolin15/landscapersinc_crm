/* =============================================================================
   Quote & invoice maths — pure (no database, no DOM), so the PDF layout and the
   tests can use it directly. _biz.js re-exports these for the apps.
   ========================================================================== */

import { documentTotals, sub, lineTotal } from '../core/money.js';

/** Lines as stored: trimmed descriptions, numbers, the amount worked out to the cent. Blank lines are dropped. */
export function cleanLines(lines) {
  return (Array.isArray(lines) ? lines : []).filter(l => l && (String(l.description || '').trim() || Number(l.unit_price))).map(l => ({
    description: String(l.description || '').trim(), qty: l.qty === '' || l.qty == null ? 1 : Number(l.qty),
    unit_price: Number(l.unit_price) || 0, discount_pct: Number(l.discount_pct) || 0,
    amount: lineTotal(l.qty === '' || l.qty == null ? 1 : Number(l.qty), Number(l.unit_price) || 0, Number(l.discount_pct) || 0),
    ...(l.service_id ? { service_id: l.service_id } : {})
  }));
}
export function totalsOf(doc) {
  return documentTotals(cleanLines(doc.lines), { vatRegistered: !!doc.vat_applied, docDiscount: doc.discount || 0 });
}
/** Recalculates stored subtotal / vat / total from the lines (not for legacy overrides). */
export function withTotals(doc) {
  if (doc.total_override_reason) return doc;
  const lines = cleanLines(doc.lines);
  if (!lines.length) return doc;
  const t = documentTotals(lines, { vatRegistered: !!doc.vat_applied, docDiscount: doc.discount || 0 });
  return { ...doc, lines, subtotal: t.subtotal, vat: t.vat, total: t.total };
}
export const balanceOf = inv => (inv.status === 'void' || inv.kind === 'credit_note' ? 0 : Math.max(0, sub(inv.total || 0, inv.amount_paid || 0)));
/** The figures a printed document shows: legacy invoices keep their printed totals exactly. */
export function printedTotals(rec) {
  return rec.total_override_reason ? { subtotal: rec.subtotal ?? rec.total, discount: rec.discount || 0, vat: rec.vat || 0, total: rec.total } : totalsOf(rec);
}
