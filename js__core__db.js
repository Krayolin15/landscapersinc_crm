/* =============================================================================
   db — the single data API every app uses.

   Reads are synchronous from an in-memory cache (instant UI):
     db.all('clients')                      every live record
     db.get('clients', id)                  one record (or null)
     db.list('invoices', { where, sort, search, limit })
     db.filter / db.find / db.count

   Writes are async, validated, stamped with who/when, audited, and broadcast:
     await db.insert('events', { title, date, ... })     -> record (created_by = current user)
     await db.update('events', id, { time: '10:00' })   -> record (updated_by = current user)
     await db.remove('events', id)                       -> soft delete (Trash); { hard:true } to purge
     await db.restore('events', id)
     db.on('events', ({ type, rec, prev }) => ...)       -> unsubscribe fn

   Backends: 'local' (IndexedDB, this device) and 'supabase' (Postgres + RLS,
   realtime, offline outbox). Same calls, same behaviour.
   ========================================================================== */

import { CONFIG, IS_SUPABASE } from '../config.js';
import { bus, store } from './bus.js';
import { idb } from './idb.js';
import { validateRecord, normalise, ValidationError } from './validate.js';
import { getDef, SYSTEM_FIELDS, AUDIT_EXEMPT } from './schema.js';
import { canSeeField } from './perms.js';
import { uid } from '../ui/dom.js';
import { ensureLib } from './lazy.js';

const mem = new Map();          // col -> Map(id -> record)
const loaded = new Set();       // collections fetched from server (supabase mode)
let sb = null;                  // supabase client
let channel = null;             // realtime channel
const bc = 'BroadcastChannel' in globalThis ? new BroadcastChannel('lsihq-db') : null;
if (bc && typeof bc.unref === 'function') bc.unref(); // Node (tests, seed tools): don't keep the process alive

const nowIso = () => new Date().toISOString();
const colMap = col => { if (!mem.has(col)) mem.set(col, new Map()); return mem.get(col); };
const actor = () => {
  const u = store.get('user');
  return u ? { id: u.id, name: u.name } : { id: 'system', name: 'System' };
};
const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));

function emit(col, type, rec, prev, remote = false) {
  const payload = { col, type, rec, prev, remote };
  bus.emit(`db:${col}`, payload);
  bus.emit('db:change', payload);
}

/* ------------------------------------------------------------------ reads */

function live(r, opts) { return opts && opts.withDeleted ? true : !r.deleted_at; }

