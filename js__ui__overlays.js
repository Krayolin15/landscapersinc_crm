/* =============================================================================
   Overlays: modal, drawer, confirm, prompt, toast, context menus, tooltips.
   All are keyboard accessible (Esc closes, focus is trapped and restored).
   ========================================================================== */

import { h, onOutside } from './dom.js';
import { icon } from './icons.js';

const stack = [];

function trapFocus(root) {
  const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
  const handler = e => {
    if (e.key !== 'Tab') return;
    const f = Array.from(root.querySelectorAll(sel)).filter(el => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  root.addEventListener('keydown', handler);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && stack.length) {
    const top = stack[stack.length - 1];
    if (top.dismissable !== false) { e.preventDefault(); top.close(); }
  }
});

/**
 * modal({ title, body, actions:[{label, variant, onClick(close) }], size:'wide'|'xwide', dismissable, onClose, icon })
 * returns { close, el, body }
 */
export function modal(o = {}) {
  const prevFocus = document.activeElement;
  let closed = false;
  const close = (result) => {
    if (closed) return; closed = true;
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 150);
    const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
    o.onClose && o.onClose(result);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };
  const bodyEl = h('div.modal-body', o.body);
  const foot = (o.actions && o.actions.length) ? h('div.modal-foot', o.actions.map(a => a instanceof Node ? a : h('button', {
    class: ['btn', a.variant ? `btn-${a.variant}` : ''], type: 'button', disabled: a.disabled,
    onClick: async e => { if (a.onClick) { const btn = e.currentTarget; btn.disabled = true; try { const r = await a.onClick(close, bodyEl); if (r !== false && a.close !== false) close(r); } finally { btn.disabled = false; } } else close(); }
  }, a.icon ? icon(a.icon, 16) : null, a.label))) : null;
  const dialog = h('div', { class: ['modal', o.size || ''], role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || 'Dialog' },
    o.title ? h('div.modal-head', o.icon ? h('div', { class: ['li-ico', o.tile || 't-forest'], style: 'width:34px;height:34px;border-radius:11px;display:grid;place-items:center;color:#fff' }, icon(o.icon, 17)) : null, h('h3', o.title), h('button.btn.btn-ghost.btn-icon', { onClick: () => close(), 'aria-label': 'Close' }, icon('x'))) : null,
    bodyEl, foot);
  const backdrop = h('div.modal-backdrop', { onPointerdown: e => { if (e.target === backdrop && o.dismissable !== false) close(); } }, dialog);
  document.body.appendChild(backdrop);
  trapFocus(dialog);
  setTimeout(() => { const f = dialog.querySelector('[autofocus], input, select, textarea, [contenteditable="true"]') || dialog.querySelector('button'); f && f.focus(); }, 60);
  const api = { close, el: dialog, body: bodyEl, dismissable: o.dismissable };
  stack.push(api);
  return api;
}

/** drawer({ title, body, footer, wide, onClose }) — slides in from the right. */
export function drawer(o = {}) {
  const prevFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    panel.style.animation = 'slideInRight 220ms var(--ease-out) reverse forwards';
    scrim.style.animation = 'fadeIn 200ms reverse forwards';
    setTimeout(() => { panel.remove(); scrim.remove(); }, 210);
    const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
    o.onClose && o.onClose();
    prevFocus && prevFocus.focus && prevFocus.focus();
  };
  const bodyEl = h('div.drawer-body', o.body);
  const panel = h('aside', { class: ['drawer', o.wide ? 'wide' : ''], role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || 'Panel' },
    h('div.drawer-head', o.icon ? h('div', { class: ['li-ico', o.tile || 't-forest'], style: 'width:34px;height:34px;border-radius:11px;display:grid;place-items:center;color:#fff' }, icon(o.icon, 17)) : null, h('h3', o.title || ''), o.headActions || null, h('button.btn.btn-ghost.btn-icon', { onClick: close, 'aria-label': 'Close' }, icon('x'))),
    bodyEl,
    o.footer ? h('div.drawer-foot', o.footer) : null);
  const scrim = h('div.drawer-backdrop', { onClick: close });
  document.body.append(scrim, panel);
  trapFocus(panel);
  const api = { close, el: panel, body: bodyEl };
  stack.push(api);
  return api;
}

/** await confirm('Delete this invoice?', { danger:true, ok:'Delete' }) -> boolean */
export function confirm(message, { title = 'Are you sure?', ok = 'Confirm', cancel = 'Cancel', danger = false, detail } = {}) {
  return new Promise(resolve => {
    let answered = false;
    modal({
      title, icon: danger ? 'triangle-alert' : 'circle-help', tile: danger ? 't-rose' : 't-river',
      body: h('div', h('p', { style: 'font-size:var(--fs-md)' }, message), detail ? h('p.muted.small', detail) : null),
      actions: [
        { label: cancel, variant: 'ghost', onClick: () => { answered = true; resolve(false); } },
        { label: ok, variant: danger ? 'danger' : 'primary', onClick: () => { answered = true; resolve(true); } }
      ],
      onClose: () => { if (!answered) resolve(false); }
    });
  });
}

