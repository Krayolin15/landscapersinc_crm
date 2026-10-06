/* =============================================================================
   Meet (#/meet) — video meetings on Jitsi (free, no accounts): start an instant
   meeting, schedule one (it goes on the shared calendar with the link and
   reminders), join today's meetings, and meet inside the app window.
   ========================================================================== */

import { h, ensureStyle, uid, copyText } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, card, pageHeader, emptyState, listItem, callout } from '../../ui/components.js';
import { modal, toast, showError } from '../../ui/overlays.js';
import { fieldInput } from '../../ui/form.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { notify } from '../../core/notify.js';
import { today, addDays } from '../../core/dates.js';
import { expand } from '../../core/recurrence.js';
import { CONFIG } from '../../config.js';
import * as fmt from '../../core/format.js';

ensureStyle('lsi-meet', `.meet-frame{width:100%;height:calc(100vh - 220px);min-height:420px;border:0;border-radius:18px;background:#000}`);
const roomUrl = name => `${CONFIG.meetBaseUrl}LandscapersInc-${String(name).replace(/[^A-Za-z0-9]/g, '').slice(0, 40) || uid()}`;

function schedule(pre = {}) {
  const v = { title: 'Meeting', start_date: today(), start_time: '10:00', end_time: '10:30', attendees: [], external_attendees: '', ...pre };
  const f = (label, name, def) => h('div.field', h('label.field-label', label), fieldInput(def, v[name], x => { v[name] = x; }));
  modal({
    title: 'Schedule a video meeting', icon: 'video', tile: 't-clay',
    body: h('div.form-grid', f('Title', 'title', { type: 'text' }), f('Date', 'start_date', { type: 'date' }), f('Start', 'start_time', { type: 'time' }), f('End', 'end_time', { type: 'time' }),
      h('div.field.full', h('label.field-label', 'Team members'), fieldInput({ type: 'refs', ref: 'profiles' }, [], x => { v.attendees = x || []; })),
      h('div.field.full', h('label.field-label', 'Guests (emails, comma separated)'), fieldInput({ type: 'text' }, '', x => { v.external_attendees = x; }))),
    actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Schedule', icon: 'calendar-plus', variant: 'primary', onClick: async () => {
      try {
        const link = roomUrl(`${v.title}-${uid().slice(0, 6)}`);
        const ev = await db.insert('events', { ...v, category: 'meeting', meet_link: link, visibility: 'company', status: 'confirmed', reminders: CONFIG.defaultEventReminders, description: `Video meeting: ${link}` });
        if (v.attendees.length) notify(v.attendees.filter(id => id !== (store.get('user') || {}).id), { title: `Invitation: ${v.title}`, body: `${fmt.date(v.start_date, 'long')} at ${v.start_time}`, icon: 'video', tile: 't-clay', link: `#/calendar/event/${ev.id}`, kind: 'meeting', source_key: `meet|${ev.id}` }).catch(() => {});
        await copyText(link); toast.success('Meeting scheduled', { text: 'Added to the calendar. The link is copied to share with guests.' });
      } catch (e) { showError(e); return false; }
    } }]
  });
}

function page(ctx) {
  const room = ctx.query.room;
  if (room) {
    const url = roomUrl(room);
    return h('div', pageHeader({ title: 'Video meeting', sub: url, icon: 'video', tile: 't-clay', actions: [btn({ label: 'Copy link', icon: 'link', onClick: async () => { await copyText(url); toast.success('Link copied'); } }), h('a.btn', { href: url, target: '_blank', rel: 'noopener' }, icon('external-link', 16), 'Open in new tab'), h('a.btn.btn-ghost', { href: '#/meet' }, 'Leave')] }),
      h('iframe.meet-frame', { src: `${url}#config.prejoinPageEnabled=true`, allow: 'camera; microphone; display-capture; fullscreen; autoplay', title: 'Video meeting' }));
  }
  const occ = expand(db.all('events').filter(e => e.meet_link && e.status !== 'cancelled'), today(), addDays(today(), 14));
  const code = h('input.input', { placeholder: 'Meeting code or link' });
  return h('div',
    pageHeader({ title: 'Meet', sub: 'Video meetings for the team and clients — free, no sign-up for guests.', icon: 'video', tile: 't-clay' }),
    h('div.grid.cols-2', { style: 'margin-bottom:16px' },
      card({ title: 'Start or join', icon: 'video', cls: 'solid' }, h('div.stack',
        btn({ label: 'New meeting now', icon: 'video', variant: 'primary', onClick: () => ctx.navigate(`meet?room=${uid().slice(0, 10)}`) }),
        btn({ label: 'Schedule a meeting', icon: 'calendar-plus', onClick: () => schedule() }),
        h('div.row.gap-8', code, btn({ label: 'Join', onClick: () => { const v = code.value.trim(); if (v) ctx.navigate(`meet?room=${encodeURIComponent(v.split('/').pop().replace(/^LandscapersInc-/, ''))}`); } })))),
      callout('info', 'How it works', 'Meetings run on Jitsi Meet in your browser or phone. Share the link with clients — they don’t need an account. Scheduled meetings appear on everyone’s calendar with reminders.', 'info')),
    card({ title: 'Upcoming video meetings', icon: 'calendar-days', cls: 'solid' },
      occ.length ? h('div.list.divider-list', occ.map(o => listItem({ title: o.event.title, sub: `${fmt.date(o.date, 'full')} ${o.start_time || ''} · added by ${o.event.created_by_name || '—'}`, icon: 'video', tile: 't-clay',
        right: h('div.row.gap-4', h('a.btn.btn-sm.btn-primary', { href: `#/meet?room=${encodeURIComponent(o.event.meet_link.split('/').pop().replace(/^LandscapersInc-/, ''))}` }, 'Join'), h('a.btn.btn-sm.btn-ghost', { href: `#/calendar/event/${o.event.id}` }, 'Details')) })))
        : emptyState({ icon: 'video-off', title: 'No video meetings in the next two weeks' })));
}

export default { id: 'meet', routes: { '': page } };
export { schedule };
