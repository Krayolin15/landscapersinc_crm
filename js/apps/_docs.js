/* =============================================================================
   Quote & invoice documents: the editor (works one-handed on a phone on site),
   branded PDF output, the "send" sheet (WhatsApp / email / download) and the
   payment + proof-of-payment dialog. Used by the quotes, invoices, payments,
   clients and jobs apps.
   ========================================================================== */

import { h, ensureStyle, downloadBlob, copyText } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { btn, badge, card, pageHeader, callout, kv } from '../ui/components.js';
import { modal, toast, showError, confirm } from '../ui/overlays.js';
import { fieldInput, refPicker } from '../ui/form.js';
import { celebrate } from '../ui/animate.js';
import { db } from '../core/db.js';
import { can } from '../core/perms.js';
import { store } from '../core/bus.js';
import { uploadFiles } from '../core/files.js';
import { lineTotal, toCents } from '../core/money.js';
import { today, addDays } from '../core/dates.js';
import * as fmt from '../core/format.js';
import { company, printBank, cleanLines, totalsOf, withTotals, nextNumber, balanceOf, invoiceState, recordPayment, waLink, mailtoLink, invoiceMessage, quoteMessage, paymentsFor, matchPop, printedTotals } from './_biz.js';
import { renderDocPdf, renderStatementPdf } from './_docpdf.js';
import { ensureLib } from '../core/lazy.js';
import { LOGO_DATA_URL } from '../core/logo.js';

const COL = { quote: 'quotes', invoice: 'invoices' };
export const INVOICE_STATE_BADGE = { draft: ['Draft', 'gray'], unpaid: ['Unpaid', 'blue'], partially_paid: ['Partially paid', 'gold'], awaiting_pop: ['Awaiting POP', 'violet'], paid: ['Paid', 'green'], overdue: ['Overdue', 'red'], void: ['Void', 'gray'], not_recorded: ['Payment not recorded', 'clay'] };
export const QUOTE_BADGE = { draft: ['Draft', 'gray'], sent: ['Sent', 'blue'], viewed: ['Viewed', 'violet'], accepted: ['Accepted', 'green'], rejected: ['Declined', 'red'], expired: ['Expired', 'clay'], superseded: ['Superseded', 'gray'] };
export function invoiceBadge(inv) { const s = invoiceState(inv); const [l, c] = INVOICE_STATE_BADGE[s] || [s, 'gray']; return badge(l, c); }
export function quoteBadge(q) { const s = q.status === 'sent' && q.valid_until && q.valid_until < today() ? 'expired' : q.status; const [l, c] = QUOTE_BADGE[s] || [s, 'gray']; return badge(l, c); }

ensureStyle('lsi-docs', `
.doc-lines{display:flex;flex-direction:column;gap:10px}
.doc-line{display:grid;grid-template-columns:minmax(0,1fr) 90px 130px 80px 120px 36px;gap:8px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:14px;background:var(--surface);animation:popIn .25s var(--ease-out)}
.doc-line .amt{font-variant-numeric:tabular-nums;text-align:right;font-weight:600}
.doc-line-head{display:grid;grid-template-columns:minmax(0,1fr) 90px 130px 80px 120px 36px;gap:8px;padding:0 10px;font-size:var(--fs-xs);color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.doc-totals{margin-left:auto;min-width:260px;display:grid;grid-template-columns:1fr auto;gap:6px 18px;font-variant-numeric:tabular-nums}
.doc-totals .grand{font-size:1.35rem;font-weight:800;color:var(--brand)}
.doc-sticky{position:sticky;bottom:0;z-index:5;display:flex;gap:8px;align-items:center;padding:12px;margin:18px -4px 0;border-radius:18px;background:var(--glass);backdrop-filter:blur(14px);border:1px solid var(--border);box-shadow:var(--shadow-lg)}
.svc-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}
.svc-chips .chip{white-space:nowrap}
@media (max-width: 760px){
  .doc-line-head{display:none}
  .doc-line{grid-template-columns:1fr 1fr;grid-template-areas:"d d" "q u" "p a" "x x"}
  .doc-line>:nth-child(1){grid-area:d}.doc-line>:nth-child(2){grid-area:q}.doc-line>:nth-child(3){grid-area:u}
  .doc-line>:nth-child(4){grid-area:p}.doc-line>:nth-child(5){grid-area:a;align-self:center}.doc-line>:nth-child(6){grid-area:x;justify-self:end}
  .doc-totals{min-width:0;width:100%}
}`);

/* =============================================================================
   Editor
   ========================================================================== */
/**
 * docEditor('invoice'|'quote', ctx, { id, values }) → page Node.
 * Saves a draft or issues the document (assigns the next number), then opens it.
 */
