// Admin console pure-logic tests:  node tests__admin.test.js
import assert from 'node:assert/strict';
import { luhnValid } from '../js__core__validate.js';
import {
  normText, normPhoneDigits, normEmail, duplicateGroups, slugField, bestFieldMatch, autoMapColumns,
  mergeRoleMatrix, parseCSV, sortBySeverity, daysBetween, backupAlert, computeSaIdCheckDigit,
  refPointers, findOrphans, generateTempPassword
} from '../js__apps__admin__lib.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };

// ---------------- normalisation ----------------
t('normText strips accents, punctuation, case', () => assert.equal(normText("O'Brien & Sons — Ltd."), 'o brien sons ltd'));
t('normText collapses whitespace', () => assert.equal(normText('  Wayne   Muller '), 'wayne muller'));
t('normPhoneDigits rewrites +27 and 27-prefixed to local 0', () => {
  assert.equal(normPhoneDigits('+27 69 131 5387'), '0691315387');
  assert.equal(normPhoneDigits('27691315387'), '0691315387');
  assert.equal(normPhoneDigits('069 131 5387'), '0691315387');
});
t('normEmail trims and lowercases', () => assert.equal(normEmail('  Wayne@Landscapers.CO.ZA '), 'wayne@landscapers.co.za'));

// ---------------- duplicate finder ----------------
t('duplicateGroups matches by normalised name', () => {
  const rows = [{ id: '1', name: 'Wayne Muller', phone: '', email: '' }, { id: '2', name: 'wayne   muller', phone: '', email: '' }, { id: '3', name: 'Someone Else', phone: '', email: '' }];
  const groups = duplicateGroups(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].records.length, 2);
  assert.equal(groups[0].field, 'name');
});
t('duplicateGroups matches by phone regardless of +27/0 format', () => {
  const rows = [{ id: '1', name: 'A', phone: '0691315387', email: '' }, { id: '2', name: 'B', phone: '+27691315387', email: '' }];
  const groups = duplicateGroups(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].field, 'phone');
});
t('duplicateGroups ignores short/blank phone numbers', () => {
  const rows = [{ id: '1', name: 'A', phone: '123', email: '' }, { id: '2', name: 'B', phone: '123', email: '' }];
  assert.equal(duplicateGroups(rows).length, 0);
});
t('duplicateGroups never returns singletons and de-dupes overlapping keys', () => {
  const rows = [{ id: '1', name: 'Wayne Muller', phone: '0691315387', email: 'w@x.com' }, { id: '2', name: 'Wayne Muller', phone: '0691315387', email: 'w@x.com' }];
  const groups = duplicateGroups(rows);
  // name + phone + email all match the same pair — must not report the same pair three times
  assert.equal(groups.length, 1);
});

// ---------------- CSV column auto-mapping ----------------
t('slugField normalises headers to field-key shape', () => assert.equal(slugField('Employee No.'), 'employee_no'));
t('bestFieldMatch: exact label match', () => assert.equal(bestFieldMatch('Full Name', [{ key: 'full_name', label: 'Full name' }, { key: 'phone', label: 'Mobile' }]), 'full_name'));
t('bestFieldMatch: key without underscores matches', () => assert.equal(bestFieldMatch('EmployeeNo', [{ key: 'employee_no', label: 'Employee #' }]), 'employee_no'));
t('bestFieldMatch: nothing close enough returns null', () => assert.equal(bestFieldMatch('Completely Unrelated Column', [{ key: 'phone', label: 'Mobile' }]), null));
t('autoMapColumns: each field is used at most once, stronger match wins', () => {
  const fields = [{ key: 'name', label: 'Full name' }, { key: 'phone', label: 'Mobile' }];
  const map = autoMapColumns(['Full Name', 'Name (short)', 'Mobile'], fields);
  assert.equal(map['Full Name'], 'name');
  assert.equal(map['Mobile'], 'phone');
  // 'name' is already claimed by the exact match, so the weaker header maps to null rather than stealing it
  assert.equal(map['Name (short)'], null);
});