export const db = {
  get mode() { return IS_SUPABASE() ? 'supabase' : 'local'; },
  get client() { return sb; },

  all(col, opts) { return Array.from(colMap(col).values()).filter(r => live(r, opts)); },
  get(col, id) { const r = id != null ? colMap(col).get(String(id)) : null; return r || null; },
  find(col, pred, opts) { for (const r of colMap(col).values()) if (live(r, opts) && pred(r)) return r; return null; },
  filter(col, pred, opts) { return db.all(col, opts).filter(pred); },
  count(col, pred) { return pred ? db.filter(col, pred).length : db.all(col).length; },
  trash(col) { return Array.from(colMap(col).values()).filter(r => r.deleted_at); },
  collections() { return Array.from(mem.keys()); },

  /**
   * list(col, { where: obj|fn, sort: 'field' | '-field' | fn, search: 'text', fields: [..], limit, offset })
   */
  list(col, opts = {}) {
    let rows = db.all(col, opts);
    const { where, sort, search, limit, offset = 0 } = opts;
    if (typeof where === 'function') rows = rows.filter(where);
    else if (where && typeof where === 'object') rows = rows.filter(r => Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)));
    if (search) {
      const def = getDef(col);
      const keys = opts.fields || (def && def.search) || Object.keys((def && def.fields) || {});
      const terms = String(search).toLowerCase().split(/\s+/).filter(Boolean);
      rows = rows.filter(r => { const hay = keys.map(k => r[k]).join(' ').toLowerCase(); return terms.every(t => hay.includes(t)); });
    }
    if (sort) {
      if (typeof sort === 'function') rows.sort(sort);
      else {
        const desc = sort.startsWith('-'), key = desc ? sort.slice(1) : sort;
        rows.sort((a, b) => {
          const x = a[key], y = b[key];
          if (x == null && y == null) return 0;
          if (x == null) return 1;
          if (y == null) return -1;
          const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true, sensitivity: 'base' });
          return desc ? -c : c;
        });
      }
    }
    if (offset || limit) rows = rows.slice(offset, limit ? offset + limit : undefined);
    return rows;
  },

  /** Label for any record (used in audit log, search, attributions). */
  label(col, recOrId) {
    const rec = typeof recOrId === 'object' ? recOrId : db.get(col, recOrId);
    if (!rec) return '(deleted)';
    const def = getDef(col);
    if (def && typeof def.display === 'function') { try { return def.display(rec) || rec.id; } catch { /* fall through */ } }
    return rec.name || rec.title || rec.subject || rec.number || rec.code || rec.id;
  },

  /* --------------------------------------------------------------- writes */

  /** Validate without saving. Returns { ok, errors, warnings, rec } */
  check(col, data, { id } = {}) {
    const def = getDef(col);
    const rec = normalise(def, data);
    const res = validateRecord(def, rec, { existing: db.all(col), lookup: (c, i) => db.get(c, i), isUpdate: !!id, id });
    return { ...res, rec };
  },

  async insert(col, data, opts = {}) {
    const def = getDef(col);
    let rec = normalise(def, { ...(def && def.defaults ? (typeof def.defaults === 'function' ? def.defaults() : def.defaults) : {}), ...data });
    if (!opts.skipValidate) {
      const res = validateRecord(def, rec, { existing: db.all(col), lookup: (c, i) => db.get(c, i), id: rec.id });
      if (!res.ok) throw new ValidationError(res.errors, res.warnings);
    }
    const who = opts.as || actor();
    const ts = opts.at || nowIso();
    rec = {
      ...rec,
      id: String(rec.id || uid()),
      created_at: rec.created_at || ts,
      created_by: rec.created_by || who.id,
      created_by_name: rec.created_by_name || who.name,
      updated_at: ts,
      updated_by: who.id,
      updated_by_name: who.name
    };
    if (def && typeof def.beforeSave === 'function') rec = def.beforeSave(rec, null) || rec;
    colMap(col).set(rec.id, rec);
    try { await persist(col, rec, 'insert'); } catch (e) { colMap(col).delete(rec.id); idb.deleteRecord(col, rec.id); throw e; }
    emit(col, 'insert', rec, null);
    if (!opts.silent) audit('create', col, rec, null);
    return rec;
  },

  async update(col, id, patch, opts = {}) {
    const def = getDef(col);
    const prev = db.get(col, id);
    if (!prev) throw new Error(`${col} record ${id} not found`);
    let next = { ...prev, ...normalise(def, patch) };
    if (!opts.skipValidate) {
      const res = validateRecord(def, next, { existing: db.all(col), lookup: (c, i) => db.get(c, i), isUpdate: true, id });
      if (!res.ok) throw new ValidationError(res.errors, res.warnings);
    }
    const who = opts.as || actor();
    next = { ...next, id: prev.id, created_at: prev.created_at, created_by: prev.created_by, created_by_name: prev.created_by_name, updated_at: nowIso(), updated_by: who.id, updated_by_name: who.name };
    if (def && typeof def.beforeSave === 'function') next = def.beforeSave(next, prev) || next;
    colMap(col).set(next.id, next);
    try { await persist(col, next, 'update'); } catch (e) { colMap(col).set(prev.id, prev); idb.putRecord(col, prev); throw e; }
    emit(col, 'update', next, prev);
    if (!opts.silent) audit('update', col, next, prev);
    return next;
  },

  /** Soft delete by default (goes to Trash). { hard: true } removes permanently. */
  async remove(col, id, opts = {}) {
    const prev = db.get(col, id);
    if (!prev) return null;
    if (opts.hard) {
      colMap(col).delete(String(id));
      await persistDelete(col, prev);
      emit(col, 'delete', null, prev);
      if (!opts.silent) audit('purge', col, null, prev);
      return prev;
    }
    const who = actor();
    const next = { ...prev, deleted_at: nowIso(), deleted_by: who.id, deleted_by_name: who.name };
    colMap(col).set(next.id, next);
    await persist(col, next, 'update');
    emit(col, 'delete', next, prev);
    if (!opts.silent) audit('delete', col, next, prev);
    return next;
  },

  async restore(col, id) {
    const prev = db.get(col, id);
    if (!prev) return null;
    const next = { ...prev, deleted_at: null, deleted_by: null, deleted_by_name: null, updated_at: nowIso() };
    colMap(col).set(next.id, next);
    await persist(col, next, 'update');
    emit(col, 'insert', next, prev);
    audit('restore', col, next, prev);
    return next;
  },

  /**
   * Several system records in one go (notifications, read receipts, predictions): one IndexedDB
   * transaction, one message to other tabs and one change event, instead of one of each per record.
   * Not validated and not audited, like the single-record calls these replace ({ skipValidate, silent }).
   */
  async insertMany(col, list, opts = {}) {
    const def = getDef(col);
    const who = opts.as || actor();
    const ts = nowIso();
    const out = list.map(data => {
      let rec = normalise(def, { ...(def && def.defaults ? (typeof def.defaults === 'function' ? def.defaults() : def.defaults) : {}), ...data });
      rec = { ...rec, id: String(rec.id || uid()), created_at: rec.created_at || ts, created_by: rec.created_by || who.id, created_by_name: rec.created_by_name || who.name, updated_at: ts, updated_by: who.id, updated_by_name: who.name };
      return def && typeof def.beforeSave === 'function' ? def.beforeSave(rec, null) || rec : rec;
    });
    if (!out.length) return out;
    out.forEach(r => colMap(col).set(r.id, r));
    try { await persistMany(col, out); } catch (e) { out.forEach(r => { colMap(col).delete(r.id); idb.deleteRecord(col, r.id); }); throw e; }
    bus.emit(`db:${col}`, { col, type: 'bulk', count: out.length });
    bus.emit('db:change', { col, type: 'bulk', count: out.length });
    return out;
  },
  /** updateMany(col, [{ id, patch }]) — the batch twin of update() for system records (see insertMany). */
  async updateMany(col, changes, opts = {}) {
    const def = getDef(col);
    const who = opts.as || actor();
    const ts = nowIso();
    const prevs = [], out = [];
    for (const { id, patch } of changes) {
      const prev = db.get(col, id);
      if (!prev) continue;
      let next = { ...prev, ...normalise(def, patch), id: prev.id, created_at: prev.created_at, created_by: prev.created_by, created_by_name: prev.created_by_name, updated_at: ts, updated_by: who.id, updated_by_name: who.name };
      if (def && typeof def.beforeSave === 'function') next = def.beforeSave(next, prev) || next;
      prevs.push(prev); out.push(next);
    }
    if (!out.length) return out;
    out.forEach(r => colMap(col).set(r.id, r));
    try { await persistMany(col, out); } catch (e) { prevs.forEach(r => colMap(col).set(r.id, r)); idb.putRecords(col, prevs).catch(() => {}); throw e; }
    bus.emit(`db:${col}`, { col, type: 'bulk', count: out.length });
    bus.emit('db:change', { col, type: 'bulk', count: out.length });
    return out;
  },

  /** Fast path for imports & seeding: validates unless told not to, no per-row audit. */
  async bulkUpsert(col, rows, opts = {}) {
    const def = getDef(col);
    const who = opts.as || actor();
    const ts = nowIso();
    const out = [];
    const errors = [];
    for (const raw of rows) {
      const rec0 = normalise(def, raw);
      if (opts.validate) {
        const res = validateRecord(def, rec0, { existing: [...db.all(col), ...out], lookup: (c, i) => db.get(c, i), id: rec0.id });
        if (!res.ok) { errors.push({ rec: raw, errors: res.errors }); if (opts.strict) continue; }
      }
      const rec = { ...rec0, id: String(rec0.id || uid()), created_at: rec0.created_at || ts, created_by: rec0.created_by || who.id, created_by_name: rec0.created_by_name || who.name, updated_at: rec0.updated_at || ts, updated_by: rec0.updated_by || who.id, updated_by_name: rec0.updated_by_name || who.name };
      colMap(col).set(rec.id, rec);
      out.push(rec);
    }
    if (IS_SUPABASE() && !opts.localOnly) await sbUpsert(col, out);
    await idb.putRecords(col, out);
    bus.emit(`db:${col}`, { col, type: 'bulk', count: out.length });
    bus.emit('db:change', { col, type: 'bulk', count: out.length });
    if (!opts.silent) audit('import', col, { id: `${out.length} records`, _label: `${out.length} records` }, null);
    return { saved: out, errors };
  },

  on(col, fn) { return bus.on(col === '*' ? 'db:change' : `db:${col}`, fn); },

  /* ----------------------------------------------------------- lifecycle */

  async init({ onProgress } = {}) {
    const cached = await idb.getAllRecords().catch(() => []);
    for (const row of cached) colMap(row.col).set(row.id, row.v);
    if (IS_SUPABASE()) {
      let S; try { S = await ensureLib('supabase'); } catch { throw new Error('Supabase library failed to load'); }
      sb = S.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
      window.addEventListener('online', () => flushOutbox());
    }
    if (bc) bc.onmessage = e => applyRemote(e.data);
    onProgress && onProgress(1);
    return { cachedRecords: cached.length };
  },

  /** Supabase: fetch these collections from the server (all rows, paged). No-op in local mode. */
  async sync(cols, { force = false } = {}) {
    if (!IS_SUPABASE() || !sb) return;
    const todo = cols.filter(c => force || !loaded.has(c));
    await Promise.all(todo.map(async col => {
      const rows = [];
      // tables with sensitive columns: the table only returns the other columns (RLS, js__sql__schema.js);
      // people allowed to see them get the values from <col>_sensitive
      const sens = sensitiveFields(col);
      const columns = sens.length ? [...knownColumns(col), 'data'].filter(c => !sens.includes(c)).join(',') : '*';
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from(col).select(columns).range(from, from + 999);
        if (error) { console.warn(`[db] load ${col}:`, error.message); if (/permission|denied|not exist/i.test(error.message)) { mem.set(col, new Map()); } return; }
        rows.push(...data);
        if (data.length < 1000) break;
      }
      const m = new Map();
      rows.map(fromRow).forEach(r => m.set(r.id, r));
      if (sens.some(f => canSeeField(col, f))) {
        for (let from = 0; ; from += 1000) {
          const { data, error } = await sb.from(`${col}_sensitive`).select('*').range(from, from + 999);
          if (error) { console.warn(`[db] load ${col}_sensitive:`, error.message); break; }
          for (const s of data) { const r = m.get(s.id); if (r) Object.assign(r, s); }
          if (data.length < 1000) break;
        }
      }
      mem.set(col, m);
      loaded.add(col);
      await idb.replaceCollection(col, Array.from(m.values())); // one transaction, no row-by-row deletes
      bus.emit(`db:${col}`, { col, type: 'sync', count: m.size });
    }));
  },

  subscribeRealtime() {
    if (!IS_SUPABASE() || !sb || channel) return;
    channel = sb.channel('lsihq-all')
      .on('postgres_changes', { event: '*', schema: 'public' }, payload => {
        const col = payload.table;
        // Realtime trims rows it cannot deliver whole (e.g. a large spreadsheet) and says so in `errors`:
        // never apply a partial row — fetch the real one instead
        const errs = payload.errors;
        if (payload.eventType !== 'DELETE' && errs && (Array.isArray(errs) ? errs.length : true)) {
          const id = (payload.new && payload.new.id) || (payload.old && payload.old.id);
          if (id != null) fetchRow(col, id).then(res => {
            if (!res) return;
            const prev = db.get(col, String(id));
            if (res.gone) { if (prev) { colMap(col).delete(String(id)); idb.deleteRecord(col, id); emit(col, 'delete', null, prev, true); } return; }
            colMap(col).set(res.rec.id, res.rec); idb.putRecord(col, res.rec);
            emit(col, prev ? 'update' : 'insert', res.rec, prev, true);
          });
          return;
        }
        if (payload.eventType === 'DELETE') {
          const prev = db.get(col, payload.old.id);
          colMap(col).delete(String(payload.old.id));
          idb.deleteRecord(col, payload.old.id);
          emit(col, 'delete', null, prev, true);
        } else {
          const rec = fromRow(payload.new);
          const prev = db.get(col, rec.id);
          const sens = sensitiveFields(col);
          // realtime never carries sensitive columns: keep what we have, then refresh them if this person may see them
          if (sens.length && prev) for (const f of sens) if (!(f in (payload.new || {})) && f in prev) rec[f] = prev[f];
          colMap(col).set(rec.id, rec);
          idb.putRecord(col, rec);
          emit(col, prev ? 'update' : 'insert', rec, prev, true);
          if (sens.some(f => canSeeField(col, f))) {
            sb.from(`${col}_sensitive`).select('*').eq('id', rec.id).maybeSingle().then(({ data }) => {
              const cur = db.get(col, rec.id);
              if (!data || !cur) return;
              const next = { ...cur, ...data };
              colMap(col).set(rec.id, next);
              idb.putRecord(col, next);
              emit(col, 'update', next, cur, true);
            });
          }
        }
      })
      .subscribe(status => store.set('realtime', status));
  },

  async export() {
    const out = { exported_at: nowIso(), app: CONFIG.appName, mode: db.mode, collections: {} };
    for (const [col, m] of mem) out.collections[col] = Array.from(m.values());
    return out;
  },
  async import(json, { replace = false } = {}) {
    for (const [col, rows] of Object.entries(json.collections || {})) {
      if (replace) { mem.set(col, new Map()); await idb.clearCollection(col); }
      await db.bulkUpsert(col, rows, { silent: true });
    }
  },
  async wipeLocal() { mem.clear(); await idb.clearAll(); },

  async pendingOutbox() { return (await idb.outboxAll()).length; }
};