export function docEditor(kind, ctx, o = {}) {
  const col = COL[kind];
  const c = company();
  const existing = o.id ? db.get(col, o.id) : null;
  const base = kind === 'invoice'
    ? { status: 'draft', kind: 'adhoc', issue_date: today(), due_date: addDays(today(), Number(c.default_due_days) || 7), vat_applied: !!c.vat_registered, discount: 0, amount_paid: 0, terms: c.invoice_terms, lines: [] }
    : { status: 'draft', issue_date: today(), valid_until: addDays(today(), Number(c.quote_valid_days) || 30), vat_applied: !!c.vat_registered, discount: 0, deposit_pct: Number(c.deposit_pct) || 50, terms: c.quote_terms, lines: [], salesperson: (store.get('user') || {}).full_name || null };
  const v = { ...base, ...(existing || {}), ...(o.values || {}) };
  if (!Array.isArray(v.lines) || !v.lines.length) v.lines = [{ description: '', qty: 1, unit_price: null, discount_pct: 0 }];
  v.lines = v.lines.map(l => ({ ...l }));
  if (existing && existing.total_override_reason) return callout('warning', 'Legacy invoice', 'This invoice was imported from a PDF whose printed total differs from its lines. It is kept exactly as printed and cannot be edited line by line — use Edit (all details) instead.', 'lock');

  const linesBox = h('div.doc-lines');
  const totalsBox = h('div.doc-totals');
  const clientInfo = h('div.small.muted');
  const err = h('div');

  const drawTotals = () => {
    const t = totalsOf(v);
    const dep = kind === 'quote' && v.deposit_pct ? Math.round(toCents(t.total) * v.deposit_pct / 100) / 100 : null;
    totalsBox.replaceChildren(
      h('span.muted', 'Subtotal'), h('span', fmt.money(t.subtotal)),
      t.discount ? h('span.muted', 'Discount') : null, t.discount ? h('span', `− ${fmt.money(t.discount)}`) : null,
      v.vat_applied ? h('span.muted', `VAT ${Math.round((t.vat / (t.net || 1)) * 100) || 15}%`) : null, v.vat_applied ? h('span', fmt.money(t.vat)) : null,
      h('span', { style: 'font-weight:700' }, 'Total'), h('span.grand', fmt.money(t.total)),
      dep != null ? h('span.muted', `Deposit ${v.deposit_pct}%`) : null, dep != null ? h('span', fmt.money(dep)) : null);
  };
  const lineRow = (l, i) => {
    const amt = h('div.amt', fmt.money(lineTotal(l.qty ?? 1, l.unit_price || 0, l.discount_pct || 0)));
    const upd = () => { amt.textContent = fmt.money(lineTotal(l.qty === '' || l.qty == null ? 1 : l.qty, l.unit_price || 0, l.discount_pct || 0)); drawTotals(); };
    return h('div.doc-line',
      h('input.input', { value: l.description || '', placeholder: 'Description (e.g. Lawn installation — Buffalo grass)', 'aria-label': 'Description', onInput: e => { l.description = e.target.value; } }),
      h('input.input', { type: 'number', step: 'any', inputmode: 'decimal', value: l.qty ?? 1, 'aria-label': 'Quantity', onInput: e => { l.qty = e.target.value === '' ? '' : Number(e.target.value); upd(); } }),
      h('div.input-group', h('span.addon', 'R'), h('input.input', { type: 'number', step: 'any', inputmode: 'decimal', value: l.unit_price ?? '', placeholder: '0.00', 'aria-label': 'Unit price', onInput: e => { l.unit_price = e.target.value === '' ? null : Number(e.target.value); upd(); } })),
      h('div.input-group', h('input.input', { type: 'number', step: 'any', min: 0, max: 100, value: l.discount_pct || '', placeholder: '0', 'aria-label': 'Line discount %', onInput: e => { l.discount_pct = Number(e.target.value) || 0; upd(); } }), h('span.addon', '%')),
      amt,
      h('button.btn.btn-ghost.btn-icon', { type: 'button', 'aria-label': 'Remove line', onClick: () => { v.lines.splice(i, 1); if (!v.lines.length) v.lines.push({ description: '', qty: 1, unit_price: null, discount_pct: 0 }); drawLines(); } }, icon('trash-2', 16)));
  };
  const drawLines = () => { linesBox.replaceChildren(...v.lines.map(lineRow)); drawTotals(); };
  const addLine = (l = {}) => { v.lines.push({ description: '', qty: 1, unit_price: null, discount_pct: 0, ...l }); drawLines(); const inputs = linesBox.querySelectorAll('.doc-line'); inputs[inputs.length - 1]?.querySelector('input')?.focus(); };

  const services = db.all('services').filter(s => s.active !== false);
  const svcChips = services.length ? h('div.svc-chips', services.slice(0, 40).map(s => h('button.chip', { type: 'button', title: s.description || '', onClick: () => addLine({ description: s.name + (s.description ? ` — ${s.description.split('\n')[0]}` : ''), qty: 1, unit_price: s.rate ?? null, service_id: s.id }) }, icon('plus', 13), s.name, s.rate != null ? h('span.muted', ` ${fmt.money(s.rate)}${s.unit ? '/' + s.unit : ''}`) : null))) : null;

  const pickClient = id => {
    v.client_id = id;
    const cl = id ? db.get('clients', id) : null;
    if (cl) {
      v.client_name = cl.name;
      v.bill_to = [cl.name, cl.company && cl.company !== cl.name ? cl.company : null, cl.address, cl.suburb].filter(Boolean).join('\n');
      if (kind === 'invoice' && !v.reference) v.reference = cl.legacy_code || null;
      nameInput.value = v.client_name; billInput.value = v.bill_to;
    }
    clientInfo.replaceChildren(cl ? h('span', cl.phone ? fmt.phone(cl.phone) : '', cl.email ? ` · ${cl.email}` : '', cl.preferred_channel ? ` · prefers ${cl.preferred_channel}` : '') : '');
  };
  const nameInput = h('input.input', { value: v.client_name || '', placeholder: 'Client name as it should print', onInput: e => { v.client_name = e.target.value; } });
  const billInput = h('textarea.textarea', { rows: 3, value: v.bill_to || '', placeholder: 'Name, address…', onInput: e => { v.bill_to = e.target.value; } });
  const field = (label, input, hint, full) => h('div', { class: ['field', full ? 'full' : ''] }, h('label.field-label', label), input, hint ? h('div.field-hint', hint) : null);
  const f = (name, def) => fieldInput(def, v[name], x => { v[name] = x; if (['vat_applied', 'discount', 'deposit_pct'].includes(name)) drawTotals(); });

  const leadPicker = kind === 'quote' ? field('Lead', refPicker({ ref: 'leads' }, v.lead_id, id => { v.lead_id = id; const l = id && db.get('leads', id); if (l && !v.client_name) { v.client_name = l.name; nameInput.value = l.name; } })) : null;

  async function save(issue) {
    const lines = cleanLines(v.lines);
    const problems = [];
    if (!String(v.client_name || '').trim()) problems.push('Choose a client or type the client name');
    if (!lines.length) problems.push('Add at least one line with a description and price');
    if (kind === 'quote' && !String(v.title || '').trim()) problems.push('Give the quote a short description');
    if (lines.some(l => !l.description)) problems.push('Every line needs a description');
    if (problems.length) { err.replaceChildren(callout('danger', 'Almost there', problems.join(' · '), 'circle-alert')); err.scrollIntoView({ behavior: 'smooth', block: 'center' }); return null; }
    err.replaceChildren();
    let rec = withTotals({ ...v, lines });
    if (kind === 'quote' && rec.deposit_pct) rec.deposit_amount = Math.round(toCents(rec.total) * rec.deposit_pct / 100) / 100;
    if (issue) {
      if (!rec.number) rec.number = await nextNumber(kind);
      rec.status = kind === 'invoice' ? (rec.status === 'draft' ? 'unpaid' : rec.status) : (rec.status === 'draft' ? 'sent' : rec.status);
      if (kind === 'invoice' && !rec.reference) rec.reference = rec.number;
    }
    delete rec.id;
    const res = db.check(col, rec, { id: existing && existing.id });
    if (!res.ok) { err.replaceChildren(callout('danger', 'Please check', Object.values(res.errors).join(' · '), 'circle-alert')); return null; }
    try {
      const saved = existing ? await db.update(col, existing.id, rec) : await db.insert(col, rec);
      toast.success(issue ? `${kind === 'quote' ? 'Quote' : 'Invoice'} ${saved.number} issued` : 'Draft saved', { text: `${saved.client_name} · ${fmt.money(saved.total)}` });
      return saved;
    } catch (e) { showError(e); return null; }
  }

  drawLines(); pickClient(v.client_id || null); if (!v.client_id) clientInfo.replaceChildren();
  const title = existing ? `Edit ${existing.number || existing.legacy_number || (kind === 'quote' ? 'quote' : 'invoice')}` : kind === 'quote' ? 'New quote' : 'New invoice';
  return h('div',
    pageHeader({ title, sub: kind === 'invoice' ? 'Fill in the client and lines — the total, VAT and number are handled for you.' : 'Build the quote from the price list or free-type any line.', icon: kind === 'quote' ? 'file-signature' : 'receipt', tile: kind === 'quote' ? 't-clay' : 't-violet', crumbs: [{ label: kind === 'quote' ? 'Quotes' : 'Invoices', href: `#/${col}` }, { label: title }] }),
    err,
    card({ title: 'Client', icon: 'user', cls: 'solid' },
      h('div.form-grid',
        field('Find client', refPicker({ ref: 'clients' }, v.client_id, pickClient), 'Search the client list — or type a new name below'),
        field('Name on the document', nameInput),
        leadPicker,
        field('Bill to', billInput, null, true), h('div.full', clientInfo))),
    card({ title: 'Details', icon: 'file-cog', cls: 'solid' },
      h('div.form-grid',
        kind === 'quote' ? field('Description', f('title', { type: 'text', placeholder: 'e.g. Garden makeover — front lawn & paving' }), null, true) : null,
        kind === 'invoice' ? field('Type', f('kind', { type: 'enum', required: true, options: [{ value: 'maintenance', label: 'Monthly maintenance' }, { value: 'adhoc', label: 'Ad-hoc / project' }, { value: 'deposit', label: 'Deposit' }, { value: 'balance', label: 'Balance' }, { value: 'credit_note', label: 'Credit note' }] })) : null,
        field(kind === 'quote' ? 'Quote date' : 'Invoice date', f('issue_date', { type: 'date' })),
        kind === 'invoice' ? field('Due date', f('due_date', { type: 'date' })) : field('Valid until', f('valid_until', { type: 'date' })),
        kind === 'invoice' ? field('Service month', f('period', { type: 'text', placeholder: 'YYYY-MM' }), 'For monthly maintenance, e.g. 2026-10') : field('Deposit %', f('deposit_pct', { type: 'percent' })),
        kind === 'invoice' ? field('Payment reference', f('reference', { type: 'text', placeholder: 'Defaults to the invoice number' })) : field('Salesperson', f('salesperson', { type: 'text' })),
        field('Add VAT', f('vat_applied', { type: 'bool', switchLabel: c.vat_registered ? 'VAT registered' : 'Not VAT registered' })),
        field('Discount on total', f('discount', { type: 'money', min: 0 })))),
    card({ title: 'Line items', icon: 'list', cls: 'solid', actions: [btn({ label: 'Add line', icon: 'plus', size: 'sm', onClick: () => addLine() })] },
      svcChips ? h('div', { style: 'margin-bottom:12px' }, h('div.small.muted', { style: 'margin-bottom:6px' }, 'Tap a service to add it'), svcChips) : null,
      h('div.doc-line-head', h('span', 'Description'), h('span', 'Qty'), h('span', 'Unit price'), h('span', 'Disc.'), h('span', { style: 'text-align:right' }, 'Amount'), h('span')),
      linesBox,
      h('div.row', { style: 'margin-top:14px;align-items:flex-start' }, btn({ label: 'Add line', icon: 'plus', variant: 'ghost', onClick: () => addLine() }), h('div.spacer'), totalsBox)),
    card({ title: 'Terms & notes', icon: 'scroll-text', cls: 'solid' },
      h('div.form-grid', field('Terms (print on the document)', f('terms', { type: 'longtext', rows: 3 }), null, true), field('Internal notes (not printed)', f('notes', { type: 'longtext', rows: 2 }), null, true),
        kind === 'invoice' ? field('Client signature (optional, on site)', f('signature', { type: 'signature' }), null, true) : null)),
    h('div.doc-sticky',
      btn({ label: 'Cancel', variant: 'ghost', onClick: () => history.back() }),
      h('div.spacer'),
      btn({ label: 'Save draft', icon: 'save', onClick: async e => { const r = await save(false); if (r) ctx.navigate(`${col}/${col === 'quotes' ? 'q' : 'i'}/${encodeURIComponent(r.id)}`); } }),
      btn({ label: existing && existing.number ? 'Save' : kind === 'quote' ? 'Issue quote' : 'Issue invoice', icon: 'send', variant: 'primary', onClick: async () => { const r = await save(true); if (r) { ctx.navigate(`${col}/${col === 'quotes' ? 'q' : 'i'}/${encodeURIComponent(r.id)}`); if (!existing || !existing.number) setTimeout(() => sendSheet(kind, db.get(col, r.id)), 350); } } })));
}

