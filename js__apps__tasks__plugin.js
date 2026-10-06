import { registerBadge, registerCreate } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { registerSkill } from '../../ai/skills.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { today } from '../../core/dates.js';

const mine = t => { const u = store.get('user') || {}; return !t.assignee_id || t.assignee_id === u.id; };

export default function () {
  registerBadge('tasks', () => { const n = db.filter('tasks', t => t.status !== 'done' && mine(t) && t.due_date && t.due_date <= today()).length; return { n, hot: n > 0 }; });
  registerCreate({ id: 'new-task', label: 'Task', icon: 'list-todo', group: 'Workspace', app: 'tasks', run: async () => (await import('./index.js')).openTask({}) });
  registerAlertSource(() => db.filter('tasks', t => t.status !== 'done' && t.due_date && t.due_date <= today() && t.assignee_id).map(t => ({
    key: `task-due|${t.id}|${t.due_date}`, title: t.due_date < today() ? 'Task overdue' : 'Task due today', body: t.title, link: `#/tasks?open=${encodeURIComponent(t.id)}`, due: t.due_date,
    severity: t.due_date < today() ? 'warn' : 'info', roles: '*', icon: 'list-todo', tile: 't-sun', user_id: t.assignee_id
  })));
  registerCalendarSource({ id: 'tasks-due', label: 'Task due dates', color: '#f2b42f', icon: 'list-todo', app: 'tasks', defaultOn: true,
    items: (from, to) => db.filter('tasks', t => t.status !== 'done' && t.due_date >= from && t.due_date <= to && mine(t)).map(t => ({ id: `task-${t.id}`, date: t.due_date, time: t.due_time || null, title: `☐ ${t.title}`, link: `#/tasks?open=${encodeURIComponent(t.id)}`, category: 'deadline' })) });
  registerSkill({
    id: 'tasks-mine', app: 'tasks', label: 'My tasks',
    examples: ['what are my tasks', 'what is overdue', 'tasks due this week'],
    keywords: ['task', 'tasks', 'to do', 'todo', 'overdue'],
    run: () => {
      const open = db.filter('tasks', t => t.status !== 'done' && mine(t)).sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')));
      const over = open.filter(t => t.due_date && t.due_date < today());
      return { text: `You have ${open.length} open task${open.length === 1 ? '' : 's'}${over.length ? `, ${over.length} overdue` : ''}.`, cards: [{ type: 'list', items: open.slice(0, 10).map(t => ({ title: t.title, sub: t.due_date || 'no due date', href: `#/tasks?open=${encodeURIComponent(t.id)}`, icon: 'list-todo' })) }], actions: [{ label: 'Open Tasks', href: '#/tasks' }], sources: ['tasks'] };
    }
  });
}
