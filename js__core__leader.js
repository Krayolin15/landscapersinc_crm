/* =============================================================================
   One "leader" tab. Background jobs (reminders, the local agent, model
   training) run in a single open tab; the other tabs get the results through
   the shared database. When the leader tab closes, the browser hands the lock
   to another open tab, which then starts the jobs. Browsers without the Web
   Locks API simply run the jobs in every tab, as before.
   ========================================================================== */

const waiting = [];
let leader = false;
let asked = false;

function become() {
  leader = true;
  for (const fn of waiting.splice(0)) { try { fn(); } catch (e) { console.warn('[leader]', e); } }
}

/** Run fn once this tab is the leader (immediately if it already is). */
export function whenLeader(fn) {
  if (leader) { fn(); return; }
  waiting.push(fn);
  if (asked) return;
  asked = true;
  const locks = typeof navigator !== 'undefined' && navigator.locks;
  if (!locks || typeof locks.request !== 'function') { become(); return; }
  // the lock is held until the tab closes (the promise never settles)
  locks.request('lsihq-leader', () => { become(); return new Promise(() => {}); }).catch(() => { if (!leader) become(); });
}

export const isLeader = () => leader;
