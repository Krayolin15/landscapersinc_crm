/* =============================================================================
   Calendar — data selection. Turns `events` + registered calendar sources into
   the flat list of items every view (day/week/month/year/agenda) renders,
   respecting "My calendars" / "Other sources" visibility and event privacy.
   ========================================================================== */

import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { expand } from '../../core/recurrence.js';
import { calendarSources, derivedItems } from '../../core/calendar-sources.js';
import { isPublicHoliday, isWorkingDay } from '../../core/holidays.js';
import { EVENT_CATEGORIES } from '../../schema/workspace.js';
import { isCalendarVisible, isSourceEnabled, UNASSIGNED_ID } from './prefs.js';

const me = () => store.get('user');
export const CATEGORY_COLOR = Object.fromEntries(EVENT_CATEGORIES.map(c => [c.value, c.color]));
export const categoryColor = cat => CATEGORY_COLOR[cat] || '#5fa83b';

export function getCalendars() { return db.all('calendars').sort((a, b) => a.name.localeCompare(b.name)); }
export function hasUnassignedEvents() { return db.all('events').some(e => !e.calendar_id); }

/** A calendar record's own colour, or the category's colour when the event has none of its own. */
export function eventColor(ev) {
  if (ev.color) return ev.color;
  const cal = ev.calendar_id && db.get('calendars', ev.calendar_id);
  if (cal && cal.color) return cal.color;
  return categoryColor(ev.category);
}

function myId() { return (me() || {}).id; }
export function canSeeEvent(ev) {
  if (ev.visibility !== 'private') return true;
  const u = me(); if (!u) return false;
  return ev.created_by === u.id || (Array.isArray(ev.attendees) && ev.attendees.includes(u.id));
}
function passesCalendarFilter(ev) {
  const id = ev.calendar_id || UNASSIGNED_ID;
  if (id === UNASSIGNED_ID) return isCalendarVisible(UNASSIGNED_ID, true);
  const cal = db.get('calendars', id);
  return isCalendarVisible(id, !cal || cal.visible_by_default !== false);
}
function matchesSearch(ev, q) {
  if (!q) return true;
  const hay = `${ev.title} ${ev.location || ''} ${ev.description || ''} ${ev.created_by_name || ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.includes(t));
}

/**
 * Expanded event occurrences in [from, to], respecting calendar visibility,
 * privacy and an optional free-text filter. Cancelled events are excluded.
 */
export function eventOccurrences(from, to, { search = '' } = {}) {
  const events = db.all('events').filter(ev => ev.status !== 'cancelled' && canSeeEvent(ev) && passesCalendarFilter(ev) && matchesSearch(ev, search));
  return expand(events, from, to);
}

/** Derived items (SA holidays + whatever other apps register) in [from, to], respecting the "Other sources" toggles. */
export function sourceItems(from, to) {
  const enabled = calendarSources().filter(s => isSourceEnabled(s.id, s.defaultOn !== false)).map(s => s.id);
  return derivedItems(from, to, enabled);
}
export function allSources() { return calendarSources(); }

/** Public-holiday derived items only (used to tint day cells and show all-day banners). */
export function holidayBanners(from, to) {
  return sourceItems(from, to).filter(it => it.source === 'sa-holidays');
}

/** Other events in [from,to] sharing an attendee with `rec`, overlapping its time (for the "this clashes" warning). */
export function attendeeConflicts(rec, excludeId) {
  if (!rec.start_date) return [];
  const people = new Set([...(rec.attendees || []), rec.created_by || myId()].filter(Boolean));
  if (!people.size) return [];
  const to = rec.end_date && rec.end_date > rec.start_date ? rec.end_date : rec.start_date;
  const others = db.all('events').filter(ev => ev.id !== excludeId && ev.status !== 'cancelled' && (ev.attendees || []).concat(ev.created_by).some(p => people.has(p)));
  const occs = expand(others, rec.start_date, to);
  const s1 = rec.start_time || '00:00', e1 = rec.end_time || (rec.all_day ? '23:59' : rec.start_time ? addHour(rec.start_time) : '23:59');
  return occs.filter(o => {
    if (o.date > to || o.end_date < rec.start_date) return false;
    if (rec.all_day || o.all_day) return true; // date overlap is enough when either side is all-day
    const s2 = o.start_time || '00:00', e2 = o.end_time || addHour(s2);
    return s1 < e2 && s2 < e1;
  });
}
function addHour(hhmm) { const [h, m] = hhmm.split(':').map(Number); return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

export function fallsOnHolidayOrWeekend(dateIso) {
  if (isPublicHoliday(dateIso)) return 'public holiday';
  if (!isWorkingDay(dateIso)) return 'weekend';
  return null;
}
