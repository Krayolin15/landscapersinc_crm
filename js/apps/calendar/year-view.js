/* =============================================================================
   Calendar — Year view: 12 mini months with a "heat" tint per day showing how
   busy it is (relative to the busiest day this year), and public holidays
   picked out in red.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import * as D from '../../core/dates.js';
import { eventOccurrences, sourceItems } from './data.js';
import { heatLevel } from './logic.js';

export function yearView({ anchor, search, actions }) {
  const year = D.parse(anchor).getFullYear();
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const todayIso = D.today();

  const occs = eventOccurrences(from, to, { search });
  const derived = sourceItems(from, to);
  const counts = new Map();
  const bump = date => counts.set(date, (counts.get(date) || 0) + 1);
  occs.forEach(o => { let d = o.date; while (d <= o.end_date) { bump(d); d = D.addDays(d, 1); } });
  const holidaySet = new Set(derived.filter(x => x.source === 'sa-holidays' && x.category === 'holiday').map(x => x.date));
  const max = Math.max(1, ...counts.values());

  const grid = h('div.cal-yeargrid');
  for (let m = 0; m < 12; m++) {
    const dates = D.monthGrid(year, m);
    const cells = h('div.mm-cells');
    dates.forEach(dt => {
      const inMonth = D.parse(dt).getMonth() === m;
      const count = counts.get(dt) || 0;
      const level = inMonth ? heatLevel(count, max) : -1;
      const isHoliday = inMonth && holidaySet.has(dt);
      cells.appendChild(h('button.mm-cell', {
        class: [inMonth ? '' : 'other', isHoliday ? 'holiday' : '', dt === todayIso ? 'today' : ''].filter(Boolean),
        dataset: level > 0 ? { heat: String(level) } : undefined,
        onClick: () => actions.goto('day', dt),
        title: `${dt}${count ? ` · ${count} event${count === 1 ? '' : 's'}` : ''}`
      }, inMonth ? String(D.parse(dt).getDate()) : ''));
    });
    grid.appendChild(h('div.cal-minimonth',
      h('button.mm-title', { onClick: () => actions.goto('month', `${year}-${String(m + 1).padStart(2, '0')}-01`) }, D.MONTHS[m]),
      h('div.mm-dow', ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => h('span', x))),
      cells));
  }
  return h('div.cal-yearview', grid);
}
