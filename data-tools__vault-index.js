// Index every original company file (including the files inside nested zips) for the Document Vault.
//
//   node data-tools__vault-index.js <company-data.zip> <groups.json> <out: vault-index.json> [<group>=<extra.zip> ...]
//
// Each file gets a canonical `src` (the same path the readers used, e.g. "x/Invoices-…/Invoices/INVOICES JULY/X.pdf"),
// its size, SHA-256, MIME type and the reader group that transcribed it. Identical files (same SHA-256) are
// listed once with every place they appeared in `also_at`. Extra zips (documents the company sent later, e.g.
// carron_glen_proposal=landscapers_data.zip) are indexed with that reader group and `zip` = the zip's name, so
// tools__build-vault.js can find them (pass the same zips to it with --extra <zip name>=<path>).
// data-tools__seed__90-vault.js turns the index into the drives, folders and file records of the data pack.
//
// Port of the old vault_index.py: it writes the same file byte for byte (Python's json.dump with indent=1 —
// non-ASCII as \uXXXX, the platform's line endings) and reads zip entry names exactly as Python's zipfile does.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EOL } from 'node:os';
import { openZip } from '../tools__lib__zip.js';

// MIME types: these first, then the standard ones from Python's built-in mimetypes table. (vault_index.py also
// asked the Windows registry about extensions in neither list, so for those its answer depended on the computer.)
const MIME_EXTRA = { '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.md': 'text/markdown', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf' };
const MIME_PYTHON = {
  '.txt': 'text/plain', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.rtf': 'text/rtf', '.html': 'text/html', '.htm': 'text/html', '.xml': 'text/xml',
  '.json': 'application/json', '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel', '.ppt': 'application/vnd.ms-powerpoint',
  '.odt': 'application/vnd.oasis.opendocument.text', '.ods': 'application/vnd.oasis.opendocument.spreadsheet', '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.heic': 'image/heic', '.heif': 'image/heif',
  '.ai': 'application/postscript', '.eps': 'application/postscript', '.zip': 'application/zip', '.tar': 'application/x-tar', '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/vnd.avi', '.webm': 'video/webm', '.mkv': 'video/matroska',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/vnd.wave', '.ogg': 'audio/ogg', '.eml': 'message/rfc822', '.vcf': 'text/x-vcard'
};
// as Python: ".tgz" means ".tar.gz", and a compression suffix (case-sensitive) is looked through: "x.tar.gz" → x.tar
const SUFFIXES = { '.svgz': '.svg.gz', '.tgz': '.tar.gz', '.taz': '.tar.gz', '.tz': '.tar.gz', '.tbz2': '.tar.bz2', '.txz': '.tar.xz' };
const ENCODINGS = new Set(['.gz', '.Z', '.bz2', '.xz', '.br']);

// Python's path helpers as on Windows (/ and \ both separate folders), str.strip() and json.dump(indent=1)
const basename = p => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
function splitext(p) {
  const sep = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')), dot = p.lastIndexOf('.');
  if (dot > sep) for (let i = sep + 1; i < dot; i++) if (p[i] !== '.') return [p.slice(0, dot), p.slice(dot)]; // leading dots are not an extension
  return [p, ''];
}
const strip = s => s.replace(/^[\p{White_Space}\x1c-\x1f]+|[\p{White_Space}\x1c-\x1f]+$/gu, ''); // Python's whitespace: Unicode White_Space + \x1c–\x1f
const pythonJson = value => JSON.stringify(value, null, 1).replace(/[^\x00-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).replace(/\n/g, EOL);

function guessType(name) {
  let [base, ext] = splitext(name);
  while (SUFFIXES[ext.toLowerCase()]) [base, ext] = splitext(base + SUFFIXES[ext.toLowerCase()]);
  if (ENCODINGS.has(ext)) [base, ext] = splitext(base);
  return MIME_PYTHON[ext.toLowerCase()] || null;
}
const mime = name => MIME_EXTRA[splitext(name)[1].toLowerCase()] || guessType(name) || 'application/octet-stream';

/** basename + parent folder, trimmed and lower-cased — survives the trailing-space folder names. */
function key(path) {
  const parts = path.replace(/\\/g, '/').split('/').filter(p => strip(p)).map(p => strip(p).toLowerCase());
  if (!parts.length) throw new Error(`empty file path: ${JSON.stringify(path)}`);
  return parts.slice(-2).join('|');
}
const sha256 = data => createHash('sha256').update(data).digest('hex');

const [zipPath, groupsPath, outPath, ...extras] = process.argv.slice(2);
if (!outPath || extras.some(s => !s.includes('='))) {
  console.error('usage: node data-tools__vault-index.js <company-data.zip> <groups.json> <out: vault-index.json> [<group>=<extra.zip> ...]');
  process.exit(1);
}

const groups = JSON.parse(readFileSync(groupsPath, 'utf8')).groups;
const byKey = new Map(), byName = new Map();
for (const g of groups) for (const f of g.files) {
  const k = key(f.src), n = strip(basename(f.src)).toLowerCase();
  if (!byKey.has(k)) byKey.set(k, [f.src, g.key]);
  if (!byName.has(n)) byName.set(n, []);
  byName.get(n).push([f.src, g.key]);
}

const entries = [];
function add(srcGuess, data, where) {
  let hit = byKey.get(key(srcGuess));
  if (!hit) { const cands = byName.get(strip(basename(srcGuess)).toLowerCase()) || []; hit = cands.length === 1 ? cands[0] : null; }
  entries.push({ src: hit ? hit[0] : srcGuess, group: hit ? hit[1] : null, name: strip(basename(srcGuess.replace(/\/+$/, ''))),
    size: data.length, sha256: sha256(data), mime: mime(srcGuess), where });
}

const outer = openZip(zipPath);
for (const info of outer.entries) {
  if (info.isDir) continue;
  const rel = info.name.includes('/') ? info.name.slice(info.name.indexOf('/') + 1) : info.name;
  const data = outer.read(info);
  if (rel.toLowerCase().endsWith('.zip')) {
    const stem = rel.slice(0, -4), inner = openZip(data);
    for (const ii of inner.entries) if (!ii.isDir) add(`x/${stem}/${ii.name}`, inner.read(ii), [info.name, ii.name]);
  } else add(`x/${rel}`, data, [info.name]);
}
outer.close();

const extraZips = [];
for (const spec of extras) {
  const eq = spec.indexOf('='), group = spec.slice(0, eq), path = spec.slice(eq + 1);
  const stem = splitext(basename(path))[0];
  extraZips.push(stem);
  const z = openZip(path);
  for (const info of z.entries) {
    if (info.isDir) continue;
    const data = z.read(info);
    entries.push({ src: info.name, group, name: strip(basename(info.name)), size: data.length, sha256: sha256(data), mime: mime(info.name), where: [info.name], zip: stem });
  }
  z.close();
}

const uniq = [], seen = new Map();
for (const e of entries) {
  if (seen.has(e.sha256)) { seen.get(e.sha256).also_at.push(e.src); continue; }
  e.also_at = [];
  seen.set(e.sha256, e);
  uniq.push(e);
}
writeFileSync(outPath, pythonJson({ source_zip: basename(zipPath), extra_zips: extraZips, files: uniq }));
const matched = uniq.filter(e => e.group).length;
console.log(`${entries.length} files found, ${uniq.length} unique, ${matched} matched to a reader group, ${uniq.length - matched} unmatched`);
for (const e of uniq) if (!e.group) console.log('  unmatched:', e.src);
