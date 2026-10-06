/* =============================================================================
   Files — bytes live in IndexedDB (local mode) or the private Supabase Storage
   bucket 'drive' (production). Metadata lives in the `files` collection so
   files can be searched, starred, shared and linked to any record.

   Original company documents (kind 'vault', from the data pack) open straight
   from the document vault folder next to the app — data/vault/<vault_path> —
   or, in production, from Storage at storage_path (uploaded once with
   tools__upload-vault.js). In local mode an opened document is also kept in
   IndexedDB so it still opens offline.

   When index.html is opened straight from the folder (file://) the browser may
   SHOW data/vault files (in a frame, an image, a new tab) but never READ them
   with fetch(): documents then open from their folder address, and the few
   features that need a document's contents ask for Drive → Load original
   documents once (loadVaultFolder below), which keeps a checked copy here.
   ========================================================================== */

import { CONFIG, IS_SUPABASE } from '../config.js';
import { db } from './db.js';
import { idb } from './idb.js';
import { store } from './bus.js';
import { uid, h, downloadBlob } from '../ui/dom.js';
import { modal, toast, showError } from '../ui/overlays.js';
import { icon } from '../ui/icons.js';
import * as fmt from './format.js';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per file (Supabase free-tier limit)
/** True when the app was opened from the folder (double-clicked index.html) rather than served. */
export const fromFolder = () => typeof location !== 'undefined' && location.protocol === 'file:';
/** Where an original company document sits next to the app. */
export const vaultUrl = fileRec => 'data/vault/' + String(fileRec.vault_path).split('/').map(encodeURIComponent).join('/');
/** Shown when a feature needs a document's contents that this browser cannot read yet (opened from the folder). */
export const NEEDS_LOADING = 'This original document opens in the viewer, but its contents cannot be read while the app is opened from the folder. Go to Drive → Load original documents once (choose the data/vault folder), then try again.';

export function filesFor(col, id) {
  return db.all('files').filter(f => Array.isArray(f.linked) && f.linked.some(l => l.collection === col && l.id === id));
}

/**
 * uploadFiles(fileList, { drive_id, folder_id, linked:[{collection,id}], description, confidential }) -> [file records]
 */
export async function uploadFiles(fileList, o = {}) {
  const out = [];
  for (const file of fileList) {
    if (file.size > MAX_BYTES) { toast.error(`${file.name} is too large`, { text: `Maximum is ${fmt.fileSize(MAX_BYTES)}` }); continue; }
    try {
      const id = uid();
      const path = `${o.drive_id || 'my-drive'}/${id}/${file.name.replace(/[^\w.\- ()]+/g, '_')}`;
      if (IS_SUPABASE()) {
        const { error } = await db.client.storage.from(CONFIG.buckets.drive).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
        if (error) throw new Error(error.message);
      } else {
        await idb.putBlob(id, file, { name: file.name, type: file.type, size: file.size });
      }
      const text = await extractText(file).catch(() => '');
      const rec = await db.insert('files', {
        id, name: file.name, mime: file.type || guessMime(file.name), size: file.size, drive_id: o.drive_id || null, folder_id: o.folder_id || null,
        storage_path: IS_SUPABASE() ? path : null, blob_id: IS_SUPABASE() ? null : id, kind: 'upload',
        linked: o.linked || [], description: o.description || null, text_index: text.slice(0, 20000), confidential: !!o.confidential, owner_id: (store.get('user') || {}).id || null
      });
      out.push(rec);
    } catch (e) { showError(e, `Upload failed: ${file.name}`); }
  }
  if (out.length) toast.success(out.length === 1 ? `Uploaded ${out[0].name}` : `Uploaded ${out.length} files`);
  return out;
}

