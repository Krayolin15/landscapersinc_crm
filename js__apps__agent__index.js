/* =============================================================================
   Autonomous Core (#/agent) — the 24/7 agent's cockpit: status, the next
   scheduled runs with "Run now" buttons, today's briefing, the weather-aware
   dispatch plan (with a map), the weather board, the approvals queue, the
   decision log, the message outbox and settings.

   Everything here reads live records only — the agent's own writes (agent_runs,
   agent_decisions, briefings, outbox) plus whatever js__agent__adapters.js and
   the cloud Edge Function (supabase/functions/agent-run) produced. Nothing on
   this page is invented.
   ========================================================================== */

import { h, ensureStyle } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, pageHeader, kpiTile, tabs, emptyState, callout, listItem, busy } from '../../ui/components.js';
import { toast, showError } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { IS_SUPABASE } from '../../config.js';
import { today, nowSA } from '../../core/dates.js';
import * as fmt from '../../core/format.js';
import { agentSettings, alreadyRanToday, JOBS } from '../../agent/adapters.js';
import { runNow, isLocalAgentRunning } from '../../agent/runner.js';
import { dispatchTab, weatherTab } from './dispatch-tab.js';
import { approvalsTab, decisionsTab, outboxTab, runsTab } from './queues.js';
import { settingsTab } from './settings-tab.js';
import { JOB_META } from './meta.js';

ensureStyle('js__apps__agent__style.css');

