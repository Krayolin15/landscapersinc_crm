/* =============================================================================
   Landscapers Inc. HQ — boot.
   1. theme + splash   2. database   3. company data pack (local mode)
   4. session          5. shell + app plug-ins   6. reminders + router + offline
   ========================================================================== */

import { CONFIG, IS_SUPABASE } from './config.js';
import { h, mount } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { store, bus } from './core/bus.js';
import { db } from './core/db.js';
import { idb } from './core/idb.js';
import { auth } from './core/auth.js';
import { ensureSeed } from './core/seed.js';
import { setCustomHolidays } from './core/holidays.js';
import { setRoleMatrix } from './core/perms.js';
import { SCHEMA } from './core/schema.js';
import { APPS } from './apps/registry.js';
import { buildShell, applyTheme } from './ui/shell.js';
import { loginScreen } from './ui/login.js';
import { setOutlet, startRouter } from './core/router.js';
import { startReminders } from './core/notify.js';
import { whenLeader } from './core/leader.js';
import { installRipples } from './ui/animate.js';
import { installTooltips, modal, toast } from './ui/overlays.js';
import { folderTooDeep } from './core/files.js';

const root = document.getElementById('app');

function splash(text = 'Waking up the garden…', pct = 8) {
  return h('div.splash', { style: 'min-height:100vh;display:grid;place-items:center;text-align:center;padding:24px' },
    h('div.aurora', h('span'), h('span'), h('span'), h('span')),
    h('div.stack', { style: 'align-items:center;gap:18px' },
      h('img', { src: 'assets__landscapers-logo.jpg', alt: '', style: 'width:110px;height:110px;border-radius:30px;box-shadow:var(--shadow-lg);animation:popIn .8s var(--ease-spring) both, float 4s 1s ease-in-out infinite' }),
      h('h2', { style: 'font-family:var(--font-display)' }, CONFIG.appName),
      h('div.progress', { style: 'width:240px' }, h('i', { id: 'boot-bar', style: `width:${pct}%;transition:width .35s var(--ease-out)` })),
      h('div.small.muted', { id: 'boot-text' }, text)));
}
function progress(text, pct) {
  const t = document.getElementById('boot-text'); if (t) t.textContent = text;
  const b = document.getElementById('boot-bar'); if (b) b.style.width = pct + '%';
}

async function loadSettings() {
  setCustomHolidays(db.all('holidays'));
  const rm = db.find('settings', s => s.key === 'role_matrix');
  setRoleMatrix(rm ? rm.value : null);
  db.on('holidays', () => setCustomHolidays(db.all('holidays')));
  db.on('settings', () => { const m = db.find('settings', s => s.key === 'role_matrix'); setRoleMatrix(m ? m.value : null); });
}

async function loadPlugins() {
  // Each app may register badges, quick-create entries, alert sources and actions.
  await Promise.all(APPS.map(a => import(`./apps/${a.id}/plugin.js`).then(m => (m.default ? m.default() : null)).catch(e => { if (!/Failed to fetch|Importing a module script failed|error loading dynamically imported module/i.test(String(e))) console.warn(`[plugin] ${a.id}`, e); })));
}

async function startApp(user) {
  if (IS_SUPABASE()) {
    mount(root, splash('Syncing company data…', 30));
    // logs and history only grow; this device already shows last session's copy of them, so they
    // refresh in the background instead of holding up sign-in
    // (only when this device's copy is this person's own — on a shared device everything is fetched first)
    const LOGS = ['audit_log', 'notifications', 'predictions', 'ml_models', 'chat_messages', 'agent_runs'];
    const sameUser = (await idb.kvGet('cache.user').catch(() => null)) === user.id;
    const cols = Object.keys(SCHEMA).filter(c => !sameUser || !LOGS.includes(c));
    let n = 0;
    await Promise.all(cols.map(c => db.sync([c]).then(() => progress(`Syncing ${SCHEMA[c].label}…`, 30 + Math.round((++n / cols.length) * 65)))));
    await idb.kvSet('cache.user', user.id).catch(() => {});
    db.subscribeRealtime();
    if (sameUser) setTimeout(() => db.sync(LOGS.filter(c => SCHEMA[c])).catch(e => console.warn('[sync] history', e)), 1500);
  }
  await loadSettings();
  await loadPlugins();
  const { el, outlet } = buildShell();
  mount(root, el);
  setOutlet(outlet);
  await new Promise(r => setTimeout(r, 0)); // let the shell paint before the first page is built (two short tasks instead of one long one)
  startRouter();
  whenLeader(startReminders); // one tab checks reminders; the bell in every tab updates from the shared database
  if (user.must_change_password) promptPasswordChange();
  warnIfFolderTooDeep();
  bus.emit('app:ready', { user });
}

