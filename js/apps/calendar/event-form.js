/* =============================================================================
   Calendar — event create/edit (modal or drawer) + recurring-series edit/delete
   scope ("this event" / "all events" / "this and following").
   ========================================================================== */

import { h, uid } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { fieldInput } from '../../ui/form.js';
import { modal, drawer, confirm, toast, showError } from '../../ui/overlays.js';
import { btn, callout } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { getDef } from '../../core/schema.js';
import { store } from '../../core/bus.js';
import { CONFIG } from '../../config.js';
import { addDays, today } from '../../core/dates.js';
import * as fmt from '../../core/format.js';
import { EVENT_CATEGORIES } from '../../schema/workspace.js';
import { attendeeConflicts, fallsOnHolidayOrWeekend, categoryColor } from './data.js';
import { minutesReminderLabel, REMINDER_PRESETS } from './logic.js';

const DEF = () => getDef('events');
const label = n => (DEF().fields[n] || {}).label || n;

function slugify(s) { return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }

/* ---------------------------------------------------------------- reminders editor */

function remindersEditor(initial) {
  let mins = Array.isArray(initial) && initial.length ? [...initial] : [...CONFIG.defaultEventReminders];
  const list = h('div.chips');
  const customInput = h('input.input', { type: 'number', min: 1, placeholder: 'Custom minutes', style: 'width:140px' });
  const draw = () => {
    list.replaceChildren(...mins.sort((a, b) => a - b).map(m => h('span.chip.active', minutesReminderLabel(m),
      h('button.x', { type: 'button', onClick: () => { mins = mins.filter(x => x !== m); draw(); } }, icon('x', 13)))));
  };
  const addPreset = m => { if (!mins.includes(m)) { mins.push(m); draw(); } };
  draw();
  const presets = h('div.row.wrap.gap-8',
    ...REMINDER_PRESETS.map(m => btn({ label: minutesReminderLabel(m).replace(' before', ''), size: 'sm', variant: mins.includes(m) ? 'soft' : 'ghost', onClick: () => addPreset(m) })),
    customInput,
    btn({ icon: 'plus', size: 'sm', variant: 'ghost', tip: 'Add custom reminder', onClick: () => { const n = Math.round(Number(customInput.value)); if (n > 0) { addPreset(n); customInput.value = ''; } } }));
  return { el: h('div.stack.tight', list, presets), get value() { return mins.slice(); } };
}

/* ---------------------------------------------------------------- video link */

function videoLinkField(value) {
  const input = h('input.input', { type: 'url', value: value || '', placeholder: 'https://meet.jit.si/…' });
  const gen = btn({ label: 'Generate', icon: 'video', size: 'sm', variant: 'soft', onClick: () => { input.value = CONFIG.meetBaseUrl + 'lsi-' + slugify((store.get('user') || {}).name) + '-' + Math.random().toString(36).slice(2, 8); } });
  return { el: h('div.row', input, gen), get value() { return input.value.trim() || null; } };
}

/* ---------------------------------------------------------------- the form body */

/**
 * buildForm(values) -> { el, get(), set(k,v), validate(), showErrors(errs,warns) }
 * A hand-built form (not schemaForm) so we control layout, the reminders/video
 * widgets and the live clash / holiday warnings — every field still lines up
 * with js/schema/workspace.js's `events` definition for validation.
 */
