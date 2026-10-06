/* =============================================================================
   Minimal promise wrapper around IndexedDB.
   Stores:
     records  { k: '<collection>|<id>', col, id, v }   — all business data (local mode) / offline cache (supabase mode)
     blobs    { id, blob, name, type, size }           — file bytes for Drive (local mode) / offline copies
     kv       { k, v }                                  — small settings, sessions, reminder log, ML models
     outbox   { seq, op }                               — writes made offline, replayed when back online
   ========================================================================== */

import { CONFIG } from '../config.js';

let dbp = null;

export function openIDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('This browser does not support IndexedDB'));
    const req = indexedDB.open(CONFIG.dbName, CONFIG.dbVersion);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('records')) { const s = d.createObjectStore('records', { keyPath: 'k' }); s.createIndex('col', 'col'); }
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn('IndexedDB upgrade blocked by another tab');
  });
  return dbp;
}

function tx(store, mode, fn) {
  return openIDB().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
  }));
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const idb = {
  getAllRecords: () => tx('records', 'readonly', s => reqP(s.getAll())),
  getCollection: col => tx('records', 'readonly', s => reqP(s.index('col').getAll(col))),
  putRecord: (col, rec) => tx('records', 'readwrite', s => { s.put({ k: `${col}|${rec.id}`, col, id: rec.id, v: rec }); }),
  putRecords: (col, recs) => tx('records', 'readwrite', s => { recs.forEach(rec => s.put({ k: `${col}|${rec.id}`, col, id: rec.id, v: rec })); }),
  deleteRecord: (col, id) => tx('records', 'readwrite', s => { s.delete(`${col}|${id}`); }),
  clearCollection: col => tx('records', 'readwrite', s => new Promise(res => {
    const r = s.index('col').openKeyCursor(IDBKeyRange.only(col));
    r.onsuccess = () => { const c = r.result; if (c) { s.delete(c.primaryKey); c.continue(); } else res(); };
  })),
  /** Swap a collection's cached rows for new ones in ONE transaction (keys are '<col>|<id>'; the '|' keeps 'mail' from matching 'mail_flags'). */
  replaceCollection: (col, recs) => tx('records', 'readwrite', s => {
    s.delete(IDBKeyRange.bound(col + '|', col + '|\uffff'));
    recs.forEach(rec => s.put({ k: `${col}|${rec.id}`, col, id: rec.id, v: rec }));
  }),
  clearAll: () => Promise.all(['records', 'blobs', 'kv', 'outbox'].map(n => tx(n, 'readwrite', s => { s.clear(); }))),

  putBlob: (id, blob, meta = {}) => tx('blobs', 'readwrite', s => { s.put({ id, blob, ...meta }); }),
  getBlob: id => tx('blobs', 'readonly', s => reqP(s.get(id))),
  deleteBlob: id => tx('blobs', 'readwrite', s => { s.delete(id); }),
  blobUsage: () => tx('blobs', 'readonly', s => reqP(s.getAll())).then(all => all.reduce((a, b) => a + (b.size || (b.blob && b.blob.size) || 0), 0)),

  kvGet: k => tx('kv', 'readonly', s => reqP(s.get(k))).then(r => (r ? r.v : undefined)),
  kvSet: (k, v) => tx('kv', 'readwrite', s => { s.put({ k, v }); }),
  kvDel: k => tx('kv', 'readwrite', s => { s.delete(k); }),

  outboxAdd: op => tx('outbox', 'readwrite', s => { s.add({ op, at: new Date().toISOString() }); }),
  outboxAll: () => tx('outbox', 'readonly', s => reqP(s.getAll())),
  outboxDelete: seq => tx('outbox', 'readwrite', s => { s.delete(seq); })
};
