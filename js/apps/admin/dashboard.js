/* Admin dashboard: tiles + security health checklist. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { pageHeader, kpiTile, card, badge } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { IS_SUPABASE } from '../../config.js';
import * as fmt from '../../core/format.js';
import { today, diffDays } from '../../core/dates.js';
import { storageUsed } from '../../core/files.js';
import { adminNav } from './nav.js';

export function dashboardPage(ctx) {
  const root = h('div');
  let seq = 0;
  const draw = async () => {
    const my = ++seq;
    const t = today();
    const profiles = db.all('profiles');
    const activeToday = profiles.filter(p => p.last_login_at && p.last_login_at.slice(0, 10) === t);
    const issuesOpen = db.filter('data_issues', r => r.status === 'open');
    const issuesHigh = issuesOpen.filter(r => r.severity === 'high');
    const auditToday = db.filter('audit_log', a => String(a.at || '').slice(0, 10) === t);
    const pending = db.filter('agent_decisions', d => d.status === 'pending' || d.status === 'suggested');
    const lastBackup = db.find('settings', s => s.key === 'last_backup');
    const lastBackupDate = lastBackup && lastBackup.value && lastBackup.value.date;

    const admins = profiles.filter(p => ['owner', 'admin'].includes(p.role) && !p.deleted_at);
    const staleLogins = profiles.filter(p => p.status !== 'suspended' && (!p.last_login_at || diffDays(p.last_login_at.slice(0, 10), t) > 30));
    const defaultPasswords = profiles.filter(p => p.must_change_password);

    let storageBytes = 0;
    try { storageBytes = await storageUsed(); } catch { /* private mode */ }
    if (my !== seq) return; // a newer redraw started while this one waited

    const kpis = h('div.grid.cols-4.stagger',
      kpiTile({ label: 'People', value: profiles.filter(p => !p.deleted_at).length, icon: 'users', tile: 't-forest', foot: `${admins.length} admin${admins.length === 1 ? '' : 's'}`, href: '#/admin/users' }),
      kpiTile({ label: 'Active today', value: activeToday.length, icon: 'radio', tile: 't-river', foot: 'signed in today' }),
      kpiTile({ label: 'Storage used', value: storageBytes, format: v => fmt.fileSize(v), icon: 'hard-drive', tile: 't-grass', foot: IS_SUPABASE() ? 'Supabase storage' : 'this device' }),
      kpiTile({ label: 'Data issues open', value: issuesOpen.length, icon: 'shield-alert', tile: issuesHigh.length ? 't-rose' : 't-sun', foot: issuesHigh.length ? `${issuesHigh.length} high severity` : 'none high severity', href: '#/admin/data' }),
      kpiTile({ label: 'Audit events today', value: auditToday.length, icon: 'scroll-text', tile: 't-violet', href: '#/admin/audit' }),
      kpiTile({ label: 'Pending approvals', value: pending.length, icon: 'sparkles', tile: pending.length ? 't-sun' : 't-slate', foot: 'from the autonomous agent', href: '#/agent' }),
      kpiTile({ label: 'Last backup', value: lastBackupDate ? fmt.date(lastBackupDate, 'short') : 'Never', icon: 'database-backup', tile: lastBackupDate && diffDays(lastBackupDate, t) <= 7 ? 't-forest' : 't-rose', href: '#/admin/backup' })
    );

    const checks = [
      { ok: true, label: `Mode: ${IS_SUPABASE() ? 'Cloud (Supabase) — shared, RLS-protected' : 'Local — this device only'}`, icon: IS_SUPABASE() ? 'cloud' : 'hard-drive' },
      { ok: staleLogins.length === 0, label: staleLogins.length ? `${staleLogins.length} user${staleLogins.length === 1 ? '' : 's'} without a sign-in in the last 30 days` : 'Everyone has signed in within 30 days', icon: 'clock' },
      { ok: true, label: `${admins.length} owner/admin account${admins.length === 1 ? '' : 's'}`, icon: 'shield' },
      { ok: defaultPasswords.length === 0, label: defaultPasswords.length ? `${defaultPasswords.length} account${defaultPasswords.length === 1 ? '' : 's'} still on a temporary password` : 'No temporary passwords outstanding', icon: 'key-round' },
      { ok: null, label: IS_SUPABASE() ? 'Row Level Security is generated from the schema (js/schema) — after changing what a role may do there, run step 02 again from Admin → Go live.' : 'Local mode has no server — RLS applies once you move to Supabase.', icon: 'lock' }
    ];

    root.replaceChildren(
      pageHeader({ title: 'Admin console', sub: 'Users, roles, security, audit, data health, backups and company profile.', icon: 'shield', tile: 't-slate', actions: adminNav(ctx, 'dashboard') }),
      kpis,
      h('div.grid.cols-2', { style: 'margin-top:18px' },
        card({ title: 'Security health', icon: 'shield-check', cls: 'solid' },
          h('div.stack.tight', checks.map(c => h('div.row.gap-8', { style: 'padding:6px 0' },
            c.ok === null ? h('span', { style: 'color:var(--info)' }, icon('info', 16)) : c.ok ? h('span', { style: 'color:var(--success)' }, icon('circle-check', 16)) : h('span', { style: 'color:var(--warning)' }, icon('triangle-alert', 16)),
            h('span', c.label))))),
        card({ title: 'Quick links', icon: 'compass', cls: 'solid' },
          h('div.grid.cols-2.gap-8',
            [['users', 'Users', 'users'], ['roles', 'Roles & permissions', 'lock'], ['company', 'Company profile', 'building-2'], ['audit', 'Audit log', 'scroll-text'], ['data', 'Data health', 'shield-alert'], ['backup', 'Backup & restore', 'database-backup'], ['import', 'Import centre', 'upload'], ['system', 'System', 'cpu']]
              .map(([path, label, ic]) => h('a.btn.btn-ghost', { href: `#/admin/${path}`, style: 'justify-content:flex-start' }, icon(ic, 16), label))))));
  };
  draw();
  // redraw (once per burst) only for what the page shows — not for every notification, agent run or prediction
  const SHOWN = new Set(['profiles', 'data_issues', 'agent_decisions', 'settings', 'files', 'audit_log']);
  let timer = null;
  ctx.dispose.add(db.on('*', e => { if (e && e.col && !SHOWN.has(e.col)) return; clearTimeout(timer); timer = setTimeout(draw, 250); }));
  ctx.dispose.add(() => clearTimeout(timer));
  return root;
}
