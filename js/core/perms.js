/* =============================================================================
   Permissions. The interface hides what a role cannot use — but the real
   protection in production is Row Level Security in Postgres (js/sql/schema.js, step 02),
   generated from the same `perms` on each collection.
   ========================================================================== */

import { store } from './bus.js';
import { getDef } from './schema.js';
import { APPS } from '../apps/registry.js';

const SUPER = new Set(['owner', 'admin']);
let overrides = null; // settings.role_matrix: { apps: {appId: [roles]}, collections: {col: {read:[..], write:[..]}} }

export function setRoleMatrix(m) { overrides = m || null; }
const me = () => store.get('user');
const roleOf = u => (u && u.role) || 'viewer';

function allowed(list, role) {
  if (list === '*' || (Array.isArray(list) && list.includes('*'))) return true;
  return Array.isArray(list) && list.includes(role);
}

/** can('write', 'invoices') — for the signed-in user unless another is passed.
    'update' (editing an existing record) follows 'write' unless a collection sets it separately,
    e.g. anyone may submit a form response but only reviewers may change one. */
export function can(action, col, user = me()) {
  if (!user) return false;
  const role = roleOf(user);
  if (SUPER.has(role)) return true;
  if (role === 'viewer' && action !== 'read') return false;
  const def = getDef(col);
  const o = overrides && overrides.collections && overrides.collections[col];
  if (action === 'update' && !(o && o.update) && !(def && def.perms && def.perms.update)) action = 'write';
  if (o && o[action]) return allowed(o[action], role);
  if (!def || !def.perms) return action === 'read';
  return allowed(def.perms[action], role);
}

export function canApp(appId, user = me()) {
  if (!user) return false;
  const role = roleOf(user);
  if (SUPER.has(role)) return true;
  const o = overrides && overrides.apps && overrides.apps[appId];
  if (o) return allowed(o, role);
  const app = APPS.find(a => a.id === appId);
  if (!app) return false;
  return allowed(app.roles || '*', role);
}

/** Field-level: sensitive fields are only visible to def.sensitiveRoles (+ owner/admin). */
export function canSeeField(col, field, user = me()) {
  const def = getDef(col);
  const f = def && def.fields && def.fields[field];
  if (!f || !f.sensitive) return true;
  const role = roleOf(user);
  if (SUPER.has(role)) return true;
  return allowed(def.sensitiveRoles || ['manager', 'finance'], role);
}

export const isAdmin = (user = me()) => !!user && SUPER.has(roleOf(user));
export const isManager = (user = me()) => !!user && (SUPER.has(roleOf(user)) || roleOf(user) === 'manager');
export const isField = (user = me()) => !!user && ['field', 'supervisor'].includes(roleOf(user));
