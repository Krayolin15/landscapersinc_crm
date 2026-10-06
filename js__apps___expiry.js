/* =============================================================================
   Expiry & due-date watcher used by many plugins: certificates, medicals,
   licences, services, compliance documents, warnings… One call registers
   (1) reminders at 60 / 30 / 7 days and on/after the date, and (2) a layer on
   the shared calendar. Alert keys are stable so each reminder fires once.
   ========================================================================== */

import { registerAlertSource } from '../core/notify.js';
import { registerCalendarSource } from '../core/calendar-sources.js';
import { db } from '../core/db.js';
import { today, diffDays } from '../core/dates.js';

/**
 * watchDates({ id, app, col, field, what, title(rec), link(rec), roles, icon, tile, color,
 *              when(rec) -> bool, windows:[60,30,7], calendar:true, calendarLabel, defaultOn })
 */
export function watchDates(o) {
  const windows = o.windows || [60, 30, 7];
  const active = r => r[o.field] && (!o.when || o.when(r));
  registerAlertSource(() => {
    const t = today(), out = [];
    for (const r of db.filter(o.col, active)) {
      const d = diffDays(t, r[o.field]);
      let tier = null;
      if (d < 0) tier = 'expired'; else if (d === 0) tier = 'today'; else { const w = windows.filter(x => d <= x).sort((a, b) => a - b)[0]; if (w != null) tier = `${w}d`; }
      if (!tier) continue;
      out.push({
        key: `${o.id}|${r.id}|${tier}`, title: d < 0 ? `${o.what} expired` : d === 0 ? `${o.what} due today` : `${o.what} due in ${d} day${d === 1 ? '' : 's'}`,
        body: `${o.title(r)} — ${d < 0 ? `since ${r[o.field]}` : r[o.field]}`, link: o.link ? o.link(r) : `#/record/${o.col}/${encodeURIComponent(r.id)}`,
        due: r[o.field], severity: d < 0 ? 'danger' : d <= 7 ? 'warn' : 'info', roles: o.roles, icon: o.icon, tile: o.tile
      });
    }
    return out;
  });
  if (o.calendar !== false) registerCalendarSource({
    id: o.id, label: o.calendarLabel || `${o.what} dates`, color: o.color || '#b54a4a', icon: o.icon, app: o.app, defaultOn: o.defaultOn ?? true,
    items: (from, to) => db.filter(o.col, r => active(r) && r[o.field] >= from && r[o.field] <= to).map(r => ({ id: `${o.id}-${r.id}`, date: r[o.field], title: `${o.what}: ${o.title(r)}`, link: o.link ? o.link(r) : `#/record/${o.col}/${encodeURIComponent(r.id)}`, category: o.category || 'compliance' }))
  });
}
