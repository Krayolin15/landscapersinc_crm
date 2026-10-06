/* =============================================================================
   Company data pack loader (local mode).

   data/seed/manifest.js lists every collection file with its record count and
   a checksum. The pack is stored as small JavaScript files (tools/lib/seed-files.js)
   and loaded with <script> tags, so it also loads when index.html is opened
   straight from the folder — browsers refuse fetch() of local files there. On first run everything is loaded; when a newer data pack ships,
   only records that nobody has touched since import are refreshed and new ones
   added — anything a person edited is never overwritten.
   In Supabase mode the same data is loaded by the 06 seed SQL (Admin → Go live) instead.
   ========================================================================== */

import { db } from './db.js';
import { idb } from './idb.js';

const SYSTEM = { id: 'system', name: 'Company records import' };

/** Run one data-pack file and hand back what it holds. Each file queues ["<key>", value] on globalThis.LSI_SEED. */
function loadPackFile(file, key, bust) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `data/seed/${file}?v=${encodeURIComponent(bust)}`;
    s.onload = () => {
      s.remove();
      const queue = globalThis.LSI_SEED || [];
      const i = queue.findIndex(e => Array.isArray(e) && e[0] === key);
      if (i < 0) { reject(new Error(`data/seed/${file} does not hold “${key}” — the company data pack is damaged. Unzip it again.`)); return; }
      resolve(queue.splice(i, 1)[0][1]); // taken off the queue, so the browser can free it once it is saved
    };
    s.onerror = () => { s.remove(); reject(new Error(`Missing data file data/seed/${file}`)); };
    document.head.appendChild(s);
  });
}

export async function loadManifest() {
  // a new query each time, so a newer data pack is never hidden behind a cached copy
  try { return await loadPackFile('manifest.js', 'manifest', Date.now()); }
  catch { throw new Error('The company data is missing: the data folder must sit next to index.html, exactly as it comes in the zip (data/seed/manifest.js). Unzip the zip again and reload.'); }
}

/** The whole data pack as shipped (not this device's edits): { manifest, records: { <collection>: [rows] } }.
    Used by Admin → Go live to build the Supabase seed SQL. onProgress({ done, total, collection }) */
export async function loadPack(onProgress = () => {}) {
  const manifest = await loadManifest();
  const records = {};
  let done = 0;
  for (const c of manifest.collections) {
    records[c.name] = await loadPackFile(c.file, c.name, manifest.version);
    onProgress({ done: ++done, total: manifest.collections.length, collection: c.label || c.name });
  }
  return { manifest, records };
}

/** One collection of the data pack as shipped (e.g. the staff profiles), or null if the pack has no such collection. */
export async function loadPackCollection(name) {
  const manifest = await loadManifest();
  const c = manifest.collections.find(x => x.name === name);
  return c ? loadPackFile(c.file, c.name, manifest.version) : null;
}

/** First run or upgrade. onProgress({ done, total, collection, count }) */
export async function ensureSeed(onProgress = () => {}) {
  const pending = loadManifest();                        // network check and local read run side by side
  pending.catch(() => { /* handled below */ });
  const current = await idb.kvGet('seed.version');
  if (!current) return applyPack(await pending, current, onProgress); // first run: the data pack is required
  // normal start: don't keep everyone on the splash while a slow network answers "nothing new"
  let manifest;
  try { manifest = await Promise.race([pending, new Promise(r => setTimeout(() => r(WAITED), 1500))]); }
  catch { return { loaded: false, version: current }; }  // offline: this device already has the data
  if (manifest === WAITED) {
    // a newer pack (if any) is applied in the background; open screens refresh from the change events
    pending.then(m => (m.version !== current ? applyPack(m, current, () => {}) : null)).catch(e => console.warn('[seed] background update', e));
    return { loaded: false, version: current };
  }
  if (manifest.version === current) return { loaded: false, version: current };
  return applyPack(manifest, current, onProgress);
}
const WAITED = Symbol('waited');

async function applyPack(manifest, current, onProgress) {
  const firstRun = !current;
  const total = manifest.collections.length;
  // download all collection files in parallel (6 at a time, like a browser does per server) …
  const files = new Array(total);
  let fetched = 0, next = 0;
  onProgress({ done: 0, total, collection: manifest.collections[0] ? manifest.collections[0].label || manifest.collections[0].name : 'data', count: 0 });
  const worker = async () => {
    while (next < total) {
      const i = next++, c = manifest.collections[i];
      files[i] = await loadPackFile(c.file, c.name, manifest.version);
      onProgress({ done: ++fetched, total, collection: c.label || c.name, count: c.count });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, total) }, worker));
  // … then save them in manifest order
  const summary = [];
  manifest.collections.forEach((c, i) => {
    const rows = files[i];
    let toWrite = rows;
    if (!firstRun) {
      toWrite = rows.filter(r => {
        const existing = db.get(c.name, r.id);
        return !existing || (existing._seed && existing.updated_by === SYSTEM.id);
      });
    }
    summary.push({ c, rows, stamped: toWrite.map(r => ({ ...r, _seed: true, created_by: r.created_by || SYSTEM.id, created_by_name: r.created_by_name || SYSTEM.name, updated_by: SYSTEM.id, updated_by_name: SYSTEM.name })) });
  });
  onProgress({ done: total, total, collection: 'Saving', count: 0 });
  for (const { c, stamped } of summary) if (stamped.length) await db.bulkUpsert(c.name, stamped, { silent: true, as: SYSTEM, localOnly: true });
  const result = summary.map(({ c, rows, stamped }) => ({ collection: c.name, total: rows.length, written: stamped.length }));
  await idb.kvSet('seed.version', manifest.version);
  await idb.kvSet('seed.summary', { version: manifest.version, at: new Date().toISOString(), firstRun, summary: result });
  return { loaded: true, firstRun, version: manifest.version, summary: result };
}