/* ------------------------------------------------------------------ persistence */

function knownColumns(col) {
  const def = getDef(col);
  return new Set([...SYSTEM_FIELDS, ...Object.keys((def && def.fields) || {}).filter(k => !(def.fields[k] || {}).computed)]);
}
/** Schema fields marked `sensitive` (served by <col>_sensitive in Supabase mode). */
function sensitiveFields(col) {
  const def = getDef(col);
  return Object.entries((def && def.fields) || {}).filter(([, f]) => f.sensitive && !f.computed).map(([k]) => k);
}
/** Supabase: one row, read the same way sync() reads a table. { rec } | { gone: true } (deleted or no longer visible) | null on error. */
async function fetchRow(col, id) {
  if (!sb) return null;
  const sens = sensitiveFields(col);
  const columns = sens.length ? [...knownColumns(col), 'data'].filter(c => !sens.includes(c)).join(',') : '*';
  const { data, error } = await sb.from(col).select(columns).eq('id', id).maybeSingle();
  if (error) { console.warn(`[db] refetch ${col}/${id}:`, error.message); return null; }
  if (!data) return { gone: true };
  const rec = fromRow(data);
  if (sens.some(f => canSeeField(col, f))) {
    const { data: s } = await sb.from(`${col}_sensitive`).select('*').eq('id', id).maybeSingle();
    if (s) Object.assign(rec, s);
  }
  return { rec };
}
/** Record -> DB row: known fields become columns, everything else goes into the `data` jsonb column.
    Sensitive fields this person may not see are never sent, so their save cannot blank them. */