// Opened from a folder buried too deep, Windows cannot open some original documents (paths over 260 characters).
function warnIfFolderTooDeep() {
  const { deep, folder } = folderTooDeep();
  if (deep) toast('Move the app folder somewhere shorter', { kind: 'warn', ms: 20000, text: `It sits too deep for Windows to open every original document (${folder}). Move the landscapers-hq folder to a short place such as C:\\LSI and open index.html from there.` });
}

function promptPasswordChange() {
  const cur = h('input.input', { type: 'password', autocomplete: 'current-password' });
  const n1 = h('input.input', { type: 'password', autocomplete: 'new-password' });
  const n2 = h('input.input', { type: 'password', autocomplete: 'new-password' });
  modal({
    title: 'Choose your own password', icon: 'key-round', tile: 't-sun', dismissable: false,
    body: h('div.stack',
      h('p.muted', 'You are using a temporary password. Choose a private one only you know (at least 8 characters with a letter and a number).'),
      h('div.field', h('label.field-label', 'Temporary password'), cur),
      h('div.field', h('label.field-label', 'New password'), n1),
      h('div.field', h('label.field-label', 'Repeat new password'), n2)),
    actions: [{ label: 'Save password', variant: 'primary', icon: 'check', onClick: async () => {
      if (n1.value !== n2.value) { toast.error('The new passwords do not match'); return false; }
      try { await auth.changePassword(cur.value, n1.value); toast.success('Password changed'); } catch (e) { toast.error(e.message); return false; }
    } }]
  });
}

async function boot() {
  applyTheme();
  installRipples();
  installTooltips();
  if (!document.getElementById('boot-bar')) mount(root, splash()); // index.html already shows it while the code loads
  try {
    await db.init();
    progress('Opening the company database…', 20);
    if (!IS_SUPABASE()) {
      await ensureSeed(({ done, total, collection, count }) => progress(`Loading ${collection}${count ? ` (${count})` : ''}…`, 20 + Math.round((done / Math.max(1, total)) * 75)));
    }
    progress('Checking your session…', 97);
    let user = await auth.restore();
    if (user) return startApp(user);
    mount(root, loginScreen({ onSignedIn: u => startApp(u) }));
  } catch (err) {
    console.error(err);
    mount(root, h('div.empty', { style: 'min-height:100vh' },
      h('div.e-art', { style: 'background:var(--danger-soft);color:var(--danger)' }, icon('triangle-alert', 40)),
      h('h3', 'Landscapers Inc. HQ could not start'),
      h('p', String(err && err.message ? err.message : err)),
      h('p.small.muted', location.protocol === 'file:' ? 'Opened from the folder: make sure the whole zip was unzipped (not opened inside the zip) and index.html sits next to the js, css and data folders. See docs__TROUBLESHOOTING.html.' : 'Check your internet connection and reload. If this keeps happening, see docs__TROUBLESHOOTING.html.'),
      h('button.btn.btn-primary', { onClick: () => location.reload() }, icon('rotate-cw'), 'Reload')));
  }
}

// Offline-first: cache the app shell so it opens with no signal on site.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e)));
}
window.addEventListener('online', () => { store.set('online', true); toast.success('Back online', { text: IS_SUPABASE() ? 'Syncing your changes…' : undefined }); });
window.addEventListener('offline', () => { store.set('online', false); toast.warn('You are offline', { text: 'Keep working — changes are saved on this device.' }); });
boot();
