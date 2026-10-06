import { db } from '../../core/db.js';
import { registerBadge } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { watchDates } from '../_expiry.js';

export default function () {
  watchDates({ id: 'cert-expiry', app: 'training', col: 'certificates', field: 'expiry_date', what: "Certificate", title: r => `${r.person_name || ''} — ${r.course || ''}`, icon: 'award', tile: 't-river', roles: ["manager","hr","operations"], windows: [90,30,7] });
}
void db; void registerBadge; void registerAlertSource; void registerCalendarSource; void watchDates;
