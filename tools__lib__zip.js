// A small ZIP reader and writer for the Node tools — no dependencies, only node:zlib and node:fs.
//
//   import { openZip, createZipWriter, zipDirectory } from './lib/zip.js';
//
//   const zip = openZip('company.zip');               // a path (read on demand) or a Buffer (e.g. a zip inside a zip)
//   for (const e of zip.entries) if (!e.isDir) use(e.name, zip.read(e));
//   zip.close();
//
//   const out = createZipWriter('out.zip');
//   out.add('folder/file.pdf', bufferOrPathOnDisk, { mtime });
//   out.finish();                                      // → { entries, bytes }
//
//   zipDirectory('some/folder', 'out.zip', { prefix: 'Top folder/', filter: (rel, isDir) => rel !== 'node_modules' });
//
// Reading sees exactly the names Python's zipfile sees (the document vault tools were ported from Python and must
// find the same files): a name is UTF-8 when general-purpose flag bit 11 is set and CP437 otherwise, an Info-ZIP
// Unicode Path extra field (0x7075) overrides it, and the name is cut at a NUL byte with \ turned into /.
// Stored and deflated entries are supported (what Windows, 7-Zip, Google Drive and Python write), as are data
// descriptors, archive comments, data prepended to the archive and ZIP64. Every entry's CRC-32 is checked on read.
//
// Writing uses UTF-8 names (flag bit 11) with forward slashes, DOS timestamps in local time, and for each entry
// whichever of deflate (level 6) or stored is smaller. Entries go to disk one at a time, so the archive is never
// held in memory (only the entry being added). ZIP64 records are added automatically from 65,535 entries or 4 GB
// of archive; a single entry must stay under 4 GB.
import { openSync, closeSync, fstatSync, readSync, writeSync, readFileSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { constants as bufferConstants } from 'node:buffer';
import { crc32, inflateRawSync, deflateRawSync } from 'node:zlib';

const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_EOCD = 0x06054b50, SIG_EOCD64 = 0x06064b50, SIG_LOCATOR64 = 0x07064b50;
const MAX16 = 0xffff, MAX32 = 0xffffffff;
const FLAG_ENCRYPTED = 0x1, FLAG_PATCHED = 0x20, FLAG_STRONG_ENCRYPTION = 0x40, FLAG_UTF8 = 0x800;
const STORED = 0, DEFLATED = 8;
const EMPTY = Buffer.alloc(0);

// ---------------------------------------------------------------- names

// CP437, the original zip name encoding: bytes 0x00–0x7F are ASCII, 0x80–0xFF are these (as Python's cp437 codec).
const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xa0';
/** Decode bytes as code page 437. */
export function decodeCp437(bytes) {
  let s = '';
  for (const b of bytes) s += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  return s;
}
// strict, and a leading BOM stays part of the name (Python's 'utf-8' codec does the same)
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const decodeName = (raw, flags, where) => {
  if (!(flags & FLAG_UTF8)) return decodeCp437(raw);
  try { return UTF8.decode(raw); } catch { throw new Error(`${where}: an entry name is marked UTF-8 but is not valid UTF-8`); }
};
// Python's zipfile: cut at the first NUL, and \ (written by some Windows tools) becomes /
const sanitize = name => { const nul = name.indexOf('\0'); return (nul < 0 ? name : name.slice(0, nul)).replace(/\\/g, '/'); };

// ---------------------------------------------------------------- dates

const fromDos = (date, time) => new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
function toDos(when) {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) throw new TypeError(`zip: not a valid date: ${when}`);
  let [y, mo, day, h, mi, s] = [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
  if (y < 1980) [y, mo, day, h, mi, s] = [1980, 1, 1, 0, 0, 0];               // DOS dates start in 1980…
  else if (y > 2107) [y, mo, day, h, mi, s] = [2107, 12, 31, 23, 59, 58];     // …and end in 2107
  return { date: ((y - 1980) << 9) | (mo << 5) | day, time: (h << 11) | (mi << 5) | (s >> 1) };
}

// ---------------------------------------------------------------- reading

/** Random access to the archive bytes: a file is read piece by piece, a Buffer is sliced. */
function source(input) {
  if (typeof input === 'string') {
    const fd = openSync(input, 'r');
    return {
      size: fstatSync(fd).size,
      read(pos, len) {
        const b = Buffer.allocUnsafe(len);
        let got = 0;
        while (got < len) { const n = readSync(fd, b, got, len - got, pos + got); if (!n) break; got += n; }
        return got === len ? b : b.subarray(0, got);
      },
      close() { closeSync(fd); }
    };
  }
  if (!(input instanceof Uint8Array)) throw new TypeError('openZip: expected a file path or a Buffer');
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  return { size: buf.length, read: (pos, len) => buf.subarray(pos, Math.min(pos + len, buf.length)), close() {} };
}

/**
 * Open a zip archive (a file path, or a Buffer holding the whole archive).
 * → { entries: [{ name, size, compressedSize, method, crc32, flags, mtime, isDir, offset }], get(name), read(nameOrEntry) → Buffer, close() }
 * `entries` is in central-directory order and includes folders (isDir). get(name) returns the last entry of that
 * name (as Python's zipfile does when a name occurs twice).
 */
export function openZip(input) {
  const src = source(input);
  try { return readArchive(src, typeof input === 'string' ? input : 'zip'); } catch (e) { src.close(); throw e; }
}

function readArchive(src, where) {
  const bad = m => new Error(`${where}: ${m}`);

  // the end of central directory record: the last 22 bytes, or further back when the archive has a comment (≤ 64 KB)
  const tailLen = Math.min(src.size, 22 + MAX16);
  const tail = src.read(src.size - tailLen, tailLen);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === SIG_EOCD) { at = i; break; }
  if (at < 0) throw bad('not a zip file (no end of central directory record)');
  let location = src.size - tailLen + at;
  let cdSize = tail.readUInt32LE(at + 12), cdOffset = tail.readUInt32LE(at + 16);

  // ZIP64: a locator right before that record points to the 64-bit one, which has the real sizes and offsets
  if (location >= 20) {
    const loc = src.read(location - 20, 20);
    if (loc.readUInt32LE(0) === SIG_LOCATOR64) {
      if (loc.readUInt32LE(4) !== 0 || loc.readUInt32LE(16) > 1) throw bad('zip files split over several disks are not supported');
      const recOffset = Number(loc.readBigUInt64LE(8)), expected = location - 20 - 56;
      if (recOffset > expected) throw bad('corrupt ZIP64 end of central directory locator');
      const isRecord = r => r.length === 56 && r.readUInt32LE(0) === SIG_EOCD64;
      let recPos = recOffset, rec = src.read(recPos, 56);
      // not where the locator says: data was prepended to the archive, so look right before the locator instead
      if (!isRecord(rec) && recOffset !== expected) { recPos = expected; rec = src.read(recPos, 56); }
      if (!isRecord(rec)) throw bad('ZIP64 end of central directory record not found');
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
      if (cdOffset + cdSize !== recOffset || Number(rec.readBigUInt64LE(4)) + 12 !== 56 + (expected - recPos)) throw bad('corrupt ZIP64 end of central directory record');
      location = recPos;
    }
  }

  // anything in front of the archive (a self-extractor stub, say) shifts every offset by the same amount
  const shift = location - cdSize - cdOffset;
  const cdStart = cdOffset + shift;
  if (cdStart < 0) throw bad('bad offset for the central directory');
  const cd = src.read(cdStart, cdSize);
  if (cd.length < cdSize) throw bad('truncated central directory');

  const entries = [], byName = new Map(), headerName = new Map();
  for (let p = 0; p < cdSize;) {
    if (p + 46 > cdSize || cd.readUInt32LE(p) !== SIG_CENTRAL) throw bad('bad central directory');
    if (cd[p + 6] > 63) throw bad(`an entry needs zip version ${cd[p + 6] / 10}, which is not supported`);
    const flags = cd.readUInt16LE(p + 8), nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
    const rawName = cd.subarray(p + 46, p + 46 + nameLen);
    const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    const decoded = decodeName(rawName, flags, where);
    const e = {
      name: sanitize(decoded), size: cd.readUInt32LE(p + 24), compressedSize: cd.readUInt32LE(p + 20), method: cd.readUInt16LE(p + 10),
      crc32: cd.readUInt32LE(p + 16), flags, mtime: fromDos(cd.readUInt16LE(p + 14), cd.readUInt16LE(p + 12)), isDir: false, offset: cd.readUInt32LE(p + 42)
    };
    readExtra(e, extra, rawName, bad);
    e.offset += shift;
    e.isDir = e.name.endsWith('/');
    entries.push(e);
    byName.set(e.name, e);
    headerName.set(e, decoded); // the local header must carry the same name (checked on read)
    p += 46 + nameLen + extraLen + commentLen;
  }

  // where each entry's data must end: at the next entry's local header (anything longer overlaps another entry)
  const end = new Map();
  let next = cdStart;
  for (const e of [...entries].sort((a, b) => a.offset - b.offset).reverse()) { end.set(e, next); next = e.offset; }

  function read(target) {
    const e = typeof target === 'string' ? byName.get(target) : target;
    if (!e || !headerName.has(e)) throw bad(`no entry named ${JSON.stringify(typeof target === 'string' ? target : target && target.name)}`);
    if (e.flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) throw bad(`${e.name} is encrypted (password-protected zips are not supported)`);
    if (e.flags & FLAG_PATCHED) throw bad(`${e.name} is compressed patch data, which is not supported`);
    const head = src.read(e.offset, 30);
    if (head.length < 30 || head.readUInt32LE(0) !== SIG_LOCAL) throw bad(`bad local header for ${e.name}`);
    const nameLen = head.readUInt16LE(26), extraLen = head.readUInt16LE(28);
    if (decodeName(src.read(e.offset + 30, nameLen), head.readUInt16LE(6), where) !== headerName.get(e)) throw bad(`the central directory and the local header disagree on the name of ${e.name}`);
    const start = e.offset + 30 + nameLen + extraLen;
    if (start + e.compressedSize > end.get(e) && end.get(e) !== e.offset) throw bad(`${e.name} overlaps another entry (possible zip bomb)`);
    const packed = src.read(start, e.compressedSize);
    if (packed.length < e.compressedSize) throw bad(`${e.name} is truncated`);
    let data;
    if (e.method === STORED) data = Buffer.from(packed);
    else if (e.method === DEFLATED) {
      try { data = e.compressedSize ? inflateRawSync(packed, { maxOutputLength: Math.min(Math.max(e.size, 1), bufferConstants.MAX_LENGTH) }) : EMPTY; }
      catch (err) { throw bad(`${e.name} could not be decompressed (${err.message})`); }
    } else throw bad(`${e.name} uses compression method ${e.method}; only stored (0) and deflate (8) are supported`);
    if (data.length !== e.size) throw bad(`${e.name} should be ${e.size} bytes but is ${data.length}`);
    if (crc32(data) !== e.crc32) throw bad(`bad CRC-32 for ${e.name} (the zip is damaged)`);
    return data;
  }

  return { entries, get: name => byName.get(name), read, close: () => src.close() };
}

