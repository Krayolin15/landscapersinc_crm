/* =============================================================================
   Settings — pure helper logic (no DOM, no db). Unit tested by tests/settings.test.js.
   Reminder-minute parsing/formatting, notification-kind preference merging,
   "Install app" step lists and a friendly device/browser label for sessions.
   ========================================================================== */

/** "30, 1440, 30, abc" -> [30, 1440] — trims, drops junk/non-positive, de-dupes, sorts ascending. */
export function parseReminderMinutes(text) {
  const seen = new Set();
  const out = [];
  for (const part of String(text ?? '').split(',')) {
    const n = parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out.sort((a, b) => a - b);
}

/** 30 -> "30 min before" · 60 -> "1 hour before" · 1440 -> "1 day before" · 4320 -> "3 days before" */
export function formatReminderMinutes(mins) {
  const n = Number(mins);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n % 1440 === 0) { const d = n / 1440; return `${d} day${d === 1 ? '' : 's'} before`; }
  if (n % 60 === 0) { const h = n / 60; return `${h} hour${h === 1 ? '' : 's'} before`; }
  return `${n} min before`;
}

export const DEFAULT_NOTIFY_KINDS = { reminders: true, tasks: true, alerts: true };
export const NOTIFY_KIND_LABELS = { reminders: 'Calendar reminders', tasks: 'Daily task digest', alerts: 'Business alerts (overdue invoices, expiring certificates…)' };

/** Merge a partial notification-kind edit onto the saved preferences without losing untouched keys. */
export function mergeNotifyKinds(base, patch) {
  return { ...DEFAULT_NOTIFY_KINDS, ...(base || {}), ...(patch || {}) };
}

/** Ordered "Install app" steps for a platform — pure data, no DOM. */
export function installSteps(platform) {
  if (platform === 'ios') {
    return ['Open this site in Safari (not Chrome or another browser).', 'Tap the Share icon at the bottom of the screen.', 'Scroll down and tap “Add to Home Screen”.', 'Tap “Add” — the app icon appears on your home screen and opens full-screen, offline-ready.'];
  }
  if (platform === 'android') {
    return ['Open this site in Chrome.', 'Tap “Install app” below (or the menu ⋮ → “Install app” / “Add to Home screen”).', 'Confirm the install prompt.', 'The app now opens from your home screen like a native app, and keeps working offline.'];
  }
  return ['Open this site in Chrome, Edge or another Chromium-based browser.', 'Click “Install app” below, or the install icon in the address bar.', 'Confirm — the app opens in its own window, separate from the browser.'];
}

/** Friendly "Chrome on Windows" style label from a User-Agent string, for the "My sessions" list. */
export function deviceLabel(ua) {
  const s = String(ua || '');
  let os = 'Unknown device';
  if (/Android/i.test(s)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Windows/i.test(s)) os = 'Windows';
  else if (/Mac OS X/i.test(s)) os = 'Mac';
  else if (/Linux/i.test(s)) os = 'Linux';
  let browser = 'a browser';
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/OPR\//i.test(s)) browser = 'Opera';
  else if (/Chrome\//i.test(s) && !/Chromium/i.test(s)) browser = 'Chrome';
  else if (/Firefox\//i.test(s)) browser = 'Firefox';
  else if (/Safari\//i.test(s) && !/Chrome/i.test(s)) browser = 'Safari';
  return `${browser} on ${os}`;
}
