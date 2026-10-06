/* Admin → Roles & permissions: apps × roles and collections × roles(read/write/delete),
   saved to settings key 'role_matrix' which core/perms.js reads live. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { pageHeader, card, btn, callout, searchBox } from '../../ui/components.js';
import { fieldInput } from '../../ui/form.js';
import { toast, showError, confirm } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { setRoleMatrix } from '../../core/perms.js';
import { APPS } from '../registry.js';
import { SCHEMA } from '../../core/schema.js';
import { ROLES } from '../../schema/workspace.js';
import { adminNav } from './nav.js';
import { mergeRoleMatrix } from './lib.js';

const EDITABLE_ROLES = ROLES.filter(r => !['owner', 'admin'].includes(r.value)); // owner/admin always pass — nothing to toggle
const expand = list => (list === '*' ? EDITABLE_ROLES.map(r => r.value) : Array.isArray(list) ? list.filter(v => EDITABLE_ROLES.some(r => r.value === v)) : []);

export function rolesPage(ctx) {
  const patch = { apps: {}, collections: {} };
  const existing = () => { const s = db.find('settings', x => x.key === 'role_matrix'); return (s && s.value) || { apps: {}, collections: {} }; };

  const appsBody = h('div.stack');
  const colBody = h('div.stack');
  const colSearch = searchBox({ placeholder: 'Filter collections…', onInput: v => renderCollections(v) });

  function appRow(app) {
    const base = existing();
    const current = base.apps && base.apps[app.id] !== undefined ? base.apps[app.id] : app.roles;
    const value = expand(current);
    const control = fieldInput({ type: 'multi', options: EDITABLE_ROLES }, value, v => { patch.apps[app.id] = v; });
    return h('div.row.top.wrap', { style: 'padding:10px 0;border-bottom:1px solid var(--border)' },
      h('div', { style: 'min-width:180px;flex:none' }, h('div.row.gap-8', h('span', { class: ['li-ico', app.tile], style: 'width:26px;height:26px;border-radius:8px;display:grid;place-items:center;color:#fff' }, icon(app.icon, 13)), h('b', app.name))),
      h('div', { style: 'flex:1;min-width:220px' }, control));
  }

  function collectionRow(col, def) {
    const base = existing();
    const override = (base.collections && base.collections[col]) || {};
    const row = h('div.stack.tight', { style: 'padding:12px 0;border-bottom:1px solid var(--border)' },
      h('div.row.gap-8', h('span', { class: ['li-ico', def.tile || 't-slate'], style: 'width:24px;height:24px;border-radius:7px;display:grid;place-items:center;color:#fff' }, icon(def.icon || 'table', 12)), h('b', def.label), h('span.xs.muted.mono', col)));
    const grid = h('div.grid.cols-3');
    for (const action of ['read', 'write', 'delete']) {
      const base2 = override[action] !== undefined ? override[action] : (def.perms && def.perms[action]) || [];
      const value = expand(base2);
      grid.appendChild(h('div.field', h('label.field-label', { style: 'text-transform:capitalize' }, action),
        fieldInput({ type: 'multi', options: EDITABLE_ROLES }, value, v => { patch.collections[col] = { ...(patch.collections[col] || {}), [action]: v }; })));
    }
    row.appendChild(grid);
    return row;
  }

  function renderCollections(q = '') {
    const term = q.trim().toLowerCase();
    const cols = Object.entries(SCHEMA).filter(([col, def]) => !term || col.includes(term) || (def.label || '').toLowerCase().includes(term));
    colBody.replaceChildren(...cols.map(([col, def]) => collectionRow(col, def)));
  }

  appsBody.replaceChildren(...APPS.filter(a => a.id !== 'admin').map(appRow));
  renderCollections();

  async function save() {
    try {
      const cur = existing();
      const merged = mergeRoleMatrix(cur, patch);
      const rec = db.find('settings', s => s.key === 'role_matrix');
      if (rec) await db.update('settings', rec.id, { value: merged });
      else await db.insert('settings', { key: 'role_matrix', value: merged, description: 'Overrides for app and collection access by role, edited in Admin → Roles.' });
      setRoleMatrix(merged);
      patch.apps = {}; patch.collections = {};
      toast.success('Roles & permissions saved');
    } catch (e) { showError(e); }
  }
  async function resetAll() {
    if (!(await confirm('Reset every override back to the schema defaults?', { danger: true, ok: 'Reset all' }))) return;
    try {
      const rec = db.find('settings', s => s.key === 'role_matrix');
      const empty = { apps: {}, collections: {} };
      if (rec) await db.update('settings', rec.id, { value: empty });
      setRoleMatrix(empty);
      patch.apps = {}; patch.collections = {};
      appsBody.replaceChildren(...APPS.filter(a => a.id !== 'admin').map(appRow));
      renderCollections(colSearch.querySelector('input').value);
      toast.success('Reset to defaults');
    } catch (e) { showError(e); }
  }

  return h('div',
    pageHeader({ title: 'Roles & permissions', sub: 'Owner and Administrator always have full access — everything here is for the other roles.', icon: 'lock', tile: 't-slate',
      actions: [adminNav(ctx, 'roles'), btn({ label: 'Reset to defaults', icon: 'rotate-ccw', variant: 'ghost', onClick: resetAll }), btn({ label: 'Save', icon: 'check', variant: 'primary', onClick: save })] }),
    callout('info', 'Server-side enforcement', 'These toggles change what the app shows and offers. The database enforces the rules defined in js/schema: turning access off here hides it in the app, but to widen or narrow what the database itself allows, change perms in js/schema, then run step 02 again from Admin → Go live (docs/SECURITY.html).', 'shield'),
    h('div.grid.cols-2', { style: 'margin-top:16px;align-items:start' },
      card({ title: 'Apps', sub: 'Who can open each app', icon: 'layout-grid', cls: 'solid' }, appsBody),
      card({ title: 'Collections', sub: 'Read / write / delete by role', icon: 'database', cls: 'solid', actions: [colSearch] }, colBody)));
}
