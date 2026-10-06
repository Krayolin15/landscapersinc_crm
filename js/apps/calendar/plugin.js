/* =============================================================================
   Calendar plugin — sidebar badge, quick-create, quick actions and the Sage AI
   skills that let people ask about the calendar in plain language.
   ========================================================================== */

import { registerBadge, registerCreate } from '../../ui/shell.js';
import { registerAction } from '../../core/search.js';
import { registerSkill } from '../../ai/skills.js';
import { db } from '../../core/db.js';
import { today, addDays } from '../../core/dates.js';
import { date as fmtDate } from '../../core/format.js';
import { expand } from '../../core/recurrence.js';
import { holidaysBetween } from '../../core/holidays.js';
import { canSeeEvent } from './data.js';
import { parseNaturalDate } from './logic.js';

/** event-form.js pulls in the form/overlay UI kit — load it lazily, only when someone actually creates an event. */
const openCreateForm = async (values) => { const { openEventForm } = await import('./event-form.js'); return openEventForm({ values }); };

const liveEvents = () => db.all('events').filter(e => e.status !== 'cancelled' && canSeeEvent(e));

export default function () {
  registerBadge('calendar', () => {
    const t = today();
    const n = expand(liveEvents(), t, t).length;
    return { n, hot: false };
  });

  registerCreate({ id: 'new-event', label: 'Event', icon: 'calendar-plus', group: 'Workspace', app: 'calendar', run: () => openCreateForm({ start_date: today() }) });

  registerAction({ id: 'cal-today', label: 'Go to today in the calendar', icon: 'calendar', keywords: 'today agenda calendar', app: 'calendar', run: () => (location.hash = `#/calendar?view=day&d=${today()}`) });
  registerAction({ id: 'cal-new-event', label: 'New event', icon: 'calendar-plus', keywords: 'create event meeting schedule new', app: 'calendar', run: () => openCreateForm({ start_date: today() }) });
  registerAction({ id: 'cal-holidays', label: 'Manage public holidays', icon: 'party-popper', keywords: 'holiday holidays public leave', app: 'calendar', run: () => (location.hash = '#/calendar/holidays') });

  registerSkill({
    id: 'calendar-whats-on', app: 'calendar', label: "What's on a day",
    examples: ["what's on friday?", "what's on 10 september", "what's on tomorrow", "what's on this week"],
    keywords: ['whats on', "what's", 'schedule', 'agenda', 'today', 'tomorrow', 'this week', 'next week', 'calendar'],
    run: (q, ents) => {
      // prefer the engine's parsed period (Sage), fall back to the calendar's own parser
      const fromEnts = ents && ents.dates ? { date: ents.dates.from, to: ents.dates.to, label: /^(today|tomorrow|yesterday|this week|next week|last week)$/.test(ents.dates.label || '') ? ents.dates.label : null } : null;
      const parsed = fromEnts || parseNaturalDate(q) || { date: today(), to: today(), label: 'today' };
      if (!parsed.label || parsed.label.length > 24) parsed.label = parsed.date === parsed.to ? fmtDate(parsed.date, 'long') : `${fmtDate(parsed.date)} – ${fmtDate(parsed.to)}`;
      const occs = expand(liveEvents(), parsed.date, parsed.to);
      const href = `#/calendar?view=${parsed.date === parsed.to ? 'day' : 'week'}&d=${parsed.date}`;
      if (!occs.length) return { text: `Nothing is on the calendar for ${parsed.label}.`, actions: [{ label: 'Open calendar', href }], sources: ['events'] };
      const items = occs.slice(0, 10).map(o => ({
        title: `${o.all_day ? 'All day' : (o.start_time || '')} ${o.event.title}`.trim(),
        sub: `Added by ${o.event.created_by_name || 'someone'}`,
        href: `#/calendar/event/${o.event.id}?d=${o.date}`
      }));
      return { text: `${occs.length} event${occs.length === 1 ? '' : 's'} for ${parsed.label}.`, cards: [{ type: 'list', items }], actions: [{ label: 'Open calendar', href }], sources: ['events'] };
    }
  });

  registerSkill({
    id: 'calendar-who-added', app: 'calendar', label: 'Who added an event',
    examples: ['who added the meeting on 10 september', 'who created the friday meeting', 'who entered the site visit'],
    keywords: ['who added', 'who created', 'who entered', 'who put', 'who booked'],
    run: q => {
      const parsed = parseNaturalDate(q);
      const words = q.toLowerCase().replace(/who\s+(added|created|entered|put|booked)(\s+the)?/, '').replace(/\bon\b.*$/, '').trim();
      let pool = liveEvents();
      let ev = null;
      if (parsed) { const occs = expand(pool, parsed.date, parsed.to); ev = (words ? occs.filter(o => o.event.title.toLowerCase().includes(words)) : occs).map(o => o.event)[0]; }
      if (!ev && words) ev = pool.filter(e => e.title.toLowerCase().includes(words))[0];
      if (!ev) return { text: "I couldn't find that event.", sources: ['events'] };
      const when = new Date(ev.created_at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      return { text: `“${ev.title}” was added by ${ev.created_by_name || 'someone'} on ${when}.`, actions: [{ label: 'Open event', href: `#/calendar/event/${ev.id}` }], sources: ['events'] };
    }
  });

  registerSkill({
    id: 'calendar-next-holiday', app: 'calendar', label: 'Next public holiday',
    examples: ['when is the next public holiday', 'next holiday', 'when is the next public holiday in south africa'],
    keywords: ['next public holiday', 'next holiday', 'holiday coming up'],
    run: () => {
      const from = today();
      const upcoming = holidaysBetween(from, addDays(from, 365)).filter(h => h.type === 'public' && h.date >= from).sort((a, b) => a.date.localeCompare(b.date))[0];
      if (!upcoming) return { text: 'No public holidays found in the next year.', sources: ['holidays'] };
      const when = new Date(upcoming.date).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return { text: `${upcoming.name} — ${when}${upcoming.observed ? ' (observed)' : ''}.`, actions: [{ label: 'Open holidays', href: '#/calendar/holidays' }], sources: ['holidays'] };
    }
  });

  registerSkill({
    id: 'calendar-create', app: 'calendar', label: 'Create an event by asking',
    examples: ['create a meeting on friday at 10', 'add an event tomorrow at 2pm', 'schedule a site visit on 10 september at 9'],
    keywords: ['create a meeting', 'schedule', 'add an event', 'book a meeting', 'new event'],
    run: q => {
      const parsed = parseNaturalDate(q);
      if (!parsed) return { text: "I couldn't work out the date — try something like “create a meeting on Friday at 10”.", sources: [] };
      const titleMatch = /(?:create|add|schedule|book)\s+(?:a|an)?\s*(.+?)\s+(?:on|for|at|tomorrow|today)\b/i.exec(q);
      const title = titleMatch ? titleMatch[1].trim() : '';
      const href = `#/calendar/new?d=${parsed.date}${parsed.time ? '&t=' + parsed.time : ''}${title ? '&title=' + encodeURIComponent(title) : ''}`;
      return { text: `Ready to create ${title ? `“${title}”` : 'an event'} on ${parsed.label}${parsed.time ? ' at ' + parsed.time : ''}. Open it to confirm and save.`, actions: [{ label: 'Create event', href }], sources: [] };
    }
  });
}
