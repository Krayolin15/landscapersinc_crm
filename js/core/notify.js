/* =============================================================================
   Notifications & reminders.

   notify(userIds|'all'|role list, { title, body, icon, tile, link, kind, source_key })
   startReminders()  — runs every CONFIG.reminderTickSeconds while the app is open:
     1. Calendar reminders (per event, e.g. 30 min + 1 day before) -> toast, browser
        notification and an entry in the bell inbox. Fired once per occurrence.
     2. Business alerts from registered sources (certificates expiring, invoices
        overdue, vehicle services due, follow-ups...) -> one notification per key
        per person, re-raised when severity escalates.
   registerAlertSource(fn) — apps add sources: fn() -> [{ key, title, body, link,
        due (ISO date), severity:'info'|'warn'|'danger', roles:[...]|'*', icon, tile }]
   In Supabase mode the same reminders are also emailed by the scheduled Edge
   Function (supabase/functions/reminders) so people are reminded even when the
   app is closed.
   ========================================================================== */

import { CONFIG } from '../config.js';
import { db } from './db.js';
import { idb } from './idb.js';
import { store, bus } from './bus.js';
import { expand } from './recurrence.js';
import { today, addDays, at, nowSA } from './dates.js';
import * as fmt from './format.js';
import { toast } from '../ui/overlays.js';

const sources = [];
let timer = null;
let fired = null;

export function registerAlertSource(fn) { sources.push(fn); alertCache = null; }

// The alert list only changes when business data changes or the day rolls over, so it is
// worked out once and reused by the 30-second tick and the Home "Needs attention" card.
// Writes to these collections never change an alert, so they don't invalidate it.
const NO_ALERTS = new Set(['notifications', 'audit_log', 'agent_runs', 'predictions', 'ml_models', 'outbox', 'weather_cache', 'briefings']);
let dataVersion = 0;
let alertCache = null;
bus.on('db:change', e => { if (!e || !NO_ALERTS.has(e.col)) dataVersion++; });
async function allAlerts() {
  const me = store.get('user');
  const key = `${today()}|${dataVersion}|${sources.length}|${me ? me.id + me.role : ''}`;
  if (alertCache && alertCache.key === key) return alertCache.list;
  const list = [];
  for (const src of sources) {
    try { list.push(...((await src()) || [])); } catch (e) { console.warn('alert source failed', e); }
  }
  alertCache = { key, list };
  return list;
}

export async function notify(to, n) {
  const profiles = db.all('profiles').filter(p => p.status !== 'suspended');
  let ids;
  if (to === 'all') ids = profiles.map(p => p.id);
  else if (Array.isArray(to) && to.every(x => typeof x === 'string' && profiles.some(p => p.role === x)) && !to.some(x => profiles.some(p => p.id === x))) ids = profiles.filter(p => to.includes(p.role) || ['owner', 'admin'].includes(p.role)).map(p => p.id);
  else ids = [].concat(to).filter(Boolean);
  const rows = [];
  for (const user_id of [...new Set(ids)]) {
    if (n.source_key && db.find('notifications', x => x.user_id === user_id && x.source_key === n.source_key)) continue;
    rows.push(notificationRow(user_id, n));
  }
  return db.insertMany('notifications', rows);
}
const notificationRow = (user_id, n) => ({ user_id, title: n.title, body: n.body || '', icon: n.icon || 'bell', tile: n.tile || 't-forest', link: n.link || null, kind: n.kind || 'info', source_key: n.source_key || null });

export function unreadCount(userId = (store.get('user') || {}).id) {
  return db.all('notifications').filter(n => n.user_id === userId && !n.read_at).length;
}

export async function markAllRead(userId = (store.get('user') || {}).id) {
  const now = new Date().toISOString();
  const unread = db.all('notifications').filter(x => x.user_id === userId && !x.read_at);
  await db.updateMany('notifications', unread.map(n => ({ id: n.id, patch: { read_at: now } }))); // one save, one redraw
}

export function browserNotify(title, body, link) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/icon-192.png', tag: title + body });
    n.onclick = () => { window.focus(); if (link) location.hash = link.replace(/^#/, ''); n.close(); };
  } catch { /* some mobile browsers only allow notifications from the service worker */ }
}
export async function requestBrowserPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

async function loadFired() {
  if (fired) return fired;
  const arr = (await idb.kvGet('reminders.fired')) || [];
  fired = new Set(arr.slice(-3000));
  return fired;
}
async function saveFired() { await idb.kvSet('reminders.fired', Array.from(fired).slice(-3000)); }