/** await prompt('Folder name', { value, placeholder }) -> string|null */
export function prompt(label, { title = label, value = '', placeholder = '', ok = 'Save', type = 'text', hint } = {}) {
  return new Promise(resolve => {
    let done = false;
    const input = h(type === 'textarea' ? 'textarea.textarea' : 'input.input', { value, placeholder, type: type === 'textarea' ? undefined : type, autofocus: true });
    const m = modal({
      title,
      body: h('div.field', h('label.field-label', label), input, hint ? h('div.field-hint', hint) : null),
      actions: [
        { label: 'Cancel', variant: 'ghost', onClick: () => { done = true; resolve(null); } },
        { label: ok, variant: 'primary', onClick: () => { done = true; resolve(input.value.trim()); } }
      ],
      onClose: () => { if (!done) resolve(null); }
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && type !== 'textarea') { done = true; resolve(input.value.trim()); m.close(); } });
  });
}

/* ---------------- toasts ---------------- */
let toastStack = null;
/** toast('Saved', { kind:'success'|'error'|'info'|'warn'|'ai', text, action:{label,onClick}, ms }) */
export function toast(title, o = {}) {
  if (!toastStack) { toastStack = h('div.toast-stack', { role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastStack); }
  const kind = o.kind || 'success';
  const icons = { success: 'check', error: 'x', info: 'info', warn: 'triangle-alert', ai: 'sparkles' };
  const el = h('div', { class: ['toast', kind] },
    h('span.t-ico', icon(o.icon || icons[kind], 16)),
    h('div', { style: 'flex:1;min-width:0' }, h('b', title), o.text ? h('div', { style: 'opacity:.85' }, o.text) : null),
    o.action ? h('button.t-action', { onClick: () => { o.action.onClick(); dismiss(); } }, o.action.label) : null,
    h('button', { style: 'opacity:.6;color:inherit', onClick: () => dismiss(), 'aria-label': 'Dismiss' }, icon('x', 15)));
  const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  toastStack.appendChild(el);
  setTimeout(dismiss, o.ms || (kind === 'error' ? 7000 : 3800));
  return dismiss;
}
toast.success = (t, x) => toast(t, { ...x, kind: 'success' });
toast.error = (t, x) => toast(t, { ...x, kind: 'error' });
toast.info = (t, x) => toast(t, { ...x, kind: 'info' });
toast.warn = (t, x) => toast(t, { ...x, kind: 'warn' });
toast.ai = (t, x) => toast(t, { ...x, kind: 'ai' });

/** Show a readable error from anything thrown (ValidationError included). */
export function showError(err, title = 'Could not save') {
  console.error(err);
  const msg = err && err.errors ? Object.values(err.errors).join(' · ') : String((err && err.message) || err);
  toast.error(title, { text: msg });
}

/* ---------------- menus ---------------- */
/**
 * menu(anchorOrEvent, [{label, icon, onClick, danger, kbd} | '-' | {title}])
 */
export function menu(anchor, items, { align = 'left' } = {}) {
  closeMenus();
  const el = h('div.menu', { role: 'menu' }, items.filter(Boolean).map(it => {
    if (it === '-') return h('div.menu-sep');
    if (it.title && !it.onClick) return h('div.menu-title', it.title);
    return h('button', { class: ['menu-item', it.danger ? 'danger' : ''], role: 'menuitem', disabled: it.disabled, onClick: () => { closeMenus(); it.onClick && it.onClick(); } },
      it.icon ? icon(it.icon, 16) : null, h('span', it.label), it.kbd ? h('span.kbd', it.kbd) : null, it.check ? icon('check', 15) : null);
  }));
  document.body.appendChild(el);
  let x, y, r;
  if (anchor instanceof Event) { x = anchor.clientX; y = anchor.clientY; anchor.preventDefault && anchor.preventDefault(); }
  else { r = anchor.getBoundingClientRect(); x = align === 'right' ? r.right : r.left; y = r.bottom + 6; }
  const mw = el.offsetWidth, mh = el.offsetHeight;
  if (align === 'right' && r) x -= mw;
  x = Math.max(8, Math.min(x, innerWidth - mw - 8));
  if (y + mh > innerHeight - 8) y = Math.max(8, (r ? r.top - mh - 6 : y - mh));
  el.style.left = x + 'px'; el.style.top = y + 'px';
  const off = onOutside(el, closeMenus);
  el._off = off;
  const first = el.querySelector('.menu-item'); first && first.focus();
  el.addEventListener('keydown', e => {
    const items2 = Array.from(el.querySelectorAll('.menu-item'));
    const i = items2.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items2[(i + 1) % items2.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items2[(i - 1 + items2.length) % items2.length].focus(); }
    if (e.key === 'Escape') closeMenus();
  });
  return el;
}
export function closeMenus() { document.querySelectorAll('.menu').forEach(m => { m._off && m._off(); m.remove(); }); }

/* ---------------- tooltips: any element with data-tip ---------------- */
export function installTooltips() {
  let tip = null, timer = null;
  const hide = () => { clearTimeout(timer); tip && tip.remove(); tip = null; };
  document.addEventListener('pointerover', e => {
    const t = e.target.closest('[data-tip]');
    if (!t || !t.dataset.tip) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      hide();
      tip = h('div.tooltip', t.dataset.tip);
      document.body.appendChild(tip);
      const r = t.getBoundingClientRect();
      let x = r.left + r.width / 2 - tip.offsetWidth / 2, y = r.bottom + 8;
      if (y + tip.offsetHeight > innerHeight) y = r.top - tip.offsetHeight - 8;
      tip.style.left = Math.max(6, Math.min(x, innerWidth - tip.offsetWidth - 6)) + 'px';
      tip.style.top = y + 'px';
    }, 380);
  });
  document.addEventListener('pointerout', e => { if (e.target.closest('[data-tip]')) hide(); });
  document.addEventListener('pointerdown', hide, true);
}
