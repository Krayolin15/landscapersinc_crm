/* =============================================================================
   Autonomous Core — "Approvals", "Decisions", "Runs" and "Outbox" tabs.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, statusBadge, card, emptyState, attribution, busy } from '../../ui/components.js';
import { dataTable } from '../../ui/table.js';
import { confirm, toast, showError } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import * as fmt from '../../core/format.js';
import { approveDecision, rejectDecision, revertDecision } from '../../agent/adapters.js';
import { waLink, mailtoLink } from '../_biz.js';
import { JOB_META, DECISION_KIND_LABEL, decisionLink } from './meta.js';

const smsLink = (to, body) => `sms:${String(to || '').replace(/\s/g, '')}?body=${encodeURIComponent(body || '')}`;
const runnerOf = runId => { const r = runId && db.get('agent_runs', runId); return r ? r.runner : null; };

/* ------------------------------------------------------------------ Approvals */
export function approvalsTab(ctx) {
  const rows = db.filter('agent_decisions', d => d.requires_approval && d.status === 'pending').sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  if (!rows.length) return emptyState({ icon: 'circle-check', title: 'Nothing waiting for approval', text: 'Decisions the agent is not confident enough to apply on its own will show up here.' });

  const act = async (d, fn, verb, el) => busy(el, async () => {
    try { await fn(d); toast.success(`${verb === 'approved' ? 'Approved' : 'Rejected'}`, { text: d.title }); ctx.refresh(); }
    catch (e) { showError(e, `Could not ${verb === 'approved' ? 'approve' : 'reject'}`); }
  });

  return h('div.stack', rows.map(d => card({ cls: 'solid' },
    h('div.row.wrap.gap-12', { style: 'align-items:flex-start' },
      h('div', { class: ['li-ico', 't-sun'] }, icon('clipboard-check', 18)),
      h('div', { style: 'flex:1;min-width:220px' },
        h('div.row.gap-8', badge(DECISION_KIND_LABEL[d.kind] || d.kind, 'gold'), h('strong', d.title)),
        d.detail ? h('p.small.muted', { style: 'margin:6px 0' }, d.detail) : null,
        attribution(d, { verb: 'Raised' }),
        decisionLink(d) ? h('a.small', { href: decisionLink(d), style: 'margin-top:6px;display:inline-block' }, 'Open the record →') : null),
      h('div.row.gap-8',
        btn({ label: 'Reject', variant: 'ghost', size: 'sm', onClick: async e => { const ok = await confirm(`Reject "${d.title}"?`); if (ok) act(d, rejectDecision, 'rejected', e.currentTarget); } }),
        btn({ label: 'Approve', icon: 'check', variant: 'primary', size: 'sm', onClick: e => act(d, approveDecision, 'approved', e.currentTarget) }))))));
}

/* ------------------------------------------------------------------ Decisions log */
export function decisionsTab() {
  const rows = () => db.all('agent_decisions').map(d => ({ ...d, runner: runnerOf(d.run_id) })).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  let table;
  const revert = async (d, el) => busy(el, async () => {
    const ok = await confirm(`Revert "${d.title}"?`, { detail: 'Puts the affected visit back the way it was.' });
    if (!ok) return;
    try { await revertDecision(d); toast.success('Reverted'); table.refresh(); } catch (e) { showError(e, 'Could not revert'); }
  });
  table = dataTable({
    rows, exportName: 'agent-decisions', sort: '-created_at', pageSize: 20,
    search: ['title', 'detail', 'kind'],
    filters: [{ key: 'kind', label: 'Type', options: Object.entries(DECISION_KIND_LABEL).map(([value, label]) => ({ value, label })) }, { key: 'status', label: 'Status', options: ['applied', 'pending', 'approved', 'rejected', 'reverted', 'suggested'] }],
    columns: [
      { key: 'kind', label: 'Type', render: d => badge(DECISION_KIND_LABEL[d.kind] || d.kind, 'gray') },
      { key: 'title', label: 'Decision', render: d => h('div', h('a', { href: decisionLink(d) || undefined, style: decisionLink(d) ? '' : 'pointer-events:none;color:inherit' }, d.title), d.detail ? h('div.xs.muted', fmt.truncate(d.detail, 90)) : null) },
      { key: 'status', label: 'Status', render: d => statusBadge(d.status) },
      { key: 'runner', label: 'Runner', render: d => (d.runner ? badge(d.runner, d.runner === 'cloud' ? 'blue' : 'violet') : '—') },
      { key: 'created_at', label: 'When', sort: true, render: d => h('span.xs', attribution(d, { showUpdate: false })) },
      { key: 'actions', label: '', sort: false, render: d => (d.revert && ['applied', 'approved'].includes(d.status) ? btn({ label: 'Revert', icon: 'undo-2', size: 'sm', variant: 'ghost', onClick: e => revert(d, e.currentTarget) }) : null) }
    ]
  });
  return table;
}

