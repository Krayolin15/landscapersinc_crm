/* =============================================================================
   Recurring events -> concrete occurrences in a date window.
   occurrences(event, fromIso, toIso) -> [{ date, end_date, start_time, end_time, event, key }]
   Supports: none, daily, weekdays, weekly, fortnightly, monthly (same day),
   monthly_nth (e.g. 2nd Tuesday), quarterly, yearly; `recurrence_until`;
   `recurrence_exceptions` (array of skipped ISO dates).
   ========================================================================== */

import { addDays, addMonths, diffDays, dow, parse, iso } from './dates.js';

const MAX = 1000;

function nthOfMonth(dateIso) { const d = parse(dateIso); return { n: Math.ceil(d.getDate() / 7), wd: d.getDay() }; }
function nthWeekdayIn(year, month, n, wd) {
  const first = new Date(year, month, 1);
  const offset = (wd - first.getDay() + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  const d = new Date(year, month, day);
  return d.getMonth() === month ? iso(d) : null; // e.g. no 5th Tuesday
}

export function occurrences(ev, from, to) {
  if (!ev || !ev.start_date || ev.deleted_at || ev.status === 'cancelled') return [];
  const start = ev.start_date;
  const span = ev.end_date && ev.end_date > start ? diffDays(start, ev.end_date) : 0;
  const rule = ev.recurrence || 'none';
  const until = ev.recurrence_until && ev.recurrence_until < to ? ev.recurrence_until : to;
  const skip = new Set(Array.isArray(ev.recurrence_exceptions) ? ev.recurrence_exceptions : []);
  const out = [];
  const push = d => {
    const endD = span ? addDays(d, span) : d;
    if (endD >= from && d <= to && !skip.has(d)) out.push({ date: d, end_date: endD, start_time: ev.start_time || null, end_time: ev.end_time || null, all_day: !!ev.all_day || !ev.start_time, event: ev, key: `${ev.id}|${d}` });
  };
  if (rule === 'none') { push(start); return out; }

  let i = 0;
  if (rule === 'monthly_nth') {
    const { n, wd } = nthOfMonth(start);
    const s = parse(start);
    for (let m = 0; i < MAX; m++, i++) {
      const y = s.getFullYear() + Math.floor((s.getMonth() + m) / 12), mo = (s.getMonth() + m) % 12;
      const d = nthWeekdayIn(y, mo, n, wd);
      if (!d) continue;
      if (d > until) break;
      if (d >= start) push(d);
    }
    return out;
  }
  let d = start;
  // jump close to the window for long-running daily/weekly series
  if ((rule === 'daily' || rule === 'weekly' || rule === 'fortnightly') && from > start) {
    const step = rule === 'daily' ? 1 : rule === 'weekly' ? 7 : 14;
    const k = Math.max(0, Math.floor((diffDays(start, from) - span) / step) - 1);
    d = addDays(start, k * step);
  }
  while (d <= until && i++ < MAX * 5) {
    if (rule !== 'weekdays' || (dow(d) !== 0 && dow(d) !== 6)) push(d);
    switch (rule) {
      case 'daily': case 'weekdays': d = addDays(d, 1); break;
      case 'weekly': d = addDays(d, 7); break;
      case 'fortnightly': d = addDays(d, 14); break;
      case 'monthly': { const n = Math.round(diffMonthsSafe(start, d)) + 1; d = addMonths(start, n); break; }
      case 'quarterly': { const n = Math.round(diffMonthsSafe(start, d)) + 3; d = addMonths(start, n); break; }
      case 'yearly': { const n = Math.round(diffMonthsSafe(start, d)) + 12; d = addMonths(start, n); break; }
      default: return out;
    }
  }
  return out;
}
function diffMonthsSafe(a, b) { const A = parse(a), B = parse(b); return (B.getFullYear() - A.getFullYear()) * 12 + (B.getMonth() - A.getMonth()); }

/** All occurrences of many events in a window, sorted by date then time. */
export function expand(events, from, to) {
  return events.flatMap(e => occurrences(e, from, to)).sort((a, b) => (a.date + (a.start_time || '')).localeCompare(b.date + (b.start_time || '')));
}

/** Human description: "Every 2 weeks on Tuesday until 30 Nov 2026" */
export function describe(ev) {
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const r = ev.recurrence || 'none';
  const wd = DAYS[dow(ev.start_date)];
  const base = {
    none: '', daily: 'Every day', weekdays: 'Every weekday (Mon–Fri)', weekly: `Weekly on ${wd}`, fortnightly: `Every 2 weeks on ${wd}`,
    monthly: `Monthly on day ${parse(ev.start_date).getDate()}`, monthly_nth: (() => { const { n } = nthOfMonth(ev.start_date); return `Monthly on the ${['1st', '2nd', '3rd', '4th', '5th'][n - 1]} ${wd}`; })(),
    quarterly: 'Every 3 months', yearly: 'Every year'
  }[r] || '';
  return base && ev.recurrence_until ? `${base} until ${ev.recurrence_until}` : base;
}
