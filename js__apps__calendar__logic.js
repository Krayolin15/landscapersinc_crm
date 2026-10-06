/* =============================================================================
   Calendar — pure logic (no DOM). Safe to import from Node tests.

     layoutColumns(events)              side-by-side column layout for overlapping
                                         same-day events (week/day time grid)
     exportEventsICS / exportOccurrencesICS   .ics text (RFC 5545, TZID Africa/Johannesburg)
     parseICS(text)                     .ics text -> plain event-shaped objects
     parseNaturalDate(text, todayIso)   "today" / "tomorrow" / weekday names /
                                         "next week" / "10 September" / "10/09" / "2026-09-10"
     parseNaturalTime(text)             "10", "10am", "14:00", "2:30pm" -> 'HH:MM'
     minutesReminderLabel(mins)         10 -> "10 minutes before", 1440 -> "1 day before"
   ========================================================================== */

import { iso, parse, addDays, startOfWeek, endOfWeek, dow, MONTHS, MONTHS_SHORT, monthIndex, today as todayFn } from '../../core/dates.js';

/* ---------------------------------------------------------------- overlap layout */

/**
 * layoutColumns([{ id, start, end }]) -> Map(id -> { col, cols })
 * start/end are comparable numbers (minutes-of-day, or any linear scale). Events
 * that overlap are packed into side-by-side columns; `cols` is the number of
 * columns needed by the whole overlap cluster the event belongs to (so unrelated
 * events elsewhere in the day still get the full width).
 */