// ---------------- role-matrix merge ----------------
t('mergeRoleMatrix keeps untouched apps/collections', () => {
  const base = { apps: { clients: ['sales'] }, collections: { invoices: { read: ['finance'] } } };
  const patch = { apps: { leads: ['sales', 'manager'] } };
  const merged = mergeRoleMatrix(base, patch);
  assert.deepEqual(merged.apps.clients, ['sales']);
  assert.deepEqual(merged.apps.leads, ['sales', 'manager']);
  assert.deepEqual(merged.collections.invoices, { read: ['finance'] });
});
t('mergeRoleMatrix merges per-action overrides inside one collection', () => {
  const base = { collections: { invoices: { read: ['finance'], write: ['finance'] } } };
  const patch = { collections: { invoices: { write: ['finance', 'sales'] } } };
  const merged = mergeRoleMatrix(base, patch);
  assert.deepEqual(merged.collections.invoices, { read: ['finance'], write: ['finance', 'sales'] });
});
t('mergeRoleMatrix tolerates missing base', () => assert.deepEqual(mergeRoleMatrix(undefined, { apps: { x: ['a'] } }), { apps: { x: ['a'] }, collections: {} }));

// ---------------- CSV parsing ----------------
t('parseCSV: quoted fields with commas and escaped quotes', () => {
  const { headers, rows } = parseCSV('name,notes\n"Smith, John","She said ""hi"""\n');
  assert.deepEqual(headers, ['name', 'notes']);
  assert.deepEqual(rows, [{ name: 'Smith, John', notes: 'She said "hi"' }]);
});
t('parseCSV: CRLF line endings and blank trailing lines', () => {
  const { rows } = parseCSV('a,b\r\n1,2\r\n\r\n');
  assert.deepEqual(rows, [{ a: '1', b: '2' }]);
});
t('parseCSV: rows that are entirely blank are dropped', () => {
  const { rows } = parseCSV('a,b\n1,2\n,\n3,4\n');
  assert.equal(rows.length, 2);
});

// ---------------- data health ----------------
t('sortBySeverity orders high, medium, low', () => {
  const out = sortBySeverity([{ id: 1, severity: 'low' }, { id: 2, severity: 'high' }, { id: 3, severity: 'medium' }]);
  assert.deepEqual(out.map(x => x.id), [2, 3, 1]);
});
t('daysBetween counts whole days', () => { assert.equal(daysBetween('2026-09-01', '2026-09-10'), 9); assert.equal(daysBetween('2026-09-10', '2026-09-01'), -9); });
t('backupAlert: null when recent, warn after 7 days, danger after 14 or never', () => {
  assert.equal(backupAlert('2026-09-27', '2026-09-28'), null);
  assert.equal(backupAlert('2026-09-20', '2026-09-28').severity, 'warn');
  assert.equal(backupAlert('2026-09-01', '2026-09-28').severity, 'danger');
  assert.equal(backupAlert(null, '2026-09-28').severity, 'danger');
});
t('computeSaIdCheckDigit produces a Luhn-valid synthetic ID', () => {
  const twelve = '800101500' + '908'; // arbitrary well-formed YYMMDD + SSSS + C + A prefix
  const check = computeSaIdCheckDigit(twelve);
  assert.ok(luhnValid(twelve + check), `expected ${twelve}${check} to be Luhn-valid`);
});

// ---------------- orphan references ----------------
t('refPointers flattens ref and refs fields, findOrphans catches missing targets', () => {
  const schema = { jobs: { fields: { client_id: { type: 'ref', ref: 'clients' }, tag_ids: { type: 'refs', ref: 'tags' } } } };
  const recordsByCol = { jobs: [{ id: 'j1', client_id: 'c-missing', tag_ids: ['t1', 't2'] }] };
  const pointers = refPointers(schema, recordsByCol);
  assert.equal(pointers.length, 3);
  const orphans = findOrphans(pointers, (col, id) => (col === 'tags' ? id === 't1' : false));
  assert.deepEqual(orphans.map(o => o.value).sort(), ['c-missing', 't2'].sort());
});

// ---------------- temp password ----------------
t('generateTempPassword meets the app password rules (>=8, a letter and a digit) and is reproducible for a fixed sequence', () => {
  const seq = [0.1, 0.9, 0.5, 0.4];
  const makeRand = () => { let i = 0; return () => seq[i++ % seq.length]; };
  const pw = generateTempPassword(makeRand());
  assert.ok(pw.length >= 8, pw);
  assert.ok(/[a-z]/i.test(pw), pw);
  assert.ok(/\d/.test(pw), pw);
  assert.equal(pw, generateTempPassword(makeRand()), 'same pseudo-random sequence should produce the same password');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
