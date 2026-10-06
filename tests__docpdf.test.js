// Quote / invoice PDFs: no text may overlap other text, run past the margins or into the footer.
//   node tests__docpdf.test.js                 (add DOCPDF_OUT=<folder> to also write the PDFs for a visual check)
// Renders hard synthetic cases always, and every invoice and quote in data/seed/ when the private data pack is present.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { hasPack, readCollection } from '../tools__lib__seed-files.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message.split('\n').slice(0, 12).join('\n  ')); } };

// the browser builds of jsPDF + AutoTable, loaded as globals exactly as index.html does
globalThis.window = globalThis;
const shim = 'var module=undefined,exports=undefined,define=undefined;\n';
vm.runInThisContext(shim + readFileSync(join(root, 'vendor__jspdf.umd.min.js'), 'utf8'));
vm.runInThisContext(shim + readFileSync(join(root, 'vendor__jspdf.plugin.autotable.min.js'), 'utf8'));
const { jsPDF } = globalThis.jspdf;
const { renderDocPdf, renderStatementPdf, PAGE } = await import('../js__apps___docpdf.js');
const { COMPANY_DEFAULTS } = await import('../js__apps___docdefaults.js');

/* ---------- instrument: record a box for every line of text drawn ---------- */
const PT = 0.3528;
function Instrumented(opts) {
  const doc = new jsPDF(opts);
  doc.__boxes = [];
  const orig = doc.text.bind(doc);
  doc.text = function (text, x, y, options = {}, ...rest) {
    const lines = Array.isArray(text) ? text : String(text).split('\n');
    const size = doc.getFontSize(), lh = size * PT * (doc.getLineHeightFactor ? doc.getLineHeightFactor() : 1.15);
    const page = doc.internal.getCurrentPageInfo().pageNumber;
    lines.forEach((ln, i) => {
      const s = String(ln); if (!s.trim()) return;
      const w = doc.getTextWidth(s);
      const x0 = options.align === 'right' ? x - w : options.align === 'center' ? x - w / 2 : x;
      const base = y + i * lh;
      const top = options.baseline === 'top' ? base : options.baseline === 'middle' ? base - size * PT * 0.5 : base - size * PT * 0.72;
      const bottom = options.baseline === 'top' ? base + size * PT * 0.95 : options.baseline === 'middle' ? base + size * PT * 0.45 : base + size * PT * 0.2;
      doc.__boxes.push({ page, text: s, x0, x1: x0 + w, top, bottom });
    });
    return orig(text, x, y, options, ...rest);
  };
  return doc;
}
function problems(doc) {
  const out = [], b = doc.__boxes, tol = 0.12;
  for (const box of b) {
    if (box.x0 < PAGE.M - 0.4 || box.x1 > PAGE.W - PAGE.M + 0.4) out.push(`p${box.page} outside the margins: "${box.text}" (${box.x0.toFixed(1)}–${box.x1.toFixed(1)} mm)`);
    if (box.top < PAGE.FOOT && box.bottom > PAGE.FOOT - 0.3) out.push(`p${box.page} runs into the footer: "${box.text}"`);
    if (box.top < 6.5) out.push(`p${box.page} runs into the top band: "${box.text}"`);
  }
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
    const a = b[i], c = b[j];
    if (a.page !== c.page) continue;
    if (a.x0 < c.x1 - tol && c.x0 < a.x1 - tol && a.top < c.bottom - tol && c.top < a.bottom - tol) out.push(`p${a.page} "${a.text}" overlaps "${c.text}"`);
  }
  return out;
}

/* ---------- inputs ---------- */
const logoPath = join(root, 'assets__landscapers-logo.jpg');
const logo = existsSync(logoPath) ? `data:image/jpeg;base64,${readFileSync(logoPath).toString('base64')}` : '';
const seedDir = join(root, 'data/seed');
const hasSeed = hasPack(seedDir);
const load = n => readCollection(seedDir, n);
const profile = hasSeed ? (load('settings').find(s => s.key === 'company_profile') || {}).value || {} : {};
const company = { ...COMPANY_DEFAULTS, ...Object.fromEntries(Object.entries(profile).filter(([, v]) => v != null && v !== '')) };
const bank = hasSeed ? (load('bank_accounts').find(b => b.is_default) || load('bank_accounts')[0] || null) : { bank: 'FNB', account_name: 'JKN Property Consortium (Pty) Ltd', account_no: '62000000000', branch_code: '250655', account_type: 'Business cheque' };

