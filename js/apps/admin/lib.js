/* =============================================================================
   Admin — pure helper logic (no DOM, no db). Unit tested by tests/admin.test.js.
   Duplicate detection, CSV parsing, column auto-mapping, role-matrix merging,
   backup-staleness and a SA ID test-number generator for the System self-tests.
   ========================================================================== */

/** Lowercase, strip accents/punctuation, collapse whitespace — for fuzzy matching. */
export function normText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
/** Digits only, with a leading +27 rewritten to a local 0 so both formats compare equal. */
export function normPhoneDigits(v) {
  let s = String(v || '').replace(/[^\d]/g, '');
  if (s.startsWith('0027')) s = '0' + s.slice(4);
  else if (s.startsWith('27') && s.length === 11) s = '0' + s.slice(2);
  return s;
}
export function normEmail(v) { return String(v || '').trim().toLowerCase(); }

/**
 * Group records that share a normalised name, phone or email.
 * records: plain objects. Returns [{ key, field, records:[...] }], de-duplicated by record-id set.
 */
export function duplicateGroups(records, { nameField = 'name', phoneField = 'phone', emailField = 'email' } = {}) {
  const byKey = new Map();
  const add = (key, field, rec) => {
    if (!key) return;
    const k = field + ':' + key;
    if (!byKey.has(k)) byKey.set(k, { key, field, records: [] });
    byKey.get(k).records.push(rec);
  };
  for (const r of records) {
    const n = normText(r[nameField]);
    const p = normPhoneDigits(r[phoneField]);
    const e = normEmail(r[emailField]);
    if (n) add(n, 'name', r);
    if (p && p.length >= 9) add(p, 'phone', r);
    if (e) add(e, 'email', r);
  }
  const seenIdSets = new Set();
  const groups = [];
  for (const g of byKey.values()) {
    if (g.records.length < 2) continue;
    const sig = g.records.map(r => r.id).sort().join(',');
    if (seenIdSets.has(sig)) continue;
    seenIdSets.add(sig);
    groups.push(g);
  }
  return groups.sort((a, b) => b.records.length - a.records.length);
}

/** "Employee no" -> "employee no" -> "employee_no" — comparable slug. */
export function slugField(s) { return normText(s).replace(/\s+/g, '_'); }

/** Best schema field for one CSV/XLSX header, or null if nothing scores well enough. */
export function bestFieldMatch(header, fieldDefs) {
  const h = slugField(header);
  if (!h) return null;
  let best = null, bestScore = 0;
  for (const f of fieldDefs) {
    const k = slugField(f.key), l = slugField(f.label || f.key);
    let score = 0;
    if (h === k || h === l) score = 100;
    else if (k === h.replace(/_/g, '') || l === h.replace(/_/g, '')) score = 95;
    else if (k.includes(h) || h.includes(k) || l.includes(h) || h.includes(l)) score = 70;
    else {
      const hw = new Set(h.split('_')), lw = l.split('_');
      const overlap = lw.filter(w => hw.has(w)).length;
      if (overlap) score = Math.max(score, 35 + overlap * 15);
    }
    if (score > bestScore) { bestScore = score; best = f.key; }
  }
  return bestScore >= 45 ? best : null;
}

/** Auto-map every CSV header to a schema field, each field used at most once. */
export function autoMapColumns(headers, fieldDefs) {
  const used = new Set();
  const map = {};
  // Pass 1: exact/near-exact matches claim their field first so a weaker header
  // further along the row can't steal a field an earlier header matched better.
  const scored = headers.map(h => ({ h, best: bestFieldMatch(h, fieldDefs) }));
  for (const { h, best } of scored) {
    if (best && !used.has(best)) { map[h] = best; used.add(best); }
  }
  for (const { h } of scored) {
    if (map[h] !== undefined) continue;
    const m = bestFieldMatch(h, fieldDefs.filter(f => !used.has(f.key)));
    map[h] = m || null;
    if (m) used.add(m);
  }
  return map;
}

