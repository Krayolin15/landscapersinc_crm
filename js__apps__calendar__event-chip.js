/* =============================================================================
   Calendar — shared event "chip" rendering: the small colored block used in
   month/week/day/agenda views, plus the hover card (attribution, time,
   location, recurrence) shown on pointer-hover. Derived items (holidays,
   invoice due dates, expiries…) get a simpler read-only chip.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { attribution } from '../../ui/components.js';
import * as fmt from '../../core/format.js';
import { eventColor } from './data.js';
import { describe as describeRecurrence } from '../../core/recurrence.js';

let hoverCard = null, hoverTimer = null;
function hideHoverCard() { clearTimeout(hoverTimer); hoverTimer = null; if (hoverCard) { hoverCard.remove(); hoverCard = null; } }
document.addEventListener('scroll', hideHoverCard, true);
document.addEventListener('pointerdown', hideHoverCard, true);

function buildHoverBody(occ) {
  const ev = occ.event;
  const timeLabel = occ.all_day ? 'All day' : `${fmt.time(occ.start_time)}${occ.end_time ? ' – ' + fmt.time(occ.end_time) : ''}`;
  return h('div.cal-hover',
    h('div.row.gap-8', h('span.ce-dot', { style: { background: eventColor(ev) } }), h('b', ev.title)),
    h('div.small.muted', fmt.date(occ.date, 'full'), ' · ', timeLabel),
    ev.location ? h('div.small.row.gap-4', icon('map-pin', 13), ev.location) : null,
    ev.recurrence && ev.recurrence !== 'none' ? h('div.small.muted.row.gap-4', icon('repeat', 13), describeRecurrence(ev)) : null,
    h('div', { style: 'margin-top:8px' }, attribution(ev)));
}

/** Attach a delayed hover card to any element; getOcc() returns the occurrence to show (or null to skip). */
export function attachHoverCard(el, getOcc) {
  el.addEventListener('pointerenter', e => {
    if (e.pointerType === 'touch') return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      hideHoverCard();
      const occ = getOcc();
      if (!occ) return;
      hoverCard = h('div.cal-hover-card', buildHoverBody(occ));
      document.body.appendChild(hoverCard);
      const r = el.getBoundingClientRect();
      let x = r.left, y = r.bottom + 6;
      const w = hoverCard.offsetWidth, hh = hoverCard.offsetHeight;
      if (x + w > innerWidth - 8) x = innerWidth - w - 8;
      if (y + hh > innerHeight - 8) y = Math.max(8, r.top - hh - 6);
      hoverCard.style.left = Math.max(8, x) + 'px';
      hoverCard.style.top = Math.max(8, y) + 'px';
    }, 380);
  });
  el.addEventListener('pointerleave', () => { clearTimeout(hoverTimer); hideHoverCard(); });
}

/** A real events-collection occurrence: coloured, hoverable, draggable by the caller. */
export function eventChip(occ, { showTime = true, dense = false } = {}) {
  const ev = occ.event;
  const color = eventColor(ev);
  const timeStr = !occ.all_day && showTime && occ.start_time ? fmt.time(occ.start_time) : '';
  const chip = h('div.cal-event', {
    class: dense ? 'dense' : '', style: { '--ev-color': color },
    dataset: { eventId: ev.id, occDate: occ.date }, tabindex: '0', role: 'button', 'aria-label': `${ev.title}${timeStr ? ', ' + timeStr : ''}`
  }, h('span.ce-dot'), timeStr ? h('span.ce-time', timeStr) : null, h('span.ce-title', ev.title));
  attachHoverCard(chip, () => occ);
  chip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chip.click(); } });
  return chip;
}

/** A read-only derived item (SA holiday, invoice due date, expiry…). */
export function derivedChip(item) {
  const chip = h('div.cal-event.derived', { style: { '--ev-color': item.color || '#8e9b93' }, title: item.subtitle || item.title, tabindex: item.link ? '0' : '-1', role: item.link ? 'link' : undefined },
    item.icon ? icon(item.icon, 12) : h('span.ce-dot'), h('span.ce-title', item.title));
  if (item.link) {
    chip.addEventListener('click', e => { e.stopPropagation(); location.hash = item.link.replace(/^#/, ''); });
    chip.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); chip.click(); } });
  }
  return chip;
}
