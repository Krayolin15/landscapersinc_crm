/* =============================================================================
   Calendar — Day & Week time-grid view.
   06:00–20:00 is what fits on screen at first paint; the grid itself covers
   00:00–24:00 and scrolls. A red line marks "now". Events can be dragged to
   move (pointer events; touch requires a short long-press so a normal finger
   scroll still works) and resized from their bottom edge. Clicking or
   dragging on an empty slot opens the quick-add popover.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { db } from '../../core/db.js';
import { can } from '../../core/perms.js';
import * as D from '../../core/dates.js';
import { toast, showError } from '../../ui/overlays.js';
import { eventOccurrences, sourceItems } from './data.js';
import { layoutColumns } from './logic.js';
import { eventChip, derivedChip } from './event-chip.js';
import { openQuickAdd } from './quick-add.js';
import { askScope, saveWithScope } from './event-form.js';

const HOUR_PX = 56;
const DAY_PX = HOUR_PX * 24;
const SNAP_MIN = 15;
const LONG_PRESS_MS = 420;

const snap = m => Math.round(m / SNAP_MIN) * SNAP_MIN;
const minutesFromHHMM = t => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
function hhmmFromMinutes(m) {
  m = Math.max(0, Math.min(24 * 60 - 15, snap(m)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function hourLabel(h) { if (h === 0) return ''; const ap = h < 12 ? 'am' : 'pm'; const hh = h % 12 === 0 ? 12 : h % 12; return `${hh}${ap}`; }

async function applyChange(ev, occDate, patch) {
  try {
    if (ev.recurrence && ev.recurrence !== 'none') {
      const scope = await askScope(ev, 'move');
      if (!scope) return false;
      await saveWithScope(ev, occDate, patch, scope === 'following' ? 'following' : scope);
    } else {
      await db.update('events', ev.id, patch);
    }
    toast.success('Event updated');
    return true;
  } catch (e) { showError(e); return false; }
}

/**
 * gridView({ anchor, view:'day'|'week', search, actions, contentDispose })
 * actions: { onOpen(id, occDate) }
 * contentDispose: a disposer scoped to the current main-content render (for the "now" line timer).
 */