/** Merge a partial role-matrix edit into the last-saved one without losing untouched entries. */
export function mergeRoleMatrix(base = {}, patch = {}) {
  const collections = { ...((base && base.collections) || {}) };
  for (const [col, v] of Object.entries((patch && patch.collections) || {})) {
    collections[col] = { ...(collections[col] || {}), ...v };
  }
  return { apps: { ...((base && base.apps) || {}), ...((patch && patch.apps) || {}) }, collections };
}

/** Minimal RFC4180 CSV parser (quoted fields, escaped quotes, CRLF/LF). */
export function parseCSV(text) {
  const s = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') endField();
    else if (c === '\n') endRow();
    else field += c;
  }
  if (field !== '' || row.length) endRow();
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map(h => String(h || '').trim());
  const out = rows.slice(1).filter(r => r.some(v => String(v ?? '').trim() !== '')).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  return { headers, rows: out };
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
export function sortBySeverity(list) { return [...list].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)); }

/** Whole days between two 'YYYY-MM-DD' strings (b - a). */
export function daysBetween(aIso, bIso) {
  return Math.round((new Date(bIso + 'T00:00:00') - new Date(aIso + 'T00:00:00')) / 86400000);
}
/** Backup reminder: null when recent enough, else { severity, days, message }. */
export function backupAlert(lastBackupIso, todayIso) {
  if (!lastBackupIso) return { severity: 'danger', days: null, message: 'No backup has ever been taken.' };
  const days = daysBetween(lastBackupIso, todayIso);
  if (days > 14) return { severity: 'danger', days, message: `Last backup was ${days} days ago.` };
  if (days > 7) return { severity: 'warn', days, message: `Last backup was ${days} days ago.` };
  return null;
}

/**
 * Given a 12-digit prefix, returns the 13th (Luhn) check digit so the full
 * string passes core/validate.js's luhnValid — used to build SYNTHETIC SA ID
 * test numbers for the System self-tests without touching a real identity.
 */
export function computeSaIdCheckDigit(twelveDigits) {
  const provisional = String(twelveDigits) + '0';
  let sum = 0, alt = false;
  for (let i = provisional.length - 1; i >= 0; i--) {
    let n = +provisional[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return String((10 - (sum % 10)) % 10);
}

/** Flatten every ref/refs field across the schema into [{col, id, field, ref, value}] for orphan scanning. */
export function refPointers(schema, recordsByCol) {
  const out = [];
  for (const [col, def] of Object.entries(schema)) {
    const recs = recordsByCol[col] || [];
    for (const [name, f] of Object.entries(def.fields || {})) {
      if (f.type !== 'ref' && f.type !== 'refs') continue;
      for (const rec of recs) {
        const v = rec[name];
        if (f.type === 'ref' && v) out.push({ col, id: rec.id, field: name, ref: f.ref, value: v });
        if (f.type === 'refs' && Array.isArray(v)) for (const one of v) if (one) out.push({ col, id: rec.id, field: name, ref: f.ref, value: one });
      }
    }
  }
  return out;
}
/** Pointers whose target record does not exist (or is a different collection's live set). */
export function findOrphans(pointers, existsFn) {
  return pointers.filter(p => !existsFn(p.ref, p.value));
}

/** A short, memorable one-time password: 3 words + 2 digits — meets the app's password rules. */
const WORDS = ['forest', 'garden', 'cedar', 'maple', 'willow', 'harbour', 'meadow', 'granite', 'copper', 'amber', 'lagoon', 'summit', 'canyon', 'orchid', 'thicket', 'lantern'];
export function generateTempPassword(rand = Math.random) {
  const pick = () => WORDS[Math.floor(rand() * WORDS.length)];
  const digits = String(Math.floor(rand() * 90) + 10);
  return `${pick()}-${pick()}-${digits}`;
}
