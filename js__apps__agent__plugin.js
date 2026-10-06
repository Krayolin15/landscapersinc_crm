/* =============================================================================
   Autonomous Core — plugin: sidebar badge, an alert per approval waiting, a
   (default-off) calendar layer for the daily agent schedule, Sage AI skills,
   and starting the local/safety-net agent runner. Kept light — everything
   heavier than js__core__db.js and js__core__dates.js is imported lazily.
   ========================================================================== */

import { registerBadge, registerCreate } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { registerAction } from '../../core/search.js';
import { db } from '../../core/db.js';
import { today, addDays, range } from '../../core/dates.js';
import { isWorkingDay } from '../../core/holidays.js';

export default function () {
  registerBadge('agent', () => {
    const n = db.count('agent_decisions', d => d.requires_approval && d.status === 'pending');
    return { n, hot: n > 0 };
  });

  registerCreate({ id: 'agent-run-now', label: 'Run an agent job now', icon: 'play', group: 'Workspace', app: 'agent', run: () => (location.hash = '#/agent') });
  registerAction({ id: 'agent-hub', label: 'Autonomous Core — dispatch, reminders, approvals', icon: 'bot', keywords: 'agent autonomous automation approvals decisions outbox cron', app: 'agent', run: () => (location.hash = '#/agent') });

  registerAlertSource(() => db.filter('agent_decisions', d => d.requires_approval && d.status === 'pending').map(d => ({
    key: `agent-approval|${d.id}`, title: 'Agent approval waiting', body: d.title, link: '#/agent?tab=approvals',
    severity: 'warn', roles: ['manager', 'operations', 'finance'], icon: 'clipboard-check', tile: 't-sun'
  })));

  // Off by default: the two fixed daily jobs, so the schedule is visible on the shared
  // Calendar for anyone curious, without crowding it for everyone else.
  registerCalendarSource({
    id: 'agent-runs', label: 'Scheduled agent jobs', color: '#7b61ff', icon: 'bot', app: 'agent', defaultOn: false,
    items: (from, to) => range(from, to).filter(isWorkingDay).flatMap(d => ([
      { id: `agent-dispatch-${d}`, date: d, time: '05:00', title: 'Agent: morning dispatch', subtitle: 'Weather-aware route planning', link: '#/agent', category: 'agent' },
      { id: `agent-briefing-${d}`, date: d, time: '05:30', title: 'Agent: executive briefing', subtitle: "Today's summary on Home", link: '#/agent', category: 'agent' }
    ]))
  });

  registerSkills();

  if (typeof window !== 'undefined') {
    // one tab runs the agent; every tab sees its decisions through the shared database
    import('../../core/leader.js').then(({ whenLeader }) => whenLeader(() => setTimeout(() => { import('../../agent/runner.js').then(m => m.startLocalAgent()).catch(() => {}); }, 20000))).catch(() => {});
  }
}

