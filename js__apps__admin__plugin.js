import { db } from '../../core/db.js';
import { registerBadge } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerAction } from '../../core/search.js';
import { registerSkill } from '../../ai/skills.js';
import { today } from '../../core/dates.js';
import * as fmt from '../../core/format.js';
import { backupAlert } from './lib.js';

export default function () {
  // Sidebar badge: open data-health issues, hot when any are high severity.
  registerBadge('admin', () => {
    const open = db.filter('data_issues', r => r.status === 'open');
    return { n: open.length, hot: open.some(r => r.severity === 'high') };
  });

  // Backup reminder — fires once per severity tier via notify()'s source_key de-dupe.
  registerAlertSource(() => {
    const rec = db.find('settings', s => s.key === 'last_backup');
    const alert = backupAlert(rec && rec.value && rec.value.date, today());
    if (!alert) return [];
    return [{
      key: `admin-backup|${alert.severity}|${rec ? rec.value.date : 'never'}`,
      title: alert.severity === 'danger' ? 'Backup overdue' : 'Backup reminder',
      body: `${alert.message} Download one from Admin → Backup.`,
      link: '#/admin/backup', severity: alert.severity, roles: ['owner', 'admin'], icon: 'database-backup', tile: 't-slate'
    }];
  });

  // Quick actions — every admin page, reachable from the omnibox / Ctrl+K palette.
  const pages = [
    { id: 'admin-dashboard', label: 'Admin console', icon: 'shield', path: '', keywords: 'admin dashboard security health' },
    { id: 'admin-users', label: 'Admin → Users', icon: 'users', path: 'users', keywords: 'admin users people accounts add invite' },
    { id: 'admin-groups', label: 'Admin → Groups', icon: 'users-round', path: 'groups', keywords: 'admin groups distribution lists' },
    { id: 'admin-roles', label: 'Admin → Roles & permissions', icon: 'lock', path: 'roles', keywords: 'admin roles permissions matrix access' },
    { id: 'admin-company', label: 'Admin → Company profile', icon: 'building-2', path: 'company', keywords: 'admin company profile bank accounts vat reg' },
    { id: 'admin-audit', label: 'Admin → Audit log', icon: 'scroll-text', path: 'audit', keywords: 'admin audit log history changes' },
    { id: 'admin-data', label: 'Admin → Data health', icon: 'shield-alert', path: 'data', keywords: 'admin data health duplicates orphans validation issues' },
    { id: 'admin-backup', label: 'Admin → Backup & restore', icon: 'database-backup', path: 'backup', keywords: 'admin backup restore export import json' },
    { id: 'admin-import', label: 'Admin → Import centre', icon: 'upload', path: 'import', keywords: 'admin import csv excel spreadsheet' },
    { id: 'admin-system', label: 'Admin → System', icon: 'cpu', path: 'system', keywords: 'admin system service worker cache self test storage reset' }
  ];
  for (const p of pages) registerAction({ id: p.id, label: p.label, icon: p.icon, keywords: p.keywords, app: 'admin', run: () => (location.hash = `#/admin/${p.path}`) });

  registerSkill({
    id: 'admin-access', app: 'admin', label: 'Who has admin access',
    examples: ['who has admin access', 'who are the admins', 'list the owners and admins'],
    keywords: ['admin', 'owner', 'access', 'administrator', 'who has'],
    run: () => {
      const admins = db.filter('profiles', p => ['owner', 'admin'].includes(p.role));
      const suspended = admins.filter(p => p.status === 'suspended');
      return {
        text: admins.length
          ? `${admins.length} ${admins.length === 1 ? 'person has' : 'people have'} owner or admin access: ${admins.map(p => p.name).join(', ')}.${suspended.length ? ` (${suspended.length} suspended.)` : ''}`
          : 'No one currently has owner or admin access.',
        cards: [{ type: 'list', items: admins.map(p => ({ title: p.name, sub: `${fmt.titleCase(p.role)} · ${p.status === 'suspended' ? 'Suspended' : p.last_login_at ? `last in ${fmt.relative(p.last_login_at)}` : 'never signed in'}`, href: '#/admin/users', icon: p.role === 'owner' ? 'crown' : 'shield' })) }],
        actions: [{ label: 'Open Admin → Users', href: '#/admin/users' }],
        sources: ['profiles']
      };
    }
  });

  registerSkill({
    id: 'admin-audit-today', app: 'admin', label: 'What changed today',
    examples: ['what changed today', 'what happened today', "today's audit log", 'recent changes'],
    keywords: ['changed', 'change', 'today', 'audit', 'activity', 'happened'],
    run: () => {
      const t = today();
      const rows = db.filter('audit_log', a => String(a.at || '').slice(0, 10) === t).sort((a, b) => String(b.at).localeCompare(String(a.at)));
      const byAction = rows.reduce((m, r) => ((m[r.action] = (m[r.action] || 0) + 1), m), {});
      const summary = Object.entries(byAction).map(([a, n]) => `${n} ${a}${n === 1 ? '' : 's'}`).join(', ');
      return {
        text: rows.length ? `${rows.length} change${rows.length === 1 ? '' : 's'} logged today (${summary}).` : 'Nothing has been logged in the audit log today yet.',
        cards: rows.length ? [{ type: 'table', columns: [{ key: 'at', label: 'When', format: v => fmt.time(v) }, { key: 'user_name', label: 'Who' }, { key: 'action', label: 'Action' }, { key: 'label', label: 'Record' }], rows: rows.slice(0, 20) }] : [],
        actions: [{ label: 'Open the audit log', href: '#/admin/audit' }],
        sources: ['audit_log']
      };
    }
  });
}