/** Store bytes for an existing metadata record (used by the document-vault importer). */
export async function attachBytes(fileRec, blob) {
  if (IS_SUPABASE()) {
    const path = fileRec.storage_path || `${fileRec.drive_id || 'my-drive'}/${fileRec.id}/${fileRec.name.replace(/[^\w.\- ()]+/g, '_')}`;
    const { error } = await db.client.storage.from(CONFIG.buckets.drive).upload(path, blob, { contentType: fileRec.mime || blob.type, upsert: true });
    if (error) throw new Error(error.message);
    return db.update('files', fileRec.id, { storage_path: path, kind: 'upload', size: blob.size }, { skipValidate: true });
  }
  await idb.putBlob(fileRec.id, blob, { name: fileRec.name, type: fileRec.mime, size: blob.size });
  return db.update('files', fileRec.id, { blob_id: fileRec.id, kind: 'upload', size: blob.size }, { skipValidate: true });
}

export async function getBlob(fileRec) {
  if (fileRec.kind === 'pending') return null;
  if (IS_SUPABASE() && fileRec.storage_path) {
    const { data, error } = await db.client.storage.from(CONFIG.buckets.drive).download(fileRec.storage_path);
    if (!error) return withType(data, fileRec);
    if (!fileRec.vault_path) throw new Error(error.message);
    // an original document not uploaded to Storage yet: the vault folder may still be served beside the app
    const fromFolder = await vaultBlob(fileRec, { keep: false });
    if (fromFolder) return fromFolder;
    throw new Error('This original document is not in cloud storage yet. An administrator uploads the document vault once with tools__upload-vault.js (docs__SETUP-SUPABASE.html, step 6).');
  }
  const row = await idb.getBlob(fileRec.blob_id || fileRec.id);
  if (row && row.blob) return withType(row.blob, fileRec);
  if (fileRec.vault_path) return vaultBlob(fileRec, { keep: true });
  return null;
}

/** Bytes of an original company document from the vault folder (data/vault/<vault_path>), or null if it isn't there. */
async function vaultBlob(fileRec, { keep }) {
  if (fromFolder()) return null; // the browser refuses fetch() of local files; see Load original documents
  let res;
  try { res = await fetch(vaultUrl(fileRec)); } catch { return null; }
  if (!res.ok) return null;
  const blob = withType(await res.blob(), fileRec);
  // keep a copy on this device so it opens instantly (and offline) next time
  if (keep) idb.putBlob(fileRec.id, blob, { name: fileRec.name, type: blob.type, size: blob.size }).catch(() => { /* storage full: it is fetched again next time */ });
  return blob;
}
/** Servers often label files application/octet-stream; previews need the real type. */
function withType(blob, fileRec) {
  const type = fileRec.mime || guessMime(fileRec.name || '');
  return blob && (!blob.type || blob.type === 'application/octet-stream') && type !== 'application/octet-stream' ? new Blob([blob], { type }) : blob;
}

/** A URL to show the file: a blob: URL of its bytes, or — for an original document when the app is opened
    from the folder and they have not been loaded — its address in data/vault (frames, images and new tabs can show it). */
export async function fileUrl(fileRec) {
  const blob = await getBlob(fileRec);
  if (blob) return URL.createObjectURL(blob);
  return fileRec.vault_path && fromFolder() ? vaultUrl(fileRec) : null;
}

export async function downloadFile(fileRec) {
  try {
    const blob = await getBlob(fileRec);
    if (!blob && fileRec.vault_path && fromFolder()) { window.open(vaultUrl(fileRec), '_blank', 'noopener'); return; } // the browser opens or saves it itself
    if (!blob) return toast.warn(`“${fileRec.name}” could not be found`, { text: missingText(fileRec) });
    downloadBlob(blob, fileRec.name);
  } catch (e) { showError(e, 'Download failed'); }
}

export async function deleteFileBytes(fileRec) {
  if (IS_SUPABASE() && fileRec.storage_path) await db.client.storage.from(CONFIG.buckets.drive).remove([fileRec.storage_path]);
  else await idb.deleteBlob(fileRec.blob_id || fileRec.id);
}

