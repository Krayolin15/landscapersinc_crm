/* =============================================================================
   Calendar — per-device preferences (which calendars / other sources are
   ticked on, last view). Stored in localStorage, same pattern as ui/shell.js.
   ========================================================================== */

import { CONFIG } from '../../config.js';

const key = k => CONFIG.storagePrefix + 'calendar.' + k;
function get(k, d) { try { const v = localStorage.getItem(key(k)); return v == null ? d : JSON.parse(v); } catch { return d; } }
function set(k, v) { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch { /* private mode */ } }

/** '__none__' stands for "events with no calendar assigned". */
export const UNASSIGNED_ID = '__none__';

/** Explicit per-id user choice: { [id]: true|false }. Falls back to the caller's default when absent. */
function isVisible(store, id, def) {
  const overrides = get(store, {});
  return id in overrides ? !!overrides[id] : !!def;
}
function setVisible(store, id, visible, def) {
  const overrides = get(store, {});
  if (visible === def) delete overrides[id]; else overrides[id] = !!visible;
  set(store, overrides);
}
export const isCalendarVisible = (id, defaultVisible = true) => isVisible('calendars', id, defaultVisible);
export const setCalendarVisible = (id, visible, defaultVisible = true) => setVisible('calendars', id, visible, defaultVisible);
export const isSourceEnabled = (id, defaultOn = true) => isVisible('sources', id, defaultOn);
export const setSourceEnabled = (id, enabled, defaultOn = true) => setVisible('sources', id, enabled, defaultOn);
export const getDefaultView = () => get('lastView', null);
export const setDefaultView = v => set('lastView', v);
