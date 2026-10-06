// Build the deployable Supabase database files from the app's single source of truth.
// Usage: node tools__prepare-supabase.js [--project-ref <20 lowercase letters>]
// Writes:
//   supabase__migrations__20261006_lsi_hq_core.sql  (schema + RLS + triggers + storage + realtime)
//   supabase__seed.sql                              (private company seed data)
//   supabase__setup__07_cron.sql                    (project-specific 24/7 schedule)
//   supabase/setup/08_link_accounts.sql            (generated from the current profile list; add staff emails first)
// The seed contains private company data and should never be published separately.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaSql, rlsSql, triggersSql, storageSql, realtimeSql, cronSql, linkAccountsSql, loginPeople } from '../js__sql__index.js';
import { hasPack, readPack } from './lib/seed-files.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ref = arg('--project-ref', '');
const outMigration = join(root, 'supabase', 'migrations', '20261006_lsi_hq_core.sql');
const outSeed = join(root, 'supabase', 'seed.sql');
const outSetup = join(root, 'supabase', 'setup');
mkdirSync(dirname(outMigration), { recursive: true });
mkdirSync(outSetup, { recursive: true });

const core = [schemaSql(), rlsSql(), triggersSql(), storageSql(), realtimeSql()].join('\n');
writeFileSync(outMigration, core);
console.log(`✓ ${outMigration}`);

if (!hasPack(join(root, 'data', 'seed'))) {
  throw new Error('data/seed is missing. Keep the private data pack with the project before generating supabase__seed.sql.');
}
const pack = readPack(join(root, 'data', 'seed'));
writeFileSync(outSeed, (await import('../js__sql__seed.js')).seedSql(pack));
console.log(`✓ ${outSeed}`);

if (ref) {
  writeFileSync(join(outSetup, '07_cron.sql'), cronSql({ projectRef: ref }));
  console.log(`✓ ${join(outSetup, '07_cron.sql')}`);
} else {
  writeFileSync(join(outSetup, '07_cron.sql'), `-- Replace <PROJECT_REF> with the 20 lowercase letters in https://<PROJECT_REF>.supabase.co, then run this file.\n\n${cronSql({ projectRef: 'abcdefghijklmnopqrst' }).replaceAll('abcdefghijklmnopqrst', '<PROJECT_REF>')}`);
  console.log(`✓ ${join(outSetup, '07_cron.sql')} (template)`);
}

const people = loginPeople(pack.records.profiles || []);
writeFileSync(join(outSetup, '08_link_accounts.template.sql'), `-- This is a template. Replace the example email values below with the real Supabase Auth emails before running.\n-- ${people.length} staff account(s) were found in the private data pack.\n-- The app deliberately does not guess or invent staff email addresses.\n\n${linkAccountsSql({ people })}`);
console.log(`✓ ${join(outSetup, '08_link_accounts.template.sql')}`);
