/* =============================================================================
   South African holidays and observances.

   PUBLIC HOLIDAYS — Public Holidays Act 36 of 1994. The 12 statutory days are
   computed exactly for any year, including Good Friday and Family Day from the
   Gregorian Easter date, and section 2(1): "Whenever any public holiday falls
   on a Sunday, the Monday following on it shall be a public holiday."
   Once-off days declared by the President (e.g. election days) are added by an
   admin in Calendar → Holidays and stored in the `holidays` collection.

   OBSERVANCES — not paid public holidays, but useful for planning:
   Mother's/Father's Day, Mandela Day, Spring Day, Arbor Week (a big one for a
   landscaping company) and major religious festivals observed widely in
   Durban. Lunar festivals (Diwali, Eid) are published tables and can shift
   by a day with moon sighting — they are marked `approximate`.
   ========================================================================== */

import { iso, addDays, dow } from './dates.js';

/** Gregorian Easter Sunday (Meeus/Jones/Butcher algorithm). */
export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(new Date(year, month - 1, day));
}

const FIXED = [
  ['01-01', "New Year's Day"],
  ['03-21', 'Human Rights Day'],
  ['04-27', 'Freedom Day'],
  ['05-01', "Workers' Day"],
  ['06-16', 'Youth Day'],
  ['08-09', "National Women's Day"],
  ['09-24', 'Heritage Day'],
  ['12-16', 'Day of Reconciliation'],
  ['12-25', 'Christmas Day'],
  ['12-26', 'Day of Goodwill']
];

/** Statutory public holidays for a year, with Sunday → Monday observance. */
export function publicHolidays(year) {
  const easter = easterSunday(year);
  const list = FIXED.map(([md, name]) => ({ date: `${year}-${md}`, name }));
  list.push({ date: addDays(easter, -2), name: 'Good Friday' });
  list.push({ date: addDays(easter, 1), name: 'Family Day' });
  const out = [];
  const taken = new Set(list.map(h => h.date));
  for (const h of list.sort((a, b) => a.date.localeCompare(b.date))) {
    out.push({ ...h, type: 'public', observed: false });
    if (dow(h.date) === 0) {
      let obs = addDays(h.date, 1);
      while (taken.has(obs)) obs = addDays(obs, 1);
      taken.add(obs);
      out.push({ date: obs, name: `${h.name} (observed)`, type: 'public', observed: true, of: h.date });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function nthWeekday(year, month, weekday, n) {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return iso(new Date(year, month, 1 + offset + (n - 1) * 7));
}

// Published dates (South Africa). Lunar festivals may move by a day with moon sighting.
const DIWALI = { 2024: '2024-10-31', 2025: '2025-10-20', 2026: '2026-11-08', 2027: '2027-10-29', 2028: '2028-10-17', 2029: '2029-11-05', 2030: '2030-10-26' };
const EID_FITR = { 2024: '2024-04-10', 2025: '2025-03-31', 2026: '2026-03-20', 2027: '2027-03-10', 2028: '2028-02-27', 2029: '2029-02-15', 2030: '2030-02-05' };
const EID_ADHA = { 2024: '2024-06-17', 2025: '2025-06-07', 2026: '2026-05-27', 2027: '2027-05-17', 2028: '2028-05-05', 2029: '2029-04-24', 2030: '2030-04-14' };

/** Observances (not public holidays). */
export function observances(year) {
  const easter = easterSunday(year);
  const list = [
    { date: `${year}-02-14`, name: "Valentine's Day" },
    { date: nthWeekday(year, 4, 0, 2), name: "Mother's Day" },
    { date: nthWeekday(year, 5, 0, 3), name: "Father's Day" },
    { date: `${year}-07-18`, name: 'Nelson Mandela International Day' },
    { date: `${year}-09-01`, name: 'Spring Day' },
    { date: `${year}-09-01`, end: `${year}-09-07`, name: 'Arbor Week' },
    { date: `${year}-12-24`, name: 'Christmas Eve' },
    { date: `${year}-12-31`, name: "New Year's Eve" },
    { date: addDays(easter, -46), name: 'Ash Wednesday' },
    { date: easter, name: 'Easter Sunday' }
  ];
  if (DIWALI[year]) list.push({ date: DIWALI[year], name: 'Diwali', approximate: true });
  if (EID_FITR[year]) list.push({ date: EID_FITR[year], name: 'Eid al-Fitr', approximate: true });
  if (EID_ADHA[year]) list.push({ date: EID_ADHA[year], name: 'Eid al-Adha', approximate: true });
  return list.map(o => ({ ...o, type: 'observance' })).sort((a, b) => a.date.localeCompare(b.date));
}

const cache = new Map();
let customHolidays = []; // [{date, name, type:'public'|'company'|'observance'}] from the holidays collection

export function setCustomHolidays(list) { customHolidays = Array.isArray(list) ? list : []; cache.clear(); }

/** All holidays + observances for a year, custom ones included. */
export function holidaysForYear(year) {
  if (!cache.has(year)) {
    const custom = customHolidays.filter(h => String(h.date).startsWith(String(year))).map(h => ({ ...h, type: h.type || 'company', custom: true }));
    cache.set(year, [...publicHolidays(year), ...observances(year), ...custom].sort((a, b) => a.date.localeCompare(b.date)));
  }
  return cache.get(year);
}

/** Holidays touching a date range (inclusive). */
export function holidaysBetween(a, b) {
  const y1 = +String(a).slice(0, 4), y2 = +String(b).slice(0, 4);
  const out = [];
  for (let y = y1; y <= y2; y++) out.push(...holidaysForYear(y));
  return out.filter(h => (h.end || h.date) >= a && h.date <= b);
}

export function holidayOn(dateIso) {
  return holidaysForYear(+dateIso.slice(0, 4)).filter(h => h.date === dateIso || (h.end && dateIso >= h.date && dateIso <= h.end));
}
export function isPublicHoliday(dateIso) { return holidayOn(dateIso).some(h => h.type === 'public'); }
/** Mon–Fri and not a public holiday. */
export function isWorkingDay(dateIso) { const d = dow(dateIso); return d !== 0 && d !== 6 && !isPublicHoliday(dateIso); }
export function nextWorkingDay(dateIso, n = 1) { let d = dateIso, c = 0; while (c < n) { d = addDays(d, 1); if (isWorkingDay(d)) c++; } return d; }
export function workingDaysBetween(a, b) { let c = 0, d = a; while (d <= b) { if (isWorkingDay(d)) c++; d = addDays(d, 1); } return c; }
