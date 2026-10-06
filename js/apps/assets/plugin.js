import { db } from '../../core/db.js';
import { registerBadge } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { watchDates } from '../_expiry.js';

export default function () {
  watchDates({ id: 'asset-service', app: 'assets', col: 'assets', field: 'next_service_date', what: "Equipment service", title: r => r.name, icon: 'wrench', tile: 't-sun', roles: ["manager","operations","supervisor"], windows: [14,7], when: r => r.status !== 'disposed' });
  watchDates({ id: 'asset-warranty', app: 'assets', col: 'assets', field: 'warranty_expiry', what: "Warranty", title: r => r.name, icon: 'shield', tile: 't-slate', roles: ["manager","operations"], windows: [30], defaultOn: false });
}
void db; void registerBadge; void registerAlertSource; void registerCalendarSource; void watchDates;
