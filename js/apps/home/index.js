/* =============================================================================
   Daily Briefing (#/home) — the first screen every morning: the 05:30 executive
   briefing written by the Autonomous Core (or a live preview until it runs),
   the numbers that matter, today's and tomorrow's agenda (who added what),
   everything that needs attention, approvals, my tasks and recent activity.
   Role-aware: field staff see their crew's run-sheet first, finance sees money.
   ========================================================================== */

import { h, ensureStyle } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, kpiTile, emptyState, listItem, callout, skeleton } from '../../ui/components.js';
import { toast, showError } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { canApp, isField } from '../../core/perms.js';
import { today, addDays, nowSA, iso } from '../../core/dates.js';
import { expand } from '../../core/recurrence.js';
import { derivedItems, calendarSources } from '../../core/calendar-sources.js';
import { currentAlerts } from '../../core/notify.js';
import { sumBy } from '../../core/money.js';
import * as fmt from '../../core/format.js';
import { mrr, ageing, lastMonths } from '../_biz.js';

ensureStyle('lsi-home', `
.hero{position:relative;overflow:hidden;border-radius:26px;padding:26px 26px 22px;color:#fff;background:var(--g-aurora, linear-gradient(135deg,#0b2a18,#1f7440 55%,#1e9bc4));box-shadow:var(--shadow-lg);margin-bottom:18px}
.hero:after{content:"";position:absolute;right:-60px;top:-60px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.18),transparent 70%);animation:floaty 9s ease-in-out infinite}
@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(18px)}}
.hero h1{margin:0;font-size:clamp(1.5rem,3.4vw,2.2rem);letter-spacing:-.02em}
.hero .sub{opacity:.85;margin-top:4px}
.hero .chips{margin-top:14px;display:flex;flex-wrap:wrap;gap:8px}
.hero .hchip{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.14);backdrop-filter:blur(6px);font-size:.85rem}
.hero .clock{font-variant-numeric:tabular-nums;font-weight:700}
.brief-sec{padding:10px 0;border-top:1px solid var(--border)}.brief-sec:first-child{border-top:0}
.brief-sec h4{margin:0 0 6px;display:flex;align-items:center;gap:8px}
.brief-item{display:flex;gap:8px;padding:4px 0;font-size:.93rem}.brief-item .dot{margin-top:7px}
.agenda-item{display:grid;grid-template-columns:62px 1fr;gap:10px;padding:9px 0;border-top:1px solid var(--border)}
.agenda-item:first-child{border-top:0}.agenda-item .t{font-variant-numeric:tabular-nums;font-weight:700;color:var(--muted)}
.qa{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.qa a{display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 8px;border-radius:18px;background:var(--surface);border:1px solid var(--border);text-decoration:none;color:inherit;transition:transform .15s,box-shadow .15s}
.qa a:hover{transform:translateY(-3px);box-shadow:var(--shadow-md)}
.qa .li-ico{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;color:#fff}
`);

const SEV = { danger: 'var(--danger)', warn: 'var(--warning)', info: 'var(--info, #1e9bc4)' };
const firstName = u => String((u && (u.name || u.full_name)) || '').split(' ')[0] || 'there';

function hero(user, ctx) {
  const clock = h('span.clock');
  const tick = () => { const d = nowSA(); clock.textContent = `${d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })} · ${d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`; };
  tick(); const t = setInterval(tick, 1000); ctx.dispose.add(() => clearInterval(t));
  const weather = h('span.hchip', icon('cloud-sun', 15), 'Checking the weather…');
  import('../../core/weather.js').then(async W => {
    const { DEPOT } = await import('../../core/geo.js');
    const a = await W.assessDay(DEPOT.lat, DEPOT.lng, today());
    weather.replaceChildren(icon(a.risk === 'dry' ? 'sun' : a.risk === 'storm' ? 'cloud-lightning' : a.risk === 'windy' ? 'wind' : 'cloud-rain', 15), `Mount Edgecombe: ${a.summary || a.risk}`);
  }).catch(() => weather.replaceChildren(icon('cloud-off', 15), 'Weather unavailable offline'));
  let lastRun = null;
  for (const r of db.all('agent_runs')) if (!lastRun || String(r.started_at) > String(lastRun.started_at)) lastRun = r;
  return h('section.hero.anim-fade',
    h('h1', `${fmt.greeting()}, ${firstName(user)}`),
    h('div.sub', 'Here is everything happening at Landscapers Inc. today.'),
    h('div.chips', h('span.hchip', icon('clock', 15), clock), weather,
      h('a.hchip', { href: '#/agent', style: 'color:#fff;text-decoration:none' }, h('span.live-dot'), lastRun ? `Agent active · last run ${fmt.relative(lastRun.started_at)}` : 'Agent ready — runs at 05:00 & 05:30')));
}

