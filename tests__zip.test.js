// ZIP reader/writer tests (tools__lib__zip.js — used to build the vault and the release zip):  node tests__zip.test.js
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateRawSync, crc32 } from 'node:zlib';
import { openZip, createZipWriter, zipDirectory, decodeCp437 } from '../tools__lib__zip.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };
const dir = mkdtempSync(join(tmpdir(), 'lsi-zip-'));
const pdfLike = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7919) % 251))]); // barely compressible
const text = Buffer.from('Landscapers Inc. — Mount Edgecombe, Durban\n'.repeat(400));

t('round trip: names (incl. non-ASCII), bytes, folders, dates', () => {
  const p = join(dir, 'a.zip');
  const w = createZipWriter(p);
  const when = new Date(2026, 8, 23, 9, 17, 42);
  w.add('HR/EX_Employees/Ex employées ½.pdf', pdfLike, { mtime: when });
  w.add('notes/readme.txt', text, { mtime: when });
  w.add('empty/', Buffer.alloc(0), { mtime: when });
  w.add('zero.txt', Buffer.alloc(0), { mtime: when });
  const r = w.finish();
  assert.equal(r.entries, 4);
  const z = openZip(p);
  assert.deepEqual(z.entries.map(e => e.name), ['HR/EX_Employees/Ex employées ½.pdf', 'notes/readme.txt', 'empty/', 'zero.txt']);
  assert.ok(z.read('HR/EX_Employees/Ex employées ½.pdf').equals(pdfLike));
  assert.ok(z.read('notes/readme.txt').equals(text));
  assert.equal(z.read('zero.txt').length, 0);
  assert.equal(z.get('empty/').isDir, true);
  assert.equal(z.get('notes/readme.txt').method, 8, 'text is deflated');
  assert.equal(z.get('notes/readme.txt').mtime.getTime(), when.getTime() - (when.getTime() % 2000), 'DOS time keeps 2-second steps');
  z.close();
});
t('stores data that deflate cannot shrink', () => {
  const p = join(dir, 'b.zip'); const w = createZipWriter(p);
  const random = Buffer.from(Array.from({ length: 4096 }, () => Math.floor(Math.random() * 256)));
  w.add('photo.jpg', random); w.finish();
  const z = openZip(p); assert.equal(z.get('photo.jpg').method, 0); assert.ok(z.read('photo.jpg').equals(random)); z.close();
});
t('reads a zip from a Buffer (a zip inside a zip)', () => {
  const inner = join(dir, 'inner.zip'); const wi = createZipWriter(inner); wi.add('x.txt', text); wi.finish();
  const outer = join(dir, 'outer.zip'); const wo = createZipWriter(outer); wo.add('nested/inner.zip', inner); wo.finish();
  const z = openZip(outer); const nested = openZip(z.read('nested/inner.zip')); assert.ok(nested.read('x.txt').equals(text)); z.close();
});
t('ZIP64 records are written and read', () => {
  const p = join(dir, 'c.zip'); const w = createZipWriter(p, { zip64: true }); w.add('a.txt', text); w.add('b.pdf', pdfLike); w.finish();
  const z = openZip(p); assert.ok(z.read('a.txt').equals(text)); assert.ok(z.read('b.pdf').equals(pdfLike)); assert.equal(z.entries.length, 2); z.close();
});
t('CP437 names (no UTF-8 flag) decode as Python zipfile does', () => {
  assert.equal(decodeCp437(Buffer.from([0x45, 0x78, 0x20, 0x82, 0xab])), 'Ex é½');
  // hand-made archive: one stored entry whose name has byte 0x82 (é in CP437) and no UTF-8 flag
  const name = Buffer.from([0x63, 0x61, 0x66, 0x82, 0x2e, 0x74, 0x78, 0x74]), data = Buffer.from('hi');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(2, 18); local.writeUInt32LE(2, 22); local.writeUInt16LE(name.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt32LE(crc32(data), 16); cen.writeUInt32LE(2, 20); cen.writeUInt32LE(2, 24); cen.writeUInt16LE(name.length, 28);
  const cd = Buffer.concat([cen, name]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(30 + name.length + 2, 16);
  const z = openZip(Buffer.concat([local, name, data, cd, end]));
  assert.equal(z.entries[0].name, 'café.txt'); assert.equal(z.read('café.txt').toString(), 'hi');
});
t('a damaged entry is refused (CRC-32)', () => {
  const p = join(dir, 'd.zip'); const w = createZipWriter(p); w.add('a.txt', Buffer.from('abcdefgh')); w.finish();
  const b = readFileSync(p); const at = b.indexOf(Buffer.from('abcdefgh')); b[at] = 0x7a; // stored (too small to deflate)
  assert.throws(() => openZip(b).read('a.txt'), /CRC-32/);
});
t('unsafe names and duplicates are refused when writing', () => {
  const w = createZipWriter(join(dir, 'e.zip'));
  assert.throws(() => w.add('../evil.txt', text), /unsafe/);
  assert.throws(() => w.add('C:/evil.txt', text), /unsafe/);
  w.add('ok.txt', text); assert.throws(() => w.add('ok.txt', text), /already/);
  w.abort(); assert.equal(existsSync(join(dir, 'e.zip')), false, 'abort deletes the unfinished file');
});
t('zipDirectory: sorted, prefixed, filtered, every byte kept', () => {
  const src = join(dir, 'tree'); mkdirSync(join(src, 'b', 'deep'), { recursive: true }); mkdirSync(join(src, 'skip'));
  writeFileSync(join(src, 'b', 'deep', 'z.txt'), text); writeFileSync(join(src, 'a.pdf'), pdfLike); writeFileSync(join(src, 'skip', 'no.txt'), 'x');
  const out = join(dir, 'tree.zip');
  const r = zipDirectory(src, out, { prefix: 'landscapers-hq', filter: rel => rel !== 'skip' });
  assert.equal(r.entries, 2);
  const z = openZip(out);
  assert.deepEqual(z.entries.map(e => e.name), ['landscapers-hq/a.pdf', 'landscapers-hq/b/deep/z.txt']);
  assert.ok(z.read('landscapers-hq/b/deep/z.txt').equals(text)); z.close();
  assert.ok(statSync(out).size > 0);
});
t('deflate output is what zlib produces (interoperable)', () => {
  const p = join(dir, 'f.zip'); const w = createZipWriter(p); w.add('t.txt', text); w.finish();
  const b = readFileSync(p); const packed = deflateRawSync(text, { level: 6 });
  assert.ok(b.includes(packed), 'the entry data is a plain raw-deflate stream');
});

rmSync(dir, { recursive: true, force: true });
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
