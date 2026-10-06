// Record links (#/record/<col>/<id>) must open the owning app's own page:  node tests/record-owners.test.js
// Reads the app sources as text (the modules need a browser), so it runs anywhere.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };

const src = readFileSync(join(root, 'js/apps/record/index.js'), 'utf8');
const OWNERS = Function(`return ${/export const OWNERS = (\{[\s\S]*?\n\});/.exec(src)[1]}`)();

// what each app actually renders: hand-written `detail: { col: … }` exports and makeApp({ collections: [...] })
const renders = {};
const topKeys = body => { let d = 0, flat = ''; for (const c of body) { if ('({['.includes(c)) d++; if (')}]'.includes(c)) d--; flat += d === 0 ? c : ' '; } return [...flat.matchAll(/(?:^|,)\s*([a-z_]+)\s*:/g)].map(m => m[1]); };
for (const app of readdirSync(join(root, 'js/apps'))) {
  const p = join(root, 'js/apps', app, 'index.js');
  if (!existsSync(p) || app === 'record') continue;
  const s = readFileSync(p, 'utf8');
  const gen = /makeApp\(\{[\s\S]*?collections:\s*(\[[^\]]*\])/.exec(s);
  if (gen) for (const c of JSON.parse(gen[1].replace(/'/g, '"'))) (renders[c] ??= new Set()).add(app);
  const i = s.search(/\bdetail\s*:\s*\{/);
  if (i >= 0) {
    const j = s.indexOf('{', i); let d = 0, k = j;
    for (; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}' && !--d) break; }
    for (const c of topKeys(s.slice(j + 1, k))) (renders[c] ??= new Set()).add(app);
  }
}

t('every collection an app renders has an owner entry', () => {
  const missing = Object.keys(renders).filter(c => !OWNERS[c]);
  assert.deepEqual(missing, []);
});
t('every owner listed really renders that collection', () => {
  const wrong = Object.entries(OWNERS).flatMap(([c, apps]) => apps.filter(a => !(renders[c] && renders[c].has(a))).map(a => `${c} → ${a}`));
  assert.deepEqual(wrong, []);
});
t('owner apps exist in the registry', () => {
  const reg = readFileSync(join(root, 'js/apps/registry.js'), 'utf8');
  const ids = new Set([...reg.matchAll(/\{ id: '([a-z_]+)'/g)].map(m => m[1]));
  const unknown = [...new Set(Object.values(OWNERS).flat())].filter(a => !ids.has(a));
  assert.deepEqual(unknown, []);
});
t('custom pages win over the generic ones', () => { assert.equal(OWNERS.visits[0], 'schedule'); assert.equal(OWNERS.sheets[0], 'sheets'); });

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