const LONG = 'Block 1B Kingfisher Office Park, 28-30 Siphosethu Road, Mount Edgecombe, Kwa-Zulu Natal, 4300';
const hardCompany = { ...company, address: LONG, legal_name: 'JKN Property Consortium (Proprietary) Limited trading as Landscapers Inc', email: 'accounts.department.landscapersinc@example-very-long-domain.co.za', phone: '069 131 5387', website: 'www.landscapersinc.co.za', vat_registered: true, vat_number: '4123456789' };
const manyLines = Array.from({ length: 34 }, (_, i) => ({ description: i % 5 === 0 ? `Supply and install premium instant lawn (Buffalo grass) including soil preparation, levelling, compost, fertiliser and first cut — area ${i + 1} along the north boundary of the estate` : `Garden maintenance item ${i + 1}`, qty: i % 3 ? 1 : 12.5, unit_price: 1234.56 * (i + 1), discount_pct: i % 7 === 0 ? 10 : 0 }));
const synthetic = [
  ['invoice', { number: 'LSI-1001', issue_date: '2026-09-30', due_date: '2026-10-07', reference: 'LSI-1001', period: '2026-09', client_name: 'Carron Glen Estate Body Corporate', bill_to: 'Carron Glen Estate Body Corporate\nc/o Attlee Agency — Managing Agent for the Trustees\nOne Old Bush Road, Mount Edgecombe, Durban, KwaZulu-Natal, 4300\naccounts@attlee-agency.example.co.za', lines: manyLines, vat_applied: true, discount: 500, amount_paid: 10000, terms: company.invoice_terms + '\n\n' + 'x '.repeat(900), signature: null }, hardCompany, 'partially_paid'],
  ['invoice', { legacy_number: 'INV- 002', issue_date: '2026-07-01', client_name: 'Dr Paul Darby Wade', bill_to: 'Dr Paul Darby Wade\n5 Carron Glen Estate', lines: [{ description: 'Monthly garden maintenance', qty: 1, unit_price: 616.05 }], total: 616.05, subtotal: 616.05, total_override_reason: 'printed total kept', terms: company.invoice_terms }, company, 'paid'],
  ['invoice', { number: 'CN-1', kind: 'credit_note', issue_date: '2026-09-30', client_name: 'A', lines: [{ description: 'Credit for missed visit', qty: 1, unit_price: 200 }] }, company, null],
  ['quote', { number: 'QT-1001', issue_date: '2026-09-30', valid_until: '2026-10-30', salesperson: 'Wayne', title: 'Once-off landscape rehabilitation of the estate perimeter, palms and entrance — Carron Glen Estate, One Old Bush Road', client_name: 'Attlee Agency', bill_to: 'Attlee Agency\nCarron Glen Estate', lines: manyLines.slice(0, 8), deposit_pct: 50, deposit_amount: 12075, terms: company.quote_terms }, hardCompany, 'accepted'],
  ['quote', { number: 'QT-2', issue_date: '2026-09-30', title: '', client_name: '', lines: [] }, { ...company, address: '', phone: '', email: '', legal_name: '' }, 'draft']
];
const renders = synthetic.map(([kind, rec, co, state], i) => ({ label: `synthetic ${i + 1} (${kind})`, kind, rec, co, state }));
if (hasSeed) {
  for (const inv of load('invoices')) renders.push({ label: `invoice ${inv.number || inv.legacy_number || inv.id}`, kind: 'invoice', rec: inv, co: company, state: inv.status });
  for (const q of load('quotes')) renders.push({ label: `quote ${q.number || q.legacy_number || q.id}`, kind: 'quote', rec: q, co: company, state: q.status });
}

