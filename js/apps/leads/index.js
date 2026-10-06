/* =============================================================================
   Leads & pipeline — kanban by stage (drag cards between columns), follow-ups
   due today / overdue, the cold-call and retirement-village prospect lists with
   one-tap call logging, and the funnel.
   ========================================================================== */

import { h, ensureStyle } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, pageHeader, kpiTile, tabs, emptyState, listItem, callout, seg } from '../../ui/components.js';
import { modal, toast, showError, prompt } from '../../ui/overlays.js';
import { entityDetailPage, entityListPage, recordLink } from '../../ui/entity.js';
import { openRecordForm, fieldInput } from '../../ui/form.js';
import { chart } from '../../ui/charts.js';
import { celebrate } from '../../ui/animate.js';
import { db } from '../../core/db.js';
import { can } from '../../core/perms.js';
import { today, addDays, diffDays } from '../../core/dates.js';
import { sumBy } from '../../core/money.js';
import * as fmt from '../../core/format.js';
import { LEAD_STAGES } from '../../schema/business.js';
import { waLink } from '../_biz.js';

ensureStyle('lsi-kanban', `
.kanban{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(250px,1fr);gap:12px;overflow-x:auto;padding-bottom:10px;scroll-snap-type:x mandatory}
.kb-col{background:var(--surface-2);border-radius:18px;padding:10px;min-height:200px;scroll-snap-align:start;display:flex;flex-direction:column;gap:8px;transition:background .2s}
.kb-col.over{background:var(--primary-soft);outline:2px dashed var(--primary)}
.kb-head{display:flex;align-items:center;gap:8px;padding:4px 6px 8px;font-weight:700}
.kb-head .sum{margin-left:auto;font-size:var(--fs-xs);color:var(--muted);font-weight:600}
.kb-card{background:var(--surface-solid);border:1px solid var(--border);border-radius:14px;padding:10px 12px;cursor:grab;box-shadow:var(--shadow-sm);transition:transform .15s,box-shadow .15s}
.kb-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}
.kb-card.dragging{opacity:.5;transform:rotate(2deg)}
.kb-card .t{font-weight:650;line-height:1.25}.kb-card .s{font-size:var(--fs-xs);color:var(--muted);margin-top:3px}
.kb-card .f{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:var(--fs-xs)}
`);

const OPEN = ['new', 'qualified', 'site_visit', 'quote_sent', 'follow_up'];
const STAGE_COLORS = { new: 'blue', qualified: 'violet', site_visit: 'gold', quote_sent: 'clay', follow_up: 'gold', won: 'green', lost: 'red', nurture: 'gray', closed_no_opportunity: 'gray' };
const stageLabel = s => (LEAD_STAGES.find(x => x.value === s) || {}).label || s;
const followState = l => (!OPEN.includes(l.stage) ? null : !l.follow_up_date ? 'none' : l.follow_up_date < today() ? 'overdue' : l.follow_up_date === today() ? 'today' : 'later');

async function moveStage(l, stage) {
  if (l.stage === stage) return;
  const patch = { stage, last_contact: today() };
  if (stage === 'lost') { const r = await prompt('Why was it lost? (helps the lead-scoring model learn)', { title: `Lost: ${l.name}`, ok: 'Save' }); if (r === null) return; patch.lost_reason = r || null; }
  try { await db.update('leads', l.id, patch); if (stage === 'won') { celebrate(); toast.success('Deal won! 🎉', { text: l.name }); } else toast.success(`Moved to ${stageLabel(stage)}`); } catch (e) { showError(e); }
}

