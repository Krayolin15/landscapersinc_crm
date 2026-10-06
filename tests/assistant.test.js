// Sage AI engine tests:  node tests/assistant.test.js
import assert from 'node:assert/strict';
import { extractEntities, rankSkills, answer, suggestions, addDaysIso } from '../js/ai/engine.js';

let passed = 0, failed = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const TODAY = '2026-09-29'; // a Tuesday
const DATA = {
  today: TODAY,
  clients: [{ id: 'c1', name: 'Carron Glen Estate' }, { id: 'c2', name: 'Carron Glen - Linda' }, { id: 'c3', name: 'Reach Park' }, { id: 'c4', name: 'Brenton Naidoo' }],
  profiles: [{ id: 'p1', name: 'Jared Emmanuel Naidoo' }, { id: 'p2', name: 'Wayne' }],
  employees: [{ id: 'e1', full_name: 'Stanford Simtembile Bengu', first_name: 'Stanford' }]
};
const E = q => extractEntities(q, DATA);

t('relative days and weeks', () => {
  assert.deepEqual(E('what is on today').dates, { from: TODAY, to: TODAY, label: 'today' });
  assert.equal(E('jobs tomorrow').dates.from, '2026-09-30');
  assert.deepEqual([E('visits this week').dates.from, E('visits this week').dates.to], ['2026-09-28', '2026-10-04']);
  assert.equal(E('what happened last week').dates.from, '2026-09-21');
  assert.equal(E('on friday').dates.from, '2026-10-02');
  assert.equal(E('last 7 days').dates.from, '2026-09-23');
});
t('explicit dates (Wayne adds a meeting on 10 September)', () => {
  assert.equal(E('what did Wayne add on 10 September').dates.from, '2026-09-10');
  assert.equal(E('meeting september 10 at 10am').dates.from, '2026-09-10');
  assert.equal(E('invoices on 2026-07-01').dates.from, '2026-07-01');
  assert.equal(E('due 05/10/2026').dates.from, '2026-10-05');
});
t('months, quarters, years', () => {
  assert.deepEqual(E('revenue this month').months, ['2026-09']);
  assert.deepEqual(E('expenses last month').months, ['2026-08']);
  assert.deepEqual(E('revenue in july').months, ['2026-07']);
  assert.deepEqual(E('compare july and august').months, ['2026-07', '2026-08']);
  assert.deepEqual(E('revenue in december').months, ['2025-12'], 'a past-tense month later than now means last year');
  assert.deepEqual(E('what is planned for december').months, ['2026-12'], 'future wording keeps this year');
  assert.deepEqual(E('Q3 revenue').months, ['2026-07', '2026-08', '2026-09']);
  assert.equal(E('profit this year').months.length, 9);
  assert.deepEqual(E('last 3 months').months, ['2026-07', '2026-08', '2026-09']);
  assert.deepEqual(E('may i see the invoices').months, [], '"may" the verb is not the month');
});
t('amounts', () => { assert.deepEqual(E('invoices over R5 000').amounts, [5000]); assert.deepEqual(E('quotes above 12k').amounts, [12000]); assert.deepEqual(E('R2,521.26 payment').amounts, [2521.26]); });
t('clients, people, employees', () => {
  assert.deepEqual(E('how much does Reach Park owe').clients, ['c3']);
  assert.deepEqual(E('carron glen invoices').clients.sort(), ['c1', 'c2']);
  assert.deepEqual(E('what did wayne add').people, ['p2']);
  assert.deepEqual(E('is stanford certified').employees, ['e1']);
  assert.deepEqual(E('brenton naidoo balance').clients, ['c4']);
});
const SKILLS = [
  { id: 'debtors', app: 'invoices', label: 'Who owes us', keywords: ['owe', 'owing', 'outstanding', 'debtor'], examples: ['who owes us money'], run: (q, ents) => ({ text: `debtors ${ents.clients.join(',')}` }) },
  { id: 'revenue', app: 'finance', label: 'Revenue', keywords: ['revenue', 'income', 'turnover'], examples: ['revenue this month'], run: (q, ents) => ({ text: `revenue ${ents.months.join(',')}` }) },
  { id: 'boom', app: 'x', label: 'Broken', keywords: ['explode'], examples: ['explode now'], run: () => { throw new Error('kaput'); } }
];
t('ranking picks the right skill', () => { const r = rankSkills('who owes us money', E('who owes us money'), SKILLS); assert.equal(r[0].skill.id, 'debtors'); });
t('answer runs the skill with entities', async () => { const a = await answer('what was revenue in july', { ...DATA, skills: SKILLS }); assert.equal(a.skill, 'revenue'); assert.equal(a.text, 'revenue 2026-07'); });
t('a failing skill reports its error instead of inventing', async () => { const a = await answer('explode now', { ...DATA, skills: SKILLS }); assert.ok(a.error); assert.match(a.text, /kaput/); });
t('no skill -> record search fallback', async () => { const a = await answer('palm trimming', { ...DATA, skills: SKILLS, search: () => [{ title: 'Palm tree trimming', group: 'Quotes', href: '#/record/quotes/q1', icon: 'x' }] }); assert.equal(a.skill, 'search'); assert.equal(a.cards[0].items.length, 1); });
t('nothing at all -> honest "not found"', async () => { const a = await answer('zzqx', { ...DATA, skills: SKILLS, search: () => [] }); assert.equal(a.skill, null); assert.match(a.text, /couldn’t find/); });
t('suggestions: one per app', () => { const s = suggestions(SKILLS, 5); assert.equal(new Set(s.map(x => x.id)).size, s.length); });
t('date helper', () => assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01'));

for (const [name, fn] of tests) { try { await fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
