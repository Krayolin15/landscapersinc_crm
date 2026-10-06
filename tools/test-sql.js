// Proves the Supabase SQL works BEFORE you touch a real project:
//   npm install            (once — installs the dev-only PGlite, a real Postgres compiled to WebAssembly)
//   npm run test:sql       (node tools/test-sql.js [--json])
//
// Runs the SQL of steps 01–05, the company data (06, built from the private data pack in data/seed — or a tiny
// stand-in when the pack is not in this folder; LSI_SEED_DIR=<folder> points elsewhere), 07 and 08 — straight from
// js/sql/*.js, exactly what Admin → Go live hands out — against Postgres with minimal Supabase stand-ins (auth.users,
// auth.uid(), storage, the realtime publication), then signs in as each role and checks the security rules:
// row policies, sensitive columns (only via <table>_sensitive for the allowed roles), attribution that
// cannot be spoofed, an append-only audit log, and the account-link script.
import { schemaSql, rlsSql, triggersSql, storageSql, realtimeSql } from '../js/sql/schema.js';
import { seedSql } from '../js/sql/seed.js';
import { cronSql as cronStep } from '../js/sql/cron.js';
import { linkAccountsSql, loginPeople } from '../js/sql/link-accounts.js';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasPack, readPack, readCollection } from './lib/seed-files.js';
import { SCHEMA } from '../js/core/schema.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEED_DIR = process.env.LSI_SEED_DIR ? resolve(process.env.LSI_SEED_DIR) : join(ROOT, 'data', 'seed');
const STEP = { '01_schema.sql': schemaSql, '02_rls.sql': rlsSql, '03_triggers.sql': triggersSql, '04_storage.sql': storageSql, '05_realtime.sql': realtimeSql };
let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); }
catch { console.error('PGlite is not installed. Run `npm install` in this folder first (dev-only, not needed by the app).'); process.exit(2); }

const out = { steps: [], checks: [] };
const ok = (name, pass, detail = '') => out.checks.push({ name, pass: !!pass, detail: String(detail).slice(0, 600) });
const db = new PGlite();
async function run(label, sql) {
  try { await db.exec(sql); out.steps.push({ label, ok: true }); return true; }
  catch (e) {
    await db.exec('rollback').catch(() => {});
    const i = Number(e.position || 0);
    out.steps.push({ label, ok: false, error: String(e.message || e).slice(0, 400), near: i ? sql.slice(Math.max(0, i - 160), i + 80).replace(/\s+/g, ' ') : '' });
    return false;
  }
}
const q = async (sql, params = []) => { try { return (await db.query(sql, params)).rows; } catch (e) { await db.exec('rollback').catch(() => {}); throw e; } };
const tryQ = async sql => { try { return { rows: await q(sql) }; } catch (e) { return { error: String(e.message).slice(0, 200) }; } };
async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}

// Sensitive columns straight from the schema
const SENS = {};
for (const [col, def] of Object.entries(SCHEMA)) {
  const fields = Object.entries(def.fields).filter(([, f]) => f.sensitive && !f.computed).map(([n]) => n);
  if (fields.length) SENS[col] = { fields, allowed: def.sensitiveRoles || ['manager', 'finance'], write: def.perms && def.perms.write };
}

