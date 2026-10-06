/* =============================================================================
   The application shell: top bar, omnibox, app launcher, sidebar, notification
   panel, command palette, quick-create, phone bottom bar and lock screen.
   Apps plug in with registerBadge(appId, fn) and registerCreate({...}).
   ========================================================================== */

import { h, $, onOutside, debounce } from './dom.js';
import { icon } from './icons.js';
import { avatar, badge } from './components.js';
import { menu, toast, modal, closeMenus, confirm } from './overlays.js';
import { CONFIG, IS_SUPABASE } from '../config.js';
import { store, bus } from '../core/bus.js';
import { db } from '../core/db.js';
import { auth, formDraftCount } from '../core/auth.js';
import { canApp, isField } from '../core/perms.js';
import { APPS, GROUPS, MOBILE_NAV, DEFAULT_FAVOURITES, appById } from '../apps/registry.js';
import { search, allActions } from '../core/search.js';
import { unreadCount, markAllRead } from '../core/notify.js';
import { navigate, parseHash } from '../core/router.js';
import * as fmt from '../core/format.js';
import { storageUsed } from '../core/files.js';

const badges = new Map();
const creators = [];
export function registerBadge(appId, fn) { badges.set(appId, fn); }
export function registerCreate(c) { if (!creators.some(x => x.id === c.id)) creators.push(c); }
const prefKey = k => CONFIG.storagePrefix + k;
const pref = (k, d) => { try { const v = localStorage.getItem(prefKey(k)); return v == null ? d : JSON.parse(v); } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(prefKey(k), JSON.stringify(v)); } catch { /* private mode */ } };

export function applyTheme(t = pref('theme', 'auto')) {
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#07130c' : '#103d24');
  document.documentElement.dataset.motion = pref('motion', 'on');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());

let shellEl, sidebarEl, bottomEl, bellDot, outlet;