function briefingCard(ctx) {
  const body = h('div', skeleton(4));
  const draw = async () => {
    const saved = db.all('briefings').filter(b => b.date === today()).sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)))[0];
    let b = saved, live = false;
    if (!b) {
      try {
        const { composeBriefing } = await import('../../../supabase/functions/_shared/agent/briefing.js');
        const { invoiceState, balanceOf } = await import('../_biz.js');
        const inv = db.all('invoices');
        b = composeBriefing({ date: today(), decisions: db.filter('agent_decisions', d => String(d.created_at || '').startsWith(today())),
          overdueInvoices: inv.filter(i => invoiceState(i) === 'overdue').map(i => ({ ...i, balance: balanceOf(i) })), awaitingPop: inv.filter(i => invoiceState(i) === 'awaiting_pop'),
          expiring: [], approvals: db.filter('agent_decisions', d => d.requires_approval && d.status === 'pending'),
          todayEvents: expand(db.all('events').filter(e => e.status !== 'cancelled'), today(), today()).map(o => ({ time: o.start_time, title: o.event.title, link: `#/calendar/event/${o.event.id}` })), kpis: {} });
        live = true;
      } catch (e) { body.replaceChildren(callout('info', 'Briefing not available yet', 'The Autonomous Core writes the executive briefing at 05:30.', 'sunrise')); return; }
    }
    body.replaceChildren(
      h('p', { style: 'font-size:1.05rem;font-weight:600;margin:0 0 10px' }, b.headline || 'A quiet day so far.'),
      live ? h('div.small.muted', { style: 'margin-bottom:8px' }, 'Live preview — the 05:30 agent will save today’s briefing.') : h('div.small.muted', { style: 'margin-bottom:8px' }, `Written by the ${b.runner === 'cloud' ? 'cloud' : 'in-app'} agent at ${fmt.time(b.generated_at)}`),
      ...(b.sections || []).filter(s => (s.items || []).length).map(s => h('div.brief-sec', h('h4', icon(s.icon || 'dot', 16), s.title),
        ...(s.items || []).slice(0, 6).map(it => h('div.brief-item', h('span.dot', { style: { background: SEV[it.severity] || 'var(--primary)' } }), it.link ? h('a', { href: it.link }, it.text) : h('span', it.text))))));
  };
  draw();
  const run = canApp('agent') ? btn({ label: 'Run briefing now', icon: 'play', size: 'sm', variant: 'ghost', onClick: async () => { try { const { runNow } = await import('../../agent/runner.js'); await runNow('executive_briefing', { force: true }); toast.success('Briefing updated'); draw(); } catch (e) { showError(e, 'Could not run the briefing'); } } }) : null;
  return card({ title: 'Executive briefing', icon: 'sunrise', cls: 'solid', actions: run ? [run] : [] }, body);
}