/* =============================================================================
   PDF
   ========================================================================== */
/** The logo for the PDFs (a data URL built into the code, so it also works when the app is opened from the folder). */
export async function logo() { return LOGO_DATA_URL; }
/** The status a printed document shows as a tag beside its title. */
export function docState(kind, rec) {
  if (kind === 'invoice') return invoiceState(rec);
  return rec.status === 'sent' && rec.valid_until && rec.valid_until < today() ? 'expired' : rec.status;
}
const pdfLib = () => ensureLib('jspdf').catch(() => { throw new Error('The PDF library could not load — check your connection and try again.'); });
/** Branded A4 PDF for a quote or invoice (layout: js/apps/_docpdf.js). Returns a Blob. */
export async function docPdf(kind, rec) {
  const { jsPDF } = await pdfLib();
  return renderDocPdf(jsPDF, { kind, rec, company: company(), bank: printBank(), logo: await logo(), state: docState(kind, rec) }).output('blob');
}
/** Client statement PDF (layout: js/apps/_docpdf.js). events: [{date, text, debit, credit}] oldest first. Returns a Blob. */
export async function statementPdf({ client, events, aging }) {
  const { jsPDF } = await pdfLib();
  return renderStatementPdf(jsPDF, { company: company(), bank: printBank(), logo: await logo(), client, date: today(), events, aging }).output('blob');
}
export function docFileName(kind, rec) { return `${kind === 'quote' ? 'Quote' : 'Invoice'} ${rec.number || rec.legacy_number || 'draft'} - ${String(rec.client_name || '').replace(/[^\w\s-]/g, '')}.pdf`.replace(/\s+/g, ' '); }
export async function downloadPdf(kind, rec) {
  try { downloadBlob(await docPdf(kind, rec), docFileName(kind, rec)); } catch (e) { showError(e, 'Could not create the PDF'); }
}
/** Share the PDF with the phone's share sheet when available (WhatsApp with attachment on mobile). */
async function sharePdf(kind, rec, text) {
  const blob = await docPdf(kind, rec);
  const file = new File([blob], docFileName(kind, rec), { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text, title: docFileName(kind, rec) }); return true; }
  downloadBlob(blob, file.name); return false;
}