function pipelinePage(ctx) {
  let view = ctx.query.view || 'board';
  let showClosed = false;
  const body = h('div');
  const kpis = h('div.grid.cols-4.stagger', { style: 'margin-bottom:18px' });
  const drawKpis = () => {
    const all = db.all('leads'), open = all.filter(l => OPEN.includes(l.stage)), won = all.filter(l => l.stage === 'won'), lost = all.filter(l => l.stage === 'lost');
    const due = open.filter(l => ['overdue', 'today'].includes(followState(l)));
    kpis.replaceChildren(
      kpiTile({ label: 'Open pipeline', value: sumBy(open, l => l.value || 0), format: 'money', icon: 'git-branch', tile: 't-sun', foot: `${open.length} open leads` }),
      kpiTile({ label: 'Won', value: sumBy(won, l => l.value || 0), format: 'money', icon: 'trophy', tile: 't-grass', foot: `${won.length} deals` }),
      kpiTile({ label: 'Win rate', value: won.length + lost.length ? (won.length / (won.length + lost.length)) * 100 : 0, format: 'pct', icon: 'percent', tile: 't-violet', foot: `${won.length} won · ${lost.length} lost` }),
      kpiTile({ label: 'Follow-ups due', value: due.length, icon: 'phone-forwarded', tile: due.length ? 't-rose' : 't-forest', foot: `${open.filter(l => followState(l) === 'none').length} with no date`, onClick: () => { view = 'follow'; vs.replaceWith(vs = viewSeg()); draw(); } }));
  };
  const board = () => {
    const stages = LEAD_STAGES.filter(s => showClosed || OPEN.includes(s.value) || ['won', 'lost'].includes(s.value));
    return h('div.kanban', stages.map(s => {
      const leads = db.filter('leads', l => l.stage === s.value).sort((a, b) => String(a.follow_up_date || '9').localeCompare(String(b.follow_up_date || '9')));
      const col = h('div.kb-col', {
        onDragover: e => { e.preventDefault(); col.classList.add('over'); }, onDragleave: () => col.classList.remove('over'),
        onDrop: e => { e.preventDefault(); col.classList.remove('over'); const id = e.dataTransfer.getData('text/lead'); const l = db.get('leads', id); if (l) moveStage(l, s.value); }
      },
      h('div.kb-head', badge(s.label, STAGE_COLORS[s.value]), h('span.muted.small', String(leads.length)), h('span.sum', fmt.moneyCompact(sumBy(leads, l => l.value || 0)))),
      ...(['won', 'lost'].includes(s.value) && !showClosed ? leads.slice(0, 6) : leads).map(l => {
        const fs = followState(l);
        return h('div.kb-card', { draggable: can('write', 'leads') ? 'true' : 'false', onDragstart: e => { e.dataTransfer.setData('text/lead', l.id); e.currentTarget.classList.add('dragging'); }, onDragend: e => e.currentTarget.classList.remove('dragging'), onClick: () => ctx.navigate(`leads/l/${encodeURIComponent(l.id)}`) },
          h('div.t', l.name), h('div.s', [l.contact_name, l.segment, l.source].filter(Boolean).join(' · ')),
          h('div.f', l.value ? h('strong', fmt.money(l.value)) : null, h('div.spacer'),
            fs === 'overdue' ? badge(`Follow-up ${fmt.dueLabel(l.follow_up_date)}`, 'red') : fs === 'today' ? badge('Follow-up today', 'gold') : fs === 'later' ? h('span.muted', fmt.date(l.follow_up_date, 'short')) : fs === 'none' ? badge('No follow-up date', 'gray') : null));
      }),
      ['won', 'lost'].includes(s.value) && !showClosed && leads.length > 6 ? h('button.btn.btn-ghost.btn-sm', { onClick: () => { showClosed = true; draw(); } }, `+ ${leads.length - 6} more`) : null);
      return col;
    }));
  };
  const follow = () => {
    const groups = [['overdue', 'Overdue', 'alarm-clock'], ['today', 'Today', 'phone-forwarded'], ['none', 'No follow-up date set', 'calendar-x'], ['later', 'Coming up', 'calendar-clock']];
    const cards = groups.map(([k, label, ic]) => {
      const rows = db.filter('leads', l => followState(l) === k).sort((a, b) => String(a.follow_up_date || '').localeCompare(String(b.follow_up_date || '')));
      if (!rows.length) return null;
      return card({ title: label, sub: `${rows.length} lead${rows.length === 1 ? '' : 's'}`, icon: ic, cls: 'solid' }, h('div.list.divider-list', rows.slice(0, k === 'later' ? 20 : 300).map(l => listItem({
        title: `${l.name}${l.value ? ' · ' + fmt.money(l.value) : ''}`, sub: [stageLabel(l.stage), l.next_action, l.follow_up_date ? fmt.dueLabel(l.follow_up_date) : null].filter(Boolean).join(' · '), icon: 'target', tile: 't-sun',
        href: `#/leads/l/${encodeURIComponent(l.id)}`,
        right: h('div.row.gap-4', l.phone ? h('a.btn.btn-ghost.btn-icon', { href: `tel:${l.phone}`, title: 'Call', onClick: e => e.stopPropagation() }, icon('phone', 16)) : null, can('write', 'leads') ? btn({ label: 'Log', icon: 'notebook-pen', size: 'sm', onClick: e => { e.preventDefault(); e.stopPropagation(); logTouch(l); } }) : null)
      }))));
    }).filter(Boolean);
    return cards.length ? h('div.stack', cards) : emptyState({ icon: 'party-popper', title: 'No open leads', text: 'Add a lead to start the pipeline.' });
  };
  const funnel = () => {
    const all = db.all('leads');
    const reached = st => all.filter(l => { const order = ['new', 'qualified', 'site_visit', 'quote_sent', 'follow_up', 'won']; const i = order.indexOf(l.stage === 'lost' ? 'new' : l.stage); return i >= order.indexOf(st); }).length;
    const bySource = [...new Set(all.map(l => l.source || 'Unknown'))].map(s => ({ s, n: all.filter(l => (l.source || 'Unknown') === s).length, won: all.filter(l => (l.source || 'Unknown') === s && l.stage === 'won').length })).sort((a, b) => b.n - a.n);
    const lostReasons = [...new Set(all.filter(l => l.stage === 'lost').map(l => l.lost_reason || 'Not recorded'))].map(r => ({ r, n: all.filter(l => l.stage === 'lost' && (l.lost_reason || 'Not recorded') === r).length })).sort((a, b) => b.n - a.n).slice(0, 8);
    return h('div.grid.cols-2',
      card({ title: 'Funnel', icon: 'filter', cls: 'solid' }, h('div', { style: 'height:260px' }, chart({ type: 'bar', horizontal: true, labels: ['Enquiries', 'Qualified', 'Site visit', 'Quote sent', 'Follow-up', 'Won'], series: [{ label: 'Leads', data: ['new', 'qualified', 'site_visit', 'quote_sent', 'follow_up', 'won'].map(reached) }], dispose: ctx.dispose }))),
      card({ title: 'Where leads come from', icon: 'radar', cls: 'solid' }, h('div', { style: 'height:260px' }, chart({ type: 'bar', labels: bySource.map(x => x.s), series: [{ label: 'Leads', data: bySource.map(x => x.n) }, { label: 'Won', data: bySource.map(x => x.won) }], dispose: ctx.dispose }))),
      card({ title: 'Why deals are lost', icon: 'circle-x', cls: 'solid' }, h('div.list.divider-list', lostReasons.map(x => listItem({ title: x.r, right: badge(String(x.n), 'red') })))));
  };
  let vs;
  const viewSeg = () => seg([{ id: 'board', label: 'Board', icon: 'kanban' }, { id: 'follow', label: 'Follow-ups', icon: 'phone-forwarded' }, { id: 'funnel', label: 'Insights', icon: 'chart-bar' }, { id: 'list', label: 'Table', icon: 'table' }], view, id => { view = id; draw(); });
  const draw = () => body.replaceChildren(view === 'board' ? h('div', h('div.row', { style: 'margin-bottom:8px' }, h('div.spacer'), h('label.row.gap-8.small', fieldInput({ type: 'bool', switchLabel: 'Show all closed leads' }, showClosed, v => { showClosed = v; draw(); }))), board()) : view === 'follow' ? follow() : view === 'funnel' ? funnel() : entityListPage('leads', ctx, { title: 'All leads', onOpen: r => ctx.navigate(`leads/l/${encodeURIComponent(r.id)}`) }));
  ctx.dispose.add(db.on('leads', () => { drawKpis(); if (view !== 'list') draw(); }));
  drawKpis(); draw();
  return h('div',
    pageHeader({ title: 'Leads & pipeline', sub: 'Drag a card to move it through the pipeline. Every move is logged with your name.', icon: 'target', tile: 't-sun',
      actions: [btn({ label: 'Prospects', icon: 'phone-call', onClick: () => ctx.navigate('leads/prospects') }), can('write', 'leads') ? btn({ label: 'New lead', icon: 'plus', variant: 'primary', onClick: () => openRecordForm('leads', { values: { enquiry_date: today(), follow_up_date: addDays(today(), 2) } }) }) : null] }),
    kpis, h('div.row', { style: 'margin-bottom:12px' }, (vs = viewSeg())), body);
}