function kpis() {
  const a = ageing(db.all('invoices'));
  const open = db.filter('leads', l => ['new', 'qualified', 'site_visit', 'quote_sent', 'follow_up'].includes(l.stage));
  const visits = db.filter('visits', v => v.date === today());
  const m = today().slice(0, 7);
  const months = lastMonths(6);
  const received = months.map(x => sumBy(db.filter('payments', p => p.status === 'verified' && String(p.date).startsWith(x)), 'amount'));
  const tiles = [
    canApp('clients') ? kpiTile({ label: 'Monthly recurring revenue', value: mrr(), format: 'money', icon: 'repeat', tile: 't-grass', href: '#/clients/contracts' }) : null,
    canApp('payments') ? kpiTile({ label: 'Owed to us', value: a.total, format: 'money', icon: 'hand-coins', tile: 't-rose', foot: `60+ days: ${fmt.money(a['60+'])}`, href: '#/payments' }) : null,
    canApp('leads') ? kpiTile({ label: 'Open pipeline', value: sumBy(open, l => l.value || 0), format: 'money', icon: 'target', tile: 't-sun', foot: `${open.length} leads`, href: '#/leads' }) : null,
    kpiTile({ label: 'Visits today', value: `${visits.filter(v => v.status === 'completed').length} / ${visits.length}`, icon: 'route', tile: 't-river', foot: 'completed / scheduled', href: '#/schedule' }),
    canApp('payments') ? kpiTile({ label: 'Received this month', value: received[received.length - 1] || 0, format: 'money', icon: 'banknote', tile: 't-forest', spark: received, href: '#/payments?tab=received' }) : null
  ].filter(Boolean);
  void m;
  return h('div.grid.cols-4.stagger', { style: 'margin-bottom:18px' }, tiles.slice(0, 4));
}

function agenda(date, label, user) {
  const occ = expand(db.all('events').filter(e => e.status !== 'cancelled' && (e.visibility !== 'private' || e.created_by === (user && user.id))), date, date);
  const WANT = ['sa-holidays', 'invoice-due', 'lead-followups', 'contract-changes', 'visits'];
  const derived = derivedItems(date, date, calendarSources().filter(x => WANT.includes(x.id) || /holiday/.test(x.id)).map(x => x.id));
  const rows = [...occ.map(o => ({ time: o.all_day ? 'All day' : o.start_time || '', title: o.event.title, sub: `Added by ${o.event.created_by_name || 'someone'}${o.event.location ? ' · ' + o.event.location : ''}`, href: `#/calendar/event/${o.event.id}?d=${date}`, color: o.event.color })),
    ...derived.slice(0, 12).map(d => ({ time: d.time || 'All day', title: d.title, sub: d.subtitle || d.sourceLabel, href: d.link, color: d.color }))].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  return card({ title: label, sub: fmt.date(date, 'full'), icon: 'calendar-days', cls: 'solid', actions: [h('a.btn.btn-ghost.btn-sm', { href: `#/calendar?view=day&d=${date}` }, 'Open')] },
    rows.length ? h('div', rows.map(r => h('a.agenda-item', { href: r.href || '#/calendar', style: 'text-decoration:none;color:inherit' }, h('span.t', r.time), h('div', h('div', { style: 'font-weight:600' }, h('span.dot', { style: { background: r.color || 'var(--primary)', marginRight: '6px' } }), r.title), h('div.small.muted', r.sub))))) : emptyState({ icon: 'calendar-check', title: 'Nothing scheduled', text: 'Enjoy the space — or add something.' }));
}

function attention(ctx) {
  const body = h('div', skeleton(3));
  currentAlerts().then(list => {
    if (!list.length) { body.replaceChildren(emptyState({ icon: 'party-popper', title: 'All clear', text: 'No reminders, expiries or overdue items need you right now.' })); return; }
    body.replaceChildren(h('div.list.divider-list', list.slice(0, 12).map(a => listItem({ title: a.title, sub: a.body, icon: a.icon || 'bell', tile: a.tile || (a.severity === 'danger' ? 't-rose' : a.severity === 'warn' ? 't-sun' : 't-sky'), href: a.link }))),
      list.length > 12 ? h('div.small.muted', { style: 'margin-top:8px' }, `+ ${list.length - 12} more in the notification bell`) : null);
  }).catch(() => body.replaceChildren(emptyState({ icon: 'bell-off', title: 'Could not load alerts' })));
  return card({ title: 'Needs attention', icon: 'bell-ring', cls: 'solid' }, body);
}