/* =============================================================================
   Send sheet
   ========================================================================== */
export function sendSheet(kind, rec, msgKind = 'send') {
  if (!rec) return;
  const col = COL[kind];
  const client = rec.client_id ? db.get('clients', rec.client_id) : null;
  const phone = client ? client.phone || client.phone_alt : null;
  const email = client ? client.billing_email || client.email : null;
  const text = kind === 'quote' ? quoteMessage(rec) : invoiceMessage(rec, msgKind);
  const subject = kind === 'quote' ? `Quotation ${rec.number || ''} — ${company().trading_name}` : msgKind === 'send' ? `Invoice ${rec.number || rec.legacy_number || ''} — ${company().trading_name}` : `Reminder: invoice ${rec.number || rec.legacy_number || ''}`;
  const ta = h('textarea.textarea', { rows: 9, value: text });
  const mark = async via => {
    try {
      if (msgKind === 'send') await db.update(col, rec.id, { sent_at: new Date().toISOString(), sent_via: [...new Set([...(rec.sent_via || []), via])], ...(kind === 'quote' && rec.status === 'draft' ? { status: 'sent' } : {}), ...(kind === 'invoice' && rec.status === 'draft' ? { status: 'unpaid' } : {}) });
      else await db.update('invoices', rec.id, { reminders_sent: [...(rec.reminders_sent || []), { day: msgKind, at: new Date().toISOString(), via, by: (store.get('user') || {}).full_name || null }] });
      await db.insert('outbox', { channel: via, to: (via === 'email' ? email : phone) || rec.client_name, to_name: rec.client_name, subject, body: ta.value, status: 'sent', sent_at: new Date().toISOString(), related_collection: col, related_id: rec.id }).catch(() => {});
    } catch (e) { showError(e); }
  };
  const m = modal({
    title: msgKind === 'send' ? `Send ${kind === 'quote' ? 'quote' : 'invoice'} ${rec.number || rec.legacy_number || ''}` : `${msgKind}-day reminder`, icon: 'send', tile: 't-grass',
    body: h('div.stack',
      h('div.row.wrap.gap-8', h('strong', rec.client_name), phone ? badge(fmt.phone(phone), 'green') : badge('No phone on file', 'gray'), email ? badge(email, 'blue') : badge('No email on file', 'gray'), client && client.preferred_channel ? badge(`Prefers ${client.preferred_channel}`, 'violet') : null),
      h('label.field-label', 'Message'), ta,
      h('div.grid.cols-2',
        btn({ label: 'WhatsApp with PDF', icon: 'message-circle', variant: 'primary', onClick: async () => { await copyText(ta.value); const shared = await sharePdf(kind, rec, ta.value).catch(() => false); if (!shared) window.open(waLink(phone, ta.value), '_blank', 'noopener'); await mark('whatsapp'); toast.success(shared ? 'Shared' : 'PDF downloaded — attach it in WhatsApp', { text: 'The message is also copied to your clipboard.' }); m.close(); } }),
        btn({ label: 'Email', icon: 'mail', onClick: async () => { await downloadPdf(kind, rec); window.location.href = mailtoLink(email, subject, ta.value); await mark('email'); toast.info('PDF downloaded — attach it to the email'); m.close(); } }),
        btn({ label: 'Download PDF', icon: 'download', variant: 'ghost', onClick: () => downloadPdf(kind, rec) }),
        btn({ label: 'Copy message', icon: 'copy', variant: 'ghost', onClick: async () => { await copyText(ta.value); toast.success('Copied'); } })),
      h('p.small.muted', 'On a phone, "WhatsApp with PDF" opens the share sheet so the PDF goes as an attachment. Every send is logged on the document and in the outbox.'))
  });
}

