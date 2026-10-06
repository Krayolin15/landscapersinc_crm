/* =============================================================================
   Thin client for the admin-users Edge Function (supabase/functions/admin-users).
   Local mode never calls this — user management there goes straight through
   auth.setPasswordFor() and db.* against the profiles collection.
   ========================================================================== */

import { CONFIG, IS_SUPABASE } from '../../config.js';
import { db } from '../../core/db.js';

/** callAdminUsers({ action:'invite'|'create'|'reset'|'suspend'|'delete', ... }) */
export async function callAdminUsers(body) {
  if (!IS_SUPABASE() || !db.client) throw new Error('Not connected to Supabase — this action needs cloud mode.');
  const { data, error } = await db.client.functions.invoke(CONFIG.functions.adminUsers, { body });
  if (error) {
    const detail = error.context && typeof error.context.json === 'function' ? await error.context.json().catch(() => null) : null;
    throw new Error((detail && detail.error) || error.message || 'The admin-users function failed.');
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}