export function gridView({ anchor, view, search, actions, contentDispose }) {
  const days = view === 'day' ? [anchor] : D.range(D.startOfWeek(anchor), D.endOfWeek(anchor));
  const from = days[0], to = days[days.length - 1];
  const todayIso = D.today();
  const writable = can('write', 'events');

  const occs = eventOccurrences(from, to, { search });
  const timed = occs.filter(o => !o.all_day);
  const allDayOccs = occs.filter(o => o.all_day);
  const derived = sourceItems(from, to);

  const cols = `64px repeat(${days.length}, minmax(0,1fr))`;
  const root = h('div.cal-gridview');

  const headerRow = h('div.cal-daynames', { style: { gridTemplateColumns: cols } },
    h('div'),
    days.map(d => h('button.cal-daylabel', { class: d === todayIso ? 'today' : '', onClick: () => actions.goto('day', d) },
      h('span.dn-wd', D.DAYS_SHORT[D.dow(d)]), h('span.dn-num', String(D.parse(d).getDate())))));

  const allDayRow = h('div.cal-allday', { style: { gridTemplateColumns: cols } }, h('div.allday-lbl.small.muted', 'All-day'));
  for (const d of days) {
    const cell = h('div.cal-allday-cell');
    for (const it of derived.filter(x => d >= x.date && d <= (x.end_date || x.date))) cell.appendChild(derivedChip(it));
    for (const o of allDayOccs.filter(o2 => d >= o2.date && d <= o2.end_date)) {
      const chip = eventChip(o, { showTime: false });
      chip.addEventListener('click', () => actions.onOpen(o.event.id, o.date));
      cell.appendChild(chip);
    }
    allDayRow.appendChild(cell);
  }

  const gutter = h('div.cal-gutter', { style: { height: DAY_PX + 'px' } }, Array.from({ length: 24 }, (_, hr) => h('div.cal-hourlabel', hourLabel(hr))));
  const body = h('div.cal-gridbody', { style: { gridTemplateColumns: cols } }, gutter);
  const dayCols = days.map(d => {
    const col = h('div.cal-daycol', { style: { height: DAY_PX + 'px' }, dataset: { date: d } });
    body.appendChild(col);
    return col;
  });

  // ---- "now" line ----
  function drawNowLine() {
    dayCols.forEach(col => { const old = col.querySelector('.cal-nowline'); if (old) old.remove(); });
    if (todayIso < from || todayIso > to) return;
    const idx = days.indexOf(todayIso);
    if (idx < 0) return;
    const now = D.nowSA();
    const mins = now.getHours() * 60 + now.getMinutes();
    dayCols[idx].appendChild(h('div.cal-nowline', { style: { top: (mins / 60 * HOUR_PX) + 'px' } }));
  }
  drawNowLine();
  const nowTimer = setInterval(drawNowLine, 60000);
  if (contentDispose) contentDispose.add(() => clearInterval(nowTimer));

  // ---- timed events, laid out with overlap columns ----
  days.forEach((d, i) => {
    const col = dayCols[i];
    const dayOccs = timed.filter(o => o.date === d);
    const layoutInput = dayOccs.map(o => {
      const s = minutesFromHHMM(o.start_time || '00:00');
      const e = Math.max(minutesFromHHMM(o.end_time || o.start_time || '00:00'), s + 15);
      return { id: o.key, start: s, end: e };
    });
    const layout = layoutColumns(layoutInput);
    dayOccs.forEach(o => {
      const startMin = minutesFromHHMM(o.start_time || '00:00');
      const endMin = Math.max(minutesFromHHMM(o.end_time || o.start_time || '00:00'), startMin + 15);
      const pos = layout.get(o.key) || { col: 0, cols: 1 };
      const chip = eventChip(o, { dense: true });
      chip.classList.add('cal-event-abs');
      const gutterPct = 2;
      const widthPct = (100 - gutterPct) / pos.cols;
      Object.assign(chip.style, {
        top: (startMin / 60 * HOUR_PX) + 'px',
        height: Math.max(18, (endMin - startMin) / 60 * HOUR_PX - 2) + 'px',
        left: `calc(${(pos.col * widthPct)}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`
      });
      if (writable) {
        const handle = h('div.ce-resize', { 'aria-hidden': 'true' });
        chip.appendChild(handle);
        attachResize(handle, chip, o);
        attachDrag(chip, o);
      }
      chip.addEventListener('click', e => { if (chip.dataset.dragged === '1') { e.preventDefault(); return; } actions.onOpen(o.event.id, o.date); });
      col.appendChild(chip);
    });
  });

  function attachDrag(chip, occ) {
    const ev = occ.event;
    let pointerId = null, mode = null, timer = null, startY = 0, startX = 0;
    chip.addEventListener('pointerdown', e => {
      if (e.target.closest('.ce-resize')) return;
      pointerId = e.pointerId; startY = e.clientY; startX = e.clientX; chip.dataset.dragged = '0';
      if (e.pointerType === 'touch') {
        timer = setTimeout(() => { mode = 'move'; try { chip.setPointerCapture(pointerId); } catch { /* noop */ } chip.classList.add('dragging'); }, LONG_PRESS_MS);
      } else mode = 'pending';
    });
    chip.addEventListener('pointermove', e => {
      if (e.pointerId !== pointerId) return;
      const dy = e.clientY - startY, dx = e.clientX - startX;
      if (mode === 'pending' && Math.hypot(dx, dy) > 4) { mode = 'move'; try { chip.setPointerCapture(pointerId); } catch { /* noop */ } chip.classList.add('dragging'); }
      if (mode === 'pending' && e.pointerType === 'touch' && Math.hypot(dx, dy) > 10) { clearTimeout(timer); pointerId = null; mode = null; return; }
      if (mode !== 'move') return;
      chip.dataset.dragged = '1';
      chip.style.transform = `translateY(${dy}px)`;
    });
    const finish = async e => {
      if (e.pointerId !== pointerId) return;
      clearTimeout(timer);
      const dy = e.clientY - startY;
      const wasMoving = mode === 'move';
      pointerId = null; mode = null;
      chip.classList.remove('dragging');
      chip.style.transform = '';
      if (!wasMoving) return;
      const deltaMin = snap(dy / HOUR_PX * 60);
      setTimeout(() => { chip.dataset.dragged = '0'; }, 0);
      if (!deltaMin) return;
      const startMin = minutesFromHHMM(ev.start_time || '00:00');
      const endMin = Math.max(minutesFromHHMM(ev.end_time || ev.start_time || '00:00'), startMin + 15);
      const dur = endMin - startMin;
      const newStart = hhmmFromMinutes(startMin + deltaMin);
      const newEnd = hhmmFromMinutes(minutesFromHHMM(newStart) + dur);
      await applyChange(ev, occ.date, { start_time: newStart, end_time: newEnd });
    };
    chip.addEventListener('pointerup', finish);
    chip.addEventListener('pointercancel', () => { clearTimeout(timer); mode = null; pointerId = null; chip.classList.remove('dragging'); chip.style.transform = ''; });
  }

  function attachResize(handle, chip, occ) {
    const ev = occ.event;
    let pointerId = null, startY = 0, startHeight = 0;
    handle.addEventListener('pointerdown', e => { e.stopPropagation(); pointerId = e.pointerId; startY = e.clientY; startHeight = parseFloat(chip.style.height); try { handle.setPointerCapture(pointerId); } catch { /* noop */ } chip.classList.add('dragging'); });
    handle.addEventListener('pointermove', e => {
      if (e.pointerId !== pointerId) return;
      const dy = e.clientY - startY;
      chip.style.height = Math.max(16, startHeight + dy) + 'px';
    });
    const finish = async e => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      chip.classList.remove('dragging');
      const startMin = minutesFromHHMM(ev.start_time || '00:00');
      const newHeightMin = Math.max(15, snap(parseFloat(chip.style.height) / HOUR_PX * 60));
      const newEnd = hhmmFromMinutes(startMin + newHeightMin);
      await applyChange(ev, occ.date, { end_time: newEnd });
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', () => { pointerId = null; chip.classList.remove('dragging'); });
  }

  // ---- click-drag on empty slots -> quick-create ----
  if (writable) {
    dayCols.forEach((col, i) => {
      let pid = null, startMin = 0, curMin = 0, ghost = null;
      col.addEventListener('pointerdown', e => {
        if (e.target.closest('.cal-event')) return;
        pid = e.pointerId;
        const rect = col.getBoundingClientRect();
        startMin = Math.max(0, snap(((e.clientY - rect.top) / HOUR_PX) * 60));
        curMin = startMin + 30;
        ghost = h('div.cal-event-abs.cal-ghost', { style: { top: (startMin / 60 * HOUR_PX) + 'px', height: (30 / 60 * HOUR_PX) + 'px' } });
        col.appendChild(ghost);
        try { col.setPointerCapture(pid); } catch { /* noop */ }
      });
      col.addEventListener('pointermove', e => {
        if (e.pointerId !== pid || !ghost) return;
        const rect = col.getBoundingClientRect();
        curMin = Math.max(startMin + 15, snap(((e.clientY - rect.top) / HOUR_PX) * 60));
        ghost.style.height = ((curMin - startMin) / 60 * HOUR_PX) + 'px';
      });
      col.addEventListener('pointerup', e => {
        if (e.pointerId !== pid) return;
        pid = null;
        if (!ghost) return;
        ghost.remove(); ghost = null;
        openQuickAdd({ x: e.clientX, y: e.clientY, date: days[i], time: hhmmFromMinutes(startMin), endTime: hhmmFromMinutes(curMin) });
      });
      col.addEventListener('pointercancel', () => { pid = null; if (ghost) { ghost.remove(); ghost = null; } });
    });
  }

  body.style.overflowY = 'auto';
  body.style.maxHeight = '68vh';
  requestAnimationFrame(() => { body.scrollTop = 6 * HOUR_PX; });

  root.append(headerRow, allDayRow, body);
  return root;
}
