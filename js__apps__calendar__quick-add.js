/* =============================================================================
   Calendar — inline quick-add popover (click a slot -> type a title -> Enter).
   "More options" hands off to the full create form (openEventForm).
   ========================================================================== */

import { h, onOutside } from '../../ui/dom.js';
import { btn } from '../../ui/components.js';
import { showError } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { CONFIG } from '../../config.js';
import { openEventForm } from './event-form.js';

let openPopover = null;
export function closeQuickAdd() { if (openPopover) { openPopover.remove(); openPopover = null; } }

/**
 * openQuickAdd({ x, y, date, time, endTime, allDay }, onDone)
 * x/y: viewport coordinates to anchor the popover near.
 */
export function openQuickAdd({ x, y, date, time, endTime, allDay = false }, onDone) {
  closeQuickAdd();
  const input = h('input.input', { placeholder: 'Add a title', autofocus: true });
  const whenLabel = allDay ? 'All day' : `${time || ''}${endTime ? ' – ' + endTime : ''}`;
  const pop = h('div.cal-quickadd', { role: 'dialog', 'aria-label': 'Quick add event' },
    h('div.small.muted', whenLabel),
    input,
    h('div.row.end.gap-8', { style: 'margin-top:10px' },
      btn({ label: 'More options', size: 'sm', variant: 'ghost', onClick: () => {
        const title = input.value.trim();
        closeQuickAdd();
        openEventForm({ values: { title: title || undefined, start_date: date, start_time: allDay ? null : time, end_time: allDay ? null : endTime, all_day: allDay } })
          .then(saved => { if (saved && onDone) onDone(saved); });
      } }),
      btn({ label: 'Save', icon: 'check', size: 'sm', variant: 'primary', onClick: save })));
  async function save() {
    const title = input.value.trim();
    if (!title) { input.focus(); return; }
    try {
      const saved = await db.insert('events', {
        title, start_date: date, start_time: allDay ? null : time, end_time: allDay ? null : endTime, all_day: !!allDay,
        category: 'meeting', recurrence: 'none', status: 'confirmed', visibility: 'company', reminders: [...CONFIG.defaultEventReminders]
      });
      closeQuickAdd();
      if (onDone) onDone(saved);
    } catch (e) { showError(e); }
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') closeQuickAdd(); });
  document.body.appendChild(pop);
  openPopover = pop;
  const w = pop.offsetWidth, hh = pop.offsetHeight;
  let px = x, py = y;
  if (px + w > innerWidth - 8) px = innerWidth - w - 8;
  if (py + hh > innerHeight - 8) py = innerHeight - hh - 8;
  pop.style.left = Math.max(8, px) + 'px';
  pop.style.top = Math.max(8, py) + 'px';
  setTimeout(() => input.focus(), 30);
  const off = onOutside(pop, () => { closeQuickAdd(); off(); });
}
