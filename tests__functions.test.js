// Edge Functions and their deploy tool (no deploying, no network):  node tests__functions.test.js
import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { planConfig, listFunctions, NO_JWT, atLeast } from '../tools__deploy-functions.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };
const fnDir = join(root, 'supabase/functions');
const FNS = listFunctions(root);

t('five functions, each plain JavaScript (index.js, no TypeScript left)', () => {
  assert.deepEqual(FNS.map(f => f.name), ['admin-users', 'agent-run', 'ai-assistant', 'inbound-email', 'send-email']);
  (function walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else assert.ok(!/\.tsx?$/.test(e.name), `TypeScript file left: ${p}`); } })(fnDir);
  for (const f of FNS) execFileSync(process.execPath, ['--check', join(fnDir, f.name, 'index.js')]);
});
t('only the machine-called functions skip the login check', () => {
  assert.deepEqual([...NO_JWT].sort(), ['agent-run', 'inbound-email']);
  for (const f of FNS) assert.equal(f.verifyJwt, !NO_JWT.has(f.name));
  // and each of those two really checks its own secret header
  assert.match(readFileSync(join(fnDir, 'agent-run/index.js'), 'utf8'), /x-cron-secret/);
  assert.match(readFileSync(join(fnDir, 'inbound-email/index.js'), 'utf8'), /x-inbound-secret/);
});
t('a new config.toml names every JavaScript entry file', () => {
  const { text, created } = planConfig(null, FNS);
  assert.equal(created, true);
  for (const f of FNS) {
    const sec = text.split(`[functions.${f.name}]`)[1].split('\n[')[0];
    assert.match(sec, new RegExp(`entrypoint = './functions/${f.name}/index.js'`));
    assert.match(sec, new RegExp(`verify_jwt = ${f.verifyJwt}`));
  }
  assert.equal(planConfig(text, FNS).text, text, 'running again changes nothing');
});
t('an existing config.toml (supabase init) keeps every other line, and CRLF line endings', () => {
  const before = '# made by supabase init\r\nproject_id = "x"\r\n\r\n[api]\r\nport = 54321\r\n\r\n[functions.admin-users]\r\nverify_jwt = false # someone changed it\r\n\r\n[functions.other]\r\nverify_jwt = false\r\n';
  const { text, changes } = planConfig(before, FNS);
  assert.ok(text.startsWith('# made by supabase init\r\nproject_id = "x"\r\n\r\n[api]\r\nport = 54321\r\n'), 'the top is untouched');
  assert.ok(text.includes('[functions.other]\r\nverify_jwt = false\r\n'), 'other functions untouched');
  assert.ok(text.includes("[functions.admin-users]\r\nverify_jwt = true\r\nentrypoint = './functions/admin-users/index.js'\r\n"), 'ours corrected in place');
  assert.ok(!/[^\r]\n/.test(text), 'every line ends in CRLF');
  assert.equal(changes.find(c => c.name === 'admin-users').action, 'updated');
  assert.equal(changes.find(c => c.name === 'agent-run').action, 'added');
  assert.equal(planConfig(text, FNS).text, text, 'idempotent');
});
t('a setting given twice is refused instead of guessed', () => {
  assert.throws(() => planConfig('[functions.agent-run]\nverify_jwt = false\nverify_jwt = true\n', FNS), /twice/);
  assert.throws(() => planConfig('[functions.agent-run]\n[functions.agent-run]\n', FNS), /twice/);
});
t('CLI version check (entrypoint needs 1.215.0)', () => {
  assert.equal(atLeast('2.48.3', '1.215.0'), true);
  assert.equal(atLeast('1.215.0', '1.215.0'), true);
  assert.equal(atLeast('1.214.9', '1.215.0'), false);
  assert.equal(atLeast('', '1.215.0'), false);
});
t('the generated config.toml is not part of the project (git-ignored)', () => {
  const gi = readFileSync(join(root, '.gitignore'), 'utf8');
  assert.match(gi, /^supabase\/config\.toml$/m);
  assert.ok(!existsSync(join(root, 'supabase/config.toml')) || gi.includes('supabase/config.toml'));
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