/** Open a preview (PDF, image, text, video) with download / open-in-tab actions. */
export async function openFile(fileRec) {
  if (fileRec.kind && !['upload', 'pending', 'vault'].includes(fileRec.kind) && fileRec.ref_id) {
    const target = { doc: 'docs', sheet: 'sheets', slides: 'slides', form: 'forms' }[fileRec.kind];
    location.hash = `#/${target}/${fileRec.ref_id}`;
    return;
  }
  let url = null;
  try { url = await fileUrl(fileRec); } catch (e) { showError(e, 'Could not open file'); return; }
  const mime = fileRec.mime || guessMime(fileRec.name);
  let body;
  if (!url) body = h('div.empty', h('div.e-art', icon('cloud-off', 40)), h('h3', 'Document not found'), h('p', missingText(fileRec)));
  else if (mime.includes('pdf')) body = h('iframe', { src: url, title: fileRec.name, style: 'width:100%;height:72vh;border:0;border-radius:12px;background:#fff' });
  else if (mime.startsWith('image/')) body = h('img', { src: url, alt: fileRec.name, style: 'max-width:100%;max-height:72vh;margin:auto;border-radius:12px' });
  else if (mime.startsWith('video/')) body = h('video', { src: url, controls: true, style: 'width:100%;max-height:72vh;border-radius:12px' });
  else if (mime.startsWith('text/') || /\.(csv|txt|md|json)$/i.test(fileRec.name)) {
    const b = await getBlob(fileRec).catch(() => null);
    body = b ? h('pre', { style: 'white-space:pre-wrap;max-height:72vh;overflow:auto;background:var(--surface-2);padding:16px;border-radius:12px' }, (await b.text()).slice(0, 200000))
      : h('iframe', { src: url, title: fileRec.name, style: 'width:100%;height:72vh;border:0;border-radius:12px;background:#fff' });
  }
  else body = h('div.empty', h('div.e-art', icon('file', 40)), h('h3', fileRec.name), h('p', `${mime || 'Unknown type'} · ${fmt.fileSize(fileRec.size)} — no preview for this type. Download it to open.`));
  modal({
    title: fileRec.name, icon: 'file', tile: 't-grass', size: 'xwide', body,
    onClose: () => url && setTimeout(() => URL.revokeObjectURL(url), 5000),
    actions: url ? [
      { label: 'Open in new tab', icon: 'external-link', variant: 'ghost', close: false, onClick: () => { window.open(url, '_blank', 'noopener'); return false; } },
      { label: 'Download', icon: 'download', variant: 'primary', close: false, onClick: () => { downloadFile(fileRec); return false; } }
    ] : [{ label: 'Close', variant: 'primary' }]
  });
}

/** What to tell someone when a document's bytes are missing. */
function missingText(fileRec) {
  if (fileRec.vault_path) {
    return IS_SUPABASE()
      ? `This is an original company document (${fileRec.vault_path}). It has not been uploaded to cloud storage yet — an administrator runs tools__upload-vault.js once (docs__SETUP-SUPABASE.html).`
      : `This is an original company document. It belongs at data/vault/${fileRec.vault_path} next to index.html — the data/vault folder comes in the zip. Unzip the whole zip again so the folder is complete.`;
  }
  return 'The file itself is not on this device or in storage. Upload it again from Drive.';
}

/**
 * Drive → Load original documents. fileList: files the person picked — the data/vault folder (input webkitdirectory),
 * a folder above it, or the documents themselves. Each file is recognised by its content (SHA-256, as on its record),
 * so its name and folder do not matter; a file whose path names a record but whose content differs is reported, not
 * loaded. Matching files are kept in this browser, so every feature can read them from now on.
 * visible(fileRec) limits it to the documents this person may open. Returns counts and the paths that did not match.
 */