function approvals() {
  const pend = db.filter('agent_decisions', d => d.requires_approval && d.status === 'pending');
  if (!pend.length || !canApp('agent')) return null;
  return card({ title: 'Waiting for your approval', sub: `${pend.length} decision${pend.length === 1 ? '' : 's'} by the Autonomous Core`, icon: 'badge-check', cls: 'solid' },
    h('div.list.divider-list', pend.slice(0, 6).map(d => listItem({ title: d.title, sub: d.detail, icon: 'bot', tile: 't-aurora',
      right: h('div.row.gap-4', btn({ label: 'Approve', size: 'sm', variant: 'primary', onClick: async () => { try { const m = await import('../../agent/adapters.js'); await m.approveDecision(d); toast.success('Approved'); } catch (e) { showError(e); } } }),
        btn({ label: 'Reject', size: 'sm', variant: 'ghost', onClick: async () => { try { const m = await import('../../agent/adapters.js'); await m.rejectDecision(d); toast.success('Rejected'); } catch (e) { showError(e); } } })) }))),
    h('a.btn.btn-ghost.btn-sm', { href: '#/agent', style: 'margin-top:8px' }, 'All decisions'));
}

function myTasks(user) {
  const mine = db.filter('tasks', t => t.status !== 'done' && (!t.assignee_id || t.assignee_id === (user && user.id)) && (!t.due_date || t.due_date <= addDays(today(), 2)));
  mine.sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
  return card({ title: 'My tasks', icon: 'list-todo', cls: 'solid', actions: [h('a.btn.btn-ghost.btn-sm', { href: '#/tasks' }, 'All tasks')] },
    mine.length ? h('div.list.divider-list', mine.slice(0, 8).map(t => listItem({ title: t.title, sub: [t.list_name, t.due_date ? fmt.dueLabel(t.due_date) : 'no due date'].filter(Boolean).join(' · '), icon: t.priority === 'high' || t.priority === 'urgent' ? 'flag' : 'circle', tile: t.due_date && t.due_date < today() ? 't-rose' : 't-sun', href: `#/tasks?open=${encodeURIComponent(t.id)}` })))
      : emptyState({ icon: 'check-check', title: 'Nothing due', text: 'No open tasks due in the next two days.' }));
}

function crewToday(user) {
  const emp = user && db.find('employees', e => e.profile_id === user.id);
  const visits = db.filter('visits', v => v.date === today() && (!emp || !emp.crew_id || v.crew_id === emp.crew_id)).sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
  return card({ title: emp && emp.crew_id ? `Your run-sheet — ${(db.get('crews', emp.crew_id) || {}).name || 'crew'}` : 'Today’s run-sheet', icon: 'route', cls: 'solid', actions: [h('a.btn.btn-primary.btn-sm', { href: '#/schedule' }, 'Open Live Dispatch')] },
    visits.length ? h('div.list.divider-list', visits.map(v => listItem({ title: v.site_name, sub: [v.start_time && `from ${v.start_time}`, v.finish_by && `finish by ${v.finish_by}`, v.instructions].filter(Boolean).join(' · '), icon: v.status === 'completed' ? 'circle-check' : 'map-pin', tile: v.status === 'completed' ? 't-grass' : 't-river', href: `#/schedule/visit/${encodeURIComponent(v.id)}` })))
      : emptyState({ icon: 'map', title: 'No visits today' }));
}

function activity() {
  const when = r => r.at || r.created_at;
  const rows = [];
  for (const r of db.all('audit_log')) {
    const w = String(when(r));
    if (rows.length === 10 && w <= String(when(rows[9]))) continue;
    let i = rows.length; while (i > 0 && String(when(rows[i - 1])) < w) i--;
    rows.splice(i, 0, r); if (rows.length > 10) rows.pop();
  }
  const verb = a => (/insert|create/.test(a) ? 'added' : /delete|remove/.test(a) ? 'deleted' : /restore/.test(a) ? 'restored' : 'updated');
  return card({ title: 'Recent activity', icon: 'history', cls: 'solid' },
    rows.length ? h('div.list.divider-list', rows.map(r => listItem({ title: `${r.user_name || r.created_by_name || 'Someone'} ${verb(r.action)} ${r.label || r.collection}`, sub: `${fmt.relative(when(r))} · ${r.collection}`, icon: r.action === 'insert' ? 'plus' : r.action === 'delete' ? 'trash-2' : 'pencil', tile: 't-slate', href: r.record_id ? `#/record/${r.collection}/${encodeURIComponent(r.record_id)}` : undefined })))
      : emptyState({ icon: 'history', title: 'No changes yet today', text: 'Every add, edit and delete by anyone appears here.' }));
}