export function buildShell() {
  const user = store.get('user');
  const collapsed = pref('sidebarCollapsed', false);
  shellEl = h('div', { class: ['shell', collapsed ? 'collapsed' : ''] });
  outlet = h('main.main', { id: 'main', tabindex: '-1' });

  // ---------- top bar ----------
  const omniInput = h('input', { type: 'search', placeholder: 'Search everything, or ask Sage…', 'aria-label': 'Search', autocomplete: 'off' });
  const omni = h('div.omnibox', { onClick: () => omniInput.focus() }, icon('search', 19, { cls: 'muted' }), omniInput, h('span.hint', h('kbd', 'Ctrl'), ' ', h('kbd', 'K')), h('button.top-btn.ai', { 'data-tip': 'Ask Sage AI', onClick: e => { e.stopPropagation(); navigate(`assistant${omniInput.value ? '?q=' + encodeURIComponent(omniInput.value) : ''}`); omniInput.value = ''; } }, icon('sparkles', 19)));
  let omniMenu = null;
  const showOmni = debounce(() => {
    const q = omniInput.value.trim();
    omniMenu && omniMenu.remove(); omniMenu = null;
    if (!q) return;
    const res = search(q, { limit: 12 });
    const r = omni.getBoundingClientRect();
    omniMenu = h('div.menu', { style: { left: r.left + 'px', top: r.bottom + 6 + 'px', width: r.width + 'px', maxWidth: 'none' } },
      h('button.menu-item', { onMousedown: e => { e.preventDefault(); navigate(`assistant?q=${encodeURIComponent(q)}`); omniInput.value = ''; hideOmni(); } }, icon('sparkles', 16, { cls: 'ai-text' }), h('span', 'Ask Sage: ', h('b', `“${q}”`))),
      h('div.menu-sep'),
      res.length ? res.map((x, i) => h('button', { class: ['menu-item', i === 0 ? 'hl' : ''], onMousedown: e => { e.preventDefault(); go(x); } },
        h('span', { class: ['li-ico', x.tile], style: 'width:26px;height:26px;border-radius:8px;display:grid;place-items:center;color:#fff;flex:none' }, icon(x.icon, 14)),
        h('span', { style: 'flex:1;min-width:0' }, h('div.ellipsis', x.title), h('div.xs.muted.ellipsis', x.group + (x.sub && x.sub !== x.group ? ' · ' + x.sub : ''))))) : h('div.menu-title', 'No matching records'));
    document.body.appendChild(omniMenu);
  }, 120);
  const hideOmni = () => { omniMenu && omniMenu.remove(); omniMenu = null; omni.classList.remove('focus'); };
  const go = x => { hideOmni(); omniInput.value = ''; omniInput.blur(); if (x.run) x.run(); else location.hash = x.href; };
  omniInput.addEventListener('focus', () => omni.classList.add('focus'));
  omniInput.addEventListener('blur', () => setTimeout(hideOmni, 150));
  omniInput.addEventListener('input', showOmni);
  omniInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const q = omniInput.value.trim(); if (!q) return; const res = search(q, { limit: 1 }); if (res.length && res[0].score >= 50) go(res[0]); else { navigate(`assistant?q=${encodeURIComponent(q)}`); hideOmni(); omniInput.value = ''; } }
    if (e.key === 'Escape') { omniInput.value = ''; hideOmni(); omniInput.blur(); }
  });

  bellDot = h('span.dot', { style: 'display:none' });
  const syncDot = h('span', { class: 'live-dot', style: 'margin:0 8px', 'data-tip': IS_SUPABASE() ? 'Connected — changes sync live' : 'Local mode — data stays on this device' });
  // Live telemetry (SAST clock · Durban weather · agent status) — loaded lazily so the shell never blocks on it.
  const telemetrySlot = h('div.telemetry-slot.hide-mobile', { style: 'display:flex;align-items:center' });
  import('./telemetry.js').then(m => { if (m.telemetryBar) { telemetrySlot.replaceChildren(m.telemetryBar()); syncDot.remove(); } }).catch(() => {});
  const top = h('header.topbar',
    h('button.top-btn.burger', { 'aria-label': 'Menu', onClick: () => toggleNav() }, icon('menu', 22)),
    h('a.brand', { href: '#/home' }, h('img', { src: 'assets/landscapers-logo.jpg', alt: 'Landscapers Inc.' }), h('span.brand-text', h('b', 'Landscapers Inc.'), h('small', 'HQ · Command centre'))),
    omni,
    h('div.top-actions',
      telemetrySlot,
      syncDot,
      h('button.top-btn.hide-mobile', { 'data-tip': 'Help & shortcuts', onClick: showHelp }, icon('circle-help', 21)),
      h('a.top-btn.hide-mobile', { href: '#/settings', 'data-tip': 'Settings' }, icon('settings', 21)),
      h('button.top-btn', { 'data-tip': 'Notifications', 'aria-label': 'Notifications', onClick: () => togglePanel() }, icon('bell', 21), bellDot),
      h('button.top-btn', { 'data-tip': 'Apps', 'aria-label': 'Apps', onClick: e => toggleLauncher(e.currentTarget) }, icon('grip', 21)),
      h('button.me-chip', { onClick: e => meMenu(e.currentTarget) }, h('span.who', h('b', user.name.split(' ')[0]), h('small', (fmt.titleCase((user.role || '').replace('_', ' '))))), avatar(user))));

  // ---------- sidebar ----------
  sidebarEl = h('nav.sidebar', { 'aria-label': 'Apps' });
  drawSidebar();

  // ---------- bottom nav (phones) ----------
  bottomEl = h('nav.bottomnav', { 'aria-label': 'Quick navigation' });
  drawBottom();

  const fab = h('button.fab', { 'aria-label': 'Create', 'data-tip': 'Create', onClick: e => quickCreate(e.currentTarget) }, icon('plus', 26));
  shellEl.append(h('div.aurora.still', h('span'), h('span'), h('span'), h('span')), top, sidebarEl, outlet, bottomEl, fab);

  // live updates — the sidebar is built once; saves only update the badge numbers, navigation only moves the highlight
  const NO_BADGE = new Set(['audit_log', 'agent_runs', 'predictions', 'ml_models', 'outbox', 'briefings', 'weather_cache']);
  let badgesDirty = false, storageDirty = false;
  const refreshSoon = debounce(() => {
    if (document.hidden) { badgesDirty = true; return; }   // a hidden tab catches up when it is shown again
    badgesDirty = false;
    refreshCounts();
    if (storageDirty) { storageDirty = false; refreshStorage(); }
  }, 300);
  bus.on('db:change', e => {
    const col = e && e.col;
    if (col === 'notifications') { updateBell(); return; }
    if (col === 'settings') { drawSidebar(); drawBottom(); return; } // roles / app access may have changed
    if (col === 'files') storageDirty = true;
    if (col && NO_BADGE.has(col)) return;
    refreshSoon();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && badgesDirty) refreshSoon(); });
  setInterval(() => { if (!document.hidden) refreshCounts(); }, 60000); // date-based counts (overdue, due today) roll over
  bus.on('route', () => { markActive(); shellEl.classList.remove('nav-open'); document.querySelector('.scrim')?.remove(); });
  bus.on('notifications:tick', updateBell);
  updateBell();

  // keyboard shortcuts
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); }
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) { e.preventDefault(); omniInput.focus(); }
    if (e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key)) { const fav = favourites()[+e.key - 1]; if (fav) navigate(fav); }
  });
  bus.on('auth:locked', lockScreen);
  return { el: shellEl, outlet };
}

