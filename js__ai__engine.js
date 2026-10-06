/* =============================================================================
   Sage AI — the question engine.
     1. extractEntities(): dates, months, amounts, clients, people, employees in plain
        South African business English ("last month", "Q3", "10 September", "R5k").
     2. rankSkills(): every registered skill scores the question (skills.js).
     3. answer(): runs the best skill on LIVE records. Nothing is invented — if no
        skill fits, it searches every record instead and says so.
   Pure functions take their data as arguments so they are testable in Node
   (tests__assistant.test.js); ask() wires them to the live database.
   ========================================================================== */

import { allSkills, keywordScore } from './skills.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON = MONTHS.map(m => m.slice(0, 3));
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const STOP = new Set('a an the and or of for to in on at by with from is are was were be been do does did what whats which who whom how many much show me my our us we i you it this that these those there their any all please tell give list find get can could would should will about per vs than then have has had into out up down over under between'.split(' '));
const FUTURE = /\b(next|upcoming|coming|planned|scheduled|due|will|forecast|predict)\b/;

/* ---------------- ISO date maths (UTC, no time zones) ---------------- */
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const D = iso => new Date(`${iso}T00:00:00Z`);
export const addDaysIso = (iso, n) => { const d = D(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
const monthKey = (y, m) => `${y}-${pad(m)}`; // m 1..12
const shiftMonth = (key, n) => { let [y, m] = key.split('-').map(Number); m += n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return monthKey(y, m); };
const monthEnd = key => { const [y, m] = key.split('-').map(Number); return isoOf(new Date(Date.UTC(y, m, 0))); };
const monthsBetween = (a, b) => { const out = []; for (let k = a; k <= b; k = shiftMonth(k, 1)) out.push(k); return out; };
const label = key => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`; };

/** Pull structured facts out of a question. */
export function extractEntities(query, { today = new Date().toISOString().slice(0, 10), clients = [], profiles = [], employees = [] } = {}) {
  const q = ` ${String(query || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ')} `;
  const thisMonth = today.slice(0, 7), year = Number(today.slice(0, 4));
  const future = FUTURE.test(q);
  const ents = { dates: null, months: [], amounts: [], clients: [], people: [], employees: [], words: [] };
  const setRange = (from, to, lbl) => { if (!ents.dates) ents.dates = { from, to, label: lbl }; };
  const setMonths = (keys, lbl) => { if (!ents.months.length) { ents.months = keys; setRange(`${keys[0]}-01`, monthEnd(keys.at(-1)), lbl || (keys.length === 1 ? label(keys[0]) : `${label(keys[0])} – ${label(keys.at(-1))}`)); } };

  // explicit dates: 2026-09-10 · 10/09/2026 · 10 September (2026) · September 10
  let m;
  if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(q))) setRange(m[0].trim(), m[0].trim(), m[0].trim());
  if ((m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(q))) { const iso = `${m[3]}-${pad(m[2])}-${pad(m[1])}`; setRange(iso, iso, iso); }
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join('|')}|${MON.join('|')})\\b\\.?(?:\\s+(\\d{4}))?`).exec(q) || null;
  const monthDay = new RegExp(`\\b(${MONTHS.join('|')}|${MON.join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*\\d{3})(?:,?\\s+(\\d{4}))?`).exec(q) || null;
  const pickYear = (mo, y) => (y ? Number(y) : !future && mo > Number(thisMonth.slice(5)) ? year - 1 : year);
  if (dayMonth) { const mo = MON.indexOf(dayMonth[2].slice(0, 3)) + 1; const iso = `${pickYear(mo, dayMonth[3])}-${pad(mo)}-${pad(dayMonth[1])}`; setRange(iso, iso, iso); }
  else if (monthDay && Number(monthDay[2]) <= 31) { const mo = MON.indexOf(monthDay[1].slice(0, 3)) + 1; const iso = `${pickYear(mo, monthDay[3])}-${pad(mo)}-${pad(monthDay[2])}`; setRange(iso, iso, iso); }

  // relative days / weeks
  if (/\btoday\b/.test(q)) setRange(today, today, 'today');
  if (/\btomorrow\b/.test(q)) { const t = addDaysIso(today, 1); setRange(t, t, 'tomorrow'); }
  if (/\byesterday\b/.test(q)) { const t = addDaysIso(today, -1); setRange(t, t, 'yesterday'); }
  const dow = D(today).getUTCDay(), monday = addDaysIso(today, -((dow + 6) % 7));
  if (/\bthis week\b/.test(q)) setRange(monday, addDaysIso(monday, 6), 'this week');
  if (/\bnext week\b/.test(q)) setRange(addDaysIso(monday, 7), addDaysIso(monday, 13), 'next week');
  if (/\b(last|previous) week\b/.test(q)) setRange(addDaysIso(monday, -7), addDaysIso(monday, -1), 'last week');
  if ((m = /\b(?:last|past|previous) (\d{1,3}) days\b/.exec(q))) setRange(addDaysIso(today, -Number(m[1]) + 1), today, `last ${m[1]} days`);
  if ((m = /\b(?:next|coming) (\d{1,3}) days\b/.exec(q))) setRange(today, addDaysIso(today, Number(m[1]) - 1), `next ${m[1]} days`);
  for (const [i, w] of WEEKDAYS.entries()) {
    if (new RegExp(`\\b(on |this |next )?${w}\\b`).test(q) && !ents.dates) { let d = (i - dow + 7) % 7; if (/\bnext /.test(q) && d === 0) d = 7; const t = addDaysIso(today, d); setRange(t, t, w[0].toUpperCase() + w.slice(1)); }
  }

  // months, quarters, years
  if (/\bthis month\b/.test(q)) setMonths([thisMonth], 'this month');
  if (/\b(last|previous) month\b/.test(q)) setMonths([shiftMonth(thisMonth, -1)], 'last month');
  if (/\bnext month\b/.test(q)) setMonths([shiftMonth(thisMonth, 1)], 'next month');
  if ((m = /\b(?:last|past|previous) (\d{1,2}) months\b/.exec(q))) setMonths(monthsBetween(shiftMonth(thisMonth, -Number(m[1]) + 1), thisMonth), `last ${m[1]} months`);
  if ((m = /\bq([1-4])(?:\s*(\d{4}))?\b/.exec(q))) { const y = m[2] ? Number(m[2]) : year; const s = (Number(m[1]) - 1) * 3 + 1; setMonths([monthKey(y, s), monthKey(y, s + 1), monthKey(y, s + 2)], `Q${m[1]} ${y}`); }
  // "may" is only the month after in/for/during/… or before a year ("may I see…" is not May)
  const named = [...q.matchAll(new RegExp(`\\b(${MONTHS.join('|')}|${MON.filter(x => x !== 'may' && x !== 'mar').join('|')})\\b(?:\\s+(\\d{4}))?`, 'g'))]
    .filter(x => x[1] !== 'may' || x[2] || /\b(in|for|during|of|since|until|from|by|and|to|through)\s+$/.test(q.slice(0, x.index)));
  if (named.length && !ents.months.length) {
    const keys = [...new Set(named.map(x => { const mo = MON.indexOf(x[1].slice(0, 3)) + 1; return monthKey(pickYear(mo, x[2]), mo); }))].sort();
    ents.months = keys;
    if (!ents.dates) setRange(`${keys[0]}-01`, monthEnd(keys.at(-1)), keys.length === 1 ? label(keys[0]) : keys.map(label).join(', '));
  }
  if (/\bthis year\b|\bytd\b|year to date/.test(q)) setMonths(monthsBetween(`${year}-01`, thisMonth), `${year} to date`);
  if (/\blast year\b/.test(q)) setMonths(monthsBetween(`${year - 1}-01`, `${year - 1}-12`), String(year - 1));
  if ((m = /\b(?:in|during|for) (20\d{2})\b/.exec(q)) && !ents.months.length) setMonths(monthsBetween(`${m[1]}-01`, `${m[1]}-12`), m[1]);
  if (!ents.months.length && ents.dates && ents.dates.from.slice(0, 7) === ents.dates.to.slice(0, 7)) ents.months = [ents.dates.from.slice(0, 7)];

  // amounts: R5 000 · R5,000.50 · 5k · 1.2m
  for (const x of q.matchAll(/\br\s?(\d[\d ,]*(?:\.\d+)?)(\s?[km])?\b|\b(\d+(?:\.\d+)?)\s?([km])\b/g)) {
    const raw = (x[1] || x[3]).replace(/[ ,]/g, ''); const mult = /k/.test(x[2] || x[4] || '') ? 1e3 : /m/.test(x[2] || x[4] || '') ? 1e6 : 1;
    const n = Number(raw) * mult; if (Number.isFinite(n)) ents.amounts.push(n);
  }

  // people & clients: whole-name matches first, then distinctive single words
  const words = q.match(/[a-z][a-z'-]+/g) || [];
  ents.words = words.filter(w => !STOP.has(w) && w.length > 1);
  const nameHit = name => { const n = String(name || '').toLowerCase().trim(); if (n.length < 3) return 0; if (q.includes(` ${n} `) || q.includes(` ${n}'`) || q.includes(` ${n}?`) || q.includes(` ${n},`) || q.includes(` ${n}.`)) return 2 + n.length / 100; return 0; };
  const tokenHit = name => { const toks = String(name || '').toLowerCase().split(/[^a-z']+/).filter(t => t.length >= 5 && !STOP.has(t) && !['estate', 'garden', 'gardens', 'place', 'road', 'street', 'park', 'office', 'house', 'lodge', 'village', 'manor', 'court', 'complex', 'body', 'corporate', 'trust', 'group', 'agency', 'property', 'properties', 'services', 'holdings'].includes(t)); return toks.some(t => words.includes(t)) ? 1 : 0; };
  // aliases = names the client is known by elsewhere (site / complex names, names on invoices & quotes)
  const scored = clients.map(c => ({ id: c.id, s: Math.max(nameHit(c.name), nameHit(c.trading_name), ...(c.aliases || []).map(a => nameHit(a) * 0.98), tokenHit(c.name) * 0.9) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  const top = scored.length ? scored[0].s : 0;
  ents.clients = scored.filter(x => x.s >= Math.min(top, 1.9) || x.s === top).slice(0, 5).map(x => x.id);
  ents.people = profiles.filter(p => { const first = String(p.name || '').split(' ')[0]; return nameHit(p.name) || (first.length >= 3 && words.includes(first.toLowerCase())); }).map(p => p.id);
  ents.employees = employees.filter(e => { const full = e.full_name || e.name || `${e.first_name || ''} ${e.last_name || ''}`.trim(); const first = (e.first_name || full.split(' ')[0] || '').toLowerCase(); return nameHit(full) || (first.length >= 3 && words.includes(first)); }).map(e => e.id);
  return ents;
}

/** Score every skill; best first. */
export function rankSkills(query, ents, skills = allSkills()) {
  return skills.map(s => { let score = 0; try { score = s.match ? Number(s.match(query, ents)) || 0 : keywordScore(s, query); } catch { score = 0; } return { skill: s, score }; })
    .filter(x => x.score > 0).sort((a, b) => b.score - a.score);
}

export const THRESHOLD = 0.4;
/** Run the best skill; fall back to record search. deps: { skills, search, today, clients, profiles, employees } */
export async function answer(query, deps = {}) {
  const q = String(query || '').trim();
  const ents = extractEntities(q, deps);
  const ranked = rankSkills(q, ents, deps.skills || allSkills());
  const best = ranked[0];
  const alternatives = ranked.slice(1, 4).filter(x => x.score >= 0.25).map(x => ({ id: x.skill.id, label: x.skill.label, example: (x.skill.examples || [])[0] }));
  if (best && best.score >= (deps.threshold ?? THRESHOLD) * 0.6) {
    try {
      const res = await best.skill.run(q, ents, deps.ctx || {});
      if (res && (res.text || (res.cards && res.cards.length))) return { ...res, skill: best.skill.id, skillLabel: best.skill.label, confidence: res.confidence ?? Math.min(1, best.score), lowConfidence: best.score < (deps.threshold ?? THRESHOLD), alternatives, ents };
    } catch (e) {
      return { text: `I found the right place to look (${best.skill.label}) but it failed: ${e.message}`, error: true, skill: best.skill.id, alternatives, ents };
    }
  }
  const hits = deps.search ? deps.search(q, { limit: 8 }).filter(r => r.href) : [];
  if (hits.length) return { text: `I don't have a ready answer for that, but these records match “${q}”:`, cards: [{ type: 'list', items: hits.map(r => ({ title: r.title, sub: `${r.group}${r.sub ? ' · ' + r.sub : ''}`, href: r.href, icon: r.icon })) }], skill: 'search', confidence: 0.3, alternatives, ents, fallback: true };
  return { text: 'I couldn’t find anything for that in the company’s records. Try one of the suggestions below, or rephrase with a client name, a month or a document type.', skill: null, confidence: 0, alternatives: alternatives.length ? alternatives : suggestions(deps.skills || allSkills(), 4).map(s => ({ id: s.id, label: s.label, example: s.example })), ents, fallback: true };
}

/** Example questions to show as chips (one per skill, varied apps). */
export function suggestions(skills = allSkills(), n = 6, seed = 0) {
  const byApp = new Map();
  for (const s of skills) if ((s.examples || []).length && !byApp.has(s.app)) byApp.set(s.app, s);
  const list = [...byApp.values()];
  const start = list.length ? seed % list.length : 0;
  return [...list.slice(start), ...list.slice(0, start)].slice(0, n).map(s => ({ id: s.id, label: s.label, example: s.examples[0] }));
}

/** Wire to the live database (browser). */
export async function ask(query, extra = {}) {
  const [{ db }, { search }, { today }] = await Promise.all([import('../core/db.js'), import('../core/search.js'), import('../core/dates.js')]);
  const aliases = new Map();
  const add = (id, name) => { if (!id || !name) return; const n = String(name).trim(); if (n.length < 3) return; if (!aliases.has(id)) aliases.set(id, new Set()); aliases.get(id).add(n); };
  db.all('sites').forEach(s => { add(s.client_id, s.name); add(s.client_id, s.complex_name); });
  db.all('invoices').forEach(i => add(i.client_id, i.client_name));
  db.all('quotes').forEach(q => add(q.client_id, q.client_name));
  const clients = db.all('clients').map(c => ({ id: c.id, name: c.name, trading_name: c.trading_name, aliases: [...(aliases.get(c.id) || [])].filter(a => a !== c.name) }));
  return answer(query, { today: today(), clients, profiles: db.all('profiles'), employees: db.all('employees'), search, ...extra });
}
