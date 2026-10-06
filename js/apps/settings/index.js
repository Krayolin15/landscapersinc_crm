/* =============================================================================
   Settings (#/settings) — everyone's own profile, password, theme, motion,
   notification preferences, default calendar reminders, locale display,
   sessions, "Install app" and a keyboard-shortcuts reference.
   ========================================================================== */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { pageHeader, card, btn, badge, callout, avatar, seg } from '../../ui/components.js';
import { schemaForm } from '../../ui/form.js';
import { toast, showError, confirm } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { auth } from '../../core/auth.js';
import { requestBrowserPermission } from '../../core/notify.js';
import { applyTheme } from '../../ui/shell.js';
import { CONFIG } from '../../config.js';
import * as fmt from '../../core/format.js';
import { parseReminderMinutes, formatReminderMinutes, mergeNotifyKinds, NOTIFY_KIND_LABELS, installSteps, deviceLabel } from './lib.js';

const prefKey = k => CONFIG.storagePrefix + k;
const pref = (k, d) => { try { const v = localStorage.getItem(prefKey(k)); return v == null ? d : JSON.parse(v); } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(prefKey(k), JSON.stringify(v)); } catch { /* private mode */ } };

// Captured once at module load so the real install prompt is ready whenever this page is visited.
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstallPrompt = e; });
window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; });

function profileCard(ctx) {
  const user = db.get('profiles', store.get('user').id) || store.get('user');
  let avatarFileId = user.avatar_file_id || null;
  const avatarBox = h('div.row.gap-8', { style: 'align-items:center' });
  const drawAvatar = async () => {
    avatarBox.replaceChildren(avatar({ ...user, color: form ? form.values().color : user.color }, { size: 'xl' }));
    if (!avatarFileId) return;
    try {
      const { fileUrl } = await import('../../core/files.js');
      const rec = db.get('files', avatarFileId);
      if (!rec) return;
      const url = await fileUrl(rec);
      if (url) avatarBox.replaceChildren(h('img', { src: url, alt: user.name, style: 'width:72px;height:72px;border-radius:50%;object-fit:cover;box-shadow:var(--shadow-sm)' }));
    } catch { /* fall back to initials avatar */ }
  };
  const avatarInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onChange: async e => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    try {
      const { uploadFiles } = await import('../../core/files.js');
      const [rec] = await uploadFiles(files, { drive_id: 'avatars', linked: [{ collection: 'profiles', id: user.id }] });
      if (rec) { avatarFileId = rec.id; await drawAvatar(); toast.info('Photo ready — click Save to keep it'); }
    } catch (err) { showError(err, 'Could not upload that photo'); }
  } });

  const form = schemaForm('profiles', { values: user, fields: ['name', 'phone', 'title', 'color', 'signature_html'] });
  drawAvatar();

  async function save() {
    const res = form.validate();
    if (!res.ok) { toast.error('Please fix the highlighted fields'); return; }
    try {
      const patch = { ...form.values(), avatar_file_id: avatarFileId };
      const rec = await db.update('profiles', user.id, patch);
      store.set('user', { ...store.get('user'), ...patch, id: rec.id });
      toast.success('Profile saved');
    } catch (e) { if (e.errors) form.showErrors(e.errors, e.warnings); showError(e); }
  }

  return card({ title: 'My profile', icon: 'user-round', cls: 'solid',
    actions: [btn({ label: 'Save', icon: 'check', variant: 'primary', size: 'sm', onClick: save })] },
    h('div.row.gap-8', { style: 'align-items:center;margin-bottom:16px' },
      avatarBox,
      h('div.stack.tight',
        btn({ label: 'Change photo', icon: 'image-plus', size: 'sm', variant: 'soft', onClick: () => avatarInput.click() }),
        avatarInput,
        h('div.xs.muted', user.email || '—'))),
    form.el);
}

function passwordCard() {
  const cur = h('input.input', { type: 'password', autocomplete: 'current-password' });
  const n1 = h('input.input', { type: 'password', autocomplete: 'new-password' });
  const n2 = h('input.input', { type: 'password', autocomplete: 'new-password' });
  const err = h('div.field-error', { style: 'display:none' });
  async function save() {
    err.style.display = 'none';
    if (!cur.value || !n1.value) { err.textContent = 'Fill in your current and new password'; err.style.display = ''; return; }
    if (n1.value !== n2.value) { err.textContent = 'The new passwords do not match'; err.style.display = ''; return; }
    try {
      await auth.changePassword(cur.value, n1.value);
      cur.value = n1.value = n2.value = '';
      toast.success('Password changed');
    } catch (e) { err.textContent = e.message; err.style.display = ''; }
  }
  return card({ title: 'Change password', icon: 'key-round', cls: 'solid',
    actions: [btn({ label: 'Save', icon: 'check', variant: 'primary', size: 'sm', onClick: save })] },
    h('div.form-grid',
      h('div.field.full', h('label.field-label', 'Current password'), cur),
      h('div.field', h('label.field-label', 'New password'), n1),
      h('div.field', h('label.field-label', 'Repeat new password'), n2),
      h('div.field.full', err)),
    h('p.small.muted', { style: 'margin-top:6px' }, 'At least 8 characters, with a letter and a number.'));
}