function favourites() { return (pref('favourites', DEFAULT_FAVOURITES) || DEFAULT_FAVOURITES).filter(id => canApp(id)); }

const navItems = new Map(); // appId -> { a, count, key } for patching counts in place
function badgeOf(appId) {
  let count = null;
  try { count = badges.get(appId) ? badges.get(appId)() : null; } catch { count = null; }
  const hot = count && typeof count === 'object' ? !!count.hot : false;
  const n = count && typeof count === 'object' ? count.n : count;
  return { n: n || 0, hot };
}
function countEl({ n, hot }) { return n ? h('span', { class: ['count', hot ? 'hot' : ''] }, n > 99 ? '99+' : String(n)) : null; }
/** Recompute every badge and patch only the numbers that changed. */
function refreshCounts() {
  for (const [appId, item] of navItems) {
    const b = badgeOf(appId), key = `${b.n}|${b.hot}`;
    if (item.key === key) continue;
    item.key = key;
    const el = countEl(b);
    if (item.count) item.count.remove();
    item.count = el;
    if (el) item.a.appendChild(el);
  }
}
/** Highlight the current app in the sidebar and the phone bar without rebuilding them. */
function markActive() {
  const { appId } = parseHash();
  for (const [id, item] of navItems) item.a.classList.toggle('active', id === appId);
  if (bottomEl) bottomEl.querySelectorAll('a[data-app]').forEach(a => a.classList.toggle('active', a.dataset.app === appId));
}
let storageText = null, storageBar = null;
function refreshStorage() {
  storageUsed().then(b => {
    if (storageText) storageText.textContent = `${fmt.fileSize(b)} of files stored`;
    if (storageBar) storageBar.style.width = Math.max(3, Math.min(100, (b / (1024 ** 3)) * 100)) + '%';
  }).catch(() => {});
}

function drawSidebar() {
  if (!sidebarEl) return;
  const { appId } = parseHash();
  navItems.clear();
  const closed = pref('closedGroups', []);
  const groups = GROUPS.map(g => {
    const apps = APPS.filter(a => a.group === g.id && canApp(a.id));
    if (!apps.length) return null;
    const isClosed = closed.includes(g.id);
    return h('div', { class: ['nav-group', isClosed ? 'collapsed' : ''] },
      h('button.nav-group-title', { onClick: () => { const c = pref('closedGroups', []); setPref('closedGroups', isClosed ? c.filter(x => x !== g.id) : [...c, g.id]); drawSidebar(); } }, h('span', g.label), icon('chevron-down', 14, { cls: 'chev' })),
      h('div.nav-items', apps.map(a => {
        const b = badgeOf(a.id), count = countEl(b);
        const el = h('a', { class: ['nav-item', a.id === appId ? 'active' : ''], href: `#/${a.id}`, 'data-tip': shellEl && shellEl.classList.contains('collapsed') ? a.name : undefined },
          h('span', { class: ['ico', a.tile] }, icon(a.icon, 16)), h('span.label', a.name), count);
        navItems.set(a.id, { a: el, count, key: `${b.n}|${b.hot}` });
        return el;
      })));
  });
  const foot = h('div.sidebar-foot',
    h('div.row', icon(IS_SUPABASE() ? 'cloud' : 'hard-drive', 14), h('b', IS_SUPABASE() ? 'Cloud · shared' : 'Local mode'), h('div.spacer'), h('button', { 'data-tip': 'Collapse sidebar', onClick: () => { shellEl.classList.toggle('collapsed'); setPref('sidebarCollapsed', shellEl.classList.contains('collapsed')); } }, icon('panel-left-close', 15))),
    h('div.bar', (storageBar = h('i', { style: 'width:12%' }))),
    (storageText = h('div.storage-text', 'Calculating storage…')));
  refreshStorage();
  sidebarEl.replaceChildren(
    h('button.new-btn', { onClick: e => quickCreate(e.currentTarget) }, h('span.plus', icon('plus', 20)), h('span', 'New')),
    ...groups.filter(Boolean), foot);
}