/* =============================================================================
   Payment / proof of payment
   ========================================================================== */
export function paymentDialog(inv, { pop = false } = {}) {
  const bal = balanceOf(inv);
  const v = { amount: bal || inv.total, date: today(), method: 'eft', reference: inv.reference || inv.number || inv.legacy_number || '', status: pop ? 'awaiting_verification' : 'verified', notes: '' };
  let files = null;
  const fi = (label, name, def) => h('div.field', h('label.field-label', label), fieldInput(def, v[name], x => { v[name] = x; }));
  modal({
    title: pop ? 'Upload proof of payment' : `Record payment · ${inv.number || inv.legacy_number || inv.client_name}`, icon: pop ? 'file-up' : 'wallet', tile: 't-rose',
    body: h('div.stack',
      kv([['Client', inv.client_name], ['Invoice total', fmt.money(inv.total)], ['Paid so far', fmt.money(inv.amount_paid || 0)], ['Balance', fmt.money(bal)]]),
      h('div.form-grid',
        fi('Amount (R)', 'amount', { type: 'money', min: 0.01 }), fi('Date received', 'date', { type: 'date' }),
        fi('Method', 'method', { type: 'enum', required: true, options: ['eft', 'cash', 'card', 'cheque', 'other'] }), fi('Bank reference', 'reference', { type: 'text' }),
        fi('Verification', 'status', { type: 'enum', required: true, options: [{ value: 'verified', label: 'Verified — money is in the bank' }, { value: 'awaiting_verification', label: 'POP received — verify against the bank' }] }),
        h('div.field', h('label.field-label', 'Proof of payment (PDF / photo)'), h('input.input', { type: 'file', accept: 'application/pdf,image/*', capture: 'environment', onChange: e => { files = e.target.files; } })),
        h('div.field.full', h('label.field-label', 'Notes'), fieldInput({ type: 'longtext', rows: 2 }, '', x => { v.notes = x; })))),
    actions: [{ label: 'Cancel', variant: 'ghost' }, {
      label: 'Save payment', icon: 'check', variant: 'primary', onClick: async () => {
        if (!(Number(v.amount) > 0)) { toast.error('Enter the amount received'); return false; }
        if (toCents(v.amount) > toCents(bal) && bal > 0 && !(await confirm(`That is ${fmt.money(Number(v.amount) - bal)} more than the balance. Record it anyway?`, { ok: 'Record anyway' }))) return false;
        try {
          let popId = null;
          if (files && files.length) { const [f] = await uploadFiles(files, { drive_id: 'finance', linked: [{ collection: 'invoices', id: inv.id }] }); popId = f && f.id; }
          await recordPayment(inv, { ...v, pop_file_id: popId });
          const after = db.get('invoices', inv.id);
          if (invoiceState(after) === 'paid') { celebrate(); toast.success('Invoice paid in full', { text: `${after.client_name} · ${fmt.money(after.total)}` }); }
          else toast.success(v.status === 'verified' ? 'Payment recorded' : 'POP saved — waiting for bank verification');
        } catch (e) { showError(e); return false; }
      }
    }]
  });
}
export async function verifyPayment(p, ok) {
  await db.update('payments', p.id, { status: ok ? 'verified' : 'rejected' });
  if (p.invoice_id) { const { recomputeInvoice } = await import('./_biz.js'); await recomputeInvoice(p.invoice_id); }
  toast.success(ok ? 'Payment verified' : 'Payment rejected');
}