function buildForm(values) {
  const v = { recurrence: 'none', visibility: 'company', all_day: false, ...values };
  const wrap = h('div.form-grid');
  const errs = {};
  const warnBox = h('div.stack.tight', { style: 'margin-top:4px' });

  const field = (name, ctrl, { full = false, err = true } = {}) => {
    const e = h('div.field-error', { style: 'display:none' });
    if (err) errs[name] = e;
    const w = h('div', { class: ['field', full ? 'full' : ''] }, h('label.field-label', label(name), (DEF().fields[name] || {}).required ? h('span.req', '*') : null), ctrl, e);
    wrap.appendChild(w);
    return w;
  };
  const set = (patch) => { Object.assign(v, patch); refreshWarnings(); };

  // title
  field('title', fieldInput({ type: 'text', required: true, placeholder: 'Add a title' }, v.title, t => set({ title: t })), { full: true });

  // category + calendar
  field('category', fieldInput({ type: 'enum', options: EVENT_CATEGORIES.map(c => ({ value: c.value, label: c.label })) }, v.category, c => set({ category: c })));
  const calendars = db.all('calendars');
  field('calendar_id', fieldInput({ type: 'enum', options: calendars.map(c => ({ value: c.id, label: c.name })) }, v.calendar_id, c => set({ calendar_id: c })));

  // all-day + dates/times
  const allDaySwitch = fieldInput({ type: 'bool', switchLabel: v.all_day ? 'All day' : 'Timed' }, v.all_day, on => { set({ all_day: on }); redrawTimes(on); });
  field('all_day', allDaySwitch);
  const dateStart = fieldInput({ type: 'date', required: true }, v.start_date, d => set({ start_date: d }));
  const dateEnd = fieldInput({ type: 'date' }, v.end_date, d => set({ end_date: d }));
  const timeStartHolder = h('div'), timeEndHolder = h('div');
  const redrawTimes = allDay => {
    timeStartHolder.replaceChildren(allDay ? h('span.faint.small', 'All day') : fieldInput({ type: 'time' }, v.start_time, t => set({ start_time: t })));
    timeEndHolder.replaceChildren(allDay ? '' : fieldInput({ type: 'time' }, v.end_time, t => set({ end_time: t })));
  };
  redrawTimes(v.all_day);
  field('start_date', h('div.row.gap-8', dateStart, timeStartHolder));
  field('end_date', h('div.row.gap-8', dateEnd, timeEndHolder));

  // recurrence + until
  const untilHolder = h('div');
  const redrawUntil = rec => { untilHolder.replaceChildren(rec === 'none' ? '' : h('div.field', h('label.field-label', 'Repeat until'), fieldInput({ type: 'date' }, v.recurrence_until, d => set({ recurrence_until: d })))); };
  field('recurrence', h('div', fieldInput({ type: 'enum', required: true, options: DEF().fields.recurrence.options }, v.recurrence, r => { set({ recurrence: r }); redrawUntil(r); }), untilHolder));
  redrawUntil(v.recurrence);

  field('location', fieldInput({ type: 'text', placeholder: 'Site, address or room' }, v.location, t => set({ location: t })));
  field('client_id', fieldInput({ type: 'ref', ref: 'clients', softRef: true }, v.client_id, c => set({ client_id: c })));
  field('description', fieldInput({ type: 'longtext' }, v.description, t => set({ description: t })), { full: true });

  field('attendees', fieldInput({ type: 'refs', ref: 'profiles' }, v.attendees, a => set({ attendees: a })), { full: true });
  field('external_attendees', fieldInput({ type: 'text', placeholder: 'guest@example.com, another@example.com' }, v.external_attendees, t => set({ external_attendees: t })), { full: true });

  const video = videoLinkField(v.meet_link);
  field('meet_link', video.el, { full: true });

  const reminders = remindersEditor(v.reminders);
  field('reminders', reminders.el, { full: true, err: false });

  field('visibility', fieldInput({ type: 'enum', options: DEF().fields.visibility.options }, v.visibility, x => set({ visibility: x })));
  field('color', h('div.row.gap-8', fieldInput({ type: 'color' }, v.color, c => set({ color: c })), btn({ label: 'Use category colour', size: 'sm', variant: 'ghost', onClick: () => { v.color = null; redraw(); } })), {});

  wrap.appendChild(h('div.field.full', warnBox));

  function refreshWarnings() {
    const nodes = [];
    if (v.start_date) {
      const hw = fallsOnHolidayOrWeekend(v.start_date);
      if (hw) nodes.push(callout('warn', null, `${fmt.date(v.start_date, 'long')} is a ${hw}.`));
      const clashes = attendeeConflicts(v, v.id);
      if (clashes.length) nodes.push(callout('warn', null, `Clashes with ${clashes.length === 1 ? '“' + clashes[0].event.title + '”' : clashes.length + ' other events'} for someone on this event, at the same time.`));
    }
    warnBox.replaceChildren(...nodes);
  }
  function redraw() { /* colour swatch has no live preview beyond the field itself */ }
  refreshWarnings();

  function get() { return { ...v, reminders: reminders.value, meet_link: video.value }; }
  function showErrors(errors = {}, warnings = {}) {
    for (const [name, el] of Object.entries(errs)) {
      const msg = errors[name] || warnings[name];
      el.style.display = msg ? '' : 'none';
      el.style.color = errors[name] ? '' : 'var(--warning)';
      el.textContent = msg || '';
    }
  }
  return { el: wrap, get, showErrors };
}

/* ---------------------------------------------------------------- recurring split helpers */

/** Apply an edit to one instance of a recurring series ("this" / "all" / "following"). */
async function saveWithScope(master, occDate, patch, scope) {
  if (!master || master.recurrence === 'none' || !occDate || scope === 'all') {
    return db.update('events', master.id, patch);
  }
  if (scope === 'this') {
    await db.update('events', master.id, { recurrence_exceptions: [...new Set([...(master.recurrence_exceptions || []), occDate])] });
    return db.insert('events', { ...master, ...patch, id: undefined, start_date: patch.start_date || occDate, recurrence: 'none', recurrence_until: null, recurrence_exceptions: null, related_collection: null, related_id: null });
  }
  // this and following
  await db.update('events', master.id, { recurrence_until: addDays(occDate, -1) });
  const futureExceptions = (master.recurrence_exceptions || []).filter(d => d >= occDate);
  return db.insert('events', { ...master, ...patch, id: undefined, start_date: patch.start_date || occDate, recurrence: patch.recurrence || master.recurrence, recurrence_until: master.recurrence_until || null, recurrence_exceptions: futureExceptions.length ? futureExceptions : null, related_collection: null, related_id: null });
}