function logTouch(l) {
  const v = { channel: 'call', outcome: '', next: addDays(today(), 3), next_action: l.next_action || '', stage: l.stage };
  const f = (label, name, def) => h('div.field', h('label.field-label', label), fieldInput(def, v[name], x => { v[name] = x; }));
  modal({
    title: `Log contact · ${l.name}`, icon: 'notebook-pen', tile: 't-sun',
    body: h('div.form-grid', f('Channel', 'channel', { type: 'enum', required: true, options: ['call', 'whatsapp', 'email', 'visit', 'meeting', 'sms'] }), f('Stage', 'stage', { type: 'enum', required: true, options: LEAD_STAGES }),
      h('div.field.full', h('label.field-label', 'What happened?'), fieldInput({ type: 'longtext', rows: 3 }, '', x => { v.outcome = x; })),
      f('Next follow-up', 'next', { type: 'date' }), f('Next action', 'next_action', { type: 'text' })),
    actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Save', icon: 'check', variant: 'primary', onClick: async () => {
      try {
        const n = db.filter('call_attempts', a => a.lead_id === l.id).length + 1;
        await db.insert('call_attempts', { lead_id: l.id, attempt_no: n, date: today(), channel: v.channel, outcome: v.outcome || '(no notes)', outcome_class: 'other' });
        await db.update('leads', l.id, { last_contact: today(), follow_up_date: OPEN.includes(v.stage) ? v.next : l.follow_up_date, next_action: v.next_action || null, stage: v.stage });
        if (v.stage === 'won' && l.stage !== 'won') celebrate();
        toast.success('Logged');
      } catch (e) { showError(e); return false; }
    } }]
  });
}