/** "Which invoice is this POP for?" helper used by the payments app. */
export function popMatcher(onPick) {
  const q = { amount: null, reference: '', name: '' };
  const out = h('div.stack');
  const run = () => {
    const m = matchPop(q).slice(0, 8);
    out.replaceChildren(...(m.length ? m.map(x => h('button.list-item.hover', { type: 'button', onClick: () => onPick(x.inv) },
      h('div.li-main', h('div.li-title', `${x.inv.number || x.inv.legacy_number || 'Invoice'} · ${x.inv.client_name}`), h('div.li-sub', `${fmt.money(balanceOf(x.inv) || x.inv.total)} · ${x.reasons.join(', ')}`)),
      badge(`${Math.round(x.score * 100)}%`, x.score >= 0.7 ? 'green' : x.score >= 0.4 ? 'gold' : 'gray'))) : [h('p.small.muted', 'Type an amount, reference or name to find the invoice.')]));
  };
  run();
  return h('div.stack',
    h('div.form-grid',
      h('div.field', h('label.field-label', 'Amount on the POP'), fieldInput({ type: 'money' }, null, x => { q.amount = x; run(); })),
      h('div.field', h('label.field-label', 'Reference'), fieldInput({ type: 'text' }, '', x => { q.reference = x; run(); })),
      h('div.field', h('label.field-label', 'Payer name'), fieldInput({ type: 'text' }, '', x => { q.name = x; run(); }))),
    out);
}
export { paymentsFor, can };

/* =============================================================================
   On-screen preview (same content as the PDF)
   ========================================================================== */
