/* =============================================================================
   Calendar — full event detail page (#/calendar/event/:id and
   #/record/events/:id). Shows attribution, attendees, reminders, the
   recurrence description, and the Join video / Copy link / Duplicate /
   Delete / Add to my tasks / Email attendees actions.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, pageHeader, card, kv, attribution, avatarStack, emptyState } from '../../ui/components.js';
import { toast, showError, menu } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { can } from '../../core/perms.js';
import { store } from '../../core/bus.js';
import * as fmt from '../../core/format.js';
import { recordLink } from '../../ui/entity.js';
import { describe as describeRecurrence } from '../../core/recurrence.js';
import { EVENT_CATEGORIES } from '../../schema/workspace.js';
import { eventColor, canSeeEvent } from './data.js';
import { openEventForm, deleteEventFlow, duplicateEventFlow } from './event-form.js';
import { minutesReminderLabel } from './logic.js';

export function eventDetailPage(id, ctx) {
  const root = h('div');
  const draw = () => {
    const ev = db.get('events', id);
    if (!ev || !canSeeEvent(ev)) {
      root.replaceChildren(emptyState({
        icon: 'calendar-x', title: ev ? 'This is a private event' : 'Event not found',
        text: ev ? 'You do not have access to this event.' : 'It may have been moved to the trash.',
        action: h('a.btn.btn-primary', { href: '#/calendar' }, 'Back to calendar')
      }));
      return;
    }
    const occDate = (ctx.query && ctx.query.d) || ev.start_date;
    const category = EVENT_CATEGORIES.find(c => c.value === ev.category);
    const color = eventColor(ev);
    const attendees = (ev.attendees || []).map(pid => db.get('profiles', pid)).filter(Boolean);
    const guestEmails = String(ev.external_attendees || '').split(',').map(s => s.trim()).filter(Boolean);
    const client = ev.client_id && db.get('clients', ev.client_id);

    const actions = [
      ev.meet_link ? btn({ label: 'Join video', icon: 'video', variant: 'soft', onClick: () => window.open(ev.meet_link, '_blank', 'noopener') }) : null,
      btn({
        label: 'Copy link', icon: 'link', variant: 'ghost',
        onClick: () => { const url = location.origin + location.pathname + `#/calendar/event/${ev.id}`; navigator.clipboard ? navigator.clipboard.writeText(url).then(() => toast.success('Link copied')) : toast.info('Link', { text: url }); }
      }),
      can('write', 'events') ? btn({ label: 'Edit', icon: 'pencil', onClick: () => openEventForm({ id: ev.id, occDate }) }) : null,
      h('button.btn.btn-ghost.btn-icon', {
        'aria-label': 'More', onClick: e => menu(e.currentTarget, [
          { label: 'Duplicate', icon: 'copy', onClick: () => duplicateEventFlow(ev) },
          {
            label: 'Add to my tasks', icon: 'list-todo', onClick: async () => {
              try { await db.insert('tasks', { title: ev.title, due_date: occDate, assignee_id: (store.get('user') || {}).id || null, related_collection: 'events', related_id: ev.id }); toast.success('Added to your tasks'); }
              catch (e2) { showError(e2); }
            }
          },
          (attendees.length || guestEmails.length) ? {
            label: 'Email attendees', icon: 'mail', onClick: () => {
              const emails = [...attendees.map(a => a.email).filter(Boolean), ...guestEmails];
              location.hash = `mail/compose?to=${encodeURIComponent(emails.join(','))}&subject=${encodeURIComponent(ev.title)}`;
            }
          } : null,
          can('delete', 'events') ? '-' : null,
          can('delete', 'events') ? { label: 'Delete', icon: 'trash-2', danger: true, onClick: async () => { if (await deleteEventFlow(ev, occDate)) location.hash = '#/calendar'; } } : null
        ], { align: 'right' })
      }, icon('ellipsis-vertical'))
    ];

    root.replaceChildren(
      pageHeader({
        crumbs: [{ label: 'Calendar', href: '#/calendar' }, { label: ev.title }],
        title: ev.title, sub: attribution(ev), icon: 'calendar-days', tile: 't-river', actions
      }),
      h('div.chips', { style: 'margin:-8px 0 16px' },
        category ? badge(category.label, 'forest', { icon: 'tag' }) : null,
        h('span.badge', { style: `background:${color}22;color:${color}` }, ev.calendar_id ? db.label('calendars', ev.calendar_id) : 'No calendar'),
        ev.status === 'cancelled' ? badge('Cancelled', 'red') : null,
        ev.status === 'tentative' ? badge('Tentative', 'gold') : null,
        ev.visibility === 'private' ? badge('Private', 'violet', { icon: 'eye-off' }) : null),
      h('div.grid.cols-2',
        card({ title: 'Details', icon: 'info', cls: 'solid' },
          kv([
            ['When', h('div', h('div', fmt.date(occDate, 'full')),
              !ev.all_day && ev.start_time ? h('div.muted', `${fmt.time(ev.start_time)}${ev.end_time ? ' – ' + fmt.time(ev.end_time) : ''}`) : h('div.muted', 'All day'))],
            ['Location', ev.location || null],
            ['Client', client ? h('a', { href: recordLink('clients', client.id) }, db.label('clients', client)) : null],
            ['Repeats', ev.recurrence && ev.recurrence !== 'none' ? describeRecurrence(ev) : 'Does not repeat'],
            ['Video meeting', ev.meet_link ? h('a', { href: ev.meet_link, target: '_blank', rel: 'noopener' }, ev.meet_link) : null]
          ]),
          ev.description ? h('div', { style: 'margin-top:14px;white-space:pre-wrap' }, ev.description) : null),
        h('div.stack',
          card({ title: 'Attendees', icon: 'users', cls: 'solid' },
            (attendees.length || guestEmails.length)
              ? h('div.stack.tight',
                attendees.map(a => h('div.row.gap-8', avatarStack([a]), h('span', a.name))),
                guestEmails.length ? h('div.small.muted', guestEmails.join(', ')) : null)
              : h('p.muted', 'No attendees added.')),
          card({ title: 'Reminders', icon: 'alarm-clock', cls: 'solid' },
            (ev.reminders || []).length
              ? h('div.chips', ev.reminders.map(m => badge(minutesReminderLabel(m).replace(' before', ''), 'blue')))
              : h('p.muted', 'No reminders set.')))));
  };
  draw();
  ctx.dispose.add(db.on('events', e => { if (!e.rec || e.rec.id === id || (e.prev && e.prev.id === id)) draw(); }));
  return root;
}
