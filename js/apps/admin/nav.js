/* Shared sub-navigation for every Admin console page (rendered as page-header actions). */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';

const PAGES = [
  { id: 'dashboard', path: '', label: 'Dashboard', icon: 'gauge' },
  { id: 'users', path: 'users', label: 'Users', icon: 'users' },
  { id: 'groups', path: 'groups', label: 'Groups', icon: 'users-round' },
  { id: 'roles', path: 'roles', label: 'Roles', icon: 'lock' },
  { id: 'company', path: 'company', label: 'Company', icon: 'building-2' },
  { id: 'audit', path: 'audit', label: 'Audit log', icon: 'scroll-text' },
  { id: 'data', path: 'data', label: 'Data health', icon: 'shield-alert' },
  { id: 'backup', path: 'backup', label: 'Backup', icon: 'database-backup' },
  { id: 'import', path: 'import', label: 'Import', icon: 'upload' },
  { id: 'golive', path: 'golive', label: 'Go live', icon: 'rocket' },
  { id: 'system', path: 'system', label: 'System', icon: 'cpu' }
];

/** A row of chip-style tabs (wraps on narrow screens) so every admin page links to the rest. */
export function adminNav(ctx, active) {
  return h('nav.chips', { 'aria-label': 'Admin sections' },
    PAGES.map(p => h('a.chip', { href: `#/admin/${p.path}`, class: p.id === active ? 'active' : '' }, icon(p.icon, 14), p.label)));
}