/** The extra fields Python's zipfile honours: ZIP64 sizes/offset (0x0001) and the Info-ZIP Unicode Path (0x7075). */
function readExtra(e, extra, rawName, bad) {
  for (let p = 0; p + 4 <= extra.length;) {
    const tag = extra.readUInt16LE(p), len = extra.readUInt16LE(p + 2), data = extra.subarray(p + 4, p + 4 + len);
    if (p + 4 + len > extra.length) throw bad(`corrupt extra field ${tag.toString(16).padStart(4, '0')} in ${e.name}`);
    if (tag === 0x0001) {
      // only the fields whose 32-bit value is 0xFFFFFFFF are here, in this order
      let q = 0;
      const take = what => { if (q + 8 > data.length) throw bad(`corrupt ZIP64 extra field in ${e.name} (${what} missing)`); const v = Number(data.readBigUInt64LE(q)); q += 8; return v; };
      if (e.size === MAX32) e.size = take('size');
      if (e.compressedSize === MAX32) e.compressedSize = take('compressed size');
      if (e.offset === MAX32) e.offset = take('header offset');
    } else if (tag === 0x7075 && data.length >= 5 && data[0] === 1 && data.readUInt32LE(1) === crc32(rawName)) {
      // the UTF-8 name, valid only while the plain name is unchanged (its CRC matches)
      let name;
      try { name = UTF8.decode(data.subarray(5)); } catch { throw bad(`corrupt Unicode path extra field in ${e.name}`); }
      if (name) e.name = sanitize(name);
    }
    p += 4 + len;
  }
}

