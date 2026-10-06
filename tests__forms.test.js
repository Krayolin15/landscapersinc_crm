// Forms logic tests:  node tests__forms.test.js
import assert from 'node:assert/strict';
import { visibleQuestions, validateAnswers, summarise, worstRisk, canReadResponse, seesAllResponses, duplicateLabels, uniqueLabels, fillQuestions, incidentFromResponse, incidentType } from '../js__apps__forms__logic.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };
const Q = [
  { id: 'a', type: 'yesno', label: 'Anyone injured?', required: true },
  { id: 'b', type: 'paragraph', label: 'Describe the injury', required: true, show_if: { question: 'a', equals: 'Yes' } },
  { id: 'c', type: 'number', label: 'People involved', min: 1, max: 20 },
  { id: 'g', type: 'grid', label: 'Checks', rows: ['Hoses labelled', 'Storage demarcated'], columns: ['Jan', 'Feb'], scale: { options: ['1', '2', '3', '4', '5'] }, required: true },
  { id: 'reg', type: 'grid', label: 'Register', rows: ['1', '2'], columns: ['Asset #', 'Location'], scale: { options: [] } }
];

t('conditional question hidden until its trigger', () => { assert.equal(visibleQuestions(Q, { a: 'No' }).length, 4); assert.equal(visibleQuestions(Q, { a: 'Yes' }).length, 5); });
t('required + conditional required', () => { const v = validateAnswers(Q, { a: 'Yes', g: { 'Hoses labelled': { Jan: 1 }, 'Storage demarcated': { Jan: 2 } } }); assert.ok(!v.ok); assert.ok(v.errors.b); assert.ok(!v.errors.a); });
t('hidden required question is not enforced', () => assert.ok(validateAnswers(Q, { a: 'No', g: { 'Hoses labelled': { Jan: 1 }, 'Storage demarcated': { Jan: 1 } } }).ok));
t('number range', () => assert.equal(validateAnswers(Q, { a: 'No', c: 50, g: { 'Hoses labelled': { Jan: 1 }, 'Storage demarcated': { Jan: 1 } } }).errors.c, 'Must be at most 20'));
t('grid rows must all be completed when required', () => assert.equal(validateAnswers(Q, { a: 'No', g: { 'Hoses labelled': { Jan: 1 } } }).errors.g, '1 row(s) not completed'));
t('summary counts + risk flags', () => {
  const s = summarise(Q, [{ answers: { a: 'Yes', c: 2, g: { 'Hoses labelled': { Jan: 4 } } } }, { answers: { a: 'No', c: 4, g: { 'Hoses labelled': { Jan: 1 } } } }]);
  assert.deepEqual(s.find(x => x.id === 'a').counts, { Yes: 1, No: 1 }); assert.equal(s.find(x => x.id === 'c').avg, 3); assert.deepEqual(s.find(x => x.id === 'g').flagged, { 'Hoses labelled': 4 });
});
t('free-text register grids are not scored as risk', () => { assert.equal(worstRisk(Q, { reg: { 1: { 'Asset #': '5' } } }), null); assert.equal(summarise(Q, [{ answers: { reg: { 1: { 'Asset #': '9' } } } }]).find(s => s.id === 'reg').flagged, undefined); });
t('worst risk', () => { assert.equal(worstRisk(Q, { g: { x: { Jan: 2, Feb: 5 } } }), 5); assert.equal(worstRisk(Q, {}), null); });

// confidentiality (mirrors the form_responses policies in js__sql__schema.js)
t('HR responses: submitter, manager and HR only', () => {
  const r = { form_category: 'hr', created_by: 'u-sam' };
  assert.ok(canReadResponse(r, { id: 'u-sam', role: 'field' }));
  assert.ok(canReadResponse(r, { id: 'u-x', role: 'hr' }));
  assert.ok(canReadResponse(r, { id: 'u-x', role: 'manager' }));
  assert.ok(canReadResponse(r, { id: 'u-x', role: 'owner' }));
  assert.ok(!canReadResponse(r, { id: 'u-x', role: 'operations' }));
  assert.ok(!canReadResponse(r, { id: 'u-x', role: 'sales' }));
  assert.ok(!canReadResponse(r, undefined));
});
t('incident responses add operations; ordinary forms are open', () => {
  assert.ok(canReadResponse({ form_category: 'incident', created_by: 'a' }, { id: 'b', role: 'operations' }));
  assert.ok(!canReadResponse({ form_category: 'incident', created_by: 'a' }, { id: 'b', role: 'finance' }));
  assert.ok(canReadResponse({ form_category: 'inspection', created_by: 'a' }, { id: 'b', role: 'field' }));
  assert.ok(!canReadResponse({ created_by: 'a' }, { id: 'b', role: 'field' }, 'hr'), 'falls back to the form category');
  assert.ok(seesAllResponses('inspection', { role: 'field' }) && !seesAllResponses('hr', { role: 'operations' }) && seesAllResponses('hr', { role: 'hr' }));
});

