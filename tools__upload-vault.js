// Upload the original company documents to Supabase Storage (production), once:
//
//   PowerShell:  $env:SUPABASE_URL="https://<project>.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="<service_role key>"; node tools__upload-vault.js
//   bash:        SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> node tools__upload-vault.js
//
// Options: --dry-run (check only, upload nothing) · --force (replace files already in Storage)
//
// Reads every document record in data__seed__files.js, takes the file from data/vault/<vault_path> (the folder
// comes in the zip; tools__build-vault.js can rebuild it from the original company zips), checks its SHA-256
// against the record and uploads it to the private 'drive' bucket at the record's storage_path — where the
// app looks for it. Safe to re-run: files already uploaded are skipped.
//
// The service_role key bypasses all security rules. Use it only on your own computer, from the
// environment (never put it in a file in this folder, never in js__config.js, never in the browser).
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCollection } from './lib/seed-files.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run'), FORCE = args.has('--force');
const URL_ = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = 'drive'; // js__config.js → CONFIG.buckets.drive (created by step 04 of the go-live SQL)

const fail = m => { console.error(`✗ ${m}`); process.exit(1); };
if (!DRY && (!/^https:\/\/[\w-]+\.supabase\.co$/.test(URL_) || !KEY)) fail('Set SUPABASE_URL (https://<project>.supabase.co) and SUPABASE_SERVICE_ROLE_KEY in the environment first (see the top of this file).');
const files = readCollection(join(root, 'data/seed'), 'files');
if (!files) fail('data__seed__files.js not found — the company data pack is missing from data/seed/.');

const records = files.filter(r => r.vault_path && r.storage_path);
const enc = p => p.split('/').map(encodeURIComponent).join('/');
let uploaded = 0, skipped = 0;
const problems = [];

async function one(r) {
  const file = join(root, 'data/vault', ...r.vault_path.split('/'));
  if (!existsSync(file)) { problems.push(`not in data/vault: ${r.vault_path} (the data/vault folder from the zip is incomplete — unzip it again, or rebuild it with tools__build-vault.js)`); return; }
  const bytes = readFileSync(file);
  if (r.sha256 && createHash('sha256').update(bytes).digest('hex') !== r.sha256) { problems.push(`content does not match its record, not uploaded: ${r.vault_path}`); return; }
  if (DRY) { uploaded++; return; }
  const res = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${enc(r.storage_path)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': r.mime || 'application/octet-stream', 'x-upsert': FORCE ? 'true' : 'false', 'cache-control': '3600' },
    body: bytes
  });
  if (res.ok) { uploaded++; return; }
  const text = await res.text();
  if (/Duplicate|already exists/i.test(text)) { skipped++; return; }
  problems.push(`${r.vault_path}: HTTP ${res.status} ${text.slice(0, 200)}`);
}

// four at a time: quick, without tripping rate limits
const queue = [...records];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await one(queue.shift()); }));

console.log(`${DRY ? 'Checked' : 'Uploaded'} ${uploaded} · already in Storage ${skipped} · problems ${problems.length} · of ${records.length} documents`);
problems.forEach(p => console.log('  ' + p));
process.exit(problems.length ? 1 : 0);
