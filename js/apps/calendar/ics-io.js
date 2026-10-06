/* =============================================================================
   Calendar — .ics import / export actions (UI glue around the pure functions
   in logic.js).
   ========================================================================== */

import { h, downloadText } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { modal, toast, showError } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import * as D from '../../core/dates.js';
import { EVENT_CATEGORIES } from '../../schema/workspace.js';
import { eventOccurrences, getCalendars } from './data.js';
import { exportOccurrencesICS, exportEventsICS, parseICS } from './logic.js';

/** Export every event occurrence currently visible in [from, to] as one .ics file. */
export function exportRange({ from, to }) {
  const occs = eventOccurrences(from, to, {});
  if (!occs.length) { toast.warn('Nothing to export', { text: 'There are no events in the visible range.' }); return; }
  const ics = exportOccurrencesICS(occs);
  downloadText(ics, `calendar-${from}-to-${to}.ics`, 'text/calendar;charset=utf-8');
  toast.success('Exported', { text: `${occs.length} event${occs.length === 1 ? '' : 's'}` });
}

/** Export a whole calendar (its series, RRULEs kept intact) as .ics. */
export function exportCalendar(calendarId, label) {
  const events = db.all('events').filter(e => (e.calendar_id || null) === calendarId);
  if (!events.length) { toast.warn('Nothing to export', { text: `${label || 'This calendar'} has no events.` }); return; }
  const ics = exportEventsICS(events, { calendarName: label });
  downloadText(ics, `${(label || 'calendar').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${D.today()}.ics`, 'text/calendar;charset=utf-8');
  toast.success('Exported', { text: `${events.length} event${events.length === 1 ? '' : 's'}` });
}

/** Open a menu of calendars to export, or just export the range if there is only one choice. */
export function openExportDialog({ from, to }) {
  const cals = getCalendars();
  const rowStyle = 'width:100%;text-align:left;border:1px solid var(--border);border-radius:var(--r-md)';
  const m = modal({
    title: 'Export calendar', icon: 'download', tile: 't-river',
    body: h('div.stack',
      h('button.list-item', { style: rowStyle, onClick: () => { exportRange({ from, to }); m.close(); } },
        h('div.li-ico.t-river', icon('calendar-range', 17)), h('div.li-main', h('div.li-title', 'Visible range'), h('div.li-sub', `${from} to ${to}`))),
      cals.map(c => h('button.list-item', { style: rowStyle, onClick: () => { exportCalendar(c.id, c.name); m.close(); } },
        h('span.cal-dot', { style: { background: c.color || '#1e9bc4' } }), h('div.li-main', h('div.li-title', c.name))))),
    actions: [{ label: 'Close', variant: 'ghost' }]
  });
}

/** Import a .ics file into a chosen (or unassigned) calendar. */
export function openImportDialog() {
  const cals = getCalendars();
  const fileInput = h('input', { type: 'file', accept: '.ics,text/calendar' });
  const calSelect = cals.length ? h('select.select', h('option', { value: '' }, 'No calendar (unassigned)'), cals.map(c => h('option', { value: c.id }, c.name))) : null;
  modal({
    title: 'Import calendar (.ics)', icon: 'upload', tile: 't-river',
    body: h('div.stack',
      h('p.small.muted', 'Choose a .ics file exported from Google Calendar, Outlook or another app. Recurring events (daily / weekly / monthly / yearly, with an optional end date) are supported.'),
      h('div.field', h('label.field-label', 'File'), fileInput),
      calSelect ? h('div.field', h('label.field-label', 'Import into'), calSelect) : null),
    actions: [{ label: 'Cancel', variant: 'ghost' }, {
      label: 'Import', variant: 'primary', icon: 'upload', onClick: async () => {
        const file = fileInput.files[0];
        if (!file) { toast.error('Choose a file first'); return false; }
        try {
          const text = await file.text();
          const parsed = parseICS(text);
          if (!parsed.length) { toast.warn('No events found in that file'); return false; }
          const calendar_id = calSelect && calSelect.value ? calSelect.value : null;
          for (const p of parsed) {
            const category = EVENT_CATEGORIES.some(c => c.value === p.category) ? p.category : null;
            await db.insert('events', {
              title: p.title, start_date: p.start_date, end_date: p.end_date, start_time: p.start_time, end_time: p.end_time,
              all_day: p.all_day, location: p.location || null, description: p.description || null, category,
              recurrence: p.recurrence || 'none', recurrence_until: p.recurrence_until || null,
              status: p.status === 'cancelled' ? 'cancelled' : 'confirmed', visibility: 'company', calendar_id
            });
          }
          toast.success('Imported', { text: `${parsed.length} event${parsed.length === 1 ? '' : 's'}` });
        } catch (e) { showError(e, 'Import failed'); return false; }
      }
    }]
  });
}
