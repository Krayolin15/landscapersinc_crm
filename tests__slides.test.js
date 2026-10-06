// Slides helper tests:  node tests__slides.test.js
import assert from 'node:assert/strict';
import { parseBody, parseStats, parseTable, normaliseDeck, blankSlide, deckFromQuote, deckMonthly, deckFromTalk, deckCompanyProfile, wordCount } from '../js__apps__slides__lib.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };
const CO = { trading_name: 'Landscapers Inc', tagline: 'Structured. Reliable.', positioning: 'Estate landscaping; Office park maintenance', phone: '069 131 5387', email: 'Sales@landscapersinc.co.za', deposit_pct: 50, quote_valid_days: 30, bbbee_level: '1', address: 'Block 1B Kingfisher Office Park, 28-30 Siphosethu Road, Mount Edgecombe, Kwa-Zulu Natal, 4300' };

t('body bullets, levels, plain lines', () => assert.deepEqual(parseBody('- One\n  - Two\n\nPlain  \n* Three'), [{ type: 'bullet', level: 1, text: 'One' }, { type: 'bullet', level: 2, text: 'Two' }, { type: 'text', level: 0, text: 'Plain' }, { type: 'bullet', level: 1, text: 'Three' }]));
t('stats and tables', () => { assert.deepEqual(parseStats('R 5 | Revenue\n12|Visits'), [{ value: 'R 5', label: 'Revenue' }, { value: '12', label: 'Visits' }]); assert.deepEqual(parseTable('A | B\n1 | 2'), [['A', 'B'], ['1', '2']]); });
t('normalise repairs ids and layouts', () => { const d = normaliseDeck([{ id: 'x', layout: 'weird', title: 5 }, { id: 'x' }]); assert.equal(d[0].layout, 'content'); assert.equal(d[0].title, '5'); assert.notEqual(d[0].id, d[1].id); assert.equal(normaliseDeck([]).length, 1); });
t('proposal from a quote with lines keeps every line and the recorded total', () => {
  const q = { id: 'q1', title: 'Rehabilitation', client_name: 'Carron Glen Estate', lines: [{ description: 'Perimeter clean-up', qty: 1, unit_price: 5500, amount: 5500 }, { description: 'Palm | trimming', qty: 2, unit_price: 1000, amount: 2000 }], discount: 7500, total: 0 };
  const d = deckFromQuote(q, { company: CO, services: ['Mowing', 'Hedging'] });
  const table = d.find(s => s.layout === 'table'); assert.equal(parseTable(table.body).length, 3); assert.ok(table.body.includes('Palm / trimming'));
  const stats = parseStats(d.find(s => s.layout === 'stats').body); assert.equal(stats.find(s => /Total/.test(s.label)).value, 'R0.00'); assert.ok(stats.some(s => s.label === 'Discount'));
  assert.ok(d[0].subtitle.includes('Carron Glen Estate')); assert.ok(d.at(-1).body.includes('50% deposit'));
});
t('proposal from a quote without lines', () => { const d = deckFromQuote({ title: 'Garden maintenance', total: 2250, client_name: 'Loshini' }, { company: CO }); assert.ok(!d.some(s => s.layout === 'table')); assert.equal(parseStats(d.find(s => s.layout === 'stats').body)[0].value, 'R2,250.00'); });
t('monthly review uses the figures given', () => { const d = deckMonthly({ month: '2026-09', monthLabel: 'September 2026', invoiced: 30000, received: 20000, expenses: 21624.25, visitsDone: 40, visitsPlanned: 12, newLeads: 3, overdue: 2, topClients: [{ name: 'A', count: 2, total: 5000 }], expenseByCat: [] }, CO); const s = parseStats(d[1].body); assert.equal(s[3].value, 'R8,375.75'); assert.equal(d.filter(x => x.layout === 'table').length, 1); });
t('toolbox talk topics become slides', () => { const d = deckFromTalk({ topic: 'General Landscaping Safety', presenter: 'A.S. Guruvadu', date: '2026-07-13', notes: 'Site: Carron Glen. Topics: Daily Safety Checklist; Mandatory PPE; Common Landscaping Hazards. Signed.' }); assert.equal(d.filter(s => s.layout === 'section').length, 3); assert.ok(d[1].body.includes('- Mandatory PPE')); });
t('company profile pairs service categories', () => { const d = deckCompanyProfile(CO, { Lawn: ['Mowing'], Trees: ['Felling'], Clean: ['Refuse'] }); assert.equal(d.filter(s => s.layout === 'two').length, 2); assert.ok(d.at(-1).body.includes('069 131 5387')); });
t('word count', () => assert.equal(wordCount(blankSlide('content', { title: 'Hello world', body: '- a b' })), 4));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