// grid labels key the answers
t('duplicate grid labels are found and made unique', () => {
  const cols = ['MON', 'TUES', 'WED', 'THU', 'FRI', 'MON', 'TUES', 'WED', 'THU', 'FRI'];
  assert.deepEqual(duplicateLabels(cols), ['MON', 'TUES', 'WED', 'THU', 'FRI']);
  const u = uniqueLabels(cols);
  assert.equal(new Set(u).size, 10); assert.equal(u[0], 'MON (wk 1)'); assert.equal(u[5], 'MON (wk 2)');
  assert.deepEqual(uniqueLabels(['Jan', 'Feb']), ['Jan', 'Feb'], 'unique labels are untouched');
  assert.deepEqual(uniqueLabels(['Hose', 'Hose']), ['Hose (1)', 'Hose (2)']);
  assert.deepEqual(duplicateLabels(['a', 'A ']), ['A '], 'case and spaces do not make a label different');
});

// signatures
t('require_signature makes the signature question required, or adds one', () => {
  const withSig = fillQuestions({ require_signature: true, questions: [{ id: 's', type: 'signature', label: 'Employee' }, { id: 'm', type: 'signature', label: 'Signed: Management Representative' }] });
  assert.equal(withSig[0].required, true); assert.ok(!withSig[1].required, 'later signatures are signed after review');
  const without = fillQuestions({ require_signature: true, questions: [{ id: 'a', type: 'text', label: 'Name' }] });
  assert.equal(without.length, 2); assert.equal(without[1].type, 'signature'); assert.ok(!validateAnswers(without, { a: 'x' }).ok);
  const notRequired = [{ id: 'a', type: 'text' }];
  assert.equal(fillQuestions({ questions: notRequired }), notRequired);
});

// incident forms → incident register
t('incident form answers map onto the incident register, without medical answers', () => {
  const qs = [
    { id: 't', type: 'choice', label: 'Type of Incident', options: ['Injury', 'Environment Spill', 'Other - Theft'] },
    { id: 'd', type: 'date', label: 'Incident Date' }, { id: 'l', type: 'text', label: 'Location' },
    { id: 'fn', type: 'text', label: 'Investigator/s First Name' }, { id: 'f', type: 'text', label: 'First Name' }, { id: 's', type: 'text', label: 'Surname' },
    { id: 'desc', type: 'text', label: 'Description of the event/incident (When, What, Where, Who, How)' },
    { id: 'bp', type: 'text', label: 'Does person suffer from High blood pressure? (Yes/No)' }, { id: 'sig', type: 'signature', label: 'Signature' }
  ];
  const inc = incidentFromResponse(qs, { t: 'Environment Spill', d: '2026-09-20', l: 'Mount Edgecombe', fn: 'Inv', f: 'Sam', s: 'Dlamini', desc: 'Diesel leaked', bp: 'Yes', sig: 'data:image/png;base64,xx' }, { today: '2026-09-30', responseId: 'fr-1' });
  assert.equal(inc.type, 'environmental'); assert.equal(inc.date, '2026-09-20'); assert.equal(inc.location, 'Mount Edgecombe'); assert.equal(inc.people_involved, 'Sam Dlamini');
  assert.match(inc.description, /Diesel leaked/); assert.match(inc.description, /fr-1/);
  assert.doesNotMatch(inc.description, /blood|Yes|data:image/);
  assert.equal(incidentFromResponse(qs, { d: '2026-10-05' }, { today: '2026-09-30' }).date, '2026-09-30', 'future dates are refused by the register');
  assert.equal(incidentType('Other - Theft'), 'security'); assert.equal(incidentType('Private Prop'), 'property_damage'); assert.equal(incidentType('Customer Complaint'), 'complaint');
  assert.equal(incidentType('Injury on Duty'), 'injury'); assert.equal(incidentType('Plant'), 'equipment'); assert.equal(incidentType('Something new'), 'near_miss');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
