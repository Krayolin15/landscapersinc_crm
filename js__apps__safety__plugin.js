import { db } from '../../core/db.js';
import { registerBadge } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { watchDates } from '../_expiry.js';

export default function () {
  watchDates({ id: 'appt-review', app: 'safety', col: 'appointments', field: 'review_date', what: "H&S appointment review", title: r => `${r.person_name || ''} — ${r.appointment || ''}`, icon: 'stamp', tile: 't-violet', roles: ["manager","hr","operations"], windows: [30,7] });
  registerAlertSource(() => db.filter('incidents', i => i.status !== 'closed').map(i => ({ key: 'incident-open|' + i.id, title: 'Incident still open', body: (i.number ? i.number + ' · ' : '') + (i.type || '') + ' ' + (i.date || ''), link: '#/record/incidents/' + encodeURIComponent(i.id), severity: i.severity === 'high' || i.severity === 'major' ? 'danger' : 'warn', roles: ['manager', 'operations', 'hr'], icon: 'siren', tile: 't-rose' })));
  registerBadge('safety', () => { const n = db.filter('incidents', i => i.status !== 'closed').length; return { n, hot: n > 0 }; });
}
void db; void registerBadge; void registerAlertSource; void registerCalendarSource; void watchDates;
