// Build the Document Vault: every original company document, read straight out of the company zip (and the
// zips inside it) and written to data/vault/<vault_path> — where the app opens it in local mode and where
// tools/upload-vault.js takes it from for Supabase Storage:
//
//   node tools/build-vault.js <company-data.zip> <vault-index.json> [--extra <name>=<extra.zip> ...] [--pack <dir>] [--out <dir>] [--zip <vault.zip>]
//
//   e.g. node tools/build-vault.js Landscapers_inc_data.zip vault-index.json --extra landscapers_data=landscapers_data.zip
//
// <vault-index.json> comes from data-tools/vault-index.js: where each file sits in the zips, and its SHA-256.
// Where it goes comes from its file record in the data pack (vault_path, built by data-tools/seed/90-vault.js),
// so the app, the vault and Storage agree. Each file is checked against the index and its record before it is
// written, with the document's own date from the zip; afterwards the whole folder is checked: every record's
// file present with the right size and SHA-256, and nothing else in the folder.
//
// Options:
//   --extra <name>=<zip>  a zip the company sent later; <name> is the `zip` the index gives (e.g. landscapers_data)
//   --pack <dir>          the data pack (default: data/seed)
//   --out <dir>           where to write the vault (default: data/vault)
//   --zip <vault.zip>     also write it as one zip with a manifest.json, the format Drive → Import document vault accepts
//
// data/vault/ is PRIVATE (it is in .gitignore): never publish it.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync, utimesSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openZip, createZipWriter } from './lib/zip.js';
import { readCollection } from './lib/seed-files.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node tools/build-vault.js <company-data.zip> <vault-index.json> [--extra <name>=<extra.zip> ...] [--pack <dir>] [--out <dir>] [--zip <vault.zip>]';
const fail = m => { console.error(`✗ ${m}`); process.exit(1); };
const sha256 = data => createHash('sha256').update(data).digest('hex');
// Python's os.path helpers as on Windows (the vault zip format was defined by the old build_vault.py)
const basename = p => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
function splitext(p) {
  const sep = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')), dot = p.lastIndexOf('.');
  if (dot > sep) for (let i = sep + 1; i < dot; i++) if (p[i] !== '.') return [p.slice(0, dot), p.slice(dot)];
  return [p, ''];
}

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2), files = [], extraZips = new Map();
const opt = { pack: join(root, 'data/seed'), out: join(root, 'data/vault'), zip: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--extra') {
    const spec = args[++i] || '', eq = spec.indexOf('=');
    if (eq < 0) fail(`--extra wants <name>=<path to the zip>\n${USAGE}`);
    extraZips.set(spec.slice(0, eq), spec.slice(eq + 1));
  } else if (a === '--pack' || a === '--out' || a === '--zip') {
    if (!args[i + 1]) fail(`${a} wants a path\n${USAGE}`);
    opt[a.slice(2)] = resolve(args[++i]);
  } else if (a.startsWith('--')) fail(`unknown option ${a}\n${USAGE}`);
  else files.push(a);
}
if (files.length !== 2) fail(USAGE);
const [companyZip, indexPath] = files;

// ---------------------------------------------------------------- inputs
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const fileRecs = readCollection(opt.pack, 'files'), folderRecs = readCollection(opt.pack, 'folders'), driveRecs = readCollection(opt.pack, 'drives');
if (!fileRecs || !folderRecs || !driveRecs) fail(`${opt.pack} is not a data pack (files.js, folders.js and drives.js are needed)`);
const records = new Map(fileRecs.map(f => [f.sha256, f]));   // by content, as the index lists them
const folders = new Map(folderRecs.map(f => [f.id, f])), drives = new Map(driveRecs.map(d => [d.id, d]));
function folderPath(fid) {
  const parts = [];
  for (let f; fid; fid = f.parent_id) {
    f = folders.get(fid);
    if (!f) fail(`folder ${fid} is not in the data pack`);
    parts.unshift(f.name);
  }
  return parts.join('/');
}

const outer = openZip(companyZip);
const extras = new Map([...extraZips].map(([name, path]) => [name, openZip(path)]));
const nested = new Map();
function take(zip, name, label) {
  const entry = zip.get(name);
  if (!entry) fail(`${name} is not in ${label}`);
  return { data: zip.read(entry), mtime: entry.mtime };
}
/** A file's bytes and date, by its index `where` ([name] or [nested zip, name inside it]) and `zip` (an extra zip). */
function read(where, zipName) {
  if (zipName) {
    if (!extras.has(zipName)) fail(`${zipName}.zip is needed for ${where[where.length - 1]}: pass --extra ${zipName}=<path to ${zipName}.zip>`);
    return take(extras.get(zipName), where[0], `${zipName}.zip`);
  }
  if (where.length === 1) return take(outer, where[0], companyZip);
  if (!nested.has(where[0])) nested.set(where[0], openZip(take(outer, where[0], companyZip).data));
  return take(nested.get(where[0]), where[1], where[0]);
}

