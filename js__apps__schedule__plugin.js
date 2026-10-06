import { registerBadge, registerCreate } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerAction } from '../../core/search.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { registerSkill } from '../../ai/skills.js';
import { db } from '../../core/db.js';
import { today, addDays, nowSA } from '../../core/dates.js';

const crewName = id => (db.get('crews', id) || {}).name || 'Unassigned';

export default function () {
  registerBadge('schedule', () => {
    const t = today(); const late = nowSA().getHours() >= 17;
    const open = db.filter('visits', v => v.date === t && !['completed', 'cancelled', 'rescheduled', 'weather_postponed', 'no_access', 'skipped'].includes(v.status)).length;
    return { n: open, hot: late && open > 0 };
  });
  registerCreate({ id: 'new-visit', label: 'Visit', icon: 'map-pin', group: 'Operations', app: 'schedule', run: async () => { const { openRecordForm } = await import('../../ui/form.js'); openRecordForm('visits', { values: { date: today(), status: 'scheduled', kind: 'maintenance' } }); } });
  registerAction({ id: 'dispatch-today', label: 'Today’s dispatch board', icon: 'route', keywords: 'dispatch schedule crews run sheet today', app: 'schedule', run: () => (location.hash = '#/schedule') });
  registerAction({ id: 'dispatch-generate', label: 'Generate visits from contracts', icon: 'wand-sparkles', keywords: 'generate visits schedule contracts month', app: 'schedule', run: () => (location.hash = '#/schedule/generate') });
  registerCalendarSource({ id: 'visits', label: 'Maintenance rounds', color: '#1f7440', icon: 'route', app: 'schedule', defaultOn: false,
    items: (from, to) => db.filter('visits', v => v.date >= from && v.date <= to && v.status !== 'cancelled').map(v => ({ id: `vis-${v.id}`, date: v.date, time: v.start_time || null, title: v.site_name, subtitle: crewName(v.crew_id), color: (db.get('crews', v.crew_id) || {}).color, link: `#/schedule/visit/${encodeURIComponent(v.id)}`, category: 'maintenance' })) });
  registerAlertSource(() => {
    const t = today(), out = [];
    const unassigned = db.filter('visits', v => v.date === t && !v.crew_id && v.status === 'scheduled');
    if (unassigned.length) out.push({ key: `visits-unassigned|${t}`, title: `${unassigned.length} visit${unassigned.length === 1 ? '' : 's'} today without a crew`, body: unassigned.slice(0, 4).map(v => v.site_name).join(', '), link: '#/schedule', severity: 'warn', roles: ['manager', 'operations', 'supervisor'], icon: 'user-x', tile: 't-rose' });
    for (const c of db.filter('crews', x => x.active !== false && !x.leader_id)) out.push({ key: `crew-no-leader|${c.id}`, title: `${c.name} has no team leader / driver`, body: 'Set one so dispatch can assign a vehicle.', link: `#/record/crews/${encodeURIComponent(c.id)}`, severity: 'info', roles: ['manager', 'operations'], icon: 'steering-wheel', tile: 't-sun' });
    const pending = db.filter('agent_decisions', d => d.kind === 'weather_reschedule' && d.status === 'pending');
    if (pending.length) out.push({ key: `weather-pending|${t}|${pending.length}`, title: `${pending.length} rain reschedule${pending.length === 1 ? '' : 's'} waiting for approval`, body: 'Approve or reject in Autonomous Core.', link: '#/agent', severity: 'warn', roles: ['manager', 'operations'], icon: 'cloud-rain', tile: 't-sky' });
    return out;
  });
  registerSkill({
    id: 'dispatch-day', app: 'schedule', label: 'Who is working where',
    examples: ['what is crew 1 doing today', 'what is scheduled tomorrow', 'who is at carron glen this week'],
    keywords: ['crew', 'scheduled', 'schedule', 'dispatch', 'visit', 'visits', 'working', 'run sheet', 'tomorrow', 'today'],
    run: q => {
      const low = q.toLowerCase();
      const d = /tomorrow/.test(low) ? addDays(today(), 1) : today();
      const week = /this week/.test(low);
      const to = week ? addDays(d, 6) : d;
      let vs = db.filter('visits', v => v.date >= d && v.date <= to && v.status !== 'cancelled');
      const crew = db.all('crews').find(c => low.includes(c.name.toLowerCase().split(' —')[0]) || c.name.toLowerCase().split(/[—,]/).slice(1).join(' ').split(' ').some(w => w.length > 3 && low.includes(w)));
      if (crew) vs = vs.filter(v => v.crew_id === crew.id);
      const site = db.all('sites').concat(db.all('clients')).find(s => s.name && s.name.length > 4 && low.includes(s.name.toLowerCase().split(' ').slice(0, 2).join(' ')));
      if (site) vs = vs.filter(v => v.site_id === site.id || v.client_id === site.id || (v.site_name || '').toLowerCase().includes(site.name.toLowerCase().split(' ')[0]));
      return { text: vs.length ? `${vs.length} visit${vs.length === 1 ? '' : 's'}${crew ? ` for ${crew.name}` : ''}${site ? ` at ${site.name}` : ''} ${week ? 'this week' : d === today() ? 'today' : 'tomorrow'}.` : 'Nothing scheduled for that.',
        cards: vs.length ? [{ type: 'list', items: vs.slice(0, 15).map(v => ({ title: `${v.date} · ${v.site_name}`, sub: `${crewName(v.crew_id)} · ${v.status}`, href: `#/schedule/visit/${encodeURIComponent(v.id)}`, icon: 'map-pin' })) }] : [],
        actions: [{ label: 'Open Live Dispatch', href: `#/schedule?d=${d}` }], sources: ['visits', 'crews'] };
    }
  });
}
