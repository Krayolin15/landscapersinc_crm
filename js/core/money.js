/* =============================================================================
   Money — every calculation is done in integer cents so totals are exact.
   Floating point never touches a financial total.
   ========================================================================== */

import { CONFIG } from '../config.js';

/** Normalise anything money-like to a JS number: 1234.5, "R1 234,50", "R9000.00", "(150.00)", "-R50" */
export function parseMoney(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/ZAR|[Rr]|\s| /g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  // "1.234,56" or "1234,56" -> comma decimal; "1,234.56" -> comma grouping
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return neg ? -n : n;
}
/** Integer cents, rounded half away from zero. */
export function toCents(v) {
  const n = parseMoney(v);
  return Math.round(n * 100 + (n >= 0 ? 1e-9 : -1e-9));
}
export const fromCents = c => Math.round(c) / 100;
/** Round a rand amount to 2 decimals using exact cents (half away from zero). */
export const round2 = v => fromCents(toCents(v));

export function sum(values) { return fromCents(values.reduce((a, v) => a + toCents(v), 0)); }
export function sumBy(rows, key) { return fromCents(rows.reduce((a, r) => a + toCents(typeof key === 'function' ? key(r) : r[key]), 0)); }
export function add(...v) { return sum(v); }
export function sub(a, b) { return fromCents(toCents(a) - toCents(b)); }
/** Parse to micro-rand (6 decimals) so unrounded per-visit rates like R630.315 stay exact. */
function toMicros(v) {
  const n = parseMoney(v);
  return Math.round(n * 1e6);
}
/**
 * qty × unit price (less discount %), rounded to cents ONCE at the end.
 * Keeps the verified rule from the original CRM: 4 × R630.315 = R2,521.26 (not R2,521.28).
 */
export function lineTotal(qty, unitPrice, discountPct = 0) {
  const grossMicros = Number(qty || 0) * toMicros(unitPrice);
  const netMicros = grossMicros * (1 - (Number(discountPct || 0) / 100));
  const cents = netMicros / 1e4;
  return fromCents(Math.round(cents + (cents >= 0 ? 1e-7 : -1e-7)));
}
export function pct(part, whole) { return whole ? (Number(part) / Number(whole)) * 100 : 0; }

/** VAT on a net amount. rate defaults to CONFIG.vatRate (15%). */
export function vatOn(net, rate = CONFIG.vatRate) { return fromCents(Math.round(toCents(net) * rate)); }
export function vatInclusive(gross, rate = CONFIG.vatRate) {
  const g = toCents(gross);
  const net = Math.round(g / (1 + rate));
  return { net: fromCents(net), vat: fromCents(g - net), gross: fromCents(g) };
}

/**
 * Totals for a document (quote / invoice).
 * lines: [{qty, unit_price, discount_pct}]
 * opts: { vatRegistered, vatRate, docDiscount (rand) }
 */
export function documentTotals(lines, { vatRegistered = false, vatRate = CONFIG.vatRate, docDiscount = 0 } = {}) {
  const subtotalC = lines.reduce((a, l) => a + toCents(lineTotal(l.qty ?? 1, l.unit_price ?? 0, l.discount_pct ?? 0)), 0);
  const discC = toCents(docDiscount);
  const netC = subtotalC - discC;
  const vatC = vatRegistered ? Math.round(netC * vatRate) : 0;
  return { subtotal: fromCents(subtotalC), discount: fromCents(discC), net: fromCents(netC), vat: fromCents(vatC), total: fromCents(netC + vatC) };
}

/** Split an amount into n parts that add back up exactly (e.g. instalments). */
export function allocate(amount, n) {
  const c = toCents(amount), base = Math.floor(c / n), rem = c - base * n;
  return Array.from({ length: n }, (_, i) => fromCents(base + (i < rem ? 1 : 0)));
}

// Intl number formatters are slow to build: one per locale + decimals, reused for every number shown
const NUM_FMT = new Map();
/** A cached Intl.NumberFormat with fixed decimals (e.g. numberFormat('en-US', 2).format(1234.5) → "1,234.50"). */
export function numberFormat(locale, decimals) {
  const k = `${locale}|${decimals}`;
  let f = NUM_FMT.get(k);
  if (!f) { f = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); NUM_FMT.set(k, f); }
  return f;
}
export function formatMoney(v, { style = CONFIG.moneyStyle, decimals = 2, sign = false, compact = false } = {}) {
  if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return '—';
  const c = typeof v === 'number' ? toCents(v) : toCents(v);
  const neg = c < 0;
  const abs = Math.abs(c) / 100;
  let body;
  if (compact && abs >= 1000) {
    const units = [[1e9, 'bn'], [1e6, 'm'], [1e3, 'k']];
    const [div, suf] = units.find(([d]) => abs >= d);
    body = (abs / div).toFixed(abs / div >= 100 ? 0 : 1).replace(/\.0$/, '') + suf;
  } else if (style === 'sans') {
    body = numberFormat('en-ZA', decimals).format(abs);
  } else {
    body = numberFormat('en-US', decimals).format(abs);
  }
  const r = style === 'sans' ? 'R ' : 'R';
  return (neg ? '-' : sign && c > 0 ? '+' : '') + r + body;
}