// ---------------------------------------------------------------- write
mkdirSync(opt.out, { recursive: true });
const zip = opt.zip ? createZipWriter(opt.zip) : null;
const manifest = [], used = new Set(), problems = [];
let bytes = 0;
try {
  for (const e of index.files) {
    const rec = records.get(e.sha256);
    if (!rec) { console.log('  no file record for', e.src); continue; }
    const { data, mtime } = read(e.where, e.zip);
    if (sha256(data) !== e.sha256) fail(`${e.src}: its content does not match its SHA-256 in the vault index`);
    const drive = drives.get(rec.drive_id);
    if (!drive) fail(`drive ${rec.drive_id} of ${rec.id} is not in the data pack`);
    const fpath = folderPath(rec.folder_id);
    // where it goes comes from the file record, so the app, the vault and Storage agree
    let path = rec.vault_path || [drive.name, fpath, rec.name].filter(Boolean).join('/');
    const base = path;
    for (let n = 2; used.has(path.toLowerCase()); n++) { const [stem, ext] = splitext(base); path = `${stem} (${n})${ext}`; } // same name twice in one folder
    used.add(path.toLowerCase());
    if (path.split('/').some(s => !s || s === '.' || s === '..')) { problems.push(`not written, unsafe path: ${path}`); continue; }
    if (rec.vault_path && path !== rec.vault_path) problems.push(`written as ${path}, but its record says ${rec.vault_path} (rebuild the data pack)`);
    if (rec.size !== data.length) problems.push(`${path}: ${data.length} bytes, but its record says ${rec.size}`);

    const dest = join(opt.out, ...path.split('/'));
    mkdirSync(dirname(dest), { recursive: true });
    if (existsSync(dest)) unlinkSync(dest); // otherwise Windows keeps the old spelling when only the case of the name changed
    writeFileSync(dest, data);
    utimesSync(dest, mtime, mtime);
    bytes += data.length;
    if (zip) zip.add(path, data, { mtime });
    manifest.push({ path_in_zip: path, drive: drive.name, folder_path: fpath, name: basename(path), mime: rec.mime, size: data.length,
      sha: e.sha256, linked: rec.linked !== undefined ? rec.linked : [], confidential: Boolean(rec.confidential), expires_on: rec.expires_on ?? null,
      description: rec.description ?? null, file_id: rec.id, storage_path: rec.storage_path ?? null, original_path: e.src });
  }
  console.log(`vault: ${manifest.length} files -> ${opt.out} (${(bytes / 1e6).toFixed(1)} MB)`);
  if (zip) {
    zip.add('manifest.json', Buffer.from(JSON.stringify({ kind: 'landscapers-inc-document-vault', version: 1, drives: [...drives.values()].map(d => d.name), files: manifest }, null, 1)));
    const { bytes: size } = zip.finish();
    console.log(`vault zip: ${manifest.length} files + manifest.json -> ${opt.zip} (${(size / 1e6).toFixed(1)} MB)`);
  }
} catch (e) {
  if (zip) zip.abort();
  throw e;
} finally {
  outer.close();
  for (const z of extras.values()) z.close();
}

// ---------------------------------------------------------------- check the folder
const wanted = new Map(fileRecs.filter(r => r.vault_path).map(r => [r.vault_path, r]));
let ok = 0;
for (const [p, r] of wanted) {
  const f = join(opt.out, ...p.split('/'));
  if (!existsSync(f)) { problems.push(`missing: ${p} (its file is not in the vault index or the zips)`); continue; }
  const data = readFileSync(f);
  if (data.length !== r.size || (r.sha256 && sha256(data) !== r.sha256)) { problems.push(`does not match its record: ${p}`); continue; }
  ok++;
}
// compared ignoring case: Windows and macOS keep ONE folder when two records spell it differently
// (e.g. 'Company Documents' and 'Company documents'), and no two vault paths differ only in case
const wantedLower = new Set([...wanted.keys()].map(p => p.toLowerCase()));
(function walk(dir, rel) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) walk(join(dir, d.name), r);
    else if (!wantedLower.has(r.toLowerCase())) problems.push(`not part of the data pack (delete it): ${r}`);
  }
})(opt.out, '');
console.log(`checked: ${ok} of ${wanted.size} documents in the data pack are in ${opt.out} with the right size and SHA-256`);
problems.forEach(p => console.log('  ' + p));
process.exit(problems.length ? 1 : 0);
