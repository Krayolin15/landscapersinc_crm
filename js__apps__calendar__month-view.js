/* =============================================================================
   Calendar — Month view: a 6×7 grid. Events can be dragged across days
   (pointer events; touch needs a short long-press). Double-click / long-press
   an empty cell to quick-add an all-day event; click the day number to open
   Day view for that date.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { db } from '../../core/db.js';
import { can } from '../../core/perms.js';
import * as D from '../../core/dates.js';
import * as fmt from '../../core/format.js';
import { toast, showError } from '../../ui/overlays.js';
import { eventOccurrences, sourceItems } from './data.js';
import { eventChip, derivedChip } from './event-chip.js';
import { openQuickAdd } from './quick-add.js';
import { askScope, saveWithScope } from './event-form.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LONG_PRESS_MS = 420;
const MAX_SHOWN = 3;

export function monthView({ anchor, search, actions }) {
  const d0 = D.parse(anchor);
  const monthNum = d0.getMonth();
  const gridDates = D.monthGrid(d0.getFullYear(), monthNum);
  const from = gridDates[0], to = gridDates[gridDates.length - 1];
  const todayIso = D.today();
  const writable = can('write', 'events');

  const occs = eventOccurrences(from, to, { search });
  const derived = sourceItems(from, to);

  const byDate = new Map(gridDates.map(x => [x, []]));
  for (const it of derived) {
    let dd = it.date;
    while (dd <= (it.end_date || it.date) && byDate.has(dd)) { byDate.get(dd).push({ kind: 'derived', item: it }); dd = D.addDays(dd, 1); }
  }
  for (const o of occs) {
    if (o.all_day) { let dd = o.date; while (dd <= o.end_date && byDate.has(dd)) { byDate.get(dd).push({ kind: 'occ', occ: o, allDay: true }); dd = D.addDays(dd, 1); } }
    else if (byDate.has(o.date)) byDate.get(o.date).push({ kind: 'occ', occ: o });
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => {
      const ta = a.kind === 'occ' && !a.allDay ? (a.occ.start_time || '') : '';
      const tb = b.kind === 'occ' && !b.allDay ? (b.occ.start_time || '') : '';
      return ta.localeCompare(tb);
    });
  }

  const holidaySet = new Set(derived.filter(x => x.source === 'sa-holidays' && x.category === 'holiday').map(x => x.date));

  const dowRow = h('div.cal-monthdow', DOW.map(x => h('div', x)));
  const grid = h('div.cal-monthgrid');

  gridDates.forEach(dt => {
    const items = byDate.get(dt) || [];
    const isOtherMonth = D.parse(dt).getMonth() !== monthNum;
    const cell = h('div.cal-daycell', {
      class: [isOtherMonth ? 'other' : '', dt === todayIso ? 'today' : '', holidaySet.has(dt) ? 'holiday' : ''].filter(Boolean),
      dataset: { daycell: '1', date: dt }
    }, h('button.dc-num', { onClick: () => actions.goto('day', dt) }, String(D.parse(dt).getDate())));

    const shown = items.slice(0, MAX_SHOWN);
    shown.forEach(it => {
      let node;
      if (it.kind === 'derived') node = derivedChip(it.item);
      else {
        node = eventChip(it.occ, { showTime: !it.allDay });
        if (writable) attachMonthDrag(node, it.occ, cell, grid);
        node.addEventListener('click', e => { if (node.dataset.dragged === '1') { e.preventDefault(); return; } actions.onOpen(it.occ.event.id, it.occ.date); });
      }
      cell.appendChild(node);
    });
    if (items.length > shown.length) cell.appendChild(h('button.cal-more', { onClick: () => actions.goto('day', dt) }, `+${items.length - shown.length} more`));

    if (writable) {
      let timer = null, downTouch = false;
      cell.addEventListener('pointerdown', e => {
        if (e.target.closest('.cal-event, .dc-num, .cal-more')) return;
        if (e.pointerType === 'touch') { downTouch = true; timer = setTimeout(() => { openQuickAdd({ x: e.clientX, y: e.clientY, date: dt, allDay: true }); downTouch = false; }, LONG_PRESS_MS); }
      });
      cell.addEventListener('pointerup', () => { clearTimeout(timer); downTouch = false; });
      cell.addEventListener('pointerleave', () => { clearTimeout(timer); downTouch = false; });
      cell.addEventListener('dblclick', e => { if (e.target.closest('.cal-event, .dc-num, .cal-more')) return; openQuickAdd({ x: e.clientX, y: e.clientY, date: dt, allDay: true }); });
    }
    grid.appendChild(cell);
  });

  function attachMonthDrag(node, occ, originCell, gridEl) {
    const ev = occ.event;
    let pid = null, mode = null, timer = null, startX = 0, startY = 0, target = null;
    node.addEventListener('pointerdown', e => {
      pid = e.pointerId; startX = e.clientX; startY = e.clientY; node.dataset.dragged = '0';
      if (e.pointerType === 'touch') timer = setTimeout(() => { mode = 'move'; try { node.setPointerCapture(pid); } catch { /* noop */ } node.classList.add('dragging'); }, LONG_PRESS_MS);
      else mode = 'pending';
    });
    node.addEventListener('pointermove', e => {
      if (e.pointerId !== pid) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (mode === 'pending' && Math.hypot(dx, dy) > 5) { mode = 'move'; try { node.setPointerCapture(pid); } catch { /* noop */ } node.classList.add('dragging'); }
      if (mode === 'pending' && e.pointerType === 'touch' && Math.hypot(dx, dy) > 10) { clearTimeout(timer); pid = null; mode = null; return; }
      if (mode !== 'move') return;
      node.dataset.dragged = '1';
      gridEl.querySelectorAll('.cal-daycell.drop-target').forEach(c => c.classList.remove('drop-target'));
      const el = document.elementFromPoint(e.clientX, e.clientY);
      target = el && el.closest('[data-daycell]');
      if (target) target.classList.add('drop-target');
    });
    const finish = async e => {
      if (e.pointerId !== pid) return;
      clearTimeout(timer);
      gridEl.querySelectorAll('.cal-daycell.drop-target').forEach(c => c.classList.remove('drop-target'));
      const wasMoving = mode === 'move';
      pid = null; mode = null;
      node.classList.remove('dragging');
      setTimeout(() => { node.dataset.dragged = '0'; }, 0);
      if (!wasMoving || !target) return;
      const newDate = target.dataset.date;
      if (newDate === occ.date) return;
      const delta = D.diffDays(occ.date, newDate);
      const newStart = D.addDays(ev.start_date, delta);
      const patch = { start_date: newStart };
      if (ev.end_date) patch.end_date = D.addDays(ev.end_date, delta);
      try {
        if (ev.recurrence && ev.recurrence !== 'none') {
          const scope = await askScope(ev, 'move');
          if (!scope) return;
          await saveWithScope(ev, occ.date, patch, scope === 'following' ? 'following' : scope);
        } else await db.update('events', ev.id, patch);
        toast.success('Event moved', { text: fmt.date(newDate, 'long') });
      } catch (err) { showError(err); }
    };
    node.addEventListener('pointerup', finish);
    node.addEventListener('pointercancel', () => { clearTimeout(timer); mode = null; pid = null; node.classList.remove('dragging'); });
  }

  return h('div.cal-monthview', dowRow, grid);
}