export function layoutColumns(events) {
  const items = (events || [])
    .map(e => ({ id: e.id, start: Number(e.start), end: Math.max(Number(e.end), Number(e.start) + 1) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const clusters = [];
  let current = [], currentEnd = -Infinity;
  for (const e of items) {
    if (current.length && e.start >= currentEnd) { clusters.push(current); current = []; currentEnd = -Infinity; }
    current.push(e);
    currentEnd = Math.max(currentEnd, e.end);
  }
  if (current.length) clusters.push(current);

  const result = new Map();
  for (const cluster of clusters) {
    const colEnds = []; // colEnds[c] = end time of the last event placed in column c
    const placedCol = new Map();
    for (const e of cluster) {
      let col = colEnds.findIndex(end => end <= e.start);
      if (col === -1) { colEnds.push(e.end); col = colEnds.length - 1; }
      else colEnds[col] = e.end;
      placedCol.set(e.id, col);
    }
    const cols = colEnds.length;
    for (const e of cluster) result.set(e.id, { col: placedCol.get(e.id), cols });
  }
  return result;
}

/* ---------------------------------------------------------------- ICS: shared bits */

const TZID = 'Africa/Johannesburg';
const pad2 = n => String(n).padStart(2, '0');
const CRLF = '\r\n';

/** Fold a logical ICS line at 75 octets, continuation lines start with a space (RFC 5545 §3.1). */
function foldLine(line) {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75), rest = line.slice(75);
  while (rest.length) { out += CRLF + ' ' + rest.slice(0, 74); rest = rest.slice(74); }
  return out;
}
/** Undo line folding: a line beginning with a space or tab continues the previous one. */
function unfold(text) {
  const raw = String(text || '').split(/\r\n|\n|\r/);
  const out = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out.filter(l => l.length);
}
const escText = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const unescText = s => String(s == null ? '' : s).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

function icsDate(dateIso) { const [y, m, d] = dateIso.split('-'); return `${y}${m}${d}`; }
function icsDateTime(dateIso, hhmm) { const [h, mi] = (hhmm || '00:00').split(':'); return `${icsDate(dateIso)}T${pad2(+h)}${pad2(+mi)}00`; }

/** DTSTART/DTEND property for an all-day date or a local floating time (TZID=Africa/Johannesburg). */
function dtProp(name, dateIso, hhmm) {
  return hhmm ? `${name};TZID=${TZID}:${icsDateTime(dateIso, hhmm)}` : `${name};VALUE=DATE:${icsDate(dateIso)}`;
}

const RECURRENCE_TO_RRULE = {
  daily: 'FREQ=DAILY',
  weekdays: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
  weekly: 'FREQ=WEEKLY',
  fortnightly: 'FREQ=WEEKLY;INTERVAL=2',
  monthly: 'FREQ=MONTHLY',
  monthly_nth: null, // written specially below (needs the ordinal weekday)
  quarterly: 'FREQ=MONTHLY;INTERVAL=3',
  yearly: 'FREQ=YEARLY'
};
const NTH = ['', '1', '2', '3', '4', '5'];
const WD_CODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Our recurrence enum + until -> an RRULE value (without the "RRULE:" prefix), or null for 'none'. */
export function recurrenceToRRule(ev) {
  if (!ev || !ev.recurrence || ev.recurrence === 'none') return null;
  let base;
  if (ev.recurrence === 'monthly_nth') {
    const d = parse(ev.start_date);
    const n = Math.ceil(d.getDate() / 7);
    base = `FREQ=MONTHLY;BYDAY=${NTH[n]}${WD_CODE[d.getDay()]}`;
  } else base = RECURRENCE_TO_RRULE[ev.recurrence];
  if (!base) return null;
  return ev.recurrence_until ? `${base};UNTIL=${icsDate(ev.recurrence_until)}` : base;
}

/** RRULE value -> { recurrence, recurrence_until } (basic FREQ / INTERVAL / UNTIL, plus our own BYDAY shapes). */
export function rruleToRecurrence(rrule) {
  const parts = Object.fromEntries(String(rrule || '').split(';').filter(Boolean).map(p => { const i = p.indexOf('='); return [p.slice(0, i).toUpperCase(), p.slice(i + 1)]; }));
  const freq = parts.FREQ, interval = +(parts.INTERVAL || 1);
  let recurrence = 'none';
  if (freq === 'DAILY') recurrence = /^(MO,TU,WE,TH,FR|MO,TU,WE,TH,FR,)$/.test(parts.BYDAY || '') ? 'weekdays' : 'daily';
  else if (freq === 'WEEKLY') recurrence = interval >= 2 ? 'fortnightly' : 'weekly';
  else if (freq === 'MONTHLY') recurrence = /^\d[A-Z]{2}$/.test(parts.BYDAY || '') ? 'monthly_nth' : interval >= 3 ? 'quarterly' : 'monthly';
  else if (freq === 'YEARLY') recurrence = 'yearly';
  else return { recurrence: 'none', recurrence_until: null };
  let until = null;
  if (parts.UNTIL) { const m = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL); if (m) until = `${m[1]}-${m[2]}-${m[3]}`; }
  return { recurrence, recurrence_until: until };
}

/** One master event -> a VEVENT block (keeps its RRULE, so a recurring series stays one series). */
export function eventToVEVENT(ev, { now = new Date() } = {}) {
  const lines = ['BEGIN:VEVENT', `UID:${ev.id}@landscapersinc.hq`, `DTSTAMP:${icsDateTime(iso(now), `${pad2(now.getHours())}:${pad2(now.getMinutes())}`)}Z`];
  const hasTime = !ev.all_day && ev.start_time;
  lines.push(dtProp('DTSTART', ev.start_date, hasTime ? ev.start_time : null));
  const endDate = ev.end_date && ev.end_date > ev.start_date ? ev.end_date : ev.start_date;
  const endTime = hasTime ? (ev.end_time || ev.start_time) : null;
  lines.push(dtProp('DTEND', endTime ? endDate : addDays(endDate, 1), endTime));
  lines.push(`SUMMARY:${escText(ev.title || 'Untitled event')}`);
  if (ev.location) lines.push(`LOCATION:${escText(ev.location)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escText(ev.description)}`);
  const rrule = recurrenceToRRule(ev);
  if (rrule) lines.push(`RRULE:${rrule}`);
  for (const ex of (Array.isArray(ev.recurrence_exceptions) ? ev.recurrence_exceptions : [])) lines.push(dtProp('EXDATE', ex, hasTime ? ev.start_time : null));
  if (ev.status === 'cancelled') lines.push('STATUS:CANCELLED');
  if (ev.category) lines.push(`CATEGORIES:${escText(ev.category)}`);
  if (ev.created_by_name) lines.push(`ORGANIZER;CN=${escText(ev.created_by_name)}:mailto:noreply@landscapersinc.co.za`);
  lines.push('END:VEVENT');
  return lines.join(CRLF);
}

/** One expanded occurrence (no RRULE — a concrete instance, e.g. for "export what's on screen"). */
export function occurrenceToVEVENT(occ, { now = new Date() } = {}) {
  const ev = occ.event;
  const lines = ['BEGIN:VEVENT', `UID:${ev.id}_${occ.date}@landscapersinc.hq`, `DTSTAMP:${icsDateTime(iso(now), `${pad2(now.getHours())}:${pad2(now.getMinutes())}`)}Z`];
  const hasTime = !occ.all_day && occ.start_time;
  lines.push(dtProp('DTSTART', occ.date, hasTime ? occ.start_time : null));
  const endDate = occ.end_date && occ.end_date > occ.date ? occ.end_date : occ.date;
  const endTime = hasTime ? (occ.end_time || occ.start_time) : null;
  lines.push(dtProp('DTEND', endTime ? endDate : addDays(endDate, 1), endTime));
  lines.push(`SUMMARY:${escText(ev.title || 'Untitled event')}`);
  if (ev.location) lines.push(`LOCATION:${escText(ev.location)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escText(ev.description)}`);
  if (ev.category) lines.push(`CATEGORIES:${escText(ev.category)}`);
  lines.push('END:VEVENT');
  return lines.join(CRLF);
}

/** Wrap VEVENT blocks in a full VCALENDAR (with the Africa/Johannesburg VTIMEZONE). */
export function buildICS(veventBlocks, { calendarName = 'Landscapers Inc. HQ' } = {}) {
  const head = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Landscapers Inc. HQ//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escText(calendarName)}`, `X-WR-TIMEZONE:${TZID}`,
    'BEGIN:VTIMEZONE', `TZID:${TZID}`, 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0200', 'TZNAME:SAST', 'END:STANDARD', 'END:VTIMEZONE'
  ];
  const tail = ['END:VCALENDAR'];
  return [...head, ...veventBlocks, ...tail].map(foldLine).join(CRLF) + CRLF;
}