// client statements: a long synthetic one (many entries, long names) + one for every client with invoices
const events60 = Array.from({ length: 60 }, (_, i) => i % 3 === 2
  ? { date: `2026-${String(1 + (i % 9)).padStart(2, '0')}-15`, text: `Payment received — EFT reference CARRON-GLEN-ATTLEE-AGENCY-${i}`, debit: 0, credit: 18390 }
  : { date: `2026-${String(1 + (i % 9)).padStart(2, '0')}-01`, text: `Invoice LSI-${1000 + i} (2026-${String(1 + (i % 9)).padStart(2, '0')}) monthly estate maintenance and additional once-off rehabilitation works`, debit: 18390, credit: 0 });
renders.push({ label: 'synthetic statement', statement: { client: { name: 'Carron Glen Estate Body Corporate (c/o Attlee Agency Managing Agents)', bill_to: 'Carron Glen Estate Body Corporate\nc/o Attlee Agency — Managing Agent for the Trustees\nOne Old Bush Road, Mount Edgecombe, Durban, KwaZulu-Natal, 4300' }, events: events60, aging: { b0: 18390, b31: 36780, b60: 1234567.89, total: 1289737.89 } }, co: hardCompany });
if (hasSeed) {
  const inv = load('invoices'), clients = load('clients'), pays = load('payments') || [];
  for (const cl of clients) {
    const mine = inv.filter(i => i.client_id === cl.id); if (!mine.length) continue;
    const events = [...mine.map(i => ({ date: i.issue_date, text: `Invoice ${i.number || i.legacy_number || ''}${i.period ? ` (${i.period})` : ''}`, debit: i.kind === 'credit_note' ? 0 : Number(i.total) || 0, credit: i.kind === 'credit_note' ? Number(i.total) || 0 : 0 })),
      ...pays.filter(p => p.client_id === cl.id).map(p => ({ date: p.date, text: `Payment received${p.reference ? ` — ${p.reference}` : ''}`, debit: 0, credit: Number(p.amount) || 0 }))].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    renders.push({ label: `statement ${cl.name}`, statement: { client: { name: cl.name, bill_to: [cl.name, cl.company && cl.company !== cl.name ? cl.company : null, cl.address, cl.suburb].filter(Boolean).join('\n') }, events, aging: { b0: 0, b31: 0, b60: 0, total: mine.reduce((a, i) => a + (Number(i.total) || 0), 0) } }, co: company });
  }
}

/* ---------- run ---------- */
const outDir = process.env.DOCPDF_OUT;
if (outDir) mkdirSync(outDir, { recursive: true });
let worst = [];
for (const r of renders) {
  t(`${r.label}: no overlapping or clipped text`, () => {
    const doc = r.statement
      ? renderStatementPdf(Instrumented, { company: r.co, bank, logo, date: '2026-09-30', ...r.statement })
      : renderDocPdf(Instrumented, { kind: r.kind, rec: r.rec, company: r.co, bank, logo, state: r.state });
    if (outDir) writeFileSync(join(outDir, `${r.label.replace(/[^\w.-]+/g, '_')}.pdf`), Buffer.from(doc.output('arraybuffer')));
    const p = problems(doc);
    if (p.length > worst.length) worst = p;
    assert.deepEqual(p, []);
  });
}
t('the long company address wraps instead of running into the invoice details', () => {
  const doc = renderDocPdf(Instrumented, { kind: 'invoice', rec: synthetic[0][1], company: hardCompany, bank, logo, state: null });
  const addr = doc.__boxes.filter(b => b.page === 1 && /Kingfisher|Siphosethu|Mount Edgecombe|Natal/.test(b.text) && b.top < 60);
  assert.ok(addr.length >= 2, 'the address is split over lines');
  const details = doc.__boxes.find(b => b.text === 'Invoice no.');
  assert.ok(addr.every(a => a.x1 < details.x0 - 4), 'a clear gap before the details column');
});
t('totals and banking details start together after the table', () => {
  const doc = renderDocPdf(Instrumented, { kind: 'invoice', rec: synthetic[0][1], company: hardCompany, bank, logo, state: null });
  const bankHead = doc.__boxes.find(b => b.text === 'BANKING DETAILS'), sub = doc.__boxes.find(b => b.text === 'Subtotal');
  assert.equal(bankHead.page, sub.page); assert.ok(Math.abs(bankHead.top - sub.top) < 6);
});
console.log(`\n${renders.length} documents rendered${hasSeed ? ' (including every invoice, quote and client statement in the data pack)' : ' (synthetic cases only — no data pack here)'}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