export async function loadVaultFolder(fileList, { visible = () => true, onProgress = () => {} } = {}) {
  const recs = db.all('files').filter(f => f.vault_path && f.sha256 && visible(f));
  const byPath = new Map(recs.map(f => [String(f.vault_path).toLowerCase(), f]));
  const bySha = new Map(recs.map(f => [f.sha256, f]));
  const sizes = new Set(recs.map(f => f.size));
  const list = Array.from(fileList || []);
  const out = { loaded: 0, already: 0, other: 0, mismatched: [], expected: recs.length };
  const done = new Set();
  let i = 0;
  for (const file of list) {
    i++;
    onProgress({ done: i, total: list.length });
    // a record this file's place names (folder picked: data/vault, data/ or the app folder — longest match first)
    const parts = String(file.webkitRelativePath || '').split('/');
    let named = null;
    for (let k = 1; k < parts.length && !named; k++) named = byPath.get(parts.slice(k).join('/').toLowerCase()) || null;
    if (!named && !sizes.has(file.size)) { out.other++; continue; } // cannot be one of the documents: not even read
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('');
    const rec = bySha.get(digest);
    if (!rec) { if (named) out.mismatched.push(named.vault_path); else out.other++; continue; }
    if (done.has(rec.id)) continue; // the same document picked twice
    done.add(rec.id);
    const have = await idb.getBlob(rec.id).catch(() => null);
    if (have && have.blob && (rec.size == null || have.blob.size === rec.size)) { out.already++; continue; }
    await idb.putBlob(rec.id, new Blob([file], { type: rec.mime || file.type || guessMime(rec.name) }), { name: rec.name, type: rec.mime, size: file.size });
    out.loaded++;
  }
  return out;
}

/**
 * Opened from the folder, Windows cannot open a file whose full path is longer than 260 characters, and the browser
 * then says the document is "not found". When the app folder sits that deep for the longest document path, this says
 * so ({ deep: true, folder }), so the person can move the folder somewhere short such as C:\LSI.
 */
export function folderTooDeep() {
  if (!fromFolder() || !/^\/[A-Za-z]:\//.test(location.pathname)) return { deep: false };
  const folder = decodeURIComponent(location.pathname).slice(1).replace(/\/[^/]*$/, ''); // C:/…/landscapers-hq
  const longest = db.all('files').reduce((m, f) => Math.max(m, f.vault_path ? String(f.vault_path).length : 0), 0);
  return { deep: folder.length + '/data/vault/'.length + longest > 259, folder: folder.replace(/\//g, '\\') };
}
/** How many of the original documents (of those visible) this browser already keeps a copy of. */
export async function vaultLoadedCount(visible = () => true) {
  let n = 0;
  for (const f of db.all('files').filter(x => x.vault_path && visible(x))) { const row = await idb.getBlob(f.id).catch(() => null); if (row && row.blob) n++; }
  return n;
}

export function guessMime(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', json: 'application/json',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', mp4: 'video/mp4', zip: 'application/zip' })[ext] || 'application/octet-stream';
}

export function fileIcon(f) {
  const m = f.mime || guessMime(f.name || '');
  if (f.kind === 'doc') return ['file-text', 't-river'];
  if (f.kind === 'sheet') return ['sheet', 't-grass'];
  if (f.kind === 'slides') return ['presentation', 't-sun'];
  if (f.kind === 'form') return ['clipboard-list', 't-violet'];
  if (m.includes('pdf')) return ['file-text', 't-rose'];
  if (m.startsWith('image/')) return ['image', 't-clay'];
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv')) return ['file-spreadsheet', 't-grass'];
  if (m.includes('word')) return ['file-type', 't-river'];
  if (m.includes('presentation') || m.includes('powerpoint')) return ['presentation', 't-sun'];
  if (m.startsWith('video/')) return ['film', 't-violet'];
  if (m.includes('zip')) return ['file-archive', 't-slate'];
  return ['file', 't-slate'];
}

/** Best-effort text extraction for search (plain text, CSV, JSON). PDFs/Office are indexed by the vault importer. */
async function extractText(file) {
  if (/^text\/|json|csv/.test(file.type || '') || /\.(txt|csv|md|json)$/i.test(file.name)) return (await file.text()).slice(0, 20000);
  return '';
}

export async function storageUsed() {
  if (IS_SUPABASE()) return db.all('files').reduce((a, f) => a + (f.size || 0), 0);
  return idb.blobUsage();
}
