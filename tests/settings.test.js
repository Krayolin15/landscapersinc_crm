// Settings pure-logic tests:  node tests/settings.test.js
import assert from 'node:assert/strict';
import {
  parseReminderMinutes, formatReminderMinutes, mergeNotifyKinds, DEFAULT_NOTIFY_KINDS,
  installSteps, deviceLabel
} from '../js/apps/settings/lib.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };

// ---------------- reminder minutes ----------------
t('parseReminderMinutes: trims, dedupes, drops junk and non-positive values, sorts ascending', () => {
  assert.deepEqual(parseReminderMinutes(' 1440, 30 ,30, abc, 0, -5, 90'), [30, 90, 1440]);
});
t('parseReminderMinutes: empty / blank input gives an empty list', () => {
  assert.deepEqual(parseReminderMinutes(''), []);
  assert.deepEqual(parseReminderMinutes(null), []);
  assert.deepEqual(parseReminderMinutes('   '), []);
});
t('formatReminderMinutes: minutes, hours and days pick the coarsest exact unit', () => {
  assert.equal(formatReminderMinutes(15), '15 min before');
  assert.equal(formatReminderMinutes(60), '1 hour before');
  assert.equal(formatReminderMinutes(120), '2 hours before');
  assert.equal(formatReminderMinutes(1440), '1 day before');
  assert.equal(formatReminderMinutes(4320), '3 days before');
  assert.equal(formatReminderMinutes(90), '90 min before'); // not a whole number of hours
});
t('formatReminderMinutes: zero/negative/non-numeric returns null', () => {
  assert.equal(formatReminderMinutes(0), null);
  assert.equal(formatReminderMinutes(-30), null);
  assert.equal(formatReminderMinutes('abc'), null);
});

// ---------------- notification-kind preferences ----------------
t('mergeNotifyKinds: fills in defaults for keys never set', () => {
  assert.deepEqual(mergeNotifyKinds(undefined, undefined), DEFAULT_NOTIFY_KINDS);
});
t('mergeNotifyKinds: saved preferences override defaults, then the patch overrides those', () => {
  const saved = { reminders: false };
  const patch = { tasks: false };
  const merged = mergeNotifyKinds(saved, patch);
  assert.deepEqual(merged, { reminders: false, tasks: false, alerts: true });
});
t('mergeNotifyKinds: does not mutate the inputs', () => {
  const saved = { reminders: false };
  mergeNotifyKinds(saved, { tasks: false });
  assert.deepEqual(saved, { reminders: false });
});

// ---------------- install instructions ----------------
t('installSteps: iOS mentions Safari and Add to Home Screen', () => {
  const steps = installSteps('ios');
  assert.ok(steps.length >= 3);
  assert.ok(steps.some(s => /safari/i.test(s)));
  assert.ok(steps.some(s => /add to home screen/i.test(s)));
});
t('installSteps: android mentions Chrome and Install app', () => {
  const steps = installSteps('android');
  assert.ok(steps.some(s => /chrome/i.test(s)));
  assert.ok(steps.some(s => /install/i.test(s)));
});
t('installSteps: unknown platform falls back to desktop instructions', () => {
  assert.deepEqual(installSteps('desktop'), installSteps('something-else'));
});

// ---------------- device label ----------------
t('deviceLabel: recognises common browser/OS combinations', () => {
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'), 'Chrome on Windows');
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari on iOS');
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'), 'Chrome on Android');
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0'), 'Edge on Windows');
});
t('deviceLabel: unrecognised UA still returns a readable fallback', () => assert.equal(deviceLabel(''), 'a browser on Unknown device'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