function drawBottom() {
  if (!bottomEl) return;
  const user = store.get('user');
  const { appId } = parseHash();
  const ids = (MOBILE_NAV[user.role] || MOBILE_NAV.default).filter(id => canApp(id)).slice(0, 4);
  bottomEl.replaceChildren(...ids.map(id => { const a = appById(id); return h('a', { href: `#/${id}`, class: id === appId ? 'active' : '', dataset: { app: id } }, h('span.bi', icon(a.icon, 21)), a.name.split(' ')[0]); }),
    h('a', { href: '#', onClick: e => { e.preventDefault(); toggleNav(); } }, h('span.bi', icon('layout-grid', 21)), 'More'));
}

function toggleNav() {
  const open = !shellEl.classList.contains('nav-open');
  shellEl.classList.toggle('nav-open', open);
  if (open) { const s = h('div.scrim', { onClick: () => { shellEl.classList.remove('nav-open'); s.remove(); } }); document.body.appendChild(s); }
  else document.querySelector('.scrim')?.remove();
}

function updateBell() {
  if (!bellDot) return;
  const n = unreadCount();
  bellDot.style.display = n ? 'grid' : 'none';
  bellDot.textContent = n > 99 ? '99+' : String(n);
}

/* ---------------- app launcher (Google-style) ---------------- */
let launcherEl = null;
function toggleLauncher(anchor) {
  if (launcherEl) { launcherEl.remove(); launcherEl = null; return; }
  const favs = favourites();
  const tile = a => h('a.launch-app', { href: `#/${a.id}`, onClick: () => { launcherEl.remove(); launcherEl = null; } }, h('span', { class: ['tile', a.tile] }, icon(a.icon, 24)), h('span', a.name));
  launcherEl = h('div.launcher', { role: 'dialog', 'aria-label': 'Apps' },
    h('div.launch-sec', h('h4', 'Your favourites', h('div.spacer'), h('button.btn.btn-ghost.btn-sm', { onClick: editFavourites }, icon('pencil', 14), 'Edit')), h('div.launch-grid', favs.map(id => appById(id)).filter(Boolean).map(tile))),
    ...GROUPS.map(g => { const apps = APPS.filter(a => a.group === g.id && canApp(a.id) && !favs.includes(a.id)); return apps.length ? h('div.launch-sec', h('h4', g.label), h('div.launch-grid', apps.map(tile))) : null; }).filter(Boolean));
  document.body.appendChild(launcherEl);
  const off = onOutside(launcherEl, e => { if (!anchor.contains(e.target)) { launcherEl && launcherEl.remove(); launcherEl = null; off(); } });
}
function editFavourites() {
  launcherEl && launcherEl.remove(); launcherEl = null;
  let favs = favourites();
  const list = h('div.grid.auto-sm');
  const draw = () => list.replaceChildren(...APPS.filter(a => canApp(a.id)).map(a => h('label.check.card.flat', { style: 'padding:10px 12px' }, h('input', { type: 'checkbox', checked: favs.includes(a.id), onChange: e => { favs = e.target.checked ? [...favs, a.id] : favs.filter(x => x !== a.id); } }), h('span', { class: ['li-ico', a.tile], style: 'width:26px;height:26px;border-radius:8px;display:grid;place-items:center;color:#fff' }, icon(a.icon, 14)), a.name)));
  draw();
  modal({ title: 'Choose your favourite apps', icon: 'star', tile: 't-sun', size: 'wide', body: list, actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Save', variant: 'primary', onClick: () => { setPref('favourites', favs); toast.success('Favourites saved'); } }] });
}

/* ---------------- notifications panel ---------------- */
let panelEl = null;
function togglePanel() {
  if (panelEl) { panelEl.remove(); panelEl = null; return; }
  const me = store.get('user');
  const body = h('div.panel-body');
  const draw = () => {
    const rows = db.all('notifications').filter(n => n.user_id === me.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 80);
    body.replaceChildren(...(rows.length ? rows.map(n => h('div', { class: ['notif', n.read_at ? '' : 'unread'], onClick: async () => { if (!n.read_at) await db.update('notifications', n.id, { read_at: new Date().toISOString() }, { skipValidate: true, silent: true }); if (n.link) location.hash = n.link.replace(/^#/, ''); panelEl && panelEl.remove(); panelEl = null; } },
      h('div', { class: ['n-ico', n.tile || 't-forest'] }, icon(n.icon || 'bell', 17)),
      h('div', { style: 'flex:1;min-width:0' }, h('b', n.title), n.body ? h('div.small.text-2', n.body) : null, h('div.n-time', fmt.relative(n.created_at))))) : [h('div.empty', h('div.e-art', icon('bell-off', 40)), h('h3', 'All caught up'), h('p', 'Reminders, mentions and alerts land here.'))]));
  };
  draw();
  panelEl = h('aside.panel', { role: 'dialog', 'aria-label': 'Notifications' },
    h('div.panel-head', icon('bell', 20), h('h3', 'Notifications'), h('button.btn.btn-ghost.btn-sm', { onClick: async () => { await markAllRead(); draw(); updateBell(); } }, icon('check-check', 15), 'Mark all read'), h('button.btn.btn-ghost.btn-icon', { onClick: () => { panelEl.remove(); panelEl = null; } }, icon('x'))),
    body);
  document.body.appendChild(panelEl);
  const off = db.on('notifications', draw);
  const obs = new MutationObserver(() => { if (!document.body.contains(panelEl)) { off(); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
}

/* ---------------- quick create ---------------- */
function quickCreate(anchor) {
  const items = creators.filter(c => !c.app || canApp(c.app));
  const groupsOrder = ['Workspace', 'Sales', 'Operations', 'People', 'Finance', 'Other'];
  const byGroup = {};
  items.forEach(c => (byGroup[c.group || 'Other'] = byGroup[c.group || 'Other'] || []).push(c));
  const list = [];
  for (const g of groupsOrder) if (byGroup[g]) { list.push({ title: g }); byGroup[g].forEach(c => list.push({ label: c.label, icon: c.icon, onClick: c.run })); }
  if (!list.length) list.push({ title: 'Nothing to create yet' });
  menu(anchor, list);
}

/* ---------------- me menu ---------------- */
function meMenu(anchor) {
  const u = store.get('user');
  const t = pref('theme', 'auto');
  menu(anchor, [
    { title: `${u.name} · ${u.email || u.role}` },
    { label: 'My settings', icon: 'user-cog', onClick: () => navigate('settings') },
    '-',
    { label: 'Light theme', icon: 'sun', check: t === 'light', onClick: () => { setPref('theme', 'light'); applyTheme(); } },
    { label: 'Dark theme', icon: 'moon', check: t === 'dark', onClick: () => { setPref('theme', 'dark'); applyTheme(); } },
    { label: 'Match device', icon: 'monitor-smartphone', check: t === 'auto', onClick: () => { setPref('theme', 'auto'); applyTheme(); } },
    { label: pref('motion', 'on') === 'on' ? 'Reduce animations' : 'Enable animations', icon: 'sparkles', onClick: () => { setPref('motion', pref('motion', 'on') === 'on' ? 'off' : 'on'); applyTheme(); } },
    '-',
    { label: 'Lock screen', icon: 'lock', onClick: lockScreen },
    { label: 'Sign out', icon: 'log-out', danger: true, onClick: async () => {
      const drafts = formDraftCount((store.get('user') || {}).id);
      if (drafts && !(await confirm(`You have ${drafts} unsent form${drafts === 1 ? '' : 's'} saved on this device. Signing out deletes ${drafts === 1 ? 'it' : 'them'}.`, { danger: true, ok: 'Sign out anyway' }))) return;
      await auth.signOut(); location.hash = ''; location.reload();
    } }
  ], { align: 'right' });
}

/* ---------------- command palette ---------------- */
function palette() {
  if (document.querySelector('.palette')) return;
  closeMenus();
  const input = h('input', { placeholder: 'Jump to an app, record or action…', autofocus: true });
  const results = h('div.palette-results');
  let items = [], sel = 0;
  const draw = () => {
    const q = input.value.trim();
    items = q ? search(q, { limit: 30 }) : [
      ...favourites().map(id => appById(id)).map(a => ({ group: 'Favourites', title: a.name, sub: a.desc, icon: a.icon, tile: a.tile, href: `#/${a.id}` })),
      ...allActions().slice(0, 8).map(a => ({ group: 'Actions', title: a.label, icon: a.icon || 'zap', tile: 't-violet', run: a.run }))
    ];
    if (q) items.unshift({ group: 'Ask', title: `Ask Sage: “${q}”`, icon: 'sparkles', tile: 't-aurora', href: `#/assistant?q=${encodeURIComponent(q)}` });
    sel = Math.min(sel, Math.max(0, items.length - 1));
    let lastGroup = null;
    results.replaceChildren(...items.flatMap((x, i) => {
      const out = [];
      if (x.group !== lastGroup) { out.push(h('div.palette-group', x.group)); lastGroup = x.group; }
      out.push(h('button', { class: ['menu-item', i === sel ? 'hl' : ''], onClick: () => run(x) },
        h('span', { class: ['li-ico', x.tile], style: 'width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#fff;flex:none' }, icon(x.icon, 15)),
        h('span', { style: 'flex:1;min-width:0' }, h('div.ellipsis.semibold', x.title), x.sub ? h('div.xs.muted.ellipsis', x.sub) : null)));
      return out;
    }));
  };
  const close = () => { pal.remove(); scrim.remove(); };
  const run = x => { close(); if (x.run) x.run(); else location.hash = x.href; };
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    if (e.key === 'Enter' && items[sel]) run(items[sel]);
    if (e.key === 'Escape') close();
  });
  const scrim = h('div.scrim', { style: 'z-index:205', onClick: close });
  const pal = h('div.palette', h('div.palette-input', icon('command', 20, { cls: 'muted' }), input, h('kbd', 'Esc')), results,
    h('div.palette-foot', h('span', h('kbd', '↑'), h('kbd', '↓'), ' navigate'), h('span', h('kbd', 'Enter'), ' open'), h('span', h('kbd', 'Alt'), '+', h('kbd', '1–9'), ' favourite apps')));
  document.body.append(scrim, pal);
  draw();
  setTimeout(() => input.focus(), 30);
}

function showHelp() {
  modal({
    title: 'Help & keyboard shortcuts', icon: 'circle-help', tile: 't-river', size: 'wide',
    body: h('div.grid.cols-2',
      h('div.stack', h('h4', 'Shortcuts'), ...[['Ctrl + K', 'Command palette — jump anywhere'], ['/', 'Search'], ['Alt + 1…9', 'Open favourite app'], ['Esc', 'Close dialogs'], ['Ctrl + Enter', 'Send comment / message']].map(([k, d]) => h('div.stat-line', h('span', d), h('kbd', k)))),
      h('div.stack', h('h4', 'Tips'),
        h('p.small', 'Everything anyone adds is stamped with their name and time — look for “Added by …” on events, notes and records.'),
        h('p.small', 'Use Sage AI (the sparkle) to ask questions like “who owes us money?”, “what is on Friday?” or “when does first aid expire?”.'),
        h('p.small', 'Add this app to your phone’s home screen for a full-screen field app that works offline.'),
        h('p.small', `Mode: ${IS_SUPABASE() ? 'Cloud (Supabase) — shared, secure, multi-user.' : 'Local — this device only. See docs/SETUP-SUPABASE.html to go live.'}`)))
  });
}

/* ---------------- lock screen ---------------- */
function lockScreen() {
  if (document.querySelector('.lock-screen')) return;
  const u = store.get('user');
  if (!u) return;
  const input = h('input.input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password', style: 'text-align:center' });
  const err = h('div.field-error', { style: 'display:none' });
  const unlock = async () => {
    if (await auth.verifyPassword(input.value)) { el.remove(); auth._armIdle(); }
    else { err.style.display = ''; err.textContent = 'Incorrect password'; card.classList.remove('anim-shake'); void card.offsetWidth; card.classList.add('anim-shake'); input.value = ''; }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
  const card = h('div.card.solid.stack', { style: 'width:min(360px,92vw);padding:28px;text-align:center;align-items:center' },
    avatar(u, { size: 'xl' }), h('h2', u.name), h('p.muted', 'Locked after inactivity'), input, err,
    h('button.btn.btn-primary.btn-block', { onClick: unlock }, icon('lock-open', 16), 'Unlock'),
    h('button.btn.btn-ghost.btn-sm', { onClick: async () => { await auth.signOut(); location.reload(); } }, 'Sign in as someone else'));
  const el = h('div.lock-screen.modal-backdrop', { style: 'z-index:500;backdrop-filter:blur(18px)' }, card);
  document.body.appendChild(el);
  setTimeout(() => input.focus(), 50);
}