function quickActions() {
  const QA = [['invoices/new', 'New invoice', 'receipt', 't-violet', 'invoices'], ['quotes/new', 'New quote', 'file-signature', 't-clay', 'quotes'], ['leads', 'New lead', 'target', 't-sun', 'leads'], ['calendar/new', 'New event', 'calendar-plus', 't-river', 'calendar'],
    ['finance?tab=expenses', 'Log expense', 'receipt-text', 't-forest', 'finance'], ['payments?tab=pop', 'Match a POP', 'scan-search', 't-rose', 'payments'], ['forms', 'Fill a checklist', 'clipboard-check', 't-grass', 'forms'], ['assistant', 'Ask Sage AI', 'sparkles', 't-aurora', 'assistant']];
  return h('div.qa.stagger', { style: 'margin-bottom:18px' }, QA.filter(q => canApp(q[4])).map(([href, label, ic, tile]) => h('a', { href: `#/${href}` }, h('div', { class: ['li-ico', tile] }, icon(ic, 20)), h('span.small', { style: 'font-weight:600;text-align:center' }, label))));
}

function page(ctx) {
  const user = store.get('user');
  const field = isField();
  // each card sits in a slot (display:contents, so the grid and spacing are unchanged)
  const slots = {};
  const slot = (key, build) => { const el = h('div', { style: 'display:contents' }); const draw = () => el.replaceChildren(...[build()].filter(Boolean)); slots[key] = draw; draw(); return el; };
  const left = [slot('brief', () => (field ? crewToday(user) : briefingCard(ctx))), slot('approvals', () => approvals()), slot('today', () => agenda(today(), 'Today', user)), slot('tomorrow', () => agenda(addDays(today(), 1), 'Tomorrow', user))];
  const right = [slot('attention', () => attention(ctx)), slot('tasks', () => myTasks(user)), slot('crew', () => (field ? briefingCard(ctx) : crewToday(user))), slot('activity', () => activity())];
  const root = h('div',
    hero(user, ctx),
    field ? null : slot('kpis', () => kpis()),
    quickActions(),
    h('div.grid', { style: 'grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:16px;align-items:start' }, h('div.stack', left), h('div.stack', right)));
  // stay live: a save redraws only the cards that show that kind of record (never the whole page)
  const AFFECTS = {
    tasks: ['tasks', 'attention'],
    events: ['today', 'tomorrow', 'brief', 'attention'],
    agent_decisions: ['approvals', 'brief', 'attention'],
    briefings: ['brief', 'crew'],
    visits: ['crew', 'brief', 'kpis', 'today', 'tomorrow'],
    invoices: ['kpis', 'attention', 'brief', 'today', 'tomorrow'], payments: ['kpis', 'attention'], leads: ['kpis', 'today', 'tomorrow', 'attention'],
    contracts: ['kpis', 'today', 'tomorrow'], contract_changes: ['today', 'tomorrow'], audit_log: ['activity']
  };
  const pending = new Set();
  let timer = null;
  const flush = () => {
    timer = null;
    if (document.hidden) return;              // a hidden tab catches up when it is shown again
    const keys = [...pending]; pending.clear();
    for (const k of keys) { const draw = slots[k]; if (draw) draw(); }
  };
  const queue = keys => { keys.forEach(k => pending.add(k)); if (!timer) timer = setTimeout(flush, 800); };
  for (const [col, keys] of Object.entries(AFFECTS)) ctx.dispose.add(db.on(col, () => queue(keys)));
  const onShow = () => { if (!document.hidden && pending.size && !timer) timer = setTimeout(flush, 50); };
  document.addEventListener('visibilitychange', onShow);
  ctx.dispose.add(() => { clearTimeout(timer); document.removeEventListener('visibilitychange', onShow); });
  void iso;
  return root;
}

export default { id: 'home', routes: { '': page } };
