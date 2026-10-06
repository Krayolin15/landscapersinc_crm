/* =============================================================================
   Authentication & sessions.

   LOCAL mode   Each person has their own password, stored only as a salted
                SHA-256 hash in this browser's IndexedDB. It is a convenience
                lock for a trusted office PC — anyone with developer tools on
                that PC can read the data. Use Supabase for real security.

   SUPABASE     Email + password checked on Supabase's servers (or a magic
                link). The role comes from the profiles table, which only an
                admin can change; Row Level Security enforces it on every row.
   ========================================================================== */

import { CONFIG, IS_SUPABASE } from '../config.js';
import { store, bus } from './bus.js';
import { db } from './db.js';
import { idb } from './idb.js';

const SESSION_KEY = CONFIG.storagePrefix + 'session';
/** Forms keeps unsent answers under `${FORM_DRAFT_PREFIX}<user id>.<form id>` (js/apps/forms/index.js). */
export const FORM_DRAFT_PREFIX = 'lsihq.form-draft.';
/** How many unsent form drafts this person has on this device (signing out deletes them). */
export const formDraftCount = userId => { try { return Object.keys(localStorage).filter(k => k.startsWith(`${FORM_DRAFT_PREFIX}${userId}.`)).length; } catch { return 0; } };
let idleTimer = null;

const hex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
function randomSalt() { const a = new Uint8Array(16); crypto.getRandomValues(a); return hex(a); }

/** PBKDF2-SHA256, 100 000 iterations, 256-bit — the same as tools/hash.js uses in Node. */
export async function hashPassword(password, salt = randomSalt()) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return { hash: hex(bits), salt };
}

export function passwordProblems(pw) {
  const p = [];
  if (!pw || pw.length < 8) p.push('at least 8 characters');
  if (!/[A-Za-z]/.test(pw || '')) p.push('a letter');
  if (!/\d/.test(pw || '')) p.push('a number');
  return p;
}

function publicUser(p) {
  if (!p) return null;
  const { password_hash, password_salt, ...rest } = p;
  return rest;
}

export const auth = {
  get user() { return store.get('user'); },

  /** Restore a session on page load. Returns the user or null. */
  async restore() {
    if (IS_SUPABASE()) {
      const { data } = await db.client.auth.getSession();
      if (!data || !data.session) return null;
      return auth._loadSupabaseProfile(data.session.user);
    }
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw);
      if (s.expires && Date.now() > s.expires) { auth._clear(); return null; }
      const p = db.get('profiles', s.profileId);
      if (!p || p.status === 'suspended' || p.deleted_at) { auth._clear(); return null; }
      return auth._begin(p, false);
    } catch { return null; }
  },

  /** LOCAL: sign in a profile with its password. */
  async signInLocal(profileId, password, { remember = false } = {}) {
    const p = db.get('profiles', profileId);
    if (!p || p.deleted_at) throw new Error('Unknown account');
    if (p.status === 'suspended') throw new Error('This account is suspended. Ask an administrator.');
    if (!p.password_hash) throw new Error('No password has been set for this account yet. Ask an administrator.');
    const { hash } = await hashPassword(password, p.password_salt);
    if (hash !== p.password_hash) {
      bus.emit('auth:failed', { profileId });
      throw new Error('Incorrect password');
    }
    const payload = JSON.stringify({ profileId, expires: remember ? Date.now() + CONFIG.rememberDeviceDays * 864e5 : null });
    (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, payload);
    await db.update('profiles', p.id, { last_login_at: new Date().toISOString() }, { silent: true, skipValidate: true, as: { id: p.id, name: p.name } });
    return auth._begin(db.get('profiles', p.id), true);
  },

  /** SUPABASE: email + password. */
  async signInSupabase(email, password) {
    const { data, error } = await db.client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Incorrect email or password' : error.message);
    return auth._loadSupabaseProfile(data.user, true);
  },
  async sendMagicLink(email) {
    const { error } = await db.client.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
    if (error) throw new Error(error.message);
  },
  async sendPasswordReset(email) {
    const { error } = await db.client.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: location.origin + location.pathname + '#/reset-password' });
    if (error) throw new Error(error.message);
  },

  async _loadSupabaseProfile(authUser, fresh = false) {
    await db.sync(['profiles'], { force: true });
    const p = db.get('profiles', authUser.id);
    if (!p) throw new Error('Your login works, but no profile has been created for you yet. Ask an administrator to add you in Admin → Users.');
    if (p.status === 'suspended') { await db.client.auth.signOut(); throw new Error('This account is suspended.'); }
    return auth._begin({ ...p, email: p.email || authUser.email }, fresh);
  },

  _begin(profile, fresh) {
    const u = publicUser(profile);
    store.set('user', u);
    auth._armIdle();
    bus.emit('auth:signed-in', { user: u, fresh });
    return u;
  },

  async signOut() {
    if (IS_SUPABASE() && db.client) await db.client.auth.signOut().catch(() => {});
    auth._clear();
    // unsent form answers can be confidential (HR, incidents): they never outlive the session on a shared phone
    try { Object.keys(localStorage).filter(k => k.startsWith(FORM_DRAFT_PREFIX)).forEach(k => localStorage.removeItem(k)); } catch { /* storage blocked */ }
    store.set('user', null);
    bus.emit('auth:signed-out');
  },
  _clear() { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY); clearTimeout(idleTimer); },

  /** Lock after inactivity: the screen locks; data stays, password required to continue. */
  _armIdle() {
    const reset = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { if (store.get('user')) bus.emit('auth:locked'); }, CONFIG.idleTimeoutMinutes * 60000);
    };
    if (!auth._idleBound) {
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => window.addEventListener(ev, reset, { passive: true }));
      auth._idleBound = true;
    }
    reset();
  },

  async verifyPassword(password) {
    const u = store.get('user');
    if (!u) return false;
    if (IS_SUPABASE()) {
      const { error } = await db.client.auth.signInWithPassword({ email: u.email, password });
      return !error;
    }
    const p = db.get('profiles', u.id);
    const { hash } = await hashPassword(password, p.password_salt);
    return hash === p.password_hash;
  },

  async changePassword(current, next) {
    const probs = passwordProblems(next);
    if (probs.length) throw new Error('New password needs ' + probs.join(', '));
    if (!(await auth.verifyPassword(current))) throw new Error('Current password is incorrect');
    if (IS_SUPABASE()) {
      const { error } = await db.client.auth.updateUser({ password: next });
      if (error) throw new Error(error.message);
      return;
    }
    const u = store.get('user');
    const { hash, salt } = await hashPassword(next);
    await db.update('profiles', u.id, { password_hash: hash, password_salt: salt, must_change_password: false }, { skipValidate: true });
  },

  /** Admin (local mode): set someone's password. Supabase mode uses the admin-users Edge Function. */
  async setPasswordFor(profileId, password, { mustChange = true } = {}) {
    const probs = passwordProblems(password);
    if (probs.length) throw new Error('Password needs ' + probs.join(', '));
    const { hash, salt } = await hashPassword(password);
    await db.update('profiles', profileId, { password_hash: hash, password_salt: salt, must_change_password: mustChange }, { skipValidate: true });
  },

  async rememberLastUser(id) { await idb.kvSet('lastUser', id); },
  async lastUser() { return idb.kvGet('lastUser'); }
};