function leadDetail(ctx, id = decodeURIComponent(ctx.params.id)) {
  return entityDetailPage('leads', id, ctx, {
    backHref: '#/leads', backLabel: 'Pipeline',
    sub: l => [l.contact_name, l.segment, l.source ? `via ${l.source}` : null, l.legacy_id].filter(Boolean).join(' · '),
    badges: l => [badge(stageLabel(l.stage), STAGE_COLORS[l.stage]), l.value ? badge(fmt.money(l.value), 'green') : null, followState(l) === 'overdue' ? badge(`Follow-up overdue (${fmt.date(l.follow_up_date)})`, 'red') : null, l.listed_by ? badge(`Listed by ${l.listed_by}`, 'gray') : null],
    actions: l => [
      l.phone ? h('a.btn', { href: `tel:${l.phone}` }, icon('phone', 16), 'Call') : null,
      l.phone ? h('a.btn.btn-ghost', { href: waLink(l.phone, `Good day ${String(l.contact_name || '').split(' ')[0] || ''}, this is Landscapers Inc following up on your enquiry. `), target: '_blank', rel: 'noopener' }, icon('message-circle', 16), 'WhatsApp') : null,
      can('write', 'leads') ? btn({ label: 'Log contact', icon: 'notebook-pen', onClick: () => logTouch(l) }) : null,
      can('write', 'quotes') ? btn({ label: 'Quote', icon: 'file-signature', variant: 'primary', onClick: () => ctx.navigate(`quotes/new?lead=${encodeURIComponent(l.id)}`) }) : null,
      l.stage === 'won' && !l.client_id && can('write', 'clients') ? btn({ label: 'Make client', icon: 'user-plus', onClick: () => openRecordForm('clients', { values: { name: l.name, contact_name: l.contact_name, phone: l.phone, email: l.email, address: l.address, segment: l.segment, source: l.source, since_date: today(), status: 'active' }, onSaved: async c => { await db.update('leads', l.id, { client_id: c.id }); ctx.navigate(`clients/c/${encodeURIComponent(c.id)}`); } }) }) : null
    ],
    summary: l => h('div', { style: 'margin-bottom:16px' }, h('div.row.wrap.gap-8', LEAD_STAGES.filter(s => OPEN.includes(s.value) || ['won', 'lost'].includes(s.value)).map(s => h('button', { class: ['chip', l.stage === s.value ? 'active' : ''], disabled: !can('write', 'leads'), onClick: () => moveStage(l, s.value) }, s.label)))),
    tabs: [{ id: 'timeline', label: 'Timeline', icon: 'history', count: l => db.filter('call_attempts', a => a.lead_id === l.id).length + db.filter('quotes', q => q.lead_id === l.id).length, render: l => {
      const items = [...db.filter('call_attempts', a => a.lead_id === l.id).map(a => ({ d: a.date, t: `${fmt.titleCase(a.channel || 'call')} — ${a.outcome}`, s: a.created_by_name, ic: 'phone' })),
        ...db.filter('quotes', q => q.lead_id === l.id).map(q => ({ d: q.issue_date, t: `Quote ${q.number || q.legacy_number || ''} · ${q.title} · ${fmt.money(q.total || 0)} (${q.status})`, s: q.salesperson, ic: 'file-signature', href: `#/quotes/q/${encodeURIComponent(q.id)}` })),
        l.enquiry_date ? { d: l.enquiry_date, t: `Enquiry received${l.source ? ' via ' + l.source : ''}`, ic: 'inbox' } : null].filter(Boolean).sort((a, b) => String(b.d).localeCompare(String(a.d)));
      return items.length ? h('div.list.divider-list', items.map(x => listItem({ title: x.t, sub: [x.d ? fmt.date(x.d, 'long') : null, x.s].filter(Boolean).join(' · '), icon: x.ic, tile: 't-sun', href: x.href }))) : emptyState({ icon: 'history', title: 'No contact logged yet' });
    } }]
  });
}