ensureStyle('lsi-docprev', `
.docprev{background:#fff;color:#212523;border-radius:16px;box-shadow:var(--shadow-lg);padding:30px 32px 22px;max-width:880px;margin:0 auto;position:relative;overflow:hidden;font-size:.9rem;line-height:1.45}
.docprev:before{content:"";position:absolute;inset:0 0 auto 0;height:7px;background:linear-gradient(#103d24 0 72%,#7cc24e 72%)}
.docprev .dp-head{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,auto);gap:24px;align-items:start;padding-bottom:18px;border-bottom:1px solid #dee6e1}
.docprev .dp-co{display:flex;gap:14px;align-items:flex-start;min-width:0}
.docprev .dp-co img{width:64px;height:64px;border-radius:10px;object-fit:cover;flex:none}
.docprev .dp-co-name{font-size:1.2rem;font-weight:800;color:#103d24;line-height:1.2}
.docprev .dp-co-lines{font-size:.78rem;color:#6b746f;white-space:pre-line;overflow-wrap:anywhere;margin-top:4px}
.docprev .dp-title{text-align:right}
.docprev .dp-title h2{margin:0;color:#175a33;font-size:1.7rem;letter-spacing:.03em;line-height:1.1}
.docprev .dp-tag{display:inline-block;margin-top:6px;padding:2px 9px;border-radius:5px;color:#fff;font-weight:800;font-size:.68rem;letter-spacing:.08em}
.docprev .dp-meta{display:grid;grid-template-columns:auto auto;justify-content:end;gap:3px 18px;font-size:.82rem;margin-top:10px}
.docprev .dp-meta span:nth-child(odd){color:#6b746f;text-align:left}.docprev .dp-meta span:nth-child(even){font-weight:700;text-align:right}
.docprev .dp-boxes{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0}
.docprev .dp-box{padding:12px 14px;background:#f4f9f5;border:1px solid #dee6e1;border-radius:10px;min-width:0;overflow-wrap:anywhere}
.docprev .dp-box .k{font-size:.66rem;font-weight:800;color:#175a33;letter-spacing:.09em;margin-bottom:6px}
.docprev .dp-box .big{font-size:1.45rem;font-weight:800;color:#103d24;font-variant-numeric:tabular-nums}
.docprev .dp-box .lead{font-weight:700}.docprev .dp-box .sub{color:#6b746f;font-size:.82rem}
.docprev .dp-bill{white-space:pre-line}
.docprev table{width:100%;border-collapse:collapse;font-size:.86rem}
.docprev th{background:#103d24;color:#fff;text-align:left;padding:8px 10px;font-size:.78rem}
.docprev td{padding:8px 10px;border-bottom:1px solid #e6ece8;vertical-align:top;overflow-wrap:anywhere}
.docprev tbody tr:nth-child(even) td{background:#f9fbfa}
.docprev td.n,.docprev th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.docprev td.amt{font-weight:700}
.docprev .dp-lower{display:grid;grid-template-columns:minmax(0,1fr) minmax(250px,320px);gap:20px;margin-top:16px;align-items:start}
.docprev .dp-bank .k{font-size:.66rem;font-weight:800;color:#175a33;letter-spacing:.09em;margin-bottom:6px}
.docprev .dp-bank dl{display:grid;grid-template-columns:auto 1fr;gap:2px 14px;margin:0;font-size:.82rem}.docprev .dp-bank dt{color:#6b746f}.docprev .dp-bank dd{margin:0;font-weight:700;overflow-wrap:anywhere}
.docprev .dp-tot{display:grid;grid-template-columns:1fr auto;gap:5px 0;font-variant-numeric:tabular-nums;align-content:start}
.docprev .dp-tot>span{padding:2px 10px}.docprev .dp-tot .v{text-align:right}
.docprev .dp-tot .g{background:#103d24;color:#fff;padding:6px 10px;font-weight:800}.docprev .dp-tot .g.k{border-radius:7px 0 0 7px}.docprev .dp-tot .g.v{border-radius:0 7px 7px 0}
.docprev .dp-sec{margin-top:16px;font-size:.8rem;color:#4a504c;white-space:pre-line}.docprev .dp-sec .k{font-size:.66rem;font-weight:800;color:#175a33;letter-spacing:.09em;margin-bottom:3px}
.docprev .dp-foot{margin-top:20px;padding-top:8px;border-top:1px solid #dee6e1;font-size:.72rem;color:#6b746f}
.docprev .dp-warn{margin-top:12px;font-size:.78rem;color:#9a6408;background:#fdf6e7;border-radius:8px;padding:8px 10px}
@media (max-width:640px){.docprev{padding:24px 16px 16px}.docprev .dp-head,.docprev .dp-boxes,.docprev .dp-lower{grid-template-columns:1fr}.docprev .dp-title{text-align:left}.docprev .dp-meta{justify-content:start}}
`);
const TAG = { paid: ['PAID', '#1f7440'], overdue: ['OVERDUE', '#c0392b'], void: ['VOID', '#787878'], draft: ['DRAFT', '#787878'], partially_paid: ['PART-PAID', '#b9770e'], accepted: ['ACCEPTED', '#1f7440'], rejected: ['DECLINED', '#c0392b'], expired: ['EXPIRED', '#787878'] };
/** On-screen document — the same layout and figures as the PDF (js/apps/_docpdf.js); nothing is drawn over the text. */
export function docPreview(kind, rec) {
  const c = company(), bank = printBank();
  const isQuote = kind === 'quote', isCredit = rec.kind === 'credit_note';
  const t = printedTotals(rec), docTotal = rec.total ?? t.total, paid = Number(rec.amount_paid) || 0;
  const balance = rec.status === 'void' || isCredit ? 0 : Math.max(0, Math.round((docTotal - paid) * 100) / 100);
  const state = docState(kind, rec), tag = TAG[state];
  const lines = rec.lines || [], anyDisc = lines.some(l => Number(l.discount_pct) > 0);
  const amountOf = l => l.amount ?? lineTotal(l.qty ?? 1, l.unit_price || 0, l.discount_pct || 0);
  const coLines = [c.legal_name, [c.reg_no && `Reg. ${c.reg_no}`, c.bbbee_level && `B-BBEE Level ${c.bbbee_level}`].filter(Boolean).join(' · '), c.address, [c.phone, c.email].filter(Boolean).join(' · '), c.website, c.vat_registered && c.vat_number ? `VAT no. ${c.vat_number}` : null].filter(Boolean).join('\n');
  const meta = isQuote
    ? [['Quote no.', rec.number || rec.legacy_number || 'DRAFT'], ['Date', rec.issue_date ? fmt.date(rec.issue_date, 'long') : rec.issue_date_raw || '—'], ['Valid until', rec.valid_until ? fmt.date(rec.valid_until, 'long') : '—'], rec.salesperson ? ['Prepared by', rec.salesperson] : null]
    : [[isCredit ? 'Credit note no.' : 'Invoice no.', rec.number || rec.legacy_number || 'DRAFT'], ['Date', rec.issue_date ? fmt.date(rec.issue_date, 'long') : rec.issue_date_raw || '—'], isCredit ? null : ['Due date', rec.due_date ? fmt.date(rec.due_date, 'long') : 'On receipt'], ['Reference', rec.reference || rec.number || rec.legacy_number || '—'], rec.period ? ['Service month', rec.period] : null];
  const totals = [['Subtotal', t.subtotal], t.discount ? ['Discount', -t.discount] : null, rec.vat_applied ? ['VAT', t.vat] : null, [isCredit ? 'CREDIT TOTAL' : 'TOTAL', docTotal, true], !isQuote && !isCredit && paid > 0 ? ['Paid', -paid] : null, !isQuote && !isCredit && paid > 0 ? ['BALANCE DUE', balance, true] : null, isQuote && rec.deposit_amount ? [`Deposit to confirm (${rec.deposit_pct}%)`, rec.deposit_amount] : null].filter(Boolean);
  const money = v => (v < 0 ? `− ${fmt.money(-v)}` : fmt.money(v));
  return h('div.docprev',
    h('div.dp-head',
      h('div.dp-co', h('img', { src: 'assets/landscapers-logo.jpg', alt: '' }), h('div', { style: 'min-width:0' }, h('div.dp-co-name', c.trading_name), h('div.dp-co-lines', coLines))),
      h('div.dp-title', h('h2', isQuote ? 'QUOTATION' : isCredit ? 'CREDIT NOTE' : c.vat_registered ? 'TAX INVOICE' : 'INVOICE'),
        tag ? h('span.dp-tag', { style: { background: tag[1] } }, tag[0]) : null,
        h('div.dp-meta', meta.filter(Boolean).flatMap(([k, v]) => [h('span', k), h('span', v)])))),
    h('div.dp-boxes',
      h('div.dp-box', h('div.k', isQuote ? 'PREPARED FOR' : 'BILL TO'), h('div.dp-bill', rec.bill_to || rec.client_name || '—')),
      isQuote
        ? h('div.dp-box', h('div.k', 'PROJECT'), h('div.lead', rec.title || 'Quotation'), rec.deposit_amount ? h('div.sub', `Deposit to confirm: ${fmt.money(rec.deposit_amount)} (${rec.deposit_pct}%)`) : null)
        : h('div.dp-box', h('div.k', isCredit ? 'CREDIT' : state === 'paid' ? 'PAID IN FULL' : 'AMOUNT DUE'), h('div.big', fmt.money(isCredit ? docTotal : state === 'paid' ? 0 : balance)), !isCredit && state !== 'paid' ? h('div.sub', rec.due_date ? `by ${fmt.date(rec.due_date, 'long')}` : 'on receipt') : null)),
    h('div', { style: 'overflow-x:auto' }, h('table',
      h('thead', h('tr', h('th', { style: 'width:32px;text-align:center' }, '#'), h('th', 'Description'), h('th.n', 'Qty'), h('th.n', 'Unit price'), anyDisc ? h('th.n', 'Disc.') : null, h('th.n', 'Amount'))),
      h('tbody', lines.length ? lines.map((l, i) => h('tr', h('td', { style: 'text-align:center;color:#6b746f' }, String(i + 1)), h('td', l.description), h('td.n', fmt.num(l.qty ?? 1, Number.isInteger(Number(l.qty ?? 1)) ? 0 : 2)), h('td.n', fmt.money(l.unit_price || 0)), anyDisc ? h('td.n', l.discount_pct ? `${l.discount_pct}%` : '') : null, h('td.n.amt', fmt.money(amountOf(l)))))
        : [h('tr', h('td', { colspan: anyDisc ? 6 : 5, style: 'color:#6b746f' }, 'No line items'))]))),
    h('div.dp-lower',
      !isQuote && bank ? h('div.dp-bank', h('div.k', 'BANKING DETAILS'), h('dl', ...[['Bank', bank.bank], ['Account name', bank.account_name], ['Account no.', bank.account_no], bank.branch_code ? ['Branch code', bank.branch_code] : null, bank.account_type ? ['Account type', bank.account_type] : null, ['Payment ref.', rec.reference || rec.number || rec.legacy_number || '']].filter(Boolean).flatMap(([k, v]) => [h('dt', k), h('dd', v || '—')]))) : h('div'),
      h('div.dp-tot', ...totals.flatMap(([k, v, strong]) => strong ? [h('span.g.k', k), h('span.g.v', money(v))] : [h('span', k), h('span.v', money(v))]))),
    rec.terms ? h('div.dp-sec', h('div.k', isQuote ? 'TERMS & CONDITIONS' : 'TERMS'), rec.terms) : null,
    !isQuote && c.invoice_footer_notes ? h('div.dp-sec', h('div.k', 'PAYMENT'), c.invoice_footer_notes) : null,
    rec.signature ? h('div.dp-sec', h('img', { src: rec.signature, alt: 'Signature', style: 'height:60px;display:block' }), isQuote ? `Accepted by ${rec.approved_name || 'client'}` : 'Client signature') : null,
    h('div.dp-foot', [c.trading_name, c.legal_name, c.reg_no ? `Reg. ${c.reg_no}` : null].filter(Boolean).join(' · ')),
    rec.total_override_reason ? h('div.dp-warn', `Internal note (not printed): ${rec.total_override_reason}`) : null);
}
