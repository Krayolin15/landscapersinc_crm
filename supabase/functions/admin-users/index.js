// =============================================================================
// admin-users — Deno Edge Function.
//
// The only place the Supabase service-role key is used for people management.
// The browser (js/apps/admin/edge.js) never sees it: it calls this function
// with the CALLER's own session JWT (supabase-js attaches it automatically to
// functions.invoke), and this function re-checks that JWT itself before doing
// anything privileged — the client's own RLS-limited access never grants it.
//
//   POST /functions/v1/admin-users
//   body: { action: 'invite' | 'create' | 'reset' | 'suspend' | 'delete', ... }
//
//   invite  { email, name, role, title?, department? }
//           -> auth.admin.inviteUserByEmail + a matching profiles row (status: 'invited')
//   create  { email, name, role, title?, department?, password }
//           -> auth.admin.createUser (email confirmed) + a matching profiles row,
//              must_change_password: true so they choose their own password on first sign-in
//   reset   { id, email, password? }
//           -> password given: auth.admin.updateUserById(id, { password }), must_change_password: true
//              no password: auth.admin.generateLink({ type: 'recovery' }) and returns the link
//   suspend { id, suspend: boolean }
//           -> profiles.status + auth.admin.updateUserById(id, { ban_duration })
//   delete  { id }   (owner only)
//           -> auth.admin.deleteUser(id). The caller then hard-deletes the profiles row
//              itself (js/apps/admin/users.js) — it may, since it is already the owner.
//
// invite / create / reset / suspend require the caller's own profile role to be
// 'owner' or 'admin'. delete requires 'owner'. Every other caller gets 403.
//
// Required secrets (`supabase secrets set NAME=value`):
//   SUPABASE_URL                 auto-provided by the platform
//   SUPABASE_ANON_KEY            auto-provided by the platform — used only to verify the caller's JWT
//   SUPABASE_SERVICE_ROLE_KEY    auto-provided by the platform — NEVER sent to the browser
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const ROLES = ['owner', 'admin', 'manager', 'finance', 'hr', 'sales', 'operations', 'supervisor', 'field', 'viewer'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function bad(message, status = 400) { return json({ error: message }, status); }

function adminClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set for this function.');
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Verify the caller's own JWT (never trust anything else) and load their profile role via the service-role client. */
async function authenticate(req, sbAdmin) {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: bad('Missing Authorization header', 401) };
  if (!SUPABASE_URL || !ANON_KEY) return { error: bad('Server is not configured (SUPABASE_URL / SUPABASE_ANON_KEY missing)', 500) };

  const sbCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: userData, error: userErr } = await sbCaller.auth.getUser(token);
  if (userErr || !userData || !userData.user) return { error: bad('Your session has expired — please sign in again', 401) };
  const caller = userData.user;

  const { data: profile, error: profErr } = await sbAdmin.from('profiles').select('id, role, status, name, deleted_at').eq('id', caller.id).maybeSingle();
  if (profErr) return { error: bad(`Could not verify your account: ${profErr.message}`, 500) };
  if (!profile || profile.deleted_at || profile.status === 'suspended') return { error: bad('Your account does not have access to this function', 403) };
  if (!['owner', 'admin'].includes(profile.role)) return { error: bad('Only an owner or administrator can manage users', 403) };

  return { caller, profile };
}

async function insertProfile(sbAdmin, { id, email, name, role, title, department, status, must_change_password, by }) {
  const now = new Date().toISOString();
  const row = {
    id, email: email.trim().toLowerCase(), name, role, title: title || null, department: department || null, status,
    must_change_password: !!must_change_password,
    created_at: now, created_by: by.id, created_by_name: by.name, updated_at: now, updated_by: by.id, updated_by_name: by.name
  };
  const { error } = await sbAdmin.from('profiles').insert(row);
  if (error) throw new Error(`Created the sign-in, but could not save the profile: ${error.message}`);
}

async function handleInvite(sbAdmin, body, by) {
  const { email, name, role } = body;
  if (!email || !EMAIL_RE.test(email)) return bad('A valid email address is required');
  if (!name || !String(name).trim()) return bad('A name is required');
  if (!ROLES.includes(role)) return bad(`Role must be one of: ${ROLES.join(', ')}`);
  const { data: existing } = await sbAdmin.from('profiles').select('id').eq('email', email.trim().toLowerCase()).is('deleted_at', null).maybeSingle();
  if (existing) return bad('Someone with that email already has a profile');

  const { data, error } = await sbAdmin.auth.admin.inviteUserByEmail(email.trim().toLowerCase());
  if (error) return bad(`Could not send the invite: ${error.message}`);
  await insertProfile(sbAdmin, { id: data.user.id, email, name, role, title: body.title, department: body.department, status: 'invited', must_change_password: false, by });
  return json({ ok: true, id: data.user.id, mode: 'invite' });
}

