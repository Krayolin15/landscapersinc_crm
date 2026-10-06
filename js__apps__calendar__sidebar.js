/* =============================================================================
   Calendar — left rail: mini month picker, "My calendars" (with colour +
   show/hide checkboxes) and "Other sources" (derived items from
   core/calendar-sources.js — SA holidays plus anything other apps register).
   Choices persist per device via prefs.js.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import * as D from '../../core/dates.js';
import { getCalendars, hasUnassignedEvents, allSources } from './data.js';
import { isCalendarVisible, setCalendarVisible, isSourceEnabled, setSourceEnabled, UNASSIGNED_ID } from './prefs.js';

export function miniMonth(anchorIso, onPick) {
  const start = D.parse(anchorIso);
  let y = start.getFullYear(), m = start.getMonth();
  const wrap = h('div.cal-mini');
  function draw() {
    const dates = D.monthGrid(y, m);
    wrap.replaceChildren(
      h('div.mini-head',
        h('button.btn.btn-ghost.btn-icon.btn-sm', { 'aria-label': 'Previous month', onClick: () => { m--; if (m < 0) { m = 11; y--; } draw(); } }, icon('chevron-left', 15)),
        h('b', `${D.MONTHS[m]} ${y}`),
        h('button.btn.btn-ghost.btn-icon.btn-sm', { 'aria-label': 'Next month', onClick: () => { m++; if (m > 11) { m = 0; y++; } draw(); } }, icon('chevron-right', 15))),
      h('div.mini-dow', ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => h('span', x))),
      h('div.mini-grid', dates.map(dt => h('button', {
        class: [D.parse(dt).getMonth() !== m ? 'other' : '', dt === anchorIso ? 'sel' : '', dt === D.today() ? 'today' : ''].filter(Boolean),
        onClick: () => onPick(dt)
      }, String(D.parse(dt).getDate())))));
  }
  draw();
  return wrap;
}

export function calendarRail(anchorIso, onPick, onChange) {
  const cals = getCalendars();
  const calRows = cals.map(c => h('label.check.cal-check',
    h('input', { type: 'checkbox', checked: isCalendarVisible(c.id, c.visible_by_default !== false), onChange: e => { setCalendarVisible(c.id, e.target.checked, c.visible_by_default !== false); onChange(); } }),
    h('span.cal-dot', { style: { background: c.color || '#1e9bc4' } }), h('span', c.name)));
  if (hasUnassignedEvents()) {
    calRows.push(h('label.check.cal-check',
      h('input', { type: 'checkbox', checked: isCalendarVisible(UNASSIGNED_ID, true), onChange: e => { setCalendarVisible(UNASSIGNED_ID, e.target.checked, true); onChange(); } }),
      h('span.cal-dot', { style: { background: '#8e9b93' } }), h('span', 'No calendar')));
  }
  const sourceRows = allSources().map(s => h('label.check.cal-check',
    h('input', { type: 'checkbox', checked: isSourceEnabled(s.id, s.defaultOn !== false), onChange: e => { setSourceEnabled(s.id, e.target.checked, s.defaultOn !== false); onChange(); } }),
    h('span.cal-dot', { style: { background: s.color || '#8e9b93' } }), h('span', s.label)));

  return h('div.cal-rail',
    miniMonth(anchorIso, onPick),
    h('div.rail-sec', h('div.rail-title', 'My calendars'), calRows.length ? h('div.stack.tight', calRows) : h('p.small.muted', 'No team calendars yet.')),
    h('div.rail-sec', h('div.rail-title', 'Other sources'), sourceRows.length ? h('div.stack.tight', sourceRows) : h('p.small.muted', 'Nothing to show.')),
    h('a.rail-link', { href: '#/calendar/holidays' }, icon('party-popper', 15), 'Manage holidays'));
}