export function exportEventsICS(events, opts = {}) { return buildICS(events.map(ev => eventToVEVENT(ev)), opts); }
export function exportOccurrencesICS(occurrences, opts = {}) { return buildICS(occurrences.map(o => occurrenceToVEVENT(o)), opts); }

/* ---------------------------------------------------------------- ICS import */

function parseICSDateValue(value, params) {
  const isDate = /^\d{8}$/.test(value) || (params.VALUE || '').toUpperCase() === 'DATE';
  if (isDate) { const m = /^(\d{4})(\d{2})(\d{2})/.exec(value); return { date: m ? `${m[1]}-${m[2]}-${m[3]}` : '', time: null }; }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!m) return { date: '', time: null };
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}
function splitProp(line) {
  const c = line.indexOf(':');
  if (c < 0) return null;
  const head = line.slice(0, c), value = line.slice(c + 1);
  const [name, ...paramParts] = head.split(';');
  const params = {};
  for (const p of paramParts) { const i = p.indexOf('='); if (i > 0) params[p.slice(0, i).toUpperCase()] = p.slice(i + 1); }
  return { name: name.toUpperCase(), params, value };
}

/** Parse .ics text -> [{ uid, title, description, location, start_date, start_time, end_date, end_time, all_day, recurrence, recurrence_until, status }] */
export function parseICS(text) {
  const lines = unfold(text);
  const out = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') { cur = { title: '', description: '', location: '', all_day: true }; continue; }
    if (line === 'END:VEVENT') { if (cur) out.push(finishEvent(cur)); cur = null; continue; }
    if (!cur) continue;
    const p = splitProp(line);
    if (!p) continue;
    switch (p.name) {
      case 'UID': cur.uid = p.value; break;
      case 'SUMMARY': cur.title = unescText(p.value); break;
      case 'LOCATION': cur.location = unescText(p.value); break;
      case 'DESCRIPTION': cur.description = unescText(p.value); break;
      case 'STATUS': cur.status = p.value.toLowerCase() === 'cancelled' ? 'cancelled' : 'confirmed'; break;
      case 'CATEGORIES': cur.category = unescText(p.value).split(',')[0]; break;
      case 'DTSTART': { const d = parseICSDateValue(p.value, p.params); cur.start_date = d.date; cur.start_time = d.time; if (d.time) cur.all_day = false; break; }
      case 'DTEND': { const d = parseICSDateValue(p.value, p.params); cur._end_date = d.date; cur._end_time = d.time; break; }
      case 'RRULE': Object.assign(cur, rruleToRecurrence(p.value)); break;
      default: break;
    }
  }
  return out;
}
function finishEvent(cur) {
  let end_date = cur._end_date || cur.start_date;
  let end_time = cur._end_time || null;
  if (cur.all_day && end_date && end_date > cur.start_date) end_date = addDays(end_date, -1); // DTEND is exclusive for all-day
  return {
    uid: cur.uid || null, title: cur.title || 'Untitled event', description: cur.description || '', location: cur.location || '',
    start_date: cur.start_date, start_time: cur.all_day ? null : cur.start_time, end_date, end_time: cur.all_day ? null : end_time,
    all_day: cur.all_day, recurrence: cur.recurrence || 'none', recurrence_until: cur.recurrence_until || null,
    status: cur.status || 'confirmed', category: cur.category || null
  };
}

/* ---------------------------------------------------------------- natural language dates */

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function weekdayIndex(word) {
  const w = word.toLowerCase();
  let i = WEEKDAY_NAMES.indexOf(w);
  if (i === -1) i = WEEKDAY_SHORT.indexOf(w.slice(0, 3));
  return i;
}

