// Runs every tests/*.test.js in its own Node process and prints one summary.
//   node tools/test-all.js            (npm test)
import { readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(join(root, 'tests')).filter(f => f.endsWith('.test.js')).sort();
let passed = 0, failed = 0, broken = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [join(root, 'tests', f)], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const m = /(\d+) passed, (\d+) failed/.exec(out);
  if (m) { passed += Number(m[1]); failed += Number(m[2]); }
  const ok = r.status === 0 && m;
  if (!ok) broken += m ? 0 : 1;
  console.log(`${ok ? '✓' : '✗'} ${f.padEnd(24)} ${m ? `${m[1]} passed, ${m[2]} failed` : `exit ${r.status}${r.error ? ` (${r.error.message})` : ''}`}`);
  if (!ok) console.log(out.split('\n').filter(l => l.trim()).slice(-12).map(l => `    ${l}`).join('\n'));
}
console.log(`\n${files.length} files · ${passed} passed · ${failed} failed${broken ? ` · ${broken} file(s) did not run` : ''}`);
process.exit(failed || broken ? 1 : 0);
