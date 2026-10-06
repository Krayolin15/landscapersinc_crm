import { db } from '../../core/db.js';
import { registerBadge } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { watchDates } from '../_expiry.js';

export default function () {
  watchDates({ id: 'hr-warning', app: 'people', col: 'hr_actions', field: 'valid_until', what: "Warning validity", title: r => `${r.employee_name || ''} — ${r.type || ''}`, icon: 'gavel', tile: 't-rose', roles: ["manager","hr"], windows: [7], when: r => r.status === 'open', defaultOn: false });
  registerCalendarSource({ id: 'birthdays', label: 'Staff birthdays', color: '#d9467a', icon: 'cake', app: 'people', defaultOn: true,
    items: (from, to) => { const out = []; for (const e of db.filter('employees', x => x.date_of_birth && x.status === 'active')) { for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) { const d = y + e.date_of_birth.slice(4); if (d >= from && d <= to) out.push({ id: 'bd-' + e.id + '-' + y, date: d, title: '🎂 ' + (e.known_as || e.first_name || e.full_name) + '’s birthday', link: '#/record/employees/' + encodeURIComponent(e.id), category: 'people' }); } } return out; } });
}
void db; void registerBadge; void registerAlertSource; void registerCalendarSource; void watchDates;
