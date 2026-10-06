/* =============================================================================
   Local (browser) agent runner. In local mode — or in cloud mode when the
   Supabase Edge Function + pg_cron have not run yet today — this keeps the
   business moving while someone has the app open: at/after 05:00 SAST it
   runs the same jobs the cloud runner would, once per day per job, and
   records the run as `runner: 'browser'` so the Autonomous Core app shows
   exactly what happened and where.

   NOTE: this only runs while a browser tab is open. For true 24/7 operation
   (working overnight with nobody logged in) deploy the Edge Function +
   pg_cron schedule in js/sql/cron.js (Admin → Go live, step 07).
   ========================================================================== */

import { IS_SUPABASE } from '../config.js';
import { bus } from '../core/bus.js';
import { today, nowSA } from '../core/dates.js';
import { agentSettings, alreadyRanToday, runJob, JOBS } from './adapters.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes whether it's time to run something
const START_HOUR = 5; // 05:00 SAST — matches the cron schedule in js/sql/cron.js
let timer = null;
let running = false;

/** Cloud mode: has the Edge Function already produced a run for this job today? */
function cloudAlreadyRan(kind) { return IS_SUPABASE() && alreadyRanToday(kind); }

async function tick() {
  if (running) return;
  const settings = agentSettings();
  const now = nowSA();
  if (now.getHours() < START_HOUR) return;
  const date = today();
  running = true;
  try {
    for (const job of JOBS) {
      if (settings.jobsEnabled && settings.jobsEnabled[job] === false) continue;
      if (job === 'morning_dispatch' || job === 'executive_briefing') {
        if (alreadyRanToday(job, date) || cloudAlreadyRan(job)) continue;
      }
      // payment_reminders / expiry_watch / pop_matching are safe to re-check hourly —
      // debtorReminders / expiryAlerts are themselves idempotent (they only act on
      // stages/keys not already recorded), so a browser tab open all day just keeps
      // them current instead of skipping the whole day like the once-only jobs above.
      try { await runJob(job, { date, runner: 'browser' }); } catch (e) { console.warn(`[agent] ${job} failed`, e); }
      bus.emit('agent:ran', { job, date });
    }
  } finally { running = false; }
}

let started = false;
/** Call once after sign-in (local mode, or cloud mode as a safety net). */
export function startLocalAgent() {
  if (started) return;
  started = true;
  setTimeout(tick, 3000);
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
export function stopLocalAgent() { clearInterval(timer); timer = null; started = false; }

/** Run a job immediately regardless of schedule — used by the "Run now" buttons. */
export async function runNow(job, opts = {}) {
  return runJob(job, { date: today(), runner: 'browser', force: true, ...opts });
}

export function isLocalAgentRunning() { return running; }