function nextDailyTime(hhmm) {
  const [h1, m1] = hhmm.split(':').map(Number);
  const now = nowSA();
  const next = new Date(now); next.setHours(h1, m1, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}
function nextHourlySlot() {
  const now = nowSA();
  const next = new Date(now); next.setMinutes(0, 0, 0); next.setHours(next.getHours() + 1);
  if (next.getHours() > 18 || next.getHours() < 7) { next.setDate(next.getDate() + (next.getHours() > 18 ? 1 : 0)); next.setHours(7, 0, 0, 0); }
  return next;
}
const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Same cloud/local/paused read the top-bar telemetry chip uses (js__ui__telemetry.js), for this page's hero. */
export function agentOverallStatus() {
  const settings = agentSettings();
  const allOff = settings.jobsEnabled && Object.keys(settings.jobsEnabled).length && Object.values(settings.jobsEnabled).every(v => v === false);
  const runs = db.all('agent_runs').filter(r => r.status && r.status !== 'running').sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')));
  const cloudRun = runs.find(r => r.runner === 'cloud');
  if (allOff) return { state: 'paused', label: 'Paused', sub: 'No jobs are enabled', last: null };
  if (cloudRun) return { state: 'cloud', label: 'Cloud agent active', sub: `Last cloud run ${fmt.relative(cloudRun.started_at)}`, last: cloudRun.started_at };
  if (runs[0]) return { state: 'local', label: 'Local agent', sub: `Runs while this browser is open — last ran ${fmt.relative(runs[0].started_at)}`, last: runs[0].started_at };
  return { state: 'local', label: 'Local agent', sub: 'Runs while this browser is open — has not run yet', last: null };
}

function scheduleCard(ctx) {
  const date = today();
  const rows = JOBS.map(job => {
    const meta = JOB_META[job];
    const lastRun = db.list('agent_runs', { where: r => r.kind === job, sort: '-started_at', limit: 1 })[0];
    const ranToday = ['morning_dispatch', 'executive_briefing'].includes(job) ? alreadyRanToday(job, date) : (lastRun && String(lastRun.started_at || '').slice(0, 10) === date ? lastRun : null);
    const nextAt = meta.kind === 'daily' ? hhmm(nextDailyTime(meta.time)) : meta.kind === 'hourly' ? hhmm(nextHourlySlot()) : null;
    return { job, meta, lastRun, ranToday, nextAt };
  });
  const runOne = (job, btnEl) => busy(btnEl, async () => {
    try { const r = await runNow(job); toast.success(`${JOB_META[job].label} ran`, { text: r && r.summary ? r.summary : (r && r.headline) || undefined }); ctx.refresh(); }
    catch (e) { showError(e, `${JOB_META[job].label} failed`); }
  });
  const row = r => {
    const main = h('div.agent-job-main',
      h('div.row.gap-8', h('strong', r.meta.label), r.ranToday ? badge('ran today', 'green') : null),
      h('div.small.muted', r.meta.blurb),
      h('div.xs.muted', r.meta.schedule));
    const right = h('div.agent-job-right',
      h('div.small', r.lastRun ? `Last run ${fmt.relative(r.lastRun.started_at)}` : 'Never run'),
      r.nextAt ? h('div.xs.muted', `Next ≈ ${r.nextAt} SAST`) : null,
      btn({ label: 'Run now', icon: 'play', size: 'sm', variant: 'soft', onClick: e => runOne(r.job, e.currentTarget) }));
    return h('div.agent-job-row', h('div', { class: ['li-ico', r.meta.tile] }, icon(r.meta.icon, 18)), main, right);
  };
  return card({ title: 'Scheduled jobs', icon: 'calendar-clock', cls: 'solid', sub: 'Cloud schedule from Admin → Go live, step 07 — or run any job by hand right now.' },
    h('div.agent-jobs', rows.map(row)));
}

function briefingCard() {
  const b = db.list('briefings', { sort: '-date', limit: 1 })[0];
  if (!b) return card({ title: "Today's briefing", icon: 'sunrise', cls: 'solid' }, emptyState({ icon: 'sunrise', title: 'No briefing yet', text: 'Runs automatically at 05:30 SAST, or click Run now on Executive briefing above.' }));
  const SEV_COLOR = { danger: 'red', warn: 'gold', info: 'blue' };
  return card({ title: `Briefing · ${fmt.date(b.date, 'long')}`, sub: b.date === today() ? "Today's briefing" : 'Most recent briefing', icon: 'sunrise', tile: 't-sun', cls: 'solid' },
    h('p', { style: 'font-weight:600;margin-bottom:12px' }, b.headline),
    h('div.grid.cols-2.gap-12', (b.sections || []).map(s => h('div.agent-briefing-section',
      h('div.row.gap-6', { style: 'margin-bottom:6px' }, icon(s.icon || 'info', 15), h('b.small', s.title)),
      h('div.stack.tight', (s.items || []).slice(0, 6).map(it => h(it.link ? 'a' : 'div', { href: it.link, class: ['agent-briefing-item', it.severity ? `sev-${it.severity}` : ''] }, badge('', SEV_COLOR[it.severity] || 'gray', { dot: true }), h('span', it.text)))))))
  );
}

function overview(ctx) {
  const status = agentOverallStatus();
  const runsToday = db.filter('agent_runs', r => String(r.started_at || '').slice(0, 10) === today());
  const pendingApprovals = db.filter('agent_decisions', d => d.requires_approval && d.status === 'pending');
  const outboxQueued = db.filter('outbox', o => ['queued', 'needs_approval'].includes(o.status));
  const failedToday = runsToday.filter(r => r.status === 'failed');

  const accentColor = status.state === 'paused' ? 'var(--warning)' : status.state === 'cloud' ? 'var(--success)' : 'var(--sun-500)';
  return h('div.stack',
    card({ cls: 'agent-hero solid', accent: accentColor },
      h('div.row.gap-12', { style: 'align-items:center' },
        h('span', { class: ['live-dot', status.state === 'paused' ? 'warn' : ''], style: status.state === 'cloud' ? 'background:var(--success)' : status.state === 'local' ? 'background:var(--sun-500)' : '' }),
        h('div', h('h2', { style: 'margin:0' }, status.label), h('div.small.muted', status.sub))),
      failedToday.length ? badge(`${failedToday.length} failed run${failedToday.length === 1 ? '' : 's'} today`, 'red') : badge('All systems normal', 'green')),
    h('div.grid.cols-4.stagger',
      kpiTile({ label: 'Runs today', value: runsToday.length, icon: 'history', tile: 't-slate', href: '#/agent?tab=runs' }),
      kpiTile({ label: 'Approvals waiting', value: pendingApprovals.length, icon: 'clipboard-check', tile: pendingApprovals.length ? 't-sun' : 't-forest', href: '#/agent?tab=approvals' }),
      kpiTile({ label: 'Outbox queued', value: outboxQueued.length, icon: 'send', tile: 't-violet', href: '#/agent?tab=outbox' }),
      kpiTile({ label: 'Decisions logged', value: db.count('agent_decisions'), icon: 'sparkles', tile: 't-aurora', href: '#/agent?tab=decisions' })),
    scheduleCard(ctx),
    briefingCard(),
    callout('info', 'How the agent runs', h('span',
      IS_SUPABASE()
        ? 'This workspace is connected to Supabase. As soon as pg_cron + the agent-run Edge Function are deployed (Admin → Go live, step 07), these jobs run every day at 05:00/05:30 and hourly from 07:00–18:00 — even with nobody logged in. Until then (or as a safety net if a cloud run is ever missed) the agent also runs from any open browser tab, after 05:00.'
        : 'This workspace is in local mode: the agent runs only while this browser tab is open (it checks every 5 minutes, and right after 05:00 SAST each day). For true 24/7 operation — the agent working overnight with nobody logged in — switch to Supabase (js__config.js) and deploy the Edge Function and the cron schedule (Admin → Go live, step 07).'),
      'bot'));
}

function shell(ctx, active, render) {
  const body = h('div');
  const draw = () => body.replaceChildren(h('div.anim-fade', render(ctx)));
  draw();
  return h('div',
    pageHeader({ title: 'Autonomous Core', sub: 'The 24/7 agent: weather-aware dispatch, reminders, POP matching, expiry watch and approvals.', icon: 'bot', tile: 't-aurora',
      actions: [isLocalAgentRunning() ? badge('running now', 'green', { icon: 'loader' }) : null] }),
    tabs([
      { id: 'overview', label: 'Overview', icon: 'layout-dashboard' },
      { id: 'dispatch', label: 'Dispatch plan', icon: 'route' },
      { id: 'weather', label: 'Weather', icon: 'cloud-sun' },
      { id: 'approvals', label: 'Approvals', icon: 'clipboard-check', count: db.count('agent_decisions', d => d.requires_approval && d.status === 'pending') || undefined },
      { id: 'decisions', label: 'Decisions', icon: 'sparkles' },
      { id: 'runs', label: 'Runs', icon: 'history' },
      { id: 'outbox', label: 'Outbox', icon: 'send', count: db.count('outbox', o => ['queued', 'needs_approval'].includes(o.status)) || undefined },
      { id: 'settings', label: 'Settings', icon: 'sliders-horizontal' }
    ], active, id => (location.hash = `#/agent?tab=${id}`)),
    body);
}

const TABS = { overview, dispatch: dispatchTab, weather: weatherTab, approvals: approvalsTab, decisions: decisionsTab, runs: runsTab, outbox: outboxTab, settings: settingsTab };

function home(ctx) {
  const tab = TABS[ctx.query.tab] ? ctx.query.tab : 'overview';
  return shell(ctx, tab, TABS[tab]);
}

export default {
  id: 'agent',
  routes: { '': home }
};
void listItem;