function registerSkills() {
  import('../../ai/skills.js').then(({ registerSkill }) => {
    registerSkill({
      id: 'agent-overnight', app: 'agent', label: 'What the agent did overnight',
      examples: ['what did the agent do overnight', 'what did the agent do last night', 'summarise last night’s agent runs'],
      keywords: ['overnight', 'agent did', 'last night', 'this morning', 'agent runs'],
      run: () => {
        const date = today();
        const runs = db.filter('agent_runs', r => String(r.started_at || '').slice(0, 10) === date).sort((a, b) => String(a.started_at || '').localeCompare(String(b.started_at || '')));
        if (!runs.length) return { text: 'The agent has not run yet today.', actions: [{ label: 'Run a job now', href: '#/agent' }] };
        const ok = runs.filter(r => r.status === 'ok').length, failed = runs.filter(r => r.status === 'failed').length;
        return {
          text: `${runs.length} run${runs.length === 1 ? '' : 's'} today (${ok} ok${failed ? `, ${failed} failed` : ''}).`,
          cards: [{ type: 'list', items: runs.map(r => ({ title: `${r.kind.replace(/_/g, ' ')} — ${r.status}`, sub: r.summary || r.error || '', href: '#/agent?tab=runs', icon: r.status === 'failed' ? 'triangle-alert' : 'circle-check' })) }],
          actions: [{ label: 'Open the run log', href: '#/agent?tab=runs' }], sources: ['agent_runs']
        };
      }
    });

    registerSkill({
      id: 'agent-approvals', app: 'agent', label: 'Approvals waiting',
      examples: ['any approvals waiting', 'what needs my approval', 'agent approvals'],
      keywords: ['approval', 'approve', 'waiting', 'pending', 'needs my'],
      run: () => {
        const rows = db.filter('agent_decisions', d => d.requires_approval && d.status === 'pending');
        if (!rows.length) return { text: 'Nothing is waiting for approval right now.', actions: [{ label: 'Open Autonomous Core', href: '#/agent' }] };
        return {
          text: `${rows.length} decision${rows.length === 1 ? ' is' : 's are'} waiting for your approval.`,
          cards: [{ type: 'list', items: rows.map(d => ({ title: d.title, sub: d.detail || d.kind, href: '#/agent?tab=approvals', icon: 'clipboard-check' })) }],
          actions: [{ label: 'Review approvals', href: '#/agent?tab=approvals' }], sources: ['agent_decisions']
        };
      }
    });

    registerSkill({
      id: 'agent-weather', app: 'agent', label: 'Weather in a suburb',
      examples: ['what’s the weather tomorrow in Umhlanga', 'is it going to rain in Ballito', 'weather in Kloof'],
      keywords: ['weather', 'rain', 'raining', 'forecast', 'storm', 'wind', 'sunny'],
      run: async q => {
        const [{ resolveLocation }, { assessDay, weatherCodeLabel }] = await Promise.all([import('../../core/geo.js'), import('../../core/weather.js')]);
        const loc = resolveLocation(q);
        if (!loc) return { text: 'I couldn’t tell which suburb you meant — try naming one, e.g. "weather in Umhlanga".', actions: [{ label: 'Open the weather board', href: '#/agent?tab=weather' }] };
        const date = /tomorrow/i.test(q) ? addDays(today(), 1) : today();
        try {
          const a = await assessDay(loc.lat, loc.lng, date);
          const { label } = weatherCodeLabel(a.risk === 'storm' ? 95 : a.risk === 'wet' ? 63 : a.risk === 'showers' ? 51 : 0);
          return { text: `${loc.name}, ${date === today() ? 'today' : 'tomorrow'}: ${label.toLowerCase()}. ${a.summary}.`, cards: [{ type: 'kpis', items: [{ label: 'Rain chance', value: `${a.rainProbMax}%` }, { label: 'Rain', value: `${a.rainMm}mm` }, { label: 'Wind', value: `${a.windMax} km/h` }] }], actions: [{ label: 'Full weather board', href: '#/agent?tab=weather' }], sources: ['weather'] };
        } catch { return { text: `Couldn’t reach the weather service for ${loc.name} right now — try again shortly.`, actions: [{ label: 'Open the weather board', href: '#/agent?tab=weather' }] }; }
      }
    });

    registerSkill({
      id: 'agent-plan-tomorrow', app: 'agent', label: 'Plan tomorrow’s dispatch',
      examples: ['plan tomorrow’s dispatch', 'what does tomorrow’s route look like', 'preview tomorrow’s crews'],
      keywords: ['plan tomorrow', 'dispatch tomorrow', 'tomorrow’s route', 'preview dispatch'],
      run: async () => {
        const date = addDays(today(), 1);
        try {
          const { computePlanPreview } = await import('./dispatch-tab.js');
          const result = await computePlanPreview(date);
          const visits = result.assignments.reduce((a, x) => a + x.visits.length, 0);
          const postponed = result.decisions.filter(d => d.kind === 'weather_reschedule').length;
          if (!result.assignments.length && !postponed) return { text: `Nothing is scheduled for ${date} yet.`, actions: [{ label: 'Open the dispatch plan', href: `#/agent?tab=dispatch&date=${date}` }] };
          return {
            text: `Tomorrow (${date}): ${visits} visit${visits === 1 ? '' : 's'} across ${result.assignments.length} crew${result.assignments.length === 1 ? '' : 's'}${postponed ? `, ${postponed} weather postponement${postponed === 1 ? '' : 's'}` : ''}.`,
            cards: [{ type: 'list', items: result.assignments.map(a => ({ title: a.crew.name, sub: `${a.visits.length} visit(s) · ${a.km} km`, icon: 'route' })) }],
            actions: [{ label: 'Open the full plan', href: `#/agent?tab=dispatch&date=${date}` }], sources: ['visits', 'crews']
          };
        } catch (e) { return { text: `Could not build tomorrow’s preview: ${e.message || e}`, actions: [{ label: 'Open Autonomous Core', href: '#/agent' }] }; }
      }
    });
  }).catch(() => {});
}