/** "10", "10am", "10:30", "2:30pm", "14:00", "at 10" -> 'HH:MM' | null */
export function parseNaturalTime(text) {
  const m = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(String(text || ''));
  if (!m) return null;
  let h = +m[1], mi = +(m[2] || 0);
  const ap = m[3] ? m[3].toLowerCase() : null;
  if (h > 24 || mi > 59) return null;
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (!ap && h <= 7 && !m[2]) return null; // a bare small number ("2") is too ambiguous without am/pm/minutes/context
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/**
 * parseNaturalDate(text, todayIso) -> { date, to, time, label } | null
 * date/to mark an inclusive range (date === to for a single day). `time` is the
 * 'HH:MM' mentioned in the text, if any (e.g. "Friday at 10").
 */
export function parseNaturalDate(text, todayIso = todayFn()) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase();
  const time = parseNaturalTime(t);

  if (/\btoday\b/.test(t)) return { date: todayIso, to: todayIso, time, label: 'today' };
  if (/\btomorrow\b/.test(t)) { const d = addDays(todayIso, 1); return { date: d, to: d, time, label: 'tomorrow' }; }
  if (/\byesterday\b/.test(t)) { const d = addDays(todayIso, -1); return { date: d, to: d, time, label: 'yesterday' }; }
  if (/\bnext week\b/.test(t)) { const from = addDays(startOfWeek(todayIso), 7); return { date: from, to: addDays(from, 6), time, label: 'next week' }; }
  if (/\bthis week\b/.test(t)) return { date: startOfWeek(todayIso), to: endOfWeek(todayIso), time, label: 'this week' };

  const nextWd = /\bnext\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(t);
  if (nextWd) {
    const wi = weekdayIndex(nextWd[1]);
    let d = todayIso;
    do { d = addDays(d, 1); } while (dow(d) !== wi);
    d = addDays(d, 7);
    return { date: d, to: d, time, label: raw.trim() };
  }
  const wd = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(t);
  if (wd) {
    const wi = weekdayIndex(wd[1]);
    let d = todayIso;
    while (dow(d) !== wi) d = addDays(d, 1);
    return { date: d, to: d, time, label: raw.trim() };
  }

  // 2026-09-10
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (m) { const d = `${m[1]}-${m[2]}-${m[3]}`; return { date: d, to: d, time, label: d }; }
  // 10 September / 10 Sep 2026
  m = /\b(\d{1,2})\s+([a-z]+)\.?\s*(\d{4})?\b/.exec(t);
  if (m && monthIndex(m[2]) >= 0) {
    const day = +m[1], mi = monthIndex(m[2]);
    const d = rollYear(day, mi, m[3] ? +m[3] : null, todayIso);
    return { date: d, to: d, time, label: raw.trim() };
  }
  // September 10 / Sep 10, 2026
  m = /\b([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b/.exec(t);
  if (m && monthIndex(m[1]) >= 0) {
    const mi = monthIndex(m[1]), day = +m[2];
    const d = rollYear(day, mi, m[3] ? +m[3] : null, todayIso);
    return { date: d, to: d, time, label: raw.trim() };
  }
  // 10/09 or 10/09/2026 (SA: DD/MM[/YYYY])
  m = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}))?\b/.exec(t);
  if (m) {
    const day = +m[1], mo = +m[2] - 1;
    if (mo >= 0 && mo <= 11 && day >= 1 && day <= 31) { const d = rollYear(day, mo, m[3] ? +m[3] : null, todayIso); return { date: d, to: d, time, label: raw.trim() }; }
  }
  return null;
}
/** Day+month with no year given -> this year, unless that date already passed, then next year. */
function rollYear(day, monthIdx, year, todayIso) {
  const y0 = year || +todayIso.slice(0, 4);
  let d = iso(new Date(y0, monthIdx, day));
  if (!year && d < todayIso) d = iso(new Date(y0 + 1, monthIdx, day));
  return d;
}

/* ---------------------------------------------------------------- reminders */

/** 10 -> "10 minutes before", 60 -> "1 hour before", 1440 -> "1 day before", 10080 -> "1 week before" */
export function minutesReminderLabel(mins) {
  const n = Number(mins);
  if (!isFinite(n) || n <= 0) return 'At the time of the event';
  if (n % 10080 === 0) return `${n / 10080} week${n / 10080 === 1 ? '' : 's'} before`;
  if (n % 1440 === 0) return `${n / 1440} day${n / 1440 === 1 ? '' : 's'} before`;
  if (n % 60 === 0) return `${n / 60} hour${n / 60 === 1 ? '' : 's'} before`;
  return `${n} minute${n === 1 ? '' : 's'} before`;
}
export const REMINDER_PRESETS = [10, 30, 60, 1440, 10080];

/* ---------------------------------------------------------------- year-view heat */

/** Bucket an event count into a 0–4 "busy-ness" heat level relative to the busiest day in the range. */
export function heatLevel(count, max) {
  if (!count) return 0;
  const ratio = count / Math.max(1, max);
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}
