/* =============================================================================
   Hash router.  #/<app>/<sub/path>?query

   Each app module (js/apps/<id>/index.js) default-exports:
     {
       id: 'calendar',
       title: 'Calendar',
       routes: {
         '':           ctx => Node | Promise<Node>,   // #/calendar
         'event/:id':  ctx => ...,                     // #/calendar/event/abc
         'week/:date': ctx => ...
       }
     }
   ctx = { params, query, path, appId, dispose, setTitle, navigate, user, refresh }
   Register clean-ups with ctx.dispose.add(fn) — they run when the view changes
   (intervals, Chart.js instances, db.on() listeners...).
   ========================================================================== */

import { bus, store, disposer } from './bus.js';
import { canApp } from './perms.js';
import { appById } from '../apps/registry.js';
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const modules = new Map();
let current = { dispose: null, key: null };
let outlet = null;
let navToken = 0;

export function parseHash(hash = location.hash) {
  const raw = decodeURIComponent((hash || '').replace(/^#\/?/, ''));
  const [pathPart, queryPart = ''] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  return { appId: segs[0] || 'home', rest: segs.slice(1), query, path: pathPart };
}

export function navigate(path, { replace = false } = {}) {
  const target = '#/' + String(path).replace(/^#?\/?/, '');
  if (replace) history.replaceState(null, '', target);
  else if (location.hash !== target) { location.hash = target; return; }
  route();
}
export const link = path => '#/' + String(path).replace(/^#?\/?/, '');

function match(pattern, segs) {
  const p = pattern.split('/').filter(Boolean);
  if (p.length !== segs.length && !(p.length && p[p.length - 1] === '*')) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '*') { params.rest = segs.slice(i).join('/'); return params; }
    if (p[i].startsWith(':')) params[p[i].slice(1)] = segs[i];
    else if (p[i] !== segs[i]) return null;
  }
  return params;
}

async function loadApp(appId) {
  if (modules.has(appId)) return modules.get(appId);
  const mod = await import(`../apps/${appId}/index.js`);
  const app = mod.default || mod;
  modules.set(appId, app);
  return app;
}

export function setOutlet(el) { outlet = el; }

export async function route() {
  if (!outlet) return;
  const user = store.get('user');
  if (!user) return;
  const token = ++navToken;
  const { appId, rest, query, path } = parseHash();
  const meta = appById(appId);

  if (current.dispose) current.dispose.run();
  const dispose = disposer();
  current = { dispose, key: path };

  if (!meta && appId !== 'record') return mount(outlet, notFound(path));
  if (meta && !canApp(appId)) {
    return mount(outlet, h('div.empty.anim-in', h('div.e-art', icon('lock', 40)), h('h3', 'You do not have access to this app'), h('p', `Your role (${user.role}) cannot open ${meta.name}. Ask an administrator if you need it.`), h('a.btn.btn-primary', { href: '#/home' }, 'Go home')));
  }

  store.set('route', { appId, rest, query, path });
  bus.emit('route', { appId, rest, query, path });
  mount(outlet, h('div.loader', h('div.leafspin')));

  try {
    const app = await loadApp(appId);
    if (token !== navToken) return;
    const routes = app.routes || { '': app.render };
    let handler = null, params = {};
    for (const [pattern, fn] of Object.entries(routes)) {
      const p = match(pattern, rest);
      if (p) { handler = fn; params = p; break; }
    }
    if (!handler) return mount(outlet, notFound(path));
    const ctx = {
      appId, params, query, path, dispose, user, navigate,
      setTitle: t => { document.title = `${t} · Landscapers Inc. HQ`; },
      refresh: () => route()
    };
    const name = (meta && meta.name) || app.title;
    if (name) ctx.setTitle(name); else document.title = 'Landscapers Inc. HQ';
    const view = await handler(ctx);
    if (token !== navToken) { dispose.run(); return; }
    const wrap = h('div.view.page-enter', { class: app.fullWidth ? 'full' : '' }, view);
    mount(outlet, wrap);
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    bus.emit('route:rendered', { appId, path });
  } catch (err) {
    console.error(err);
    if (token !== navToken) return;
    mount(outlet, h('div.empty.anim-in',
      h('div.e-art', { style: 'background:var(--danger-soft);color:var(--danger)' }, icon('triangle-alert', 40)),
      h('h3', 'This page could not be opened'),
      h('p', String(err && err.message ? err.message : err)),
      h('div.row', h('button.btn', { onClick: () => route() }, icon('rotate-cw'), 'Try again'), h('a.btn.btn-primary', { href: '#/home' }, 'Go home'))));
  }
}

function notFound(path) {
  return h('div.empty.anim-in', h('div.e-art', icon('compass', 40)), h('h3', 'Page not found'), h('p', `Nothing lives at “${path}”.`), h('a.btn.btn-primary', { href: '#/home' }, 'Go home'));
}

export function startRouter() {
  window.addEventListener('hashchange', route);
  route();
}