/* ------------------------------------------------------------------ Runs history */
export function runsTab() {
  const rows = () => db.all('agent_runs').sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')));
  const durationOf = r => (r.started_at && r.finished_at ? `${Math.max(0, Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000))}s` : r.status === 'running' ? 'running…' : '—');
  return dataTable({
    rows, exportName: 'agent-runs', sort: '-started_at', pageSize: 25, search: ['summary', 'error'],
    filters: [{ key: 'kind', label: 'Job', options: Object.entries(JOB_META).map(([value, m]) => ({ value, label: m.label })) }, { key: 'runner', label: 'Runner', options: ['cloud', 'browser'] }, { key: 'status', label: 'Status', options: ['ok', 'warning', 'failed', 'running'] }],
    columns: [
      { key: 'kind', label: 'Job', render: r => h('div.row.gap-6', icon((JOB_META[r.kind] || {}).icon || 'bot', 15), (JOB_META[r.kind] || {}).label || r.kind) },
      { key: 'runner', label: 'Runner', render: r => badge(r.runner || '—', r.runner === 'cloud' ? 'blue' : 'violet') },
      { key: 'started_at', label: 'Started', sort: true, render: r => fmt.dateTime(r.started_at) },
      { key: 'duration', label: 'Duration', sort: false, render: durationOf },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'summary', label: 'Summary', render: r => h('span.small', r.error ? h('span', { style: 'color:var(--danger)' }, r.error) : (r.summary || '—')) }
    ]
  });
}

/* ------------------------------------------------------------------ Outbox */
const CHANNEL_ICON = { email: 'mail', whatsapp: 'message-circle', sms: 'message-square-text' };
export function outboxTab() {
  const rows = () => db.all('outbox').sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  let table;
  const setStatus = async (rec, patch, label, el) => busy(el, async () => {
    try { await db.update('outbox', rec.id, patch); toast.success(label); table.refresh(); } catch (e) { showError(e, 'Could not update'); }
  });
  const send = (rec, el) => {
    const link = rec.channel === 'whatsapp' ? waLink(rec.to, rec.body) : rec.channel === 'sms' ? smsLink(rec.to, rec.body) : mailtoLink(rec.to, rec.subject, rec.body);
    window.open(link, '_blank', 'noopener');
    return setStatus(rec, { status: 'opened_link' }, 'Opened — mark as sent once it’s away', el);
  };
  const actionsFor = (rec, el) => {
    const kids = [];
    if (['queued', 'needs_approval', 'opened_link'].includes(rec.status)) {
      kids.push(btn({ label: rec.channel === 'email' ? 'Open email' : 'Send', icon: CHANNEL_ICON[rec.channel] || 'send', size: 'sm', variant: 'soft', onClick: e => send(rec, e.currentTarget) }));
      kids.push(btn({ label: 'Mark sent', icon: 'check', size: 'sm', variant: 'ghost', onClick: e => setStatus(rec, { status: 'sent', sent_at: new Date().toISOString() }, 'Marked sent', e.currentTarget) }));
      kids.push(btn({ icon: 'x', size: 'sm', variant: 'ghost', tip: 'Cancel', onClick: async e => { const ok = await confirm('Cancel this message?'); if (ok) setStatus(rec, { status: 'cancelled' }, 'Cancelled', e.currentTarget); } }));
    }
    return h('div.row.gap-4', { style: 'flex-wrap:wrap' }, kids);
  };
  table = dataTable({
    rows, exportName: 'outbox', sort: '-created_at', pageSize: 20, search: ['to', 'to_name', 'subject', 'body'],
    filters: [{ key: 'channel', label: 'Channel', options: ['email', 'whatsapp', 'sms'] }, { key: 'status', label: 'Status', options: ['queued', 'needs_approval', 'opened_link', 'sent', 'failed', 'cancelled', 'draft'] }],
    columns: [
      { key: 'channel', label: '', width: '32px', render: rec => icon(CHANNEL_ICON[rec.channel] || 'send', 16) },
      { key: 'to_name', label: 'To', render: rec => h('div', h('div.small', { style: 'font-weight:600' }, rec.to_name || rec.to), h('div.xs.muted', rec.to)) },
      { key: 'subject', label: 'Message', render: rec => h('div', rec.subject ? h('div.small', rec.subject) : null, h('div.xs.muted', fmt.truncate(rec.body, 80))) },
      { key: 'status', label: 'Status', render: rec => statusBadge(rec.status, rec.status === 'opened_link' ? 'Link opened' : undefined) },
      { key: 'created_at', label: 'Queued', sort: true, render: rec => fmt.relative(rec.created_at) },
      { key: 'actions', label: '', sort: false, render: rec => actionsFor(rec) }
    ],
    empty: { icon: 'send', title: 'Outbox is empty', text: 'Debtor reminders and other agent messages queue up here.' }
  });
  return table;
}
