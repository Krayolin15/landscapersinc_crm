// Write the go-live SQL to files, for psql:  npm run sql   (node tools/gen-sql.js [--out <folder>] [--project-ref <ref>])
//
// The SQL itself lives in js/sql/*.js (the same code Admin → Go live uses in the app), so nothing here is ever
// edited by hand: change js/schema/ and every step follows. This writes 01–05, 07 and 08 to build/sql/ — and 06,
// the company data, when the data pack is in data/seed/. build/ is git-ignored because 06 holds private data.
// --project-ref fills in step 07's project ref; step 08's emails are typed in Admin → Go live (or edited in the file).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STEPS, loginPeople } from '../js/sql/index.js';
import { hasPack, readPack } from './lib/seed-files.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = resolve(arg('--out', join(root, 'build', 'sql')));
const seedDir = join(root, 'data', 'seed');
const pack = hasPack(seedDir) ? readPack(seedDir) : null;

mkdirSync(out, { recursive: true });
for (const step of STEPS) {
  let sql;
  if (step.needs === 'pack') { if (!pack) { console.log(`- ${step.file} skipped: the data pack is not in data/seed/`); continue; } sql = step.sql(pack); }
  else if (step.needs === 'ref') sql = step.sql({ projectRef: arg('--project-ref', '') });
  else if (step.needs === 'emails') sql = step.sql({ people: loginPeople(pack ? pack.records.profiles : []) });
  else sql = step.sql();
  writeFileSync(join(out, step.file), sql);
  console.log(`✓ ${relative(root, join(out, step.file)).split('\\').join('/')}  ${(sql.length / 1024).toFixed(0)} KB${step.private ? '  (PRIVATE company data)' : ''}`);
}
