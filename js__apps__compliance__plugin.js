import { db } from '../../core/db.js';
import { registerBadge } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { watchDates } from '../_expiry.js';

export default function () {
  watchDates({ id: 'compliance-expiry', app: 'compliance', col: 'compliance_docs', field: 'expiry_date', what: "Compliance document", title: r => r.name, icon: 'scale', tile: 't-slate', roles: ["manager","finance","hr"], windows: [90,30,7] });
}
void db; void registerBadge; void registerAlertSource; void registerCalendarSource; void watchDates;