function toRow(col, rec) {
  const cols = knownColumns(col);
  const hidden = new Set(sensitiveFields(col).filter(f => !canSeeField(col, f)));
  const row = { data: {} };
  for (const [k, v] of Object.entries(rec)) {
    if (k === 'data' || hidden.has(k)) continue;
    if (cols.has(k)) row[k] = v === undefined ? null : v;
    else row.data[k] = v;
  }
  return row;
}
function fromRow(row) {
  const { data, ...rest } = row || {};
  return { ...(data && typeof data === 'object' ? data : {}), ...rest };
}

async function persist(col, rec, kind) {
  await idb.putRecord(col, rec);
  if (bc) bc.postMessage({ col, type: kind, rec });
  if (IS_SUPABASE() && sb) {
    try {
      const { error } = await sb.from(col).upsert(toRow(col, rec));
      if (error) throw error;
    } catch (e) {
      if (isNetworkError(e)) {
        await idb.outboxAdd({ kind: 'upsert', col, rec });
        store.set('pendingSync', (store.get('pendingSync') || 0) + 1);
      } else {
        // Server refused (RLS / constraint): roll the cache back and surface the error.
        throw new Error(`The server refused this change: ${e.message || e}`);
      }
    }
  }
}
async function persistMany(col, recs) {
  await idb.putRecords(col, recs);
  if (bc) bc.postMessage({ col, type: 'bulk', recs });
  if (IS_SUPABASE() && sb) {
    try { await sbUpsert(col, recs); } catch (e) {
      if (isNetworkError(e)) {
        for (const rec of recs) await idb.outboxAdd({ kind: 'upsert', col, rec });
        store.set('pendingSync', (store.get('pendingSync') || 0) + recs.length);
      } else {
        throw new Error(`The server refused this change: ${e.message || e}`);
      }
    }
  }
}
async function persistDelete(col, rec) {
  await idb.deleteRecord(col, rec.id);
  if (bc) bc.postMessage({ col, type: 'delete', rec });
  if (IS_SUPABASE() && sb) {
    try {
      const { error } = await sb.from(col).delete().eq('id', rec.id);
      if (error) throw error;
    } catch (e) {
      if (isNetworkError(e)) await idb.outboxAdd({ kind: 'delete', col, id: rec.id });
      else throw new Error(`The server refused this delete: ${e.message || e}`);
    }
  }
}
async function sbUpsert(col, recs) {
  for (let i = 0; i < recs.length; i += 500) {
    const { error } = await sb.from(col).upsert(recs.slice(i, i + 500).map(r => toRow(col, r)));
    if (error) throw new Error(`Import into ${col} failed: ${error.message}`);
  }
}
const isNetworkError = e => !navigator.onLine || /Failed to fetch|NetworkError|network|timeout/i.test(String((e && e.message) || e));