async function handleCreate(sbAdmin, body, by) {
  const { email, name, role, password } = body;
  if (!email || !EMAIL_RE.test(email)) return bad('A valid email address is required');
  if (!name || !String(name).trim()) return bad('A name is required');
  if (!ROLES.includes(role)) return bad(`Role must be one of: ${ROLES.join(', ')}`);
  if (!password || String(password).length < 8) return bad('A temporary password of at least 8 characters is required');
  const { data: existing } = await sbAdmin.from('profiles').select('id').eq('email', email.trim().toLowerCase()).is('deleted_at', null).maybeSingle();
  if (existing) return bad('Someone with that email already has a profile');

  const { data, error } = await sbAdmin.auth.admin.createUser({ email: email.trim().toLowerCase(), password, email_confirm: true });
  if (error) return bad(`Could not create the account: ${error.message}`);
  await insertProfile(sbAdmin, { id: data.user.id, email, name, role, title: body.title, department: body.department, status: 'active', must_change_password: true, by });
  return json({ ok: true, id: data.user.id, mode: 'create' });
}

async function handleReset(sbAdmin, body, by) {
  const { id, email, password } = body;
  if (!id) return bad('A user id is required');
  if (password) {
    if (String(password).length < 8) return bad('The temporary password must be at least 8 characters');
    const { error } = await sbAdmin.auth.admin.updateUserById(id, { password });
    if (error) return bad(`Could not reset the password: ${error.message}`);
    await sbAdmin.from('profiles').update({ must_change_password: true, updated_at: new Date().toISOString(), updated_by: by.id, updated_by_name: by.name }).eq('id', id);
    return json({ ok: true, mode: 'password' });
  }
  if (!email || !EMAIL_RE.test(email)) return bad('An email address is required to send a reset link');
  const { data, error } = await sbAdmin.auth.admin.generateLink({ type: 'recovery', email: email.trim().toLowerCase() });
  if (error) return bad(`Could not generate a reset link: ${error.message}`);
  return json({ ok: true, mode: 'link', link: data && data.properties && data.properties.action_link });
}

async function handleSuspend(sbAdmin, body, by) {
  const { id, suspend } = body;
  if (!id) return bad('A user id is required');
  const { error: authErr } = await sbAdmin.auth.admin.updateUserById(id, { ban_duration: suspend ? '876000h' : 'none' });
  if (authErr) return bad(`Could not update the account: ${authErr.message}`);
  const { error: profErr } = await sbAdmin.from('profiles').update({ status: suspend ? 'suspended' : 'active', updated_at: new Date().toISOString(), updated_by: by.id, updated_by_name: by.name }).eq('id', id);
  if (profErr) return bad(`Account updated, but the profile could not be saved: ${profErr.message}`);
  return json({ ok: true, mode: suspend ? 'suspended' : 'reactivated' });
}

async function handleDelete(sbAdmin, body, profile) {
  if (profile.role !== 'owner') return bad('Only the owner can delete accounts', 403);
  const { id } = body;
  if (!id) return bad('A user id is required');
  if (id === profile.id) return bad('You cannot delete your own account');
  const { error } = await sbAdmin.auth.admin.deleteUser(id);
  if (error) return bad(`Could not delete the account: ${error.message}`);
  return json({ ok: true, mode: 'deleted' });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return bad('Method not allowed', 405);

  let body;
  try { body = await req.json(); } catch { return bad('Invalid JSON body'); }
  const { action } = body || {};
  if (!['invite', 'create', 'reset', 'suspend', 'delete'].includes(action)) return bad("action must be one of: invite, create, reset, suspend, delete");

  let sbAdmin;
  try { sbAdmin = adminClient(); } catch (e) { return bad(String(e.message || e), 500); }

  const { error, caller, profile } = await authenticate(req, sbAdmin);
  if (error) return error;
  const by = { id: caller.id, name: profile.name || caller.email || 'Administrator' };

  try {
    if (action === 'invite') return await handleInvite(sbAdmin, body, by);
    if (action === 'create') return await handleCreate(sbAdmin, body, by);
    if (action === 'reset') return await handleReset(sbAdmin, body, by);
    if (action === 'suspend') return await handleSuspend(sbAdmin, body, by);
    if (action === 'delete') return await handleDelete(sbAdmin, body, profile);
    return bad('Unreachable');
  } catch (e) {
    return bad(String(e.message || e), 500);
  }
});
