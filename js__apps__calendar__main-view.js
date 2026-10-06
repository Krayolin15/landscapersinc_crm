/* =============================================================================
   Calendar — the main page: header (search, today/prev/next, date-range title,
   view switcher, create), left rail (mini month, calendars, other sources),
   and the current view (day/week/month/year/agenda). Owns URL state
   (#/calendar?view=week&d=2026-09-10), keyboard shortcuts and mobile swipe.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { btn, seg, searchBox } from '../../ui/components.js';
import { menu, drawer } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { disposer } from '../../core/bus.js';
import * as D from '../../core/dates.js';
import { can } from '../../core/perms.js';
import { openEventForm } from './event-form.js';
import { getDefaultView, setDefaultView } from './prefs.js';
import { calendarRail } from './sidebar.js';
import { gridView } from './grid-view.js';
import { monthView } from './month-view.js';
import { yearView } from './year-view.js';
import { agendaView } from './agenda-view.js';
import { openImportDialog, openExportDialog } from './ics-io.js';

const isMobileWidth = () => matchMedia('(max-width: 860px)').matches;
const VIEW_ISO = /^\d{4}-\d{2}-\d{2}$/;
const VIEWS = [
  { id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' }, { id: 'agenda', label: 'Agenda' }
];

function weekLabel(from, to) {
  const a = D.parse(from), b = D.parse(to);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.getDate()} ${D.MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  const sameYear = a.getFullYear() === b.getFullYear();
  return `${a.getDate()} ${D.MONTHS_SHORT[a.getMonth()]}${sameYear ? '' : ' ' + a.getFullYear()} – ${b.getDate()} ${D.MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
}

export function calendarPage(ctx) {
  const state = {
    view: (ctx.query.view && VIEWS.some(v => v.id === ctx.query.view)) ? ctx.query.view : (getDefaultView() || (isMobileWidth() ? 'agenda' : 'month')),
    anchor: ctx.query.d && VIEW_ISO.test(ctx.query.d) ? ctx.query.d : D.today(),
    search: ctx.query.q || ''
  };
  const writable = can('write', 'events');

  function currentRange() {
    if (state.view === 'day') return { from: state.anchor, to: state.anchor };
    if (state.view === 'week') return { from: D.startOfWeek(state.anchor), to: D.endOfWeek(state.anchor) };
    if (state.view === 'month') return { from: D.startOfMonth(state.anchor), to: D.endOfMonth(state.anchor) };
    if (state.view === 'year') return { from: `${D.parse(state.anchor).getFullYear()}-01-01`, to: `${D.parse(state.anchor).getFullYear()}-12-31` };
    return { from: state.anchor, to: D.addDays(state.anchor, 30) };
  }
  function syncUrl() {
    setDefaultView(state.view);
    const q = new URLSearchParams({ view: state.view, d: state.anchor, ...(state.search ? { q: state.search } : {}) });
    history.replaceState(null, '', `#/calendar?${q}`);
  }
  function shift(dir) {
    if (state.view === 'day') state.anchor = D.addDays(state.anchor, dir);
    else if (state.view === 'week') state.anchor = D.addDays(state.anchor, dir * 7);
    else if (state.view === 'month') state.anchor = D.addMonths(state.anchor, dir);
    else if (state.view === 'year') state.anchor = D.addYears(state.anchor, dir);
    else state.anchor = D.addDays(state.anchor, dir * 30);
    syncUrl(); renderAll();
  }

  const actions = {
    onOpen: (id, occDate) => ctx.navigate(`calendar/event/${id}${occDate ? `?d=${occDate}` : ''}`),
    onCreate: ({ date, time, endTime, allDay }) => openEventForm({ values: { start_date: date, start_time: allDay ? null : time, end_time: allDay ? null : endTime, all_day: !!allDay } }),
    goto: (view, date) => { state.view = view; state.anchor = date; syncUrl(); renderAll(); }
  };

  // ---------------- header ----------------
  const titleEl = h('h2.cal-title');
  const segSlot = h('div.cal-seg-wrap');
  const drawSeg = () => segSlot.replaceChildren(seg(VIEWS, state.view, v => { state.view = v; syncUrl(); renderAll(); }));
  drawSeg();

  const searchInput = searchBox({ placeholder: 'Search events…', value: state.search, onInput: v => { state.search = v; renderMain(); } });
  const todayBtn = btn({ label: 'Today', variant: 'soft', onClick: () => { state.anchor = D.today(); syncUrl(); renderAll(); } });
  const prevBtn = btn({ icon: 'chevron-left', variant: 'ghost', 'aria-label': 'Previous', onClick: () => shift(-1) });
  const nextBtn = btn({ icon: 'chevron-right', variant: 'ghost', 'aria-label': 'Next', onClick: () => shift(1) });
  const createBtn = writable ? btn({ label: 'Create', icon: 'plus', variant: 'primary', onClick: () => openEventForm({ values: { start_date: state.anchor } }) }) : null;
  const railToggleBtn = btn({
    icon: 'sliders-horizontal', variant: 'ghost', cls: 'cal-rail-toggle', 'aria-label': 'Calendars', onClick: () => {
      const api = drawer({ title: 'Calendars', body: calendarRail(state.anchor, d => { api.close(); pick(d); }, () => renderMain()) });
    }
  });
  const moreBtn = btn({
    icon: 'ellipsis-vertical', variant: 'ghost', 'aria-label': 'More', onClick: e => menu(e.currentTarget, [
      { label: 'Print this view', icon: 'printer', onClick: () => window.print() },
      { label: 'Export…', icon: 'download', onClick: () => openExportDialog(currentRange()) },
      writable ? { label: 'Import .ics…', icon: 'upload', onClick: () => openImportDialog() } : null,
      '-',
      { label: 'Manage holidays', icon: 'party-popper', onClick: () => ctx.navigate('calendar/holidays') }
    ], { align: 'right' })
  });

  function pick(d) { state.anchor = d; if (state.view === 'year') state.view = 'month'; syncUrl(); renderAll(); }

  const header = h('div.cal-header.no-print',
    h('div.cal-header-row',
      h('div.row.gap-8.wrap', todayBtn, h('div.row.gap-4', prevBtn, nextBtn), titleEl),
      h('div.spacer'),
      h('div.row.gap-8.wrap', railToggleBtn, searchInput, segSlot, createBtn, moreBtn)));

  // ---------------- rail + main ----------------
  const railSlot = h('div.cal-rail-wrap');
  const drawRail = () => railSlot.replaceChildren(calendarRail(state.anchor, pick, () => renderMain()));
  drawRail();

  const main = h('div.cal-main');
  let contentDispose = disposer();
  ctx.dispose.add(() => contentDispose.run());
  function renderMain() {
    contentDispose.run();
    contentDispose = disposer();
    let node;
    if (state.view === 'day' || state.view === 'week') node = gridView({ anchor: state.anchor, view: state.view, search: state.search, actions, contentDispose });
    else if (state.view === 'month') node = monthView({ anchor: state.anchor, search: state.search, actions });
    else if (state.view === 'year') node = yearView({ anchor: state.anchor, search: state.search, actions });
    else node = agendaView({ anchor: state.anchor, search: state.search, actions });
    main.replaceChildren(h('div.anim-fade', node));
    const r = currentRange();
    if (state.view === 'day') titleEl.textContent = D.parse(state.anchor).toLocaleDateString ? fullDateLabel(state.anchor) : state.anchor;
    else if (state.view === 'week') titleEl.textContent = weekLabel(r.from, r.to);
    else if (state.view === 'month') titleEl.textContent = `${D.MONTHS[D.parse(state.anchor).getMonth()]} ${D.parse(state.anchor).getFullYear()}`;
    else if (state.view === 'year') titleEl.textContent = String(D.parse(state.anchor).getFullYear());
    else titleEl.textContent = 'Upcoming';
  }
  function fullDateLabel(iso) { const d = D.parse(iso); return `${D.DAYS[d.getDay()]}, ${d.getDate()} ${D.MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
  function renderAll() { drawSeg(); drawRail(); renderMain(); }

  const body = h('div.cal-body', railSlot, main);
  const root = h('div.cal-app', header, body);

  renderMain();
  syncUrl();

  // ---------------- live updates ----------------
  ctx.dispose.add(db.on('events', () => renderMain()));
  ctx.dispose.add(db.on('calendars', () => drawRail()));
  ctx.dispose.add(db.on('holidays', () => renderMain()));

  // ---------------- keyboard shortcuts ----------------
  function onKey(e) {
    const t = document.activeElement;
    if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 't': state.anchor = D.today(); syncUrl(); renderAll(); break;
      case 'd': actions.goto('day', state.anchor); break;
      case 'w': actions.goto('week', state.anchor); break;
      case 'm': actions.goto('month', state.anchor); break;
      case 'y': actions.goto('year', state.anchor); break;
      case 'a': actions.goto('agenda', state.anchor); break;
      case 'c': if (writable) openEventForm({ values: { start_date: state.anchor } }); break;
      case 'ArrowLeft': case 'k': shift(-1); break;
      case 'ArrowRight': case 'j': shift(1); break;
      default: return;
    }
  }
  document.addEventListener('keydown', onKey);
  ctx.dispose.add(() => document.removeEventListener('keydown', onKey));

  // ---------------- mobile swipe (change period) ----------------
  let touchStartX = null, touchStartY = null;
  const onTouchStart = e => {
    if (e.target.closest('.cal-event, button, a, input, select, textarea')) { touchStartX = null; return; }
    const t = e.touches[0]; touchStartX = t.clientX; touchStartY = t.clientY;
  };
  const onTouchEnd = e => {
    if (touchStartX == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX, dy = t.clientY - touchStartY;
    touchStartX = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) shift(dx < 0 ? 1 : -1);
  };
  main.addEventListener('touchstart', onTouchStart, { passive: true });
  main.addEventListener('touchend', onTouchEnd, { passive: true });
  ctx.dispose.add(() => { main.removeEventListener('touchstart', onTouchStart); main.removeEventListener('touchend', onTouchEnd); });

  return root;
}

/** #/calendar/new?d=YYYY-MM-DD&t=HH:MM&title=… — opens the create form over the calendar, then navigates to the saved event. */
export function newEventPage(ctx) {
  const view = calendarPage(ctx);
  queueMicrotask(async () => {
    const d = ctx.query.d && VIEW_ISO.test(ctx.query.d) ? ctx.query.d : D.today();
    const saved = await openEventForm({ values: { start_date: d, start_time: ctx.query.t || null, title: ctx.query.title || undefined } });
    ctx.navigate(saved ? `calendar/event/${saved.id}` : 'calendar', { replace: true });
  });
  return view;
}