async function flushOutbox() {
  if (!sb) return;
  const ops = await idb.outboxAll();
  for (const { seq, op } of ops) {
    try {
      if (op.kind === 'upsert') { const { error } = await sb.from(op.col).upsert(toRow(op.col, op.rec)); if (error) throw error; }
      if (op.kind === 'delete') { const { error } = await sb.from(op.col).delete().eq('id', op.id); if (error) throw error; }
      await idb.outboxDelete(seq);
    } catch (e) { if (isNetworkError(e)) break; await idb.outboxDelete(seq); bus.emit('sync:error', { op, error: String(e.message || e) }); }
  }
  store.set('pendingSync', (await idb.outboxAll()).length);
}

function applyRemote({ col, type, rec, recs }) {
  if (col && type === 'bulk' && Array.isArray(recs)) {
    for (const r of recs) colMap(col).set(String(r.id), r);
    bus.emit(`db:${col}`, { col, type: 'bulk', count: recs.length, remote: true });
    bus.emit('db:change', { col, type: 'bulk', count: recs.length, remote: true });
    return;
  }
  if (!col || !rec) return;
  const prev = db.get(col, rec.id);
  if (type === 'delete' && !rec.deleted_at) colMap(col).delete(String(rec.id));
  else colMap(col).set(String(rec.id), rec);
  emit(col, type, rec, prev, true);
}

