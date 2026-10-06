/* =============================================================================
   Calendar sources — how every app puts its dates on the shared Calendar.

   People add events themselves (the `events` collection, attributed to whoever
   entered them). On top of that, apps contribute DERIVED items automatically:
   invoice due dates, quote expiries, certificate / medical / licence expiries,
   vehicle services, maintenance visits, follow-ups, plan milestones, pay days,
   SA public holidays... Each source can be switched on/off in the Calendar.

   registerCalendarSource({
     id: 'invoices-due', label: 'Invoice due dates', color: '#7b61ff', icon: 'receipt',
     app: 'invoices',                     // only shown to people who can open this app
     defaultOn: true,
     items(fromIso, toIso) -> [{ id, date, end_date?, time?, end_time?, title, subtitle?,
                                 link, category, color?, icon?, who?, done? }]
   })
   ========================================================================== */

import { canApp } from './perms.js';
import { holidaysBetween } from './holidays.js';

const sources = new Map();

export function registerCalendarSource(src) { sources.set(src.id, { defaultOn: true, ...src }); }
export function calendarSources() { return Array.from(sources.values()).filter(s => !s.app || canApp(s.app)); }

/** All derived items between two dates for the enabled source ids. */
export function derivedItems(from, to, enabledIds) {
  const out = [];
  for (const s of calendarSources()) {
    if (enabledIds && !enabledIds.includes(s.id)) continue;
    let items = [];
    try { items = s.items(from, to) || []; } catch (e) { console.warn(`[calendar source ${s.id}]`, e); }
    for (const it of items) {
      if (!it || !it.date) continue;
      if ((it.end_date || it.date) < from || it.date > to) continue;
      out.push({ ...it, source: s.id, sourceLabel: s.label, color: it.color || s.color, icon: it.icon || s.icon, derived: true });
    }
  }
  return out.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

// Built-in source: South African public holidays and observances.
registerCalendarSource({
  id: 'sa-holidays', label: 'South African holidays', color: '#e0525e', icon: 'party-popper', defaultOn: true,
  items: (from, to) => holidaysBetween(from, to).map(h => ({
    id: `hol-${h.date}-${h.name}`, date: h.date, end_date: h.end, title: h.name + (h.approximate ? ' (approx.)' : ''),
    subtitle: h.type === 'public' ? 'Public holiday' + (h.observed ? ' — observed' : '') : h.type === 'company' ? 'Company closure' : 'Observance',
    category: h.type === 'public' ? 'holiday' : 'observance', color: h.type === 'public' ? '#e0525e' : h.type === 'company' ? '#c8733a' : '#8e9b93', allDay: true, holiday: h.type
  }))
});