async function main() {
  await run('Supabase stand-ins', `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create schema storage; grant usage on schema storage to anon, authenticated, service_role;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to authenticated;
    create publication supabase_realtime;`);

  for (const f of ['01_schema.sql', '02_rls.sql', '03_triggers.sql', '04_storage.sql', '05_realtime.sql']) {
    let sql = STEP[f]();
    if (f === '01_schema.sql') sql = sql.replace(/create extension if not exists pgcrypto;/i, '-- (pgcrypto: gen_random_uuid is built in)');
    ok(`${f} runs on a fresh database`, await run(f, sql), out.steps.at(-1).error || '');
  }

  // upgrading: a database made by an older release (missing this release's columns) catches up by re-running 01–05
  await run('simulate an older database', `alter table public.sheets drop column restricted_to cascade; alter table public.form_responses drop column form_category cascade; alter table public.drives drop column roles cascade;`);
  let upgraded = true;
  for (const f of ['01_schema.sql', '02_rls.sql', '03_triggers.sql', '04_storage.sql', '05_realtime.sql']) {
    let sql = STEP[f]();
    if (f === '01_schema.sql') sql = sql.replace(/create extension if not exists pgcrypto;/i, '-- (pgcrypto: gen_random_uuid is built in)');
    upgraded = (await run(`${f} again (upgrade)`, sql)) && upgraded;
  }
  const back = await q(`select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (('sheets', 'restricted_to'), ('form_responses', 'form_category'), ('drives', 'roles'))`);
  ok('re-running 01–05 upgrades an older database (new columns, policies and triggers)', upgraded && back.length === 3, out.steps.filter(x => !x.ok).map(x => x.error).join('; ') || JSON.stringify(back));

  // company data (private data pack) or a tiny stand-in with the same ids
  const realSeed = hasPack(SEED_DIR);
  if (realSeed) {
    const pack = readPack(SEED_DIR);
    ok('06_seed.sql loads', await run('06_seed.sql', seedSql(pack)), out.steps.at(-1).error || '');
    const { manifest } = pack;
    const bad = [];
    for (const c of manifest.collections) { const [{ n }] = await q(`select count(*)::int as n from public."${c.name}"`); if (n !== c.count) bad.push(`${c.name}: ${n} in SQL vs ${c.count} in the pack`); }
    ok('every data-pack record is in the database', !bad.length, bad.join('; '));
  } else {
    const standIn = await run('stand-in data', `
      insert into public.profiles (id, name, role, status, must_change_password) values ('prof-jared', 'Jared (stand-in)', 'owner', 'active', true), ('prof-wayne', 'Wayne (stand-in)', 'sales', 'active', true);
      insert into public.events (id, title, start_date, created_by, created_by_name) values ('ev-1', 'Meeting', '2026-09-10', 'prof-jared', 'Jared');
      insert into public.employees (id, full_name, id_number, status) values ('emp-1', 'Test Person', '9001015009087', 'active');
      insert into public.certificates (id, employee_id, person_name, course, id_number) values ('cert-1', 'emp-1', 'Test Person', 'First aid', '9001015009087');
      insert into public.jobs (id, title, value, cost, status) values ('job-1', 'Test job', 1400, 530, 'completed');
      insert into public.clients (id, name) values ('cl-1', 'Test client');
      insert into public.contracts (id, client_id, name, frequency, monthly_value, status) values ('ct-1', 'cl-1', 'Test contract', 'monthly', 1000, 'active');
      insert into public.forms (id, title, category) values ('form-hr', 'Grievance', 'hr'), ('form-inc', 'Incident report', 'incident'), ('form-insp', 'Site inspection', 'inspection');`);
    ok('stand-in data loads (no private data pack here)', standIn, out.steps.at(-1).error || '');
  }

  // 07: the 24/7 agent schedule, with stand-ins for pg_cron, pg_net and Vault (not available here)
  await run('pg_cron / pg_net / Vault stand-ins', `
    create schema if not exists extensions; create schema if not exists cron; create schema if not exists net; create schema if not exists vault;
    create table if not exists cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
    create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $f$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $f$;
    create or replace function cron.unschedule(id bigint) returns boolean language sql as $f$ delete from cron.job where jobid = id returning true $f$;
    create or replace function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $f$ select 1::bigint $f$;
    create table if not exists vault.decrypted_secrets (name text, decrypted_secret text);`);
  const cronSql = cronStep().replace(/create extension if not exists pg_(cron|net)[^;]*;/gi, '-- (extension stand-in)');
  ok('07_cron.sql runs', await run('07_cron.sql', cronSql), out.steps.at(-1).error || '');
  ok('07: 05:00 dispatch and 05:30 briefing are scheduled (UTC 03:00 / 03:30)', (await q(`select jobname, schedule from cron.job where (jobname, schedule) in (('agent-morning-dispatch', '0 3 * * *'), ('agent-executive-briefing', '30 3 * * *'))`)).length === 2);
  ok('07: re-running keeps one copy of each job', await run('07 again', cronSql) && (await q(`select count(*)::int as n from cron.job`))[0].n === 4);
  const openFns = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype and p.proname not in ('my_role', 'has_role', 'my_name')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
  ok('no privileged (security definer) function can be called through the API', !openFns.length, openFns.map(x => x.proname).join(', '));

  // 08: link the imported owner + one more to real logins
  const jared = '11111111-1111-4111-8111-111111111111', wayne = '33333333-3333-4333-8333-333333333333';
  await run('logins', `insert into auth.users (id, email) values ('${jared}', 'jared@test.local'), ('${wayne}', 'wayne@test.local');`);
  const before = (await q(`select count(*)::int as n from public.events where created_by = 'prof-jared'`))[0].n;
  // the people as Admin → Go live finds them in the data pack (or the stand-ins), with the emails typed in for two of them
  const people = realSeed ? loginPeople(readCollection(SEED_DIR, 'profiles')) : [{ id: 'prof-jared', name: 'Jared (stand-in)', role: 'owner' }, { id: 'prof-wayne', name: 'Wayne (stand-in)', role: 'sales' }];
  const linkSql = linkAccountsSql({ people, emails: { 'prof-jared': 'jared@test.local', 'prof-wayne': 'wayne@test.local' } });
  ok('08: only the people given an email get an active link line', linkSql.split('\n').filter(l => l.startsWith('select public.link_seed_profile(')).length === 2);
  const linked = await run('08_link_accounts.sql', linkSql);
  ok('08_link_accounts.sql runs', linked, out.steps.at(-1).error || '');
  if (linked) {
    const p = await q(`select email, must_change_password from public.profiles where id = $1`, [jared]);
    ok('08: the owner profile now uses the login id and must change password', p.length === 1 && p[0].must_change_password === true, JSON.stringify(p));
    ok('08: history follows the person', (await q(`select count(*)::int as n from public.events where created_by = $1`, [jared]))[0].n === before);
    const cols = await q(`select c.table_name, c.column_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where c.table_schema='public' and t.table_type='BASE TABLE' and c.data_type in ('text','jsonb') and c.table_name <> 'audit_log'`);
    const left = [];
    for (const c of cols) { const [{ n }] = await q(`select count(*)::int as n from public."${c.table_name}" where "${c.column_name}"::text like '%"prof-jared"%' or "${c.column_name}"::text = 'prof-jared'`); if (n) left.push(`${c.table_name}.${c.column_name}=${n}`); }
    ok('08: no reference to the old id is left', !left.length, left.join(', '));
    ok('08: triggers are back on', !(await q(`select 1 from pg_trigger where not tgisinternal and tgenabled <> 'O'`)).length);
    ok('08: re-running is safe', await run('08 again', `select public.link_seed_profile('prof-jared', 'jared@test.local');`));
  }

  // one test login per role
  const ROLES = ['viewer', 'field', 'supervisor', 'operations', 'sales', 'hr', 'finance', 'manager'];
  const uidOf = role => `44444444-4444-4444-8444-${String(100000000000 + ROLES.indexOf(role))}`;
  for (const role of ROLES) await run(`login ${role}`, `insert into auth.users (id, email) values ('${uidOf(role)}', '${role}@test.local'); insert into public.profiles (id, name, role, status) values ('${uidOf(role)}', 'Test ${role}', '${role}', 'active');`);

  // row-level rules for a field worker
  const f = uidOf('field');
  const r = await as(f, async () => ({
    hashes: await tryQ(`select count(*)::int as n from public.profiles where password_hash is not null`),
    payroll: await tryQ(`select count(*)::int as n from public.payroll`),
    medicals: await tryQ(`select count(*)::int as n from public.medicals`),
    bank: await tryQ(`select count(*)::int as n from public.bank_accounts`),
    promote: await tryQ(`update public.profiles set role = 'owner' where id = '${f}' returning role`),
    spoof: await tryQ(`insert into public.tasks (id, title, created_by, created_by_name) values ('t-spoof', 'x', 'prof-renesh', 'Renesh') returning created_by`),
    forge: await tryQ(`insert into public.audit_log (id, at, action) values ('a-x', now(), 'forged') returning id`),
  }));
  const none = x => !!x.error || (x.rows || [{ n: 0 }])[0].n === 0;
  ok('field worker: no password hashes visible', none(r.hashes), JSON.stringify(r.hashes));
  ok('field worker: cannot read payroll', none(r.payroll), JSON.stringify(r.payroll));
  ok('field worker: cannot read medicals', none(r.medicals), JSON.stringify(r.medicals));
  ok('field worker: cannot read bank accounts', none(r.bank), JSON.stringify(r.bank));
  ok('field worker: cannot promote themselves', !!r.promote.error || !(r.promote.rows || []).length, JSON.stringify(r.promote));
  ok('attribution cannot be spoofed', !!r.spoof.error || (r.spoof.rows || [])[0]?.created_by === f, JSON.stringify(r.spoof));
  ok('audit log cannot be written directly', !!r.forge.error || !(r.forge.rows || []).length, JSON.stringify(r.forge));

  // sensitive columns: never from the table; only allowed roles through <col>_sensitive
  const leaks = [], viewLeaks = [], viewMiss = [];
  for (const role of ROLES) {
    for (const [col, spec] of Object.entries(SENS)) {
      const t = await as(uidOf(role), () => tryQ(`select ${spec.fields.map(x => `count("${x}")::int as "${x}"`).join(', ')} from public."${col}"`));
      const exposed = t.rows ? Object.entries(t.rows[0]).filter(([, n]) => n > 0).map(([x]) => x) : [];
      if (exposed.length) leaks.push(`${role} reads ${col}.{${exposed.join(',')}} from the table`);
      const v = await as(uidOf(role), () => tryQ(`select count(*)::int as n from public."${col}_sensitive"`));
      const rows = v.rows ? v.rows[0].n : 0;
      const allowed = spec.allowed.includes(role);
      if (rows && !allowed) viewLeaks.push(`${role} gets ${rows} rows from ${col}_sensitive`);
      if (allowed && !rows && (await q(`select count(*)::int as n from public."${col}"`))[0].n) viewMiss.push(`${role} gets nothing from ${col}_sensitive`);
    }
  }
  ok('sensitive columns are never returned by the tables', !leaks.length, leaks.join('; '));
  ok('only the allowed roles read <table>_sensitive', !viewLeaks.length, viewLeaks.join('; '));
  ok('allowed roles do read <table>_sensitive', !viewMiss.length, viewMiss.join('; '));

  // an app save (PostgREST upsert of the visible fields) by a writer who cannot see the sensitive fields
  const appUpsert = async (uid, table, id, patch) => {
    const hidden = new Set(SENS[table].fields);
    const row = (await q(`select to_jsonb(t) as j from public."${table}" t where id = $1`, [id]))[0].j;
    const sent = { ...Object.fromEntries(Object.entries(row).filter(([k]) => !hidden.has(k))), ...patch };
    const cols = Object.keys(sent).map(c => `"${c}"`).join(', ');
    const lit = `'${JSON.stringify(sent).replace(/'/g, "''")}'::jsonb`;
    return as(uid, () => tryQ(`insert into public."${table}" (${cols}) select ${cols} from jsonb_populate_record(null::public."${table}", ${lit}) on conflict (id) do update set ${Object.keys(sent).filter(c => c !== 'id').map(c => `"${c}" = excluded."${c}"`).join(', ')}`));
  };
  for (const [table, spec] of Object.entries(SENS)) {
    const writer = (Array.isArray(spec.write) ? spec.write : []).find(role => ROLES.includes(role) && !spec.allowed.includes(role));
    if (!writer) continue;
    const row = (await q(`select id, ${spec.fields.map(x => `"${x}"`).join(', ')} from public."${table}" where ${spec.fields.map(x => `"${x}" is not null`).join(' or ')} limit 1`))[0];
    if (!row) continue;
    const w = await appUpsert(uidOf(writer), table, row.id, { notes: `${writer} note` });
    const after = (await q(`select ${spec.fields.map(x => `"${x}"`).join(', ')}, notes from public."${table}" where id = $1`, [row.id]))[0];
    ok(`${table}: ${writer} can save a record`, !w.error && after.notes === `${writer} note`, JSON.stringify(w));
    ok(`${table}: that save keeps the hidden values`, spec.fields.every(x => String(after[x]) === String(row[x])), JSON.stringify({ before: row, after }));
  }

  // confidential form responses: the category comes from the form (trigger), never from the person submitting
  const n = x => (x.rows ? x.rows.length : 0);
  const formOf = async cat => ((await q(`select id from public.forms where category = $1 order by id limit 1`, [cat]))[0] || {}).id;
  const [hrForm, incForm, inspForm] = [await formOf('hr'), await formOf('incident'), await formOf('inspection')];
  ok('seed has HR, incident and inspection forms', !!(hrForm && incForm && inspForm));
  const sub = await as(f, () => tryQ(`insert into public.form_responses (id, form_id, form_title, form_category, answers, status) values
    ('fr-hr', '${hrForm}', 'Grievance', 'other', '{}', 'submitted'), ('fr-inc', '${incForm}', 'Incident', null, '{}', 'submitted'), ('fr-insp', '${inspForm}', 'Inspection', 'hr', '{}', 'submitted') returning id, form_category`));
  ok('a field worker can submit form responses', !sub.error && n(sub) === 3, JSON.stringify(sub));
  const catOf = id => (sub.rows || []).find(x => x.id === id)?.form_category;
  ok('response category is taken from the form, not the submitter', catOf('fr-hr') === 'hr' && catOf('fr-inc') === 'incident' && catOf('fr-insp') === 'inspection', JSON.stringify(sub.rows));
  const EXPECT = { 'fr-hr': ['field', 'hr', 'manager'], 'fr-inc': ['field', 'hr', 'manager', 'operations'], 'fr-insp': ROLES };
  const wrongSee = [];
  for (const [id, who] of Object.entries(EXPECT)) for (const role of ROLES) {
    const seen = n(await as(uidOf(role), () => tryQ(`select id from public.form_responses where id = '${id}'`))) === 1;
    if (seen !== who.includes(role)) wrongSee.push(`${role} ${seen ? 'sees' : 'cannot see'} ${id}`);
  }
  ok('HR / incident responses: only the submitter and the handling roles read them', !wrongSee.length, wrongSee.join('; '));
  const upd = async (role, id, set) => n(await as(uidOf(role), () => tryQ(`update public.form_responses set ${set} where id = '${id}' returning id`)));
  ok('the submitter cannot change a response after sending it', (await upd('field', 'fr-insp', `status = 'closed'`)) === 0);
  ok('operations reviews inspection and incident responses', (await upd('operations', 'fr-insp', `status = 'reviewed'`)) === 1 && (await upd('operations', 'fr-inc', `status = 'reviewed'`)) === 1);
  ok('operations cannot touch HR responses', (await upd('operations', 'fr-hr', `status = 'closed'`)) === 0);
  ok('HR reviews HR responses', (await upd('hr', 'fr-hr', `status = 'reviewed', form_category = 'other'`)) === 1);
  ok('a reviewer cannot re-label a response to make it public', (await q(`select form_category from public.form_responses where id = 'fr-hr'`))[0].form_category === 'hr');
  await run('re-categorise a form', `update public.forms set category = 'survey' where id = '${inspForm}'`);
  ok('responses follow their form when it is re-categorised', (await q(`select form_category from public.form_responses where id = 'fr-insp'`))[0].form_category === 'survey');
  await run('restore form category', `update public.forms set category = 'inspection' where id = '${inspForm}'`);

  // spreadsheets built from restricted records stay with the roles allowed to read those records
  const mk = await as(uidOf('manager'), () => tryQ(`insert into public.sheets (id, title, tabs, restricted_to) values ('sh-pay', 'Payroll export', '[]', '["finance"]'), ('sh-open', 'Price list', '[]', null) returning id`));
  ok('a manager can save a restricted spreadsheet', !mk.error && n(mk) === 2, JSON.stringify(mk));
  const sheetSee = [];
  for (const role of ROLES) {
    const seen = new Set(((await as(uidOf(role), () => tryQ(`select id from public.sheets where id in ('sh-pay', 'sh-open')`))).rows || []).map(x => x.id));
    if (!seen.has('sh-open')) sheetSee.push(`${role} cannot see an unrestricted sheet`);
    if (seen.has('sh-pay') !== ['finance', 'manager'].includes(role)) sheetSee.push(`${role} ${seen.has('sh-pay') ? 'sees' : 'cannot see'} the restricted sheet`);
  }
  ok('restricted spreadsheets: only the listed roles and the creator', !sheetSee.length, sheetSee.join('; '));
  ok('a restricted spreadsheet cannot be changed by someone who cannot see it', (n(await as(uidOf('sales'), () => tryQ(`update public.sheets set title = 'x' where id = 'sh-pay' returning id`)))) === 0);

  // restricted shared drives (FINANCE, HR) and the stored documents behind every file record
  await run('drive fixtures', `
    insert into public.drives (id, name, restricted, roles, members) values ('drive-finance', 'FINANCE', true, '["finance"]', '[]'), ('drive-hr', 'HR', true, '["hr"]', '[]'), ('drive-sops', 'SOPS', false, '[]', '[]') on conflict (id) do update set restricted = excluded.restricted, roles = excluded.roles;
    insert into public.files (id, name, drive_id, confidential, storage_path) values ('f-fin', 'Bank statement.pdf', 'drive-finance', false, 'drive-finance/f-fin/Bank statement.pdf'),
      ('f-hr', 'Contract.pdf', 'drive-hr', false, 'drive-hr/f-hr/Contract.pdf'), ('f-sop', 'Mowing SOP.pdf', 'drive-sops', false, 'drive-sops/f-sop/Mowing SOP.pdf'),
      ('f-conf', 'Disciplinary.pdf', 'drive-sops', true, 'drive-sops/f-conf/Disciplinary.pdf')
      on conflict (id) do update set drive_id = excluded.drive_id, confidential = excluded.confidential, storage_path = excluded.storage_path;
    insert into storage.objects (bucket_id, name) select 'drive', storage_path from public.files where id in ('f-fin', 'f-hr', 'f-sop', 'f-conf');
    insert into storage.objects (bucket_id, name) values ('avatars', 'u/me.png');`);
  const DRIVE_EXPECT = { 'f-fin': ['finance', 'manager'], 'f-hr': ['hr', 'manager'], 'f-sop': ROLES, 'f-conf': ['hr', 'manager'] };
  const driveWrong = [], objWrong = [];
  for (const role of ROLES) {
    const files = new Set(((await as(uidOf(role), () => tryQ(`select id from public.files where id in ('f-fin', 'f-hr', 'f-sop', 'f-conf')`))).rows || []).map(x => x.id));
    const objs = new Set(((await as(uidOf(role), () => tryQ(`select name from storage.objects where bucket_id = 'drive'`))).rows || []).map(x => x.name.split('/')[1]));
    for (const [id, who] of Object.entries(DRIVE_EXPECT)) {
      if (files.has(id) !== who.includes(role)) driveWrong.push(`${role} ${files.has(id) ? 'sees' : 'cannot see'} ${id}`);
      if (objs.has(id) !== who.includes(role)) objWrong.push(`${role} ${objs.has(id) ? 'can download' : 'cannot download'} ${id}`);
    }
  }
  ok('restricted drives: FINANCE for finance, HR for hr, both for managers; confidential files for manager/HR', !driveWrong.length, driveWrong.join('; '));
  ok('stored documents follow their file record (no listing or downloading around it)', !objWrong.length, objWrong.join('; '));
  ok('profile pictures stay readable by all staff', n(await as(uidOf('field'), () => tryQ(`select name from storage.objects where bucket_id = 'avatars'`))) === 1);
  const upFin = await as(uidOf('sales'), () => tryQ(`insert into storage.objects (bucket_id, name, owner) values ('drive', 'drive-finance/x/y.pdf', '${uidOf('sales')}') returning name`));
  const upSop = await as(uidOf('sales'), () => tryQ(`insert into storage.objects (bucket_id, name, owner) values ('drive', 'drive-sops/x/y.pdf', '${uidOf('sales')}') returning name`));
  ok('nobody uploads into a restricted drive they cannot open', !!upFin.error && !upSop.error, JSON.stringify({ upFin, upSop }));
  ok('nobody files a record into a restricted drive they cannot open', !!(await as(uidOf('sales'), () => tryQ(`insert into public.files (id, name, drive_id) values ('f-x', 'x.pdf', 'drive-hr')`))).error);
}

try { await main(); } catch (e) { ok('test run completed', false, e && e.stack || e); }
const failed = out.checks.filter(c => !c.pass);
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
else {
  for (const c of out.checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.pass ? '' : `\n    ${c.detail}`}`);
  for (const s of out.steps.filter(x => !x.ok)) console.log(`  step failed: ${s.label}: ${s.error}${s.near ? `\n    near: …${s.near}…` : ''}`);
  console.log(`\n${out.checks.length - failed.length} passed, ${failed.length} failed`);
}
process.exit(failed.length ? 1 : 0);