/* ---------------- prospects ---------------- */
function prospectsPage(ctx) {
  return entityListPage('prospects', ctx, {
    title: 'Prospects', sub: 'Cold-call campaign (March 2026) and the retirement villages & care centres list. Tap a prospect to log a call.',
    kpis: rows => [
      kpiTile({ label: 'Prospects', value: rows.length, icon: 'phone-call', tile: 't-sun' }),
      kpiTile({ label: 'Not called yet', value: rows.filter(r => r.status === 'not_called' || r.status === 'verify_details').length, icon: 'phone-off', tile: 't-slate' }),
      kpiTile({ label: 'Call back / interested', value: rows.filter(r => ['callback', 'interested'].includes(r.status)).length, icon: 'phone-incoming', tile: 't-grass' }),
      kpiTile({ label: 'Call attempts logged', value: db.count('call_attempts'), icon: 'list-checks', tile: 't-violet' })],
    onOpen: r => ctx.navigate(`leads/p/${encodeURIComponent(r.id)}`)
  });
}
function prospectDetail(ctx) {
  const id = decodeURIComponent(ctx.params.id);
  return entityDetailPage('prospects', id, ctx, {
    backHref: '#/leads/prospects', backLabel: 'Prospects',
    actions: p => [
      p.phone ? h('a.btn', { href: `tel:${p.phone}` }, icon('phone', 16), 'Call') : null,
      can('write', 'prospects') ? btn({ label: 'Log call', icon: 'notebook-pen', variant: 'primary', onClick: () => logCall(p) }) : null,
      can('write', 'leads') && !p.lead_id ? btn({ label: 'Convert to lead', icon: 'target', onClick: () => openRecordForm('leads', { values: { name: p.name, phone: p.phone, email: p.email, address: p.area, segment: p.category, source: 'Cold call', enquiry_date: today(), follow_up_date: addDays(today(), 2), stage: 'qualified' }, onSaved: async l => { await db.update('prospects', p.id, { lead_id: l.id, status: 'converted' }); ctx.navigate(`leads/l/${encodeURIComponent(l.id)}`); } }) }) : null
    ],
    tabs: [{ id: 'calls', label: 'Call log', icon: 'phone', count: p => db.filter('call_attempts', a => a.prospect_id === p.id).length, render: p => { const rows = db.filter('call_attempts', a => a.prospect_id === p.id).sort((a, b) => (b.attempt_no || 0) - (a.attempt_no || 0)); return rows.length ? h('div.list.divider-list', rows.map(a => listItem({ title: `#${a.attempt_no || ''} ${fmt.titleCase(a.channel || 'call')} — ${a.outcome}`, sub: [a.date ? fmt.date(a.date, 'long') : 'date not recorded', a.created_by_name].filter(Boolean).join(' · '), icon: 'phone', tile: 't-sun' }))) : emptyState({ icon: 'phone', title: 'Not called yet' }); } }]
  });
}
function logCall(p) {
  const v = { outcome: '', outcome_class: 'no_answer', callback: null };
  modal({
    title: `Log call · ${p.name}`, icon: 'phone', tile: 't-sun',
    body: h('div.form-grid',
      h('div.field', h('label.field-label', 'Result'), fieldInput({ type: 'enum', required: true, options: ['no_answer', 'callback', 'interested', 'meeting', 'email_sent', 'whatsapp_sent', 'declined', 'routing_issue', 'site_visit', 'other'] }, v.outcome_class, x => { v.outcome_class = x; })),
      h('div.field', h('label.field-label', 'Call back on'), fieldInput({ type: 'date' }, null, x => { v.callback = x; })),
      h('div.field.full', h('label.field-label', 'Notes'), fieldInput({ type: 'longtext', rows: 3 }, '', x => { v.outcome = x; }))),
    actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Save', icon: 'check', variant: 'primary', onClick: async () => {
      try {
        const n = (p.attempts || 0) + 1;
        await db.insert('call_attempts', { prospect_id: p.id, attempt_no: n, date: today(), channel: 'call', outcome: v.outcome || fmt.titleCase(v.outcome_class.replace(/_/g, ' ')), outcome_class: v.outcome_class });
        const status = { callback: 'callback', interested: 'interested', meeting: 'interested', site_visit: 'interested', declined: 'declined', routing_issue: 'unreachable' }[v.outcome_class] || 'in_progress';
        await db.update('prospects', p.id, { attempts: n, last_outcome: v.outcome || v.outcome_class, status, callback_date: v.callback || p.callback_date || null });
        toast.success('Call logged');
      } catch (e) { showError(e); return false; }
    } }]
  });
}

export default {
  id: 'leads',
  routes: { '': pipelinePage, prospects: prospectsPage, 'l/:id': ctx => leadDetail(ctx), 'p/:id': prospectDetail, calls: ctx => entityListPage('call_attempts', ctx, {}) },
  detail: { leads: (id, ctx) => leadDetail(ctx, id) }
};
void callout; void tabs; void diffDays;
