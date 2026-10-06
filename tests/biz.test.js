// Business logic tests (invoices, payments, debtors, reminders, contracts):  node tests/biz.test.js
import assert from 'node:assert/strict';
import { cleanLines, totalsOf, withTotals, balanceOf, invoiceState, isOpen, ageBucket, ageing, reminderPlan, remindersDue, formatNumber, matchPop, contractMonthly, mrr, intlPhone, waLink, lastMonths } from '../js/apps/_biz.js';
import { dumpToHtml } from '../tools/knowledge-html.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };
const ON = '2026-09-28';
const inv = o => ({ id: o.id || 'i1', status: 'unpaid', total: 1000, amount_paid: 0, issue_date: '2026-09-01', due_date: '2026-09-08', ...o });

// ---------------- document maths ----------------
t('per-visit rate stays exact: 4 × R630.315 = R2,521.26', () => assert.equal(totalsOf({ lines: [{ description: 'Weekly maintenance', qty: 4, unit_price: 630.315 }] }).total, 2521.26));
t('lines without description or price are dropped', () => assert.equal(cleanLines([{ description: '', unit_price: null }, { description: 'Lawn', qty: '', unit_price: 500 }]).length, 1));
t('blank qty counts as 1', () => assert.equal(cleanLines([{ description: 'Lawn', qty: '', unit_price: 500 }])[0].amount, 500));
t('discount + VAT totals', () => { const r = totalsOf({ lines: [{ description: 'A', qty: 2, unit_price: 150 }], discount: 50, vat_applied: true }); assert.deepEqual([r.subtotal, r.net, r.vat, r.total], [300, 250, 37.5, 287.5]); });
t('withTotals keeps legacy printed totals untouched', () => { const r = withTotals({ lines: [{ description: 'x', qty: 1, unit_price: 506.7 }], total: 501.63, total_override_reason: 'printed differs' }); assert.equal(r.total, 501.63); });
t('withTotals recomputes normal documents', () => assert.equal(withTotals({ lines: [{ description: 'x', qty: 3, unit_price: 99.99 }], total: 1 }).total, 299.97));

// ---------------- invoice status ----------------
t('unpaid before due date', () => assert.equal(invoiceState(inv({ due_date: '2026-09-30' }), ON), 'unpaid'));
t('overdue the day after the due date', () => assert.equal(invoiceState(inv({ due_date: '2026-09-27' }), ON), 'overdue'));
t('not overdue on the due date itself', () => assert.equal(invoiceState(inv({ due_date: ON }), ON), 'unpaid'));
t('partially paid', () => assert.equal(invoiceState(inv({ amount_paid: 400, due_date: '2026-10-05' }), ON), 'partially_paid'));
t('paid in full wins over overdue', () => assert.equal(invoiceState(inv({ amount_paid: 1000 }), ON), 'paid'));
t('awaiting POP respected until paid', () => { assert.equal(invoiceState(inv({ status: 'awaiting_pop' }), ON), 'awaiting_pop'); assert.equal(invoiceState(inv({ status: 'awaiting_pop', amount_paid: 1000 }), ON), 'paid'); });
t('draft, void and legacy stay as stored', () => { for (const s of ['draft', 'void', 'not_recorded']) assert.equal(invoiceState(inv({ status: s }), ON), s); });
t('balance never negative; void owes nothing', () => { assert.equal(balanceOf(inv({ amount_paid: 1200 })), 0); assert.equal(balanceOf(inv({ status: 'void' })), 0); assert.equal(balanceOf(inv({ amount_paid: 333.33 })), 666.67); });
t('isOpen', () => { assert.ok(isOpen(inv({}), ON)); assert.ok(!isOpen(inv({ status: 'draft' }), ON)); assert.ok(!isOpen(inv({ amount_paid: 1000 }), ON)); });

// ---------------- debt ageing ----------------
t('age buckets by invoice date', () => { assert.equal(ageBucket(inv({ issue_date: '2026-08-29' }), ON), '0-30'); assert.equal(ageBucket(inv({ issue_date: '2026-08-28' }), ON), '31-60'); assert.equal(ageBucket(inv({ issue_date: '2026-07-30' }), ON), '31-60'); /* 60 days */ assert.equal(ageBucket(inv({ issue_date: '2026-07-29' }), ON), '60+'); /* 61 days */ });
t('ageing adds up exactly in cents', () => {
  const a = ageing([inv({ id: 'a', total: 0.1, issue_date: '2026-09-20' }), inv({ id: 'b', total: 0.2, issue_date: '2026-09-21' }), inv({ id: 'c', total: 500, issue_date: '2026-06-01' }), inv({ id: 'd', total: 999, status: 'draft' })], ON);
  assert.deepEqual([a['0-30'], a['31-60'], a['60+'], a.total, a.count], [0.3, 0, 500, 500.3, 3]);
});

