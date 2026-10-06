// Mail logic tests:  node tests/mail.test.js
import assert from 'node:assert/strict';
import { triage, extractLead, draftReply, threads } from '../js/apps/mail/logic.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };

t('storm damage is an emergency', () => assert.equal(triage({ subject: 'URGENT tree fell on our wall', body: 'After the storm last night a tree fell' }).key, 'emergency'));
t('quote request', () => assert.equal(triage({ subject: 'Garden service', body: 'Hi, could we get a quote for weekly lawn maintenance at 12 Sienna?' }).key, 'quote'));
t('proof of payment by attachment', () => assert.equal(triage({ subject: 'Invoice LSI-1004', body: 'See attached', attachments: [{ name: 'POP_LSI-1004.pdf' }] }).key, 'pop'));
t('reschedule', () => assert.equal(triage({ subject: 'Tuesday', body: 'We will not be home, please reschedule to another day' }).key, 'reschedule'));
t('general fallback', () => assert.equal(triage({ subject: 'Hello', body: 'Thanks for the great work' }).key, 'general'));
t('emergency outranks quote words', () => assert.equal(triage({ subject: 'Quote needed urgently', body: 'storm damage, fallen tree blocking the driveway' }).key, 'emergency'));
t('lead extraction', () => {
  const l = extractLead({ from_name: 'Priya Govender', from_email: 'Priya@Example.co.za', body: 'We live at 14 Forest Drive, La Lucia. Call me on 082 555 1234 about paving and a lawn.' });
  assert.equal(l.phone, '0825551234'); assert.equal(l.email, 'priya@example.co.za'); assert.equal(l.suburb, 'La Lucia'); assert.ok(l.services.includes('hardscape') && l.services.includes('lawn')); assert.ok(/14 Forest Drive/.test(l.address));
});
t('+27 numbers normalised', () => assert.equal(extractLead({ body: 'whatsapp +27 70 695 7485' }).phone, '0706957485'));
t('reply draft greets by first name', () => assert.ok(draftReply({ from_name: 'Aston Moodley', subject: 'quote please' }).startsWith('Good day Aston,')));
t('threads group re/fwd subjects', () => { const th = threads([{ subject: 'Invoice', sent_at: '2026-09-01' }, { subject: 'RE: Invoice', sent_at: '2026-09-02' }, { subject: 'Other', sent_at: '2026-09-03' }]); assert.equal(th.length, 2); assert.equal(th[1].messages.length, 2); });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
