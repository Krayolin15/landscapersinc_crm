/* =============================================================================
   Tiny event bus + reactive store.
   bus.on('db:clients', fn) · bus.emit('db:clients', payload)
   store.get('user') · store.set('theme','dark') · store.watch('user', fn)
   ========================================================================== */

const listeners = new Map();

export const bus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt)?.delete(fn);
  },
  once(evt, fn) {
    const off = bus.on(evt, (...a) => { off(); fn(...a); });
    return off;
  },
  emit(evt, ...args) {
    for (const fn of Array.from(listeners.get(evt) || [])) {
      try { fn(...args); } catch (e) { console.error(`[bus] ${evt} listener failed`, e); }
    }
    if (evt !== '*') for (const fn of Array.from(listeners.get('*') || [])) { try { fn(evt, ...args); } catch (e) { console.error(e); } }
  }
};

const state = Object.create(null);
export const store = {
  get: k => state[k],
  set(k, v) {
    const prev = state[k];
    state[k] = v;
    if (prev !== v) bus.emit(`store:${k}`, v, prev);
    return v;
  },
  patch(k, obj) { return store.set(k, { ...(state[k] || {}), ...obj }); },
  watch(k, fn) { return bus.on(`store:${k}`, fn); }
};

/** Per-view disposer: views register cleanups (intervals, charts, listeners) that run on navigation. */
export function disposer() {
  const fns = [];
  return {
    add(fn) { if (typeof fn === 'function') fns.push(fn); return fn; },
    run() { while (fns.length) { try { fns.pop()(); } catch (e) { console.error(e); } } }
  };
}
