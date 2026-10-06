// The go-live SQL modules (js/sql/*.js), without a database:  node tests/sql.test.js
// (npm run test:sql runs all of it in a real Postgres.)
import assert from 'node:assert/strict';
import { STEPS, cronSql, linkAccountsSql, loginPeople, seedSql, schemaSql } from '../js/sql/index.js';
import { SCHEMA } from '../js/core/schema.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };

t('eight steps in order, each with a generator', () => {
  assert.deepEqual(STEPS.map(s => s.id), ['01', '02', '03', '04', '05', '06', '07', '08']);
  for (const s of STEPS) { assert.equal(typeof s.sql, 'function'); assert.match(s.file, new RegExp(`^${s.id}_[a-z_]+\\.sql$`)); }
  assert.deepEqual(STEPS.filter(s => s.private).map(s => s.id), ['06'], 'only the company data is private');
});
t('step 01 creates every record type', () => {
  const sql = schemaSql();
  for (const col of Object.keys(SCHEMA)) assert.ok(sql.includes(`create table if not exists public.`) && new RegExp(`create table if not exists public\\.("?)${col}\\1 \\(`).test(sql), col);
});
t('step 07: the project ref is filled in, and only a real ref is accepted', () => {
  assert.match(cronSql(), /'<PROJECT_REF>'/);
  const sql = cronSql({ projectRef: 'abcdefghijklmnopqrst' });
  assert.match(sql, /v_project_ref text := 'abcdefghijklmnopqrst';/);
  assert.ok(!/v_project_ref text := '<PROJECT_REF>'/.test(sql));
  for (const bad of ['short', 'ABCDEFGHIJKLMNOPQRST', "abcdefghijklmnopqrs'", 'abcdefghijklmnopqrst; drop table x']) assert.throws(() => cronSql({ projectRef: bad }), /not a Supabase project ref/, bad);
});
t('step 08: people come from the data, owner first; emails make active lines; unsafe input refused', () => {
  const profiles = [
    { id: 'prof-b', name: 'Bea Two', role: 'sales', password_hash: 'x' }, { id: 'prof-a', name: 'Al One', role: 'owner', password_hash: 'x' },
    { id: 'prof-c', name: 'No Login', role: 'manager' }, { id: 'prof-d', name: 'Gone', role: 'admin', password_hash: 'x', deleted_at: '2026-01-01' }
  ];
  const people = loginPeople(profiles);
  assert.deepEqual(people.map(p => p.id), ['prof-a', 'prof-b']);
  const active = sql => sql.split('\n').filter(l => l.startsWith('select public.link_seed_profile('));
  assert.equal(active(linkAccountsSql({ people })).length, 1, 'with no emails: the owner line only, as an example');
  const two = linkAccountsSql({ people, emails: { 'prof-b': 'Bea@Company.co.za' } });
  assert.deepEqual(active(two).map(l => /'([^']+@[^']+)'/.exec(l)[1]), ['bea@company.co.za']);
  assert.match(two, /^-- select public\.link_seed_profile\('prof-a',/m);
  for (const bad of ["x'); drop table profiles; --@a.co", 'not-an-email', 'a@b']) assert.throws(() => linkAccountsSql({ people, emails: { 'prof-a': bad } }), /not an email/, bad);
});
t('step 06: local passwords never go to Supabase; quotes are escaped; counts are verified', () => {
  const pack = { manifest: { version: 'abc123' }, records: {
    profiles: [{ id: 'prof-x', name: "O'Brien", role: 'owner', password_hash: 'secret-hash', password_salt: 'salt', _seed: true }],
    clients: [{ id: 'cl-1', name: 'A "quoted" client', notes: "it's", _seed: true, extra_field: 1 }]
  } };
  const sql = seedSql(pack);
  assert.ok(!sql.includes('secret-hash') && !sql.includes('password_salt'), 'no password fields');
  assert.ok(sql.includes("'O''Brien'"), 'single quotes doubled');
  assert.match(sql, /^begin;$/m); assert.match(sql, /^commit;$/m);
  assert.match(sql, /select 'abc123' as seed_version, \(select count\(\*\) from public\.clients where _seed\) = 1 as clients_ok, \(select count\(\*\) from public\.profiles where _seed\) = 1 as profiles_ok;/);
  assert.match(sql, /"extra_field":1/, 'unknown fields go into data');
  assert.throws(() => seedSql({ manifest: { version: 'x' }, records: { not_a_collection: [] } }), /does not know/);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
