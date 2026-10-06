/* Admin → Users: list, add, edit, suspend/reactivate, reset password, delete. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { pageHeader, card, avatar, badge, statusBadge, btn } from '../../ui/components.js';
import { dataTable } from '../../ui/table.js';
import { schemaForm } from '../../ui/form.js';
import { modal, confirm, toast, showError } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { auth } from '../../core/auth.js';
import { store } from '../../core/bus.js';
import { IS_SUPABASE } from '../../config.js';
import * as fmt from '../../core/format.js';
import { ROLES } from '../../schema/workspace.js';
import { adminNav } from './nav.js';
import { generateTempPassword } from './lib.js';
import { callAdminUsers } from './edge.js';

const me = () => store.get('user');
const isOwner = () => (me() || {}).role === 'owner';

export function usersPage(ctx) {
  const root = h('div');
  const table = dataTable({
    columns: [
      { key: 'name', label: 'Person', render: r => h('div.row.gap-8', avatar(r), h('div', h('div.semibold', r.name), h('div.xs.muted', r.email || '—'))), sort: r => r.name },
      { key: 'role', label: 'Role', render: r => badge(fmt.titleCase((r.role || '').replace('_', ' ')), r.role === 'owner' ? 'violet' : r.role === 'admin' ? 'blue' : 'gray'), list: true },
      { key: 'title', label: 'Title', hide: 'sm' },
      { key: 'status', label: 'Status', render: r => statusBadge(r.status) },
      { key: 'last_login_at', label: 'Last sign-in', render: r => (r.last_login_at ? fmt.relative(r.last_login_at) : h('span.faint', 'Never')), sort: r => r.last_login_at || '' }
    ],
    rows: () => db.all('profiles'),
    search: ['name', 'email', 'title'],
    filters: [
      { key: 'role', label: 'Role', options: ROLES },
      { key: 'status', label: 'Status', options: ['active', 'suspended', 'invited'] }
    ],
    sort: 'name',
    onRowClick: r => openEdit(r),
    selectable: true,
    bulkActions: [
      { label: 'Suspend', icon: 'user-x', onClick: async sel => bulkSetStatus(sel.filter(r => r.id !== me().id), 'suspended') },
      { label: 'Reactivate', icon: 'user-check', onClick: async sel => bulkSetStatus(sel, 'active') },
      { label: 'Delete', icon: 'trash-2', danger: true, onClick: async sel => bulkDelete(sel.filter(r => r.id !== me().id)) }
    ],
    exportName: 'users',
    empty: { icon: 'users', title: 'No people yet', text: 'Add the first person to give them access.' }
  });

  async function bulkSetStatus(rows, status) {
    if (!rows.length) return;
    if (!(await confirm(`${status === 'suspended' ? 'Suspend' : 'Reactivate'} ${rows.length} ${rows.length === 1 ? 'person' : 'people'}?`))) return;
    for (const r of rows) await setStatus(r, status);
    toast.success('Updated');
  }
  async function bulkDelete(rows) {
    if (!rows.length) return;
    if (!isOwner()) return toast.error('Only the owner can delete accounts');
    if (!(await confirm(`Permanently delete ${rows.length} ${rows.length === 1 ? 'account' : 'accounts'}? This cannot be undone.`, { danger: true, ok: 'Delete' }))) return;
    for (const r of rows) await deleteUser(r, { skipConfirm: true });
    toast.success('Deleted');
  }

  async function setStatus(rec, status) {
    try {
      await db.update('profiles', rec.id, { status });
      if (IS_SUPABASE()) { try { await callAdminUsers({ action: 'suspend', id: rec.id, suspend: status === 'suspended' }); } catch (e) { toast.warn('Profile updated, but the cloud account ban could not be changed', { text: e.message }); } }
    } catch (e) { showError(e); }
  }

  async function deleteUser(rec, { skipConfirm } = {}) {
    if (!isOwner()) return toast.error('Only the owner can delete accounts');
    if (!skipConfirm && !(await confirm(`Permanently delete “${rec.name}”'s account? This cannot be undone.`, { danger: true, ok: 'Delete account', detail: rec.email }))) return;
    try {
      if (IS_SUPABASE()) await callAdminUsers({ action: 'delete', id: rec.id });
      await db.remove('profiles', rec.id, { hard: true });
      toast.success('Account deleted');
    } catch (e) { showError(e); }
  }

  async function resetPassword(rec) {
    const temp = generateTempPassword();
    try {
      if (IS_SUPABASE()) {
        await callAdminUsers({ action: 'reset', id: rec.id, email: rec.email, password: temp });
        await db.sync(['profiles'], { force: true });
      } else {
        await auth.setPasswordFor(rec.id, temp, { mustChange: true });
      }
      showTempPassword(rec, temp, 'New temporary password');
    } catch (e) { showError(e, 'Could not reset the password'); }
  }

  function showTempPassword(rec, password, title) {
    modal({
      title, icon: 'key-round', tile: 't-sun',
      body: h('div.stack',
        h('p', `Share this one-time password with `, h('b', rec.name), ` yourself (it is shown only once and is never stored in the clear).`),
        h('div.row', { style: 'background:var(--surface-2);border-radius:12px;padding:12px 16px' }, h('code.mono', { style: 'font-size:16px;flex:1' }, password),
          btn({ icon: 'copy', variant: 'ghost', tip: 'Copy', onClick: () => { navigator.clipboard && navigator.clipboard.writeText(password); toast.success('Copied'); } })),
        h('p.small.muted', 'They will be asked to choose their own password the moment they sign in.')),
      actions: [{ label: 'Done', variant: 'primary' }]
    });
  }

  function openEdit(rec) {
    const form = schemaForm('profiles', { values: rec, fields: ['name', 'phone', 'role', 'title', 'department', 'employee_id', 'color', 'status'] });
    const isSelf = rec.id === me().id;
    modal({
      title: rec.name, icon: 'user-round', tile: 't-forest', size: 'wide',
      body: h('div.stack',
        h('div.row.gap-8', avatar(rec, { size: 'lg' }), h('div', h('div.semibold', rec.email || '—'), h('div.xs.muted', `Last sign-in: ${rec.last_login_at ? fmt.dateTime(rec.last_login_at) : 'never'}`))),
        rec.must_change_password ? h('div.callout.warn', icon('triangle-alert', 16), h('div', 'Still using a temporary password.')) : null,
        form.el),
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        { label: 'Reset password', icon: 'key-round', variant: 'ghost', close: false, onClick: () => resetPassword(rec) },
        { label: rec.status === 'suspended' ? 'Reactivate' : 'Suspend', icon: rec.status === 'suspended' ? 'user-check' : 'user-x', variant: 'ghost', close: false, disabled: isSelf,
          onClick: async () => { await setStatus(rec, rec.status === 'suspended' ? 'active' : 'suspended'); toast.success(rec.status === 'suspended' ? 'Reactivated' : 'Suspended'); return true; } },
        isOwner() ? { label: 'Delete', icon: 'trash-2', variant: 'danger', close: false, disabled: isSelf, onClick: async () => { await deleteUser(rec); return true; } } : null,
        { label: 'Save changes', icon: 'check', variant: 'primary', onClick: async () => {
          const res = form.validate(); if (!res.ok) { toast.error('Please fix the highlighted fields'); return false; }
          try { await db.update('profiles', rec.id, form.values()); toast.success('Saved'); } catch (e) { if (e.errors) form.showErrors(e.errors, e.warnings); showError(e); return false; }
        } }
      ].filter(Boolean)
    });
  }

  function openAdd() {
    const form = schemaForm('profiles', { fields: ['name', 'email', 'role', 'title', 'department'], values: { role: 'viewer' } });
    const modeSel = h('select.select', {}, h('option', { value: 'invite' }, 'Email them an invite link'), h('option', { value: 'create' }, 'Set a temporary password now'));
    const modeRow = IS_SUPABASE() ? h('div.field.full', h('label.field-label', 'How should they get access?'), modeSel) : null;
    modal({
      title: 'Add a person', icon: 'user-plus', tile: 't-forest', size: 'wide',
      body: h('div', h('p.muted', { style: 'margin-bottom:12px' }, IS_SUPABASE() ? 'They will be added to profiles and Supabase authentication.' : 'A temporary password is generated for this device — share it with them once.'), form.el, modeRow),
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        { label: 'Add person', icon: 'check', variant: 'primary', onClick: async () => {
          const res = form.validate(); if (!res.ok) { toast.error('Please fix the highlighted fields'); return false; }
          const vals = form.values();
          try {
            if (IS_SUPABASE()) {
              const mode = modeSel.value || 'invite';
              if (mode === 'invite') {
                await callAdminUsers({ action: 'invite', email: vals.email, name: vals.name, role: vals.role, title: vals.title || null, department: vals.department || null });
                await db.sync(['profiles'], { force: true });
                toast.success('Invite sent', { text: vals.email });
              } else {
                const temp = generateTempPassword();
                await callAdminUsers({ action: 'create', email: vals.email, name: vals.name, role: vals.role, title: vals.title || null, department: vals.department || null, password: temp });
                await db.sync(['profiles'], { force: true });
                showTempPassword({ name: vals.name }, temp, 'Temporary password');
              }
            } else {
              const rec = await db.insert('profiles', { ...vals, status: 'active' });
              const temp = generateTempPassword();
              await auth.setPasswordFor(rec.id, temp, { mustChange: true });
              showTempPassword(rec, temp, 'Temporary password');
            }
          } catch (e) { if (e.errors) form.showErrors(e.errors, e.warnings); showError(e, 'Could not add this person'); return false; }
        } }
      ]
    });
  }

  root.replaceChildren(
    pageHeader({ title: 'Users', sub: 'Everyone with a login to Landscapers Inc. HQ.', icon: 'users', tile: 't-forest',
      actions: [adminNav(ctx, 'users'), btn({ label: 'Add person', icon: 'user-plus', variant: 'primary', onClick: openAdd })] }),
    card({ cls: 'solid' }, table));
  ctx.dispose.add(db.on('profiles', () => table.refresh()));
  return root;
}