/** Ask "this event / all events / this and following" for a recurring series. Resolves null if cancelled. */
function askScope(ev, verb = 'change') {
  return new Promise(resolve => {
    let answered = false;
    modal({
      title: `${fmt.titleCase(verb)} a repeating event`, icon: 'repeat', tile: 't-river',
      body: h('p', `“${ev.title}” repeats. What would you like to ${verb}?`),
      actions: [
        { label: 'This event only', variant: 'soft', onClick: () => { answered = true; resolve('this'); } },
        { label: 'This and following', variant: 'soft', onClick: () => { answered = true; resolve('following'); } },
        { label: 'All events', variant: 'primary', onClick: () => { answered = true; resolve('all'); } }
      ],
      onClose: () => { if (!answered) resolve(null); }
    });
  });
}

/* ---------------------------------------------------------------- delete */

export async function deleteEventFlow(event, occDate) {
  if (event.recurrence !== 'none') {
    const scope = await askScope(event, 'delete');
    if (!scope) return false;
    if (scope === 'all') { if (!(await confirm(`Move the whole “${event.title}” series to the trash?`, { danger: true, ok: 'Move to trash' }))) return false; await db.remove('events', event.id); toast.success('Series moved to trash'); return true; }
    if (scope === 'this') { await db.update('events', event.id, { recurrence_exceptions: [...new Set([...(event.recurrence_exceptions || []), occDate])] }); toast.success('That occurrence was removed'); return true; }
    if (scope === 'following') { await db.update('events', event.id, { recurrence_until: addDays(occDate, -1) }); toast.success('This and following occurrences were removed'); return true; }
  }
  if (!(await confirm(`Move “${event.title}” to the trash?`, { danger: true, ok: 'Move to trash' }))) return false;
  await db.remove('events', event.id);
  toast.success('Moved to trash');
  return true;
}

/* ---------------------------------------------------------------- open create/edit ---------------------------------------------------------------- */

/**
 * openEventForm({ id?, occDate?, values?, asDrawer? }) -> Promise<record|null>
 * id + occDate: editing one occurrence of an existing event.
 * values: prefilled fields for a new event (date/time from a click, duplicate, Sage…).
 */
export function openEventForm({ id, occDate, values, asDrawer = false, title } = {}) {
  const existing = id ? db.get('events', id) : null;
  const initial = existing ? { ...existing } : { start_date: today(), reminders: [...CONFIG.defaultEventReminders], ...values };
  const form = buildForm(initial);
  const open = asDrawer ? drawer : modal;
  return new Promise(resolve => {
    let saved = null;
    const api = open({
      title: title || (existing ? 'Edit event' : 'New event'), icon: 'calendar-plus', tile: 't-river', size: 'wide',
      body: form.el,
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: existing ? 'Save changes' : 'Add event', variant: 'primary', icon: 'check',
          onClick: async () => {
            const vals = form.get();
            const res = db.check('events', vals, { id: existing && existing.id });
            if (!res.ok) { form.showErrors(res.errors, res.warnings); toast.error('Please fix the highlighted fields'); return false; }
            try {
              if (existing && existing.recurrence !== 'none' && occDate) {
                const scope = await askScope(existing, 'save');
                if (!scope) return false;
                saved = await saveWithScope(existing, occDate, vals, scope === 'following' ? 'following' : scope);
              } else if (existing) {
                saved = await db.update('events', existing.id, vals);
              } else {
                saved = await db.insert('events', vals);
              }
              toast.success(existing ? 'Saved' : 'Event added', { text: saved.title });
            } catch (e) { if (e.errors) form.showErrors(e.errors, e.warnings); showError(e); return false; }
          }
        }
      ],
      onClose: () => resolve(saved)
    });
  });
}

/** Duplicate: opens a prefilled create form for a copy of `event` (same date/time). */
export function duplicateEventFlow(event) {
  const copy = { ...event };
  delete copy.id; delete copy.created_at; delete copy.created_by; delete copy.created_by_name; delete copy.updated_at; delete copy.updated_by; delete copy.updated_by_name; delete copy.deleted_at;
  copy.title = `${event.title} (copy)`;
  copy.recurrence_exceptions = null;
  return openEventForm({ values: copy, title: 'Duplicate event' });
}

export { askScope, slugify, buildForm, saveWithScope };