/* ------------------------------------------------------------------ audit */

function diff(prev, next) {
  const changes = {};
  const skip = new Set(['updated_at', 'updated_by', 'updated_by_name']);
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  for (const k of keys) {
    if (skip.has(k)) continue;
    const a = prev ? prev[k] : undefined, b = next ? next[k] : undefined;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[k] = [a ?? null, b ?? null];
  }
  return changes;
}
function audit(action, col, rec, prev) {
  if (AUDIT_EXEMPT.has(col)) return;
  const who = actor();
  const entry = {
    id: uid(), at: nowIso(), user_id: who.id, user_name: who.name, action, collection: col,
    record_id: (rec || prev || {}).id, label: (rec && rec._label) || db.label(col, rec || prev),
    changes: action === 'update' ? clone(diff(prev, rec)) : null
  };
  colMap('audit_log').set(entry.id, { ...entry, created_at: entry.at, created_by: who.id, created_by_name: who.name });
  // Local mode keeps the log in IndexedDB. In Supabase mode the authoritative log is written
  // server-side by the audit trigger (step 03, js__sql__schema.js) — users cannot forge or skip it.
  if (!IS_SUPABASE()) idb.putRecord('audit_log', entry);
  bus.emit('db:audit_log', { col: 'audit_log', type: 'insert', rec: entry });
}
