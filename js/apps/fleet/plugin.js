import { db } from '../../core/db.js';
import { registerBadge } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { watchDates } from '../_expiry.js';

export default function () {
  watchDates({ id: 'veh-licence', app: 'fleet', col: 'vehicles', field: 'licence_expiry', what: "Vehicle licence", title: r => `${r.name || ''} ${r.registration || ''}`.trim(), icon: 'badge-alert', tile: 't-rose', roles: ["manager","operations"] });
  watchDates({ id: 'veh-service', app: 'fleet', col: 'vehicles', field: 'next_service_date', what: "Vehicle service", title: r => `${r.name || ''} ${r.registration || ''}`.trim(), icon: 'wrench', tile: 't-sun', roles: ["manager","operations"], windows: [14,7] });
}
void db; void registerBadge; void registerAlertSource; void registerCalendarSource; void watchDates;
