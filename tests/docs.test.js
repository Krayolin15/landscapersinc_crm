// Docs helper tests:  node tests/docs.test.js
import assert from 'node:assert/strict';
import { fillTemplate, outline, pushVersion, wordCount, reviewStatus, toWordHtml } from '../js/apps/docs/lib.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };

t('template fill escapes and keeps unknown placeholders', () => assert.equal(fillTemplate('<p>Dear {{name}}, {{missing}}</p>', { name: 'A<b>' }), '<p>Dear A&lt;b&gt;, {{missing}}</p>'));
t('outline', () => assert.deepEqual(outline('<h2>Purpose</h2><p>x</p><h3>Scope &amp; aims</h3>').map(o => [o.level, o.text]), [[2, 'Purpose'], [3, 'Scope & aims']]));
t('versions: no duplicates, max kept', () => { let v = []; for (let i = 0; i < 40; i++) v = pushVersion(v, { html: String(i) }, 30); v = pushVersion(v, { html: '39' }); assert.equal(v.length, 30); assert.equal(v[29].html, '39'); });
t('word count', () => assert.equal(wordCount(' one two\nthree '), 3));
t('review status', () => {
  assert.equal(reviewStatus({ review_date: '2026-01-02' }, '2026-09-28').key, 'overdue');
  assert.equal(reviewStatus({ review_date: '2026-10-10' }, '2026-09-28').key, 'due');
  assert.equal(reviewStatus({ review_date: '2027-01-02' }, '2026-09-28').key, 'current');
  assert.equal(reviewStatus({}, '2026-09-28').key, 'none');
});
t('word export wraps html', () => assert.ok(toWordHtml('T', '<p>x</p>').includes('urn:schemas-microsoft-com:office:word')));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
