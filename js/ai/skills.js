/* =============================================================================
   Sage AI — skills registry.

   Apps teach the assistant how to answer questions about their data. Answers
   are ALWAYS computed from live records (never invented). Each skill:

   registerSkill({
     id: 'debtors', app: 'payments', label: 'Who owes us money',
     examples: ['who owes us money?', 'outstanding invoices', 'debtors over 30 days'],
     keywords: ['owe', 'owing', 'outstanding', 'debtor', 'unpaid', 'overdue'],
     match(query, ents) -> number 0..1   (optional; default = keyword overlap)
     run(query, ents, ctx) -> Promise<Answer> | Answer
   })

   ents (entities extracted by the engine): { dates:{from,to,label}, clients:[ids], people:[profile ids],
     employees:[ids], amounts:[numbers], months:['2026-07'], words:[...] }

   Answer = {
     text: 'Plain-language answer (1–4 sentences, numbers formatted).',
     cards?: [ { type:'kpis', items:[{label, value, format:'money'|'num'|'pct'}] }
             | { type:'table', columns:[{key,label,format}], rows:[{...}], link?(row) }
             | { type:'list', items:[{title, sub, href, icon}] }
             | { type:'chart', chart:{ type, labels, series:[{label,data}] , money } } ],
     actions?: [ { label, href } | { label, action:'create', collection, values } ],
     sources?: ['clients', 'invoices']      // which collections the answer used
     confidence?: 0..1
   }
   ========================================================================== */

import { canApp } from '../core/perms.js';

const skills = new Map();
export function registerSkill(s) { skills.set(s.id, s); }
export function allSkills() { return Array.from(skills.values()).filter(s => !s.app || canApp(s.app)); }
export function getSkill(id) { return skills.get(id); }

// words that say nothing about WHICH data is wanted — never count them as evidence
const COMMON = new Set('what which when where whom whose have this that these those with from much many show does done there their about your will were been into over under some most more less than then them they just like want need know tell give list find made also only very each every other same would could should being after before while please much here doing going'.split(' '));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word (plural-tolerant) test: "owe" matches "owe"/"owes", not "however". */
export function hasWord(text, k) {
  const kk = String(k).toLowerCase().trim();
  return !!kk && new RegExp(`(^|[^a-z0-9])${esc(kk)}(s|es)?([^a-z0-9]|$)`).test(text);
}
/** Default matcher: share of the skill's keywords present in the question (+ example overlap). */
export function keywordScore(skill, q) {
  const text = ` ${String(q).toLowerCase().replace(/[’]/g, "'")} `;
  const kws = skill.keywords || [];
  if (!kws.length) return 0;
  const hits = kws.filter(k => hasWord(text, k)).length;
  let s = hits ? Math.min(1, 0.45 + hits * 0.2) : 0;
  for (const ex of skill.examples || []) {
    const words = ex.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !COMMON.has(w));
    const overlap = words.filter(w => hasWord(text, w)).length;
    if (words.length) s = Math.max(s, (overlap / words.length) * 0.9);
  }
  return s;
}