// ---------------------------------------------------------------- writing

/** One ZIP64 extra field (0x0001) holding the given 64-bit values. */
function zip64Extra(values) {
  const b = Buffer.alloc(4 + 8 * values.length);
  b.writeUInt16LE(0x0001, 0);
  b.writeUInt16LE(8 * values.length, 2);
  values.forEach((v, i) => b.writeBigUInt64LE(BigInt(v), 4 + 8 * i));
  return b;
}

/**
 * Write a zip archive to `outPath`, one entry at a time:
 *   add(name, data, { mtime })  data: a Buffer, or the path of a file on disk (its mtime is used unless given);
 *                               a name ending in / is a folder entry (no data)
 *   finish() → { entries, bytes }   writes the central directory and closes the file
 *   abort()                         closes and deletes the unfinished file
 * Option zip64: true writes ZIP64 records for every entry (for testing readers; otherwise they are added only when needed).
 */
export function createZipWriter(outPath, { zip64 = false } = {}) {
  const fd = openSync(outPath, 'w');
  const central = [], names = new Set();
  let offset = 0, state = 'open';
  const ensureOpen = () => { if (state !== 'open') throw new Error(`zip writer: ${outPath} is already ${state}`); };
  const write = buf => {
    for (let n = 0; n < buf.length;) n += writeSync(fd, buf, n, buf.length - n);
    offset += buf.length;
  };
  // a failed write would leave a broken archive behind: delete it rather than leave something that looks finished
  const safely = fn => { try { fn(); } catch (e) { abort(); throw e; } };

  function add(name, input, { mtime } = {}) {
    ensureOpen();
    name = String(name).replace(/\\/g, '/');
    if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some(s => s === '..')) throw new Error(`zip writer: unsafe entry name ${JSON.stringify(name)}`);
    if (names.has(name)) throw new Error(`zip writer: ${name} is already in the archive`);
    let data;
    if (typeof input === 'string') { data = readFileSync(input); if (mtime == null) mtime = statSync(input).mtime; }
    else if (input instanceof Uint8Array) data = input;
    else throw new TypeError(`zip writer: ${name}: expected a Buffer or a file path`);
    const isDir = name.endsWith('/');
    if (isDir && data.length) throw new Error(`zip writer: folder entry ${name} cannot have data`);
    if (data.length >= MAX32) throw new Error(`zip writer: ${name} is 4 GB or larger, which is not supported`);
    const nameBuf = Buffer.from(name, 'utf8');
    if (nameBuf.length > MAX16) throw new Error(`zip writer: entry name too long: ${name.slice(0, 80)}…`);

    // deflate, unless that does not make it smaller (JPEGs, PDFs and zips usually do not shrink)
    let method = STORED, body = data;
    if (data.length) { const packed = deflateRawSync(data, { level: 6 }); if (packed.length < data.length) [method, body] = [DEFLATED, packed]; }
    const crc = crc32(data), { date, time } = toDos(mtime == null ? new Date() : mtime);
    const extra = zip64 ? zip64Extra([data.length, body.length]) : EMPTY;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(SIG_LOCAL, 0);
    head.writeUInt16LE(zip64 ? 45 : 20, 4);   // version needed to extract: 2.0 (deflate, folders), 4.5 (ZIP64)
    head.writeUInt16LE(FLAG_UTF8, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(zip64 ? MAX32 : body.length, 18);
    head.writeUInt32LE(zip64 ? MAX32 : data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(extra.length, 28);
    const at = offset;
    safely(() => { write(Buffer.concat([head, nameBuf, extra])); write(body); });
    names.add(name);
    central.push({ nameBuf, method, time, date, crc, size: data.length, csize: body.length, offset: at, isDir });
    return { name, size: data.length, compressedSize: body.length, method };
  }

  function finish() {
    ensureOpen();
    const cdStart = offset;
    safely(() => {
      for (const c of central) {
        // ZIP64 values go in the extra field, in this order, only for the fields set to 0xFFFFFFFF
        const bigOffset = zip64 || c.offset >= MAX32;
        const fields = [...(zip64 ? [c.size, c.csize] : []), ...(bigOffset ? [c.offset] : [])];
        const extra = fields.length ? zip64Extra(fields) : EMPTY, v = fields.length ? 45 : 20;
        const h = Buffer.alloc(46);
        h.writeUInt32LE(SIG_CENTRAL, 0);
        h.writeUInt16LE((3 << 8) | v, 4);     // made by: Unix, so the permissions below apply on Linux and macOS too
        h.writeUInt16LE(v, 6);
        h.writeUInt16LE(FLAG_UTF8, 8);
        h.writeUInt16LE(c.method, 10);
        h.writeUInt16LE(c.time, 12);
        h.writeUInt16LE(c.date, 14);
        h.writeUInt32LE(c.crc, 16);
        h.writeUInt32LE(zip64 ? MAX32 : c.csize, 20);
        h.writeUInt32LE(zip64 ? MAX32 : c.size, 24);
        h.writeUInt16LE(c.nameBuf.length, 28);
        h.writeUInt16LE(extra.length, 30);
        // comment length, disk number, internal attributes: 0
        h.writeUInt32LE(c.isDir ? 0o40755 * 0x10000 + 0x10 : 0o100644 * 0x10000, 38); // drwxr-xr-x + DOS folder flag, or -rw-r--r--
        h.writeUInt32LE(bigOffset ? MAX32 : c.offset, 42);
        write(Buffer.concat([h, c.nameBuf, extra]));
      }
      const cdSize = offset - cdStart, count = central.length;
      if (zip64 || count >= MAX16 || cdStart >= MAX32 || cdSize >= MAX32) {
        const recAt = offset, rec = Buffer.alloc(56), loc = Buffer.alloc(20);
        rec.writeUInt32LE(SIG_EOCD64, 0);
        rec.writeBigUInt64LE(44n, 4);           // size of the rest of this record
        rec.writeUInt16LE((3 << 8) | 45, 12);
        rec.writeUInt16LE(45, 14);
        rec.writeBigUInt64LE(BigInt(count), 24);
        rec.writeBigUInt64LE(BigInt(count), 32);
        rec.writeBigUInt64LE(BigInt(cdSize), 40);
        rec.writeBigUInt64LE(BigInt(cdStart), 48);
        loc.writeUInt32LE(SIG_LOCATOR64, 0);
        loc.writeBigUInt64LE(BigInt(recAt), 8);
        loc.writeUInt32LE(1, 16);               // total number of disks
        write(Buffer.concat([rec, loc]));
      }
      // the classic record; values that do not fit say "see the ZIP64 record"
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(SIG_EOCD, 0);
      eocd.writeUInt16LE(zip64 ? MAX16 : Math.min(count, MAX16), 8);
      eocd.writeUInt16LE(zip64 ? MAX16 : Math.min(count, MAX16), 10);
      eocd.writeUInt32LE(zip64 ? MAX32 : Math.min(cdSize, MAX32), 12);
      eocd.writeUInt32LE(zip64 ? MAX32 : Math.min(cdStart, MAX32), 16);
      write(eocd);
      closeSync(fd);
    });
    state = 'finished';
    return { entries: central.length, bytes: offset };
  }

  function abort() {
    if (state !== 'open') return; // a finished archive stays
    state = 'aborted';
    try { closeSync(fd); } catch { /* already closed */ }
    try { unlinkSync(outPath); } catch { /* already gone */ }
  }

  return { add, finish, abort };
}

/**
 * Zip a folder: every file under `dir` (sorted, subfolders included) as `prefix` + its path relative to `dir`.
 * filter(rel, isDir) → false leaves a file or a whole subfolder out (rel uses /). Links are skipped, and so is
 * the output file itself when it is written inside `dir`. → { entries, bytes }
 */
export function zipDirectory(dir, outPath, { prefix = '', filter, zip64 } = {}) {
  if (prefix && !prefix.endsWith('/')) prefix += '/';
  const self = resolve(outPath);
  const out = createZipWriter(outPath, { zip64 });
  try {
    (function walk(abs, rel) {
      const items = readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const d of items) {
        const r = rel ? `${rel}/${d.name}` : d.name, p = join(abs, d.name);
        if (!(d.isFile() || d.isDirectory()) || resolve(p) === self) continue;
        if (filter && !filter(r, d.isDirectory())) continue;
        if (d.isDirectory()) walk(p, r); else out.add(prefix + r, p);
      }
    })(dir, '');
    return out.finish();
  } catch (e) { out.abort(); throw e; }
}