function appearanceCard() {
  const themeSeg = seg([{ id: 'light', label: 'Light', icon: 'sun' }, { id: 'dark', label: 'Dark', icon: 'moon' }, { id: 'auto', label: 'Match device', icon: 'monitor-smartphone' }],
    pref('theme', 'auto'), v => { setPref('theme', v); applyTheme(); toast.success('Theme updated'); });
  const motionOn = pref('motion', 'on') === 'on';
  const motionSwitch = h('label.switch', h('input', { type: 'checkbox', checked: motionOn, onChange: e => { setPref('motion', e.target.checked ? 'on' : 'off'); applyTheme(); } }), h('span.track'), h('span.small', motionOn ? 'Animations on' : 'Animations reduced'));
  return card({ title: 'Appearance', icon: 'palette', cls: 'solid' },
    h('div.field', h('label.field-label', 'Theme'), themeSeg),
    h('div.field', { style: 'margin-top:14px' }, h('label.field-label', 'Motion'), motionSwitch, h('div.field-hint', 'Turns off page-enter animation, counters and hover effects — useful on slower devices or if motion bothers you.')));
}

function notificationsCard() {
  const user = db.get('profiles', store.get('user').id) || store.get('user');
  const kinds = mergeNotifyKinds((user.preferences || {}).notify_kinds);
  const permWrap = h('div');
  const drawPerm = () => {
    const p = ('Notification' in window) ? Notification.permission : 'unsupported';
    permWrap.replaceChildren(
      badge(p === 'granted' ? 'Allowed' : p === 'denied' ? 'Blocked' : p === 'unsupported' ? 'Not supported' : 'Not asked yet', p === 'granted' ? 'green' : p === 'denied' ? 'red' : 'gray'),
      p !== 'granted' && p !== 'unsupported' ? btn({ label: 'Enable browser notifications', icon: 'bell-ring', size: 'sm', variant: 'soft', onClick: async () => { const r = await requestBrowserPermission(); toast[r === 'granted' ? 'success' : 'warn'](r === 'granted' ? 'Notifications enabled' : 'Not enabled', { text: r === 'denied' ? 'Allow notifications for this site in your browser settings to change this.' : undefined }); drawPerm(); } }) : null);
  };
  drawPerm();

  const toggles = {};
  const kindRows = Object.entries(NOTIFY_KIND_LABELS).map(([key, label]) => {
    const sw = h('label.switch', h('input', { type: 'checkbox', checked: kinds[key] !== false, onChange: e => { toggles[key] = e.target.checked; } }), h('span.track'));
    return h('div.row', { style: 'padding:8px 0;border-bottom:1px solid var(--border)' }, h('div', { style: 'flex:1' }, label), sw);
  });
  async function save() {
    try {
      const merged = mergeNotifyKinds(kinds, toggles);
      await db.update('profiles', user.id, { preferences: { ...(user.preferences || {}), notify_kinds: merged } });
      toast.success('Notification preferences saved');
    } catch (e) { showError(e); }
  }
  return card({ title: 'Notification preferences', icon: 'bell', cls: 'solid', actions: [btn({ label: 'Save', icon: 'check', variant: 'primary', size: 'sm', onClick: save })] },
    h('div.field', h('label.field-label', 'Browser notifications'), h('div.row.gap-8', { style: 'align-items:center' }, permWrap)),
    h('div.field', { style: 'margin-top:14px' }, h('label.field-label', 'Which reminders to receive'), h('div.stack.tight', kindRows)));
}

