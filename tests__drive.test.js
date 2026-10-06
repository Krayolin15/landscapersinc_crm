// Drive helper tests:  node tests__drive.test.js
import assert from 'node:assert/strict';
import { folderPath, validateManifest, splitZipPath, isJunk, sortFiles, typeOf, COMPANY_DRIVES } from '../js__apps__drive__lib.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };

t('eight company drives with the exact Google Drive names', () => assert.deepEqual(COMPANY_DRIVES.map(d => d.name), ['ADMIN', 'FINANCE', 'HR', 'LEGAL AND COMPLIANCE', 'MANAGEMENT', 'OPERATIONS', 'SALES', "SOP'S & TEMPLATES"]));
t('folder path', () => assert.deepEqual(folderPath([{ id: 'a', name: 'Invoices' }, { id: 'b', name: 'JULY', parent_id: 'a' }], 'b').map(f => f.name), ['Invoices', 'JULY']));
t('folder path survives loops', () => assert.ok(folderPath([{ id: 'a', name: 'x', parent_id: 'b' }, { id: 'b', name: 'y', parent_id: 'a' }], 'a').length <= 51));
t('manifest ok', () => { const v = validateManifest({ files: [{ path_in_zip: 'HR/a.pdf', drive: 'HR', size: 10, sha: '1' }, { path_in_zip: 'SALES/b.pdf', drive: 'SALES', size: 5, sha: '2' }] }); assert.ok(v.ok); assert.equal(v.bytes, 15); assert.deepEqual(v.byDrive, { HR: 1, SALES: 1 }); });
t('manifest duplicate + missing drive flagged', () => { const v = validateManifest({ files: [{ path_in_zip: 'a', drive: 'HR', sha: 'x' }, { path_in_zip: 'b', sha: 'x' }] }); assert.ok(!v.ok); assert.equal(v.errors.length, 2); });
t('split zip path', () => assert.deepEqual(splitZipPath('FINANCE/Invoices/JULY/INV-1.pdf'), { folders: ['FINANCE', 'Invoices', 'JULY'], name: 'INV-1.pdf' }));
t('junk files ignored', () => { assert.ok(isJunk('__MACOSX/x')); assert.ok(isJunk('a/.DS_Store')); assert.ok(!isJunk('HR/Medicals/a.pdf')); });
t('natural sort', () => assert.deepEqual(sortFiles([{ name: 'Invoice 10' }, { name: 'Invoice 2' }]).map(f => f.name), ['Invoice 2', 'Invoice 10']));
t('types', () => { assert.equal(typeOf({ name: 'a.PDF' }), 'pdf'); assert.equal(typeOf({ mime: 'image/png' }), 'images'); assert.equal(typeOf({ name: 'x.xlsx' }), 'spreadsheets'); assert.equal(typeOf({ kind: 'doc' }), 'docs'); });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
