import { db } from '../../core/db.js';
import { registerBadge } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { watchDates } from '../_expiry.js';

export default function () {
  watchDates({ id: 'medical-expiry', app: 'medicals', col: 'medicals', field: 'expiry_date', what: "Medical", title: r => r.person_name || 'Employee', icon: 'heart-pulse', tile: 't-rose', roles: ["manager","hr"], windows: [60,30,7] });
}
void db; void registerBadge; void registerAlertSource; void registerCalendarSource; void watchDates;
