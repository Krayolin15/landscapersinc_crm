// reset-password.html (js__reset-password.js) must write passwords exactly as the app checks them:  node tests__reset.test.js
// (npm run test:browser proves it end to end: it resets a password on that page and signs in with it.)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONFIG } from '../js__config.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };
const page = readFileSync(new URL('../js__reset-password.js', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../js__core__auth.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../reset-password.html', import.meta.url), 'utf8');

t('same database as the app', () => {
  assert.match(page, new RegExp(`DB_NAME = '${CONFIG.dbName}', DB_VERSION = ${CONFIG.dbVersion}\\b`));
});
t('same password scrambling as js__core__auth.js (PBKDF2-SHA256, 100 000 iterations, 256 bits)', () => {
  for (const part of [/name: 'PBKDF2', hash: 'SHA-256'/, /iterations: 100000/, /, key, 256\)/]) { assert.match(page, part); assert.match(auth, part); }
});
t('same password rules as the app', () => {
  for (const rule of ["pw.length < 8", "/[A-Za-z]/", "/\\d/"]) { assert.ok(page.includes(rule), rule); assert.ok(auth.includes(rule), rule); }
});
t('only local: refuses Supabase mode and hosted addresses', () => {
  assert.match(page, /settings\.mode === 'supabase'/);
  assert.match(page, /location\.protocol === 'file:' \|\| \/\^\(localhost\|127/);
});
t('every reset is logged and announced', () => {
  assert.match(page, /col: 'audit_log'/);
  assert.match(page, /col: 'notifications'/);
});
t('the page loads the settings, then its script, and nothing from elsewhere', () => {
  assert.match(html, /<script src="js\/settings\.js"><\/script>\s*<script src="js\/reset-password\.js"><\/script>/);
  assert.ok(!/<script>[^<]/.test(html), 'no inline script');
  assert.ok(!/src="https?:/.test(html), 'no external script');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
