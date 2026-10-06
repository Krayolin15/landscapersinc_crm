/* =============================================================================
   Calendar — Agenda / Schedule view: a flat, grouped-by-day list of what's
   coming up. The default mobile view.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, emptyState } from '../../ui/components.js';
import * as D from '../../core/dates.js';
import * as fmt from '../../core/format.js';
import { eventOccurrences, sourceItems } from './data.js';
import { eventChip, derivedChip } from './event-chip.js';

export function agendaView({ anchor, search, actions, days = 30 }) {
  const from = anchor, to = D.addDays(anchor, days);
  const occs = eventOccurrences(from, to, { search });
  const derived = sourceItems(from, to);

  const byDate = new Map();
  const ensure = d => { if (!byDate.has(d)) byDate.set(d, []); return byDate.get(d); };
  derived.forEach(it => ensure(it.date).push({ kind: 'derived', item: it }));
  occs.forEach(o => ensure(o.date).push({ kind: 'occ', occ: o }));
  const dates = Array.from(byDate.keys()).sort();

  if (!dates.length) {
    return emptyState({
      icon: 'calendar-x', title: 'Nothing scheduled',
      text: search ? `No events match “${search}” in the next ${days} days.` : `Nothing is on the calendar for the next ${days} days.`,
      action: h('button.btn.btn-primary', { onClick: () => actions.onCreate({ date: from }) }, icon('plus', 15), 'Add an event')
    });
  }

  return h('div.cal-agenda', dates.map(d => h('div.cal-agenda-day',
    h('div.aday-head', { class: d === D.today() ? 'today' : '' }, h('b', fmt.date(d, 'full')), d === D.today() ? badge('Today', 'green') : null),
    h('div.aday-list', (byDate.get(d) || [])
      .sort((a, b) => {
        const ta = a.kind === 'occ' && !a.occ.all_day ? (a.occ.start_time || '') : '';
        const tb = b.kind === 'occ' && !b.occ.all_day ? (b.occ.start_time || '') : '';
        return ta.localeCompare(tb);
      })
      .map(it => {
        if (it.kind === 'derived') return h('div.aday-item', derivedChip(it.item), it.item.subtitle ? h('span.small.muted', it.item.subtitle) : null);
        const o = it.occ, ev = o.event;
        const chip = eventChip(o, { showTime: true });
        chip.addEventListener('click', () => actions.onOpen(ev.id, o.date));
        return h('div.aday-item', chip, ev.location ? h('span.small.muted.row.gap-4', icon('map-pin', 12), ev.location) : null);
      }))
  )));
}