function remindersCard() {
  const user = db.get('profiles', store.get('user').id) || store.get('user');
  const saved = Array.isArray((user.preferences || {}).default_reminders) ? user.preferences.default_reminders : null;
  const input = h('input.input', { value: (saved || CONFIG.defaultEventReminders).join(', '), placeholder: 'e.g. 30, 1440' });
  const preview = h('div.chips', { style: 'margin-top:8px' });
  const drawPreview = () => { const mins = parseReminderMinutes(input.value); preview.replaceChildren(...(mins.length ? mins.map(m => badge(formatReminderMinutes(m), 'forest')) : [h('span.small.muted', 'No reminders — you will not be nudged before events start')])); };
  input.addEventListener('input', drawPreview);
  drawPreview();
  async function save() {
    try {
      const mins = parseReminderMinutes(input.value);
      await db.update('profiles', user.id, { preferences: { ...(user.preferences || {}), default_reminders: mins } });
      toast.success('Default reminders saved');
    } catch (e) { showError(e); }
  }
  return card({ title: 'Default calendar reminders', icon: 'alarm-clock', cls: 'solid', actions: [btn({ label: 'Save', icon: 'check', variant: 'primary', size: 'sm', onClick: save })] },
    h('p.muted', 'Minutes before an event starts, comma-separated (e.g. 30 for half an hour, 1440 for a day). Applies to new events you create that do not set their own reminders.'),
    h('div.field', input, preview));
}

function localeCard() {
  return card({ title: 'Language & region', icon: 'globe', cls: 'solid' },
    h('dl.kv',
      h('dt', 'Language'), h('dd', 'English (South Africa)'),
      h('dt', 'Locale code'), h('dd', h('code', CONFIG.locale)),
      h('dt', 'Currency'), h('dd', `${CONFIG.currency} (${fmt.money(1234.5)})`),
      h('dt', 'Time zone'), h('dd', CONFIG.timezone),
      h('dt', 'Dates shown as'), h('dd', `${fmt.date(new Date(), 'long')} (day first, South African style)`)),
    h('p.small.muted', { style: 'margin-top:10px' }, 'Set once for the whole company in js/config.js — ask an administrator if this needs to change.'));
}

function sessionsCard() {
  const user = db.get('profiles', store.get('user').id) || store.get('user');
  return card({ title: 'My sessions', icon: 'monitor', cls: 'solid' },
    h('div.list-item', { style: 'padding:10px 0' },
      h('div.li-ico.t-river', icon('laptop', 18)),
      h('div.li-main', h('div.li-title', deviceLabel(navigator.userAgent), ' ', badge('This device', 'green')),
        h('div.li-sub', user.last_login_at ? `Signed in ${fmt.relative(user.last_login_at)}` : 'Current session'))),
    h('p.small.muted', 'Landscapers Inc. HQ does not track other devices individually yet — signing out here ends only this browser session.'),
    btn({ label: 'Sign out', icon: 'log-out', variant: 'danger', onClick: async () => { if (await confirm('Sign out of Landscapers Inc. HQ on this device?', { ok: 'Sign out' })) { await auth.signOut(); location.hash = ''; location.reload(); } } }));
}

function installCard() {
  const platform = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'desktop';
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const body = h('div');
  const draw = () => {
    body.replaceChildren(
      isStandalone ? callout('success', 'Already installed', 'You are using the installed app.', 'circle-check')
        : h('div.stack',
            deferredInstallPrompt ? btn({ label: 'Install app', icon: 'download', variant: 'primary', onClick: async () => { deferredInstallPrompt.prompt(); const { outcome } = await deferredInstallPrompt.userChoice; if (outcome === 'accepted') toast.success('Installing…'); deferredInstallPrompt = null; draw(); } }) : null,
            h('ol.stack.tight', { style: 'padding-left:20px;list-style:decimal' }, installSteps(platform).map(s => h('li', s)))));
  };
  draw();
  return card({ title: 'Install app', icon: 'smartphone', cls: 'solid' },
    h('p.muted', 'Add Landscapers Inc. HQ to your home screen for a full-screen, offline-ready field app.'),
    body);
}

function shortcutsCard() {
  const rows = [['Ctrl + K', 'Command palette — jump anywhere'], ['/', 'Focus search'], ['Alt + 1…9', 'Open a favourite app'], ['Esc', 'Close dialogs & menus'], ['Ctrl + Enter', 'Send a comment / message']];
  return card({ title: 'Keyboard shortcuts', icon: 'keyboard', cls: 'solid' },
    h('div.stack.tight', rows.map(([k, d]) => h('div.stat-line', h('span', d), h('kbd', k)))));
}

export function settingsPage(ctx) {
  return h('div',
    pageHeader({ title: 'My settings', sub: 'Your profile, password, theme and notifications.', icon: 'settings', tile: 't-slate' }),
    h('div.grid.cols-2', { style: 'align-items:start' },
      h('div.stack', profileCard(ctx), passwordCard(), appearanceCard()),
      h('div.stack', notificationsCard(), remindersCard(), localeCard(), sessionsCard(), installCard(), shortcutsCard())));
}

export default {
  id: 'settings',
  routes: { '': ctx => settingsPage(ctx) }
};
