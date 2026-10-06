/* =============================================================================
   Dates. All-day values are 'YYYY-MM-DD' strings in South African time
   (Africa/Johannesburg, UTC+2, no daylight saving). Timed values are full
   ISO strings. Weeks start on Monday.
   ========================================================================== */

const pad = n => String(n).padStart(2, '0');
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map(m => m.slice(0, 3));
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAYS_SHORT = DAYS.map(d => d.slice(0, 3));

/** Date object -> 'YYYY-MM-DD' using the date's local calendar day. */
export function iso(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** 'YYYY-MM-DD' (or ISO datetime) -> Date at local midnight (or exact time). */
export function parse(v) {
  if (v instanceof Date) return new Date(v.getTime());
  if (v == null || v === '') return null;
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
export const isValidISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && iso(parse(s)) === s;
// today() is called once per record in many lists and badges: it is worked out at most once per second
// (SA midnight falls on a whole second, so the answer is always the same as computing it fresh)
let todaySecond = -1, todayValue = '';
export function today() {
  const s = Math.floor(Date.now() / 1000);
  if (s !== todaySecond) { todaySecond = s; todayValue = iso(nowSA()); }
  return todayValue;
}
/** The South African calendar day of a stored UTC timestamp ("2026-09-29T23:30:00Z" → "2026-09-30"). SA has no daylight saving. */
export const sastDay = ts => { const t = Date.parse(ts); return Number.isFinite(t) ? new Date(t + 2 * 3600e3).toISOString().slice(0, 10) : String(ts || '').slice(0, 10); };
// building an Intl formatter is slow (~0.1–0.3 ms each): make it once
let SA_FMT = null;
try { SA_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); } catch { SA_FMT = null; }
/** Current wall-clock time in South Africa as a Date whose local fields read SA time. */
export function nowSA() {
  const now = new Date();
  if (!SA_FMT) return now;
  try {
    const parts = SA_FMT.formatToParts(now);
    const g = t => +parts.find(p => p.type === t).value;
    return new Date(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  } catch { return now; }
}
export function addDays(v, n) { const d = parse(v); d.setDate(d.getDate() + n); return typeof v === 'string' && v.length === 10 ? iso(d) : d; }
export function addMonths(v, n) {
  const d = parse(v); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  return typeof v === 'string' && v.length === 10 ? iso(d) : d;
}
export function addYears(v, n) { return addMonths(v, n * 12); }
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
/** Whole days from a to b (b - a), ignoring time of day. */
export function diffDays(a, b) {
  const A = parse(iso(parse(a))), B = parse(iso(parse(b)));
  return Math.round((B - A) / 86400000);
}
export function diffMonths(a, b) { const A = parse(a), B = parse(b); return (B.getFullYear() - A.getFullYear()) * 12 + (B.getMonth() - A.getMonth()); }
export function dow(v) { return parse(v).getDay(); }
export const isWeekend = v => [0, 6].includes(dow(v));
export function startOfWeek(v, weekStartsOn = 1) { const d = parse(v); const diff = (d.getDay() - weekStartsOn + 7) % 7; d.setDate(d.getDate() - diff); return iso(d); }
export function endOfWeek(v, weekStartsOn = 1) { return addDays(startOfWeek(v, weekStartsOn), 6); }
export function startOfMonth(v) { const d = parse(v); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); }
export function endOfMonth(v) { const d = parse(v); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
export function startOfYear(v) { return `${parse(v).getFullYear()}-01-01`; }
export function endOfYear(v) { return `${parse(v).getFullYear()}-12-31`; }
export const ym = v => iso(v).slice(0, 7);
export function monthLabel(ymStr, short = false) { const [y, m] = ymStr.split('-').map(Number); return `${(short ? MONTHS_SHORT : MONTHS)[m - 1]} ${y}`; }
export function range(a, b) { const out = []; let d = iso(parse(a)); const end = iso(parse(b)); while (d <= end) { out.push(d); d = addDays(d, 1); } return out; }
export const between = (v, a, b) => { const s = iso(v); return s >= iso(a) && s <= iso(b); };
export const sameDay = (a, b) => iso(parse(a)) === iso(parse(b));
/** 6×7 grid of ISO dates covering the month (Monday-first). */
export function monthGrid(year, month) {
  const first = iso(new Date(year, month, 1));
  const start = startOfWeek(first, 1);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
/** ISO week number (Monday-based). */
export function isoWeek(v) {
  const d = parse(v); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
/** Combine 'YYYY-MM-DD' and 'HH:MM' into a Date. */
export function at(dateIso, hhmm = '00:00') { const d = parse(dateIso); const [h, m] = String(hhmm || '00:00').split(':').map(Number); d.setHours(h || 0, m || 0, 0, 0); return d; }
export function hhmm(d) { d = parse(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function minutesOfDay(d) { d = parse(d); return d.getHours() * 60 + d.getMinutes(); }
/** Age in whole years on a given date. */
export function age(birth, on = today()) { const b = parse(birth), o = parse(on); let a = o.getFullYear() - b.getFullYear(); if (o.getMonth() < b.getMonth() || (o.getMonth() === b.getMonth() && o.getDate() < b.getDate())) a--; return a; }

/** Parse the many date formats found in the company's documents. Returns 'YYYY-MM-DD' or ''. */
export function parseLoose(s) {
  if (!s) return '';
  if (s instanceof Date) return iso(s);
  const t = String(s).trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
  let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t))) return iso(new Date(+m[1], +m[2] - 1, +m[3]));
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t))) return iso(new Date(+m[3], +m[2] - 1, +m[1])); // SA: DD/MM/YYYY
  if ((m = /^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(t))) { const mi = monthIndex(m[2]); if (mi >= 0) return iso(new Date(+m[3], mi, +m[1])); }
  if ((m = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t))) { const mi = monthIndex(m[1]); if (mi >= 0) return iso(new Date(+m[3], mi, +m[2])); }
  return '';
}
export function monthIndex(name) { const n = String(name).slice(0, 3).toLowerCase(); return MONTHS_SHORT.findIndex(m => m.toLowerCase() === n); }