async function tick() {
  const me = store.get('user');
  if (!me) return;
  await loadFired();
  const firedBefore = fired.size;
  const queued = [];   // new bell entries, written together at the end (one save, one redraw)
  const add = n => { if (!db.find('notifications', x => x.user_id === me.id && x.source_key === n.source_key)) queued.push(notificationRow(me.id, n)); };
  const now = nowSA();
  const from = today(), to = addDays(from, 8);

  // 1. calendar reminders for events I created or attend (or company-wide ones)
  const mine = db.all('events').filter(e => e.visibility !== 'private' || e.created_by === me.id || (Array.isArray(e.attendees) && e.attendees.includes(me.id)));
  for (const occ of expand(mine, addDays(from, -1), to)) {
    const ev = occ.event;
    const involved = ev.created_by === me.id || (Array.isArray(ev.attendees) && ev.attendees.includes(me.id)) || !(ev.attendees && ev.attendees.length);
    if (!involved) continue;
    const reminders = Array.isArray(ev.reminders) ? ev.reminders : CONFIG.defaultEventReminders;
    const startAt = at(occ.date, occ.start_time || '07:00');
    for (const mins of reminders) {
      const due = new Date(startAt.getTime() - mins * 60000);
      const key = `ev|${me.id}|${occ.key}|${mins}`;
      if (now >= due && now - due < 36 * 3600e3 && now < new Date(startAt.getTime() + 3600e3) && !fired.has(key)) {
        fired.add(key);
        const when = occ.start_time ? `${fmt.date(occ.date, 'dow')} at ${occ.start_time}` : fmt.date(occ.date, 'dow');
        const title = `${ev.title}`;
        const body = `${mins >= 1440 ? 'Tomorrow' : mins >= 60 ? `In ${Math.round(mins / 60)} h` : `In ${mins} min`} · ${when}${ev.location ? ' · ' + ev.location : ''} · added by ${ev.created_by_name || 'someone'}`;
        add({ title: `⏰ ${title}`, body, icon: 'alarm-clock', tile: 't-river', link: `#/calendar/event/${ev.id}?d=${occ.date}`, kind: 'reminder', source_key: key });
        toast(title, { kind: 'info', icon: 'alarm-clock', text: body, ms: 9000, action: { label: 'Open', onClick: () => (location.hash = `#/calendar/event/${ev.id}?d=${occ.date}`) } });
        browserNotify(`Reminder: ${title}`, body, `#/calendar/event/${ev.id}`);
      }
    }
  }

  // 2. my tasks due today / overdue — one digest per day
  const dayKey = `tasks|${me.id}|${from}`;
  if (!fired.has(dayKey) && now.getHours() >= 7) {
    const due = db.all('tasks').filter(t => t.assignee_id === me.id && t.status !== 'done' && t.due_date && t.due_date <= from);
    if (due.length) {
      fired.add(dayKey);
      add({ title: `${due.length} task${due.length === 1 ? '' : 's'} due`, body: due.slice(0, 3).map(t => t.title).join(' · '), icon: 'list-todo', tile: 't-sun', link: '#/tasks', kind: 'task', source_key: dayKey });
    }
  }

  // 3. business alerts
  for (const a of await allAlerts()) {
    {
      const allowed = !a.roles || a.roles === '*' || a.roles.includes(me.role) || ['owner', 'admin'].includes(me.role);
      if (!allowed) continue;
      const key = `al|${me.id}|${a.key}|${a.severity || 'info'}`;
      if (fired.has(key)) continue;
      fired.add(key);
      add({ title: a.title, body: a.body, icon: a.icon || (a.severity === 'danger' ? 'octagon-alert' : 'triangle-alert'), tile: a.tile || (a.severity === 'danger' ? 't-rose' : a.severity === 'warn' ? 't-sun' : 't-river'), link: a.link, kind: 'alert', source_key: key });
    }
  }
  if (fired.size !== firedBefore) await saveFired();
  if (queued.length) await db.insertMany('notifications', queued);
  bus.emit('notifications:tick');
}

export function startReminders() {
  if (timer) return;
  setTimeout(tick, 2500);
  timer = setInterval(tick, CONFIG.reminderTickSeconds * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
export function stopReminders() { clearInterval(timer); timer = null; }

/** Collect current alerts from all sources without notifying (Home "Needs attention" panel). */
export async function currentAlerts() {
  const me = store.get('user');
  const all = await allAlerts();
  return all.filter(a => !a.roles || a.roles === '*' || (me && (a.roles.includes(me.role) || ['owner', 'admin'].includes(me.role))))
    .sort((a, b) => ({ danger: 0, warn: 1, info: 2 }[a.severity || 'info'] - { danger: 0, warn: 1, info: 2 }[b.severity || 'info']) || String(a.due || '').localeCompare(String(b.due || '')));
}
