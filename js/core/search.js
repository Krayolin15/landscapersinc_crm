/* =============================================================================
   Global search — apps, quick actions and every record the user may read.
   Scoring: exact > prefix > word-prefix > contains; typo-tolerant for short
   queries via a simple edit-distance check on titles.
   ========================================================================== */

import { db } from './db.js';
import { store } from './bus.js';
import { SCHEMA } from './schema.js';
import { can, canApp } from './perms.js';
import { APPS } from '../apps/registry.js';

const SKIP = new Set(['audit_log', 'notifications', 'mail_flags', 'predictions', 'chat_reads', 'settings', 'ml_models', 'ai_conversations', 'comments']);
const actions = [];

/** Apps can register quick actions: { id, label, icon, keywords, run() , app } */
export function registerAction(a) { if (!actions.some(x => x.id === a.id)) actions.push(a); }
export function allActions() { return actions.filter(a => !a.app || canApp(a.app)); }

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function score(q, title, hay) {
  const t = String(title || '').toLowerCase();
  if (!t && !hay) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.split(/[\s\-_/().,]+/).some(w => w.startsWith(q))) return 65;
  if (t.includes(q)) return 50;
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length > 1 && terms.every(x => hay.includes(x))) return 40;
  if (hay.includes(q)) return 30;
  if (q.length >= 4 && t.split(/\s+/).some(w => lev(w.slice(0, q.length + 1), q) <= 1)) return 20;
  return 0;
}

/**
 * search(query, { limit=40 }) -> [{ group, title, sub, icon, tile, href | run, score }]
 */
export function search(query, { limit = 40 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const a of APPS) {
    if (!canApp(a.id)) continue;
    const s = score(q, a.name, `${a.name} ${a.desc} ${a.keywords}`.toLowerCase());
    if (s) out.push({ group: 'Apps', title: a.name, sub: a.desc, icon: a.icon, tile: a.tile, href: `#/${a.id}`, score: s + 10 });
  }
  for (const a of allActions()) {
    const s = score(q, a.label, `${a.label} ${a.keywords || ''}`.toLowerCase());
    if (s) out.push({ group: 'Actions', title: a.label, sub: a.sub || '', icon: a.icon || 'zap', tile: 't-violet', run: a.run, score: s + 5 });
  }
  for (const [col, def] of Object.entries(SCHEMA)) {
    if (SKIP.has(col) || !can('read', col)) continue;
    const keys = def.search || Object.entries(def.fields).filter(([, f]) => ['text', 'email', 'phone'].includes(f.type)).map(([k]) => k).slice(0, 5);
    for (const r of db.all(col)) {
      if (col === 'notes' && r.shared === false && r.created_by !== (store.get('user') || {}).id) continue;
      if (col === 'events' && r.visibility === 'private' && r.created_by !== (store.get('user') || {}).id) continue;
      const title = db.label(col, r);
      const hay = keys.map(k => (Array.isArray(r[k]) ? r[k].join(' ') : r[k] ?? '')).join(' ').toLowerCase();
      const s = score(q, title, hay + ' ' + String(title).toLowerCase());
      if (s) out.push({ group: def.label, title, sub: def.subtitle ? def.subtitle(r) : def.singular, icon: def.icon, tile: def.tile || 't-slate', href: `#/record/${col}/${encodeURIComponent(r.id)}`, score: s, col, id: r.id });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