// ---------------- reminders (3 / 7 / 14 days after due) ----------------
t('reminder plan dates', () => assert.deepEqual(reminderPlan(inv({ due_date: '2026-09-10' }), ON).map(r => [r.day, r.date, r.due]), [[3, '2026-09-13', true], [7, '2026-09-17', true], [14, '2026-09-24', true]]));
t('sent reminders are not due again', () => assert.deepEqual(remindersDue([inv({ due_date: '2026-09-10', reminders_sent: [{ day: 3 }, { day: 7 }] })], ON).map(r => r.day), [14]));
t('no reminders for paid invoices', () => assert.equal(remindersDue([inv({ due_date: '2026-09-10', amount_paid: 1000 })], ON).length, 0));
t('no reminders before they fall due', () => assert.equal(remindersDue([inv({ due_date: '2026-09-27' })], ON).length, 0));

// ---------------- POP matching ----------------
t('reference + exact balance ranks first', () => {
  const list = [inv({ id: 'x', number: 'LSI-1001', client_name: 'Aston Moodley', total: 842 }), inv({ id: 'y', number: 'LSI-1002', client_name: 'Evan Sim', total: 730.8 })];
  const m = matchPop({ amount: 842, reference: 'lsi 1001', name: 'A Moodley' }, list, ON);
  assert.equal(m[0].inv.id, 'x'); assert.ok(m[0].score >= 0.9, String(m[0].score));
});
t('amount-only match is weaker than reference match', () => {
  const list = [inv({ id: 'x', number: 'LSI-1001', total: 500 }), inv({ id: 'y', number: 'LSI-1002', total: 500 })];
  const m = matchPop({ amount: 500, reference: 'LSI-1002' }, list, ON);
  assert.equal(m[0].inv.id, 'y'); assert.ok(m[0].score > m[1].score);
});
t('paid invoices are never suggested', () => assert.equal(matchPop({ amount: 1000 }, [inv({ amount_paid: 1000 })], ON).length, 0));

// ---------------- contracts & misc ----------------
t('MRR counts only active contracts, exactly', () => assert.equal(mrr([{ status: 'active', monthly_value: 2521.26 }, { status: 'active', monthly_value: 0.1 }, { status: 'active', monthly_value: 0.2 }, { status: 'left', monthly_value: 9000 }]), 2521.56));
t('contractMonthly', () => { assert.equal(contractMonthly({ status: 'paused', monthly_value: 100 }), 0); assert.equal(contractMonthly({ status: 'active', monthly_value: 100 }), 100); });
t('document numbers', () => { assert.equal(formatNumber('LSI-', 7), 'LSI-0007'); assert.equal(formatNumber('QT-', 1001), 'QT-1001'); });
t('SA phone to WhatsApp format', () => { assert.equal(intlPhone('069 131 5387'), '27691315387'); assert.equal(intlPhone('+27 70 695 7485'), '27706957485'); assert.equal(intlPhone('abc'), null); assert.ok(waLink('0691315387', 'Hi & bye').endsWith('?text=Hi%20%26%20bye')); });
t('last months', () => assert.deepEqual(lastMonths(3, '2026-01-15'), ['2025-11', '2025-12', '2026-01']));

// ---------------- knowledge import: text dump → HTML ----------------
t('DOCX dump headings, bullets and escaping', () => {
  const h = dumpToHtml('# DOCX: x\n[Heading 1] Title\n[normal] A < B & C\n[List Paragraph] one\n[List Paragraph] two\n[normal] end');
  assert.equal(h, '<h2>Title</h2>\n<p>A &lt; B &amp; C</p>\n<ul><li>one</li><li>two</li></ul>\n<p>end</p>');
});
t('PDF dump bullets on their own line', () => {
  const h = dumpToHtml('# PDF: x\n\n=== PAGE 1 ===\nManagement is committed to the following:\n• \nDevelop procedures;\n• \nDesign processes;\n');
  assert.ok(h.includes('<ul><li>Develop procedures;</li><li>Design processes;</li></ul>'), h);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
