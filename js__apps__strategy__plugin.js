import { db } from '../../core/db.js';
import { registerBadge } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { watchDates } from '../_expiry.js';

export default function () {
  watchDates({ id: 'goal-due', app: 'strategy', col: 'goals', field: 'due_date', what: "Goal", title: r => r.title, icon: 'mountain', tile: 't-clay', roles: ["manager"], windows: [14], when: r => !['done', 'dropped'].includes(r.status), defaultOn: false });
}
void db; void registerBadge; void registerAlertSource; void registerCalendarSource; void watchDates;
