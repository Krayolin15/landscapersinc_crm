/* =============================================================================
   Quote / invoice / credit-note PDF — the layout, kept pure (no DOM, no database)
   so it can be tested: tests__docpdf.test.js renders every invoice and quote in
   the company data and fails if any two pieces of text overlap or text runs into
   the margins or the footer.

   Layout rules (A4, millimetres): every block is measured before it is drawn;
   text that does not fit is wrapped, never allowed to run into its neighbour;
   blocks that do not fit on the page move to the next page together; nothing
   is drawn in the footer band except the footer itself.
   ========================================================================== */

import { formatMoney, lineTotal } from '../core/money.js';
import * as fmt from '../core/format.js';
import { printedTotals } from './_docmath.js';

export const PAGE = { W: 210, H: 297, M: 16, TOP: 18, BOTTOM: 272, FOOT: 280 };
const C = { dark: [16, 61, 36], green: [23, 90, 51], lime: [124, 194, 78], ink: [33, 37, 35], grey: [107, 116, 111], line: [222, 230, 225], soft: [244, 249, 245] };
const PT = 0.3528; // mm per point
const lineH = size => size * PT * 1.32;

/**
 * renderDocPdf(jsPDF, { kind: 'invoice'|'quote', rec, company, bank, logo, state }) → jsPDF document.
 * company: settings.company_profile (+defaults) · bank: default bank account or null · logo: JPEG data URL or ''
 * state: the invoice state for the status tag ('paid' | 'overdue' | 'void' | 'draft' | …) — optional.
 */
export function renderDocPdf(JsPDF, { kind, rec, company: c, bank, logo, state }) {
  const doc = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
  const { W, M, BOTTOM } = PAGE;
  const right = W - M;
  const isQuote = kind === 'quote';
  const isCredit = rec.kind === 'credit_note';
  const { font, wrap, widthOf } = tools(doc);
  const title = isQuote ? 'QUOTATION' : isCredit ? 'CREDIT NOTE' : c.vat_registered ? 'TAX INVOICE' : 'INVOICE';
  const meta = isQuote
    ? [['Quote no.', rec.number || rec.legacy_number || 'DRAFT'], ['Date', rec.issue_date ? fmt.date(rec.issue_date, 'long') : (rec.issue_date_raw || '—')], ['Valid until', rec.valid_until ? fmt.date(rec.valid_until, 'long') : '—'], rec.salesperson ? ['Prepared by', rec.salesperson] : null]
    : [[isCredit ? 'Credit note no.' : 'Invoice no.', rec.number || rec.legacy_number || 'DRAFT'], ['Date', rec.issue_date ? fmt.date(rec.issue_date, 'long') : (rec.issue_date_raw || '—')], isCredit ? null : ['Due date', rec.due_date ? fmt.date(rec.due_date, 'long') : 'On receipt'], ['Reference', rec.reference || rec.number || rec.legacy_number || '—'], rec.period ? ['Service month', monthName(rec.period)] : null];
  let y = pageHeader(doc, { company: c, logo, title, state, meta });

  const t = printedTotals(rec);
  const docTotal = rec.total ?? t.total;
  const paid = Number(rec.amount_paid) || 0;
  const balance = rec.status === 'void' || isCredit ? 0 : Math.max(0, Math.round((docTotal - paid) * 100) / 100);

  /* ---------- parties: bill to (left) | project or amount due (right) ---------- */
  const boxGap = 6, boxW = (W - 2 * M - boxGap) / 2, pad = 4;
  const billLines = String(rec.bill_to || rec.client_name || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 6);
  const leftRows = [];
  font('bold', 10, C.ink); billLines.slice(0, 1).forEach(t => wrap(t, boxW - 2 * pad).forEach(w => leftRows.push(['bold', 10, w])));
  font('normal', 8.8, C.ink); billLines.slice(1).forEach(t => wrap(t, boxW - 2 * pad).forEach(w => leftRows.push(['normal', 8.8, w])));
  const rightRows = [];
  let rightHeading;
  if (isQuote) {
    rightHeading = 'PROJECT';
    font('bold', 10, C.dark); wrap(rec.title || 'Quotation', boxW - 2 * pad).forEach(w => rightRows.push(['bold', 10, w, C.dark]));
    if (rec.deposit_amount) { font('normal', 8.5); rightRows.push(['normal', 8.5, `Deposit to confirm: ${formatMoney(rec.deposit_amount)} (${rec.deposit_pct}%)`, C.ink]); }
  } else {
    rightHeading = isCredit ? 'CREDIT' : state === 'paid' ? 'PAID IN FULL' : 'AMOUNT DUE';
    const due = isCredit ? docTotal : state === 'paid' ? 0 : balance;
    rightRows.push(['bold', 15, formatMoney(due || 0), C.dark]);
    if (!isCredit && state !== 'paid') rightRows.push(['normal', 8.5, rec.due_date ? `by ${fmt.date(rec.due_date, 'long')}` : 'on receipt', C.grey]);
  }
  const rowsH = rows => rows.reduce((a, r) => a + lineH(r[1]), 0);
  const HEAD_H = 6.2;                       // heading line + gap
  const firstAscent = rows => (rows.length ? rows[0][1] * PT * 0.8 : 0);
  const contentH = rows => (rows.length ? firstAscent(rows) + rowsH(rows) - lineH(rows[rows.length - 1][1]) + rows[rows.length - 1][1] * PT * 0.3 : 4);
  const boxH = 2 * pad + HEAD_H + Math.max(contentH(leftRows), contentH(rightRows));
  const drawBox = (x, heading, rows) => {
    doc.setDrawColor(...C.line); doc.setFillColor(...C.soft); doc.roundedRect(x, y, boxW, boxH, 2, 2, 'FD');
    font('bold', 7.2, C.green); doc.text(heading, x + pad, y + pad + 1.6);
    let by = y + pad + HEAD_H + firstAscent(rows);
    for (const [style, size, text, col] of rows) { font(style, size, col || C.ink); doc.text(text, x + pad, by); by += lineH(size); }
  };
  drawBox(M, isQuote ? 'PREPARED FOR' : 'BILL TO', leftRows);
  drawBox(M + boxW + boxGap, rightHeading, rightRows);
  y += boxH + 7;

  /* ---------- line items ---------- */
  const lines = Array.isArray(rec.lines) ? rec.lines : [];
  const anyDisc = lines.some(l => Number(l.discount_pct) > 0);
  const qtyText = l => fmt.num(l.qty ?? 1, Number.isInteger(Number(l.qty ?? 1)) ? 0 : 2);
  const amountOf = l => l.amount ?? lineTotal(l.qty ?? 1, l.unit_price || 0, l.discount_pct || 0);
  const head = anyDisc ? ['#', 'Description', 'Qty', 'Unit price', 'Disc.', 'Amount'] : ['#', 'Description', 'Qty', 'Unit price', 'Amount'];
  const body = lines.map((l, i) => {
    const r = [String(i + 1), String(l.description || ''), qtyText(l), formatMoney(Number(l.unit_price) || 0)];
    if (anyDisc) r.push(l.discount_pct ? `${l.discount_pct}%` : '');
    r.push(formatMoney(amountOf(l)));
    return r;
  });
  const colStyles = anyDisc
    ? { 0: { cellWidth: 9, halign: 'center' }, 2: { cellWidth: 14, halign: 'right' }, 3: { cellWidth: 28, halign: 'right' }, 4: { cellWidth: 14, halign: 'right' }, 5: { cellWidth: 30, halign: 'right', fontStyle: 'bold' } }
    : { 0: { cellWidth: 9, halign: 'center' }, 2: { cellWidth: 16, halign: 'right' }, 3: { cellWidth: 30, halign: 'right' }, 4: { cellWidth: 32, halign: 'right', fontStyle: 'bold' } };
  doc.autoTable({
    startY: y, margin: { left: M, right: M, top: PAGE.TOP + 4, bottom: PAGE.H - BOTTOM },
    head: [head], body: body.length ? body : [['', 'No line items', '', '', ...(anyDisc ? [''] : []), '']],
    showHead: 'everyPage', rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 2.4, bottom: 2.4, left: 2.2, right: 2.2 }, textColor: C.ink, lineColor: C.line, lineWidth: 0.2, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: C.dark, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: [249, 251, 250] },
    columnStyles: colStyles,
    didParseCell: d => { if (d.section === 'head' && d.column.index >= 2) d.cell.styles.halign = 'right'; if (d.section === 'head' && d.column.index === 0) d.cell.styles.halign = 'center'; }
  });
  y = doc.lastAutoTable.finalY + 7;

  /* ---------- totals (right) + banking details (left) — measured together, moved together ---------- */
  const totalRows = [['Subtotal', t.subtotal]];
  if (t.discount) totalRows.push(['Discount', -t.discount]);
  if (rec.vat_applied) totalRows.push([`VAT (${Math.round((c.vatRate || 0.15) * 100)}%)`, t.vat]);
  totalRows.push([isCredit ? 'CREDIT TOTAL' : 'TOTAL', docTotal, true]);
  if (!isQuote && !isCredit && paid > 0) { totalRows.push(['Paid', -paid]); totalRows.push(['BALANCE DUE', balance, true]); }
  if (isQuote && rec.deposit_amount) totalRows.push([`Deposit to confirm (${rec.deposit_pct}%)`, rec.deposit_amount]);
  const TOT_W = 82;
  const totH = totalRows.reduce((a, r) => a + (r[2] ? 9 : 6.2), 0);
  const bankRows = !isQuote && bank ? [['Bank', bank.bank], ['Account name', bank.account_name], ['Account no.', bank.account_no], bank.branch_code ? ['Branch code', bank.branch_code] : null, bank.account_type ? ['Account type', bank.account_type] : null, ['Payment ref.', rec.reference || rec.number || rec.legacy_number || '']].filter(Boolean) : [];
  const BANK_W = W - 2 * M - TOT_W - 8;
  const BANK_LABEL = 25;
  font('normal', 8.4);
  const bankLines = bankRows.map(([k, v]) => [k, wrap(v || '—', BANK_W - BANK_LABEL - 2)]);
  const bankH = bankRows.length ? 6 + bankLines.reduce((a, [, vl]) => a + vl.length * lineH(8.4) + 0.6, 0) : 0;
  const blockH = Math.max(totH, bankH);
  if (y + blockH > BOTTOM) { doc.addPage(); y = PAGE.TOP + 4; }
  let ty = y + 4;
  for (const [k, v, strong] of totalRows) {
    if (strong) {
      doc.setFillColor(...C.dark); doc.roundedRect(right - TOT_W, ty - 4.9, TOT_W, 7.6, 1.4, 1.4, 'F');
      font('bold', 10.5, [255, 255, 255]);
    } else font('normal', 9.2, [70, 76, 72]);
    doc.text(k, right - TOT_W + 4, ty); doc.text(formatMoney(v), right - 3.5, ty, { align: 'right' });
    ty += strong ? 9 : 6.2;
  }
  if (bankRows.length) {
    let by = y + 1;
    font('bold', 7.6, C.green); doc.text('BANKING DETAILS', M, by + 3); by += 8;
    for (const [k, vl] of bankLines) {
      font('normal', 8.4, C.grey); doc.text(k, M, by);
      font('bold', 8.4, C.ink); vl.forEach((line, i) => doc.text(line, M + BANK_LABEL, by + i * lineH(8.4)));
      by += vl.length * lineH(8.4) + 0.6;
    }
  }
  y += blockH + 8;

  /* ---------- terms & notes (wrapped, paginated line by line, never into the footer) ---------- */
  const sections = [];
  if (rec.terms) sections.push([isQuote ? 'TERMS & CONDITIONS' : 'TERMS', rec.terms]);
  if (!isQuote && c.invoice_footer_notes) sections.push(['PAYMENT', c.invoice_footer_notes]);
  if (rec.notes_public) sections.push(['NOTES', rec.notes_public]);
  for (const [heading, text] of sections) {
    if (y + 10 > BOTTOM) { doc.addPage(); y = PAGE.TOP + 4; }
    font('bold', 7.6, C.green); doc.text(heading, M, y); y += 4.6;
    font('normal', 8.2, [74, 80, 76]);
    for (const para of String(text).split(/\n+/)) {
      for (const line of wrap(para, W - 2 * M)) {
        if (y + lineH(8.2) > BOTTOM) { doc.addPage(); y = PAGE.TOP + 4; font('normal', 8.2, [74, 80, 76]); }
        doc.text(line, M, y); y += lineH(8.2);
      }
      y += 1.2;
    }
    y += 3;
  }

  /* ---------- signature ---------- */
  if (rec.signature) {
    if (y + 28 > BOTTOM) { doc.addPage(); y = PAGE.TOP + 4; }
    try { doc.addImage(rec.signature, 'PNG', M, y, 50, 18); } catch { /* bad signature image: skip the picture, keep the caption */ }
    doc.setDrawColor(...C.line); doc.line(M, y + 19.5, M + 60, y + 19.5);
    font('normal', 7.6, C.grey);
    doc.text(isQuote ? `Accepted by ${rec.approved_name || 'client'}${rec.approved_at ? ` on ${fmt.date(rec.approved_at)}` : ''}` : 'Client signature', M, y + 23.5);
    y += 28;
  }

  pageFooters(doc, c);
  return doc;
}

/* =============================================================================
   Shared pieces
   ========================================================================== */
function tools(doc) {
  return {
    font: (style = 'normal', size = 9, color = C.ink) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); },
    wrap: (text, width) => doc.splitTextToSize(String(text ?? ''), width),
    widthOf: s => doc.getTextWidth(String(s))
  };
}
const TAGS = { paid: ['PAID', [31, 116, 64]], overdue: ['OVERDUE', [192, 57, 43]], void: ['VOID', [120, 120, 120]], draft: ['DRAFT', [120, 120, 120]], partially_paid: ['PART-PAID', [185, 119, 14]], accepted: ['ACCEPTED', [31, 116, 64]], rejected: ['DECLINED', [192, 57, 43]], expired: ['EXPIRED', [120, 120, 120]] };

/** Top band, company block (left, wrapped to its own column), title + status tag + details (right). Returns the y below it. */
function pageHeader(doc, { company: c, logo, title, state, meta }) {
  const { W, M } = PAGE, right = W - M;
  const { font, wrap, widthOf } = tools(doc);
  doc.setFillColor(...C.dark); doc.rect(0, 0, W, 5, 'F');
  doc.setFillColor(...C.lime); doc.rect(0, 5, W, 1.2, 'F');
  const RIGHT_W = 66, rightX = right - RIGHT_W, logoSize = 24, hasLogo = !!logo;
  if (hasLogo) { try { doc.addImage(logo, 'JPEG', M, 12, logoSize, logoSize); } catch { /* a bad image never stops the document */ } }
  const leftX = hasLogo ? M + logoSize + 5 : M;
  const leftW = rightX - 6 - leftX;          // a clear 6 mm gutter before the right column
  let ly = 17.5;
  font('bold', 15, C.dark);
  for (const t of wrap(c.trading_name || 'Landscapers Inc', leftW)) { doc.text(t, leftX, ly); ly += lineH(15); }
  ly += 0.6;
  font('normal', 7.8, C.grey);
  const details = [
    c.legal_name || null,
    [c.reg_no ? `Reg. ${c.reg_no}` : null, c.bbbee_level ? `B-BBEE Level ${c.bbbee_level}` : null].filter(Boolean).join('  ·  '),
    c.address,
    [c.phone, c.email].filter(Boolean).join('  ·  '),
    c.website,
    c.vat_registered && c.vat_number ? `VAT no. ${c.vat_number}` : null
  ].filter(Boolean).flatMap(t => String(t).split('\n'));
  for (const d of details) for (const t of wrap(d, leftW)) { doc.text(t, leftX, ly); ly += lineH(7.8); }
  const leftBottom = Math.max(ly, hasLogo ? 12 + logoSize : 0);
  let ry = 19;
  font('bold', 20, C.green); doc.text(title, right, ry, { align: 'right' });
  ry += 3;
  const tag = state && TAGS[state];
  if (tag) {
    font('bold', 7.5, [255, 255, 255]);
    const tw = widthOf(tag[0]) + 5;
    doc.setFillColor(...tag[1]); doc.roundedRect(right - tw, ry, tw, 5, 1.2, 1.2, 'F');
    doc.text(tag[0], right - tw / 2, ry + 3.5, { align: 'center' });
    ry += 10.5;
  } else ry += 3;
  const LABEL_W = 25;
  for (const row of meta.filter(Boolean)) {
    const [k, v] = row;
    font('normal', 8, C.grey); doc.text(k, rightX, ry);
    font('bold', 8.5, C.ink);
    const vl = wrap(v, RIGHT_W - LABEL_W);
    vl.forEach((t, i) => doc.text(t, right, ry + i * lineH(8.5), { align: 'right' }));
    ry += Math.max(1, vl.length) * lineH(8.5) + 1.1;
  }
  let y = Math.max(leftBottom, ry) + 5;
  doc.setDrawColor(...C.line); doc.setLineWidth(0.3); doc.line(M, y, right, y);
  return y + 6;
}

/** Footer on every page: company line, page x of y, the brand bar. */
function pageFooters(doc, c) {
  const { W, M, H, FOOT } = PAGE, right = W - M;
  const { font, wrap, widthOf } = tools(doc);
  const pages = doc.getNumberOfPages();
  const footLeft = [c.trading_name, c.legal_name, c.reg_no ? `Reg. ${c.reg_no}` : null].filter(Boolean).join('  ·  ');
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...C.line); doc.setLineWidth(0.3); doc.line(M, FOOT, right, FOOT);
    font('normal', 7.2, C.grey);
    const pageText = pages > 1 ? `Page ${p} of ${pages}` : '';
    const room = W - 2 * M - (pageText ? widthOf(pageText) + 6 : 0);
    doc.text(wrap(footLeft, room)[0] || '', M, FOOT + 4.5);
    if (pageText) doc.text(pageText, right, FOOT + 4.5, { align: 'right' });
    doc.setFillColor(...C.lime); doc.rect(0, H - 3, W, 3, 'F');
  }
}

/* =============================================================================
   Client statement
   ========================================================================== */
/**
 * renderStatementPdf(jsPDF, { company, bank, logo, client: { name, bill_to }, date, events: [{ date, text, debit, credit }], aging: { b0, b31, b60, total } })
 * → jsPDF document. Events are listed oldest first with a running balance.
 */
export function renderStatementPdf(JsPDF, { company: c, bank, logo, client, date, events, aging }) {
  const doc = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
  const { W, M, BOTTOM } = PAGE, right = W - M;
  const { font, wrap } = tools(doc);
  let y = pageHeader(doc, { company: c, logo, title: 'STATEMENT', state: null, meta: [['Client', client.name || '—'], ['Date', fmt.date(date, 'long')], ['Amount due', formatMoney((aging && aging.total) || 0)]] });
  // client box
  const pad = 4, boxW = 100;
  const rows = String(client.bill_to || client.name || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 6);
  font('normal', 9);
  const lines = rows.flatMap((r, i) => wrap(r, boxW - 2 * pad).map(t => [i === 0 ? 'bold' : 'normal', i === 0 ? 10 : 8.8, t]));
  const boxH = 2 * pad + 6.2 + (lines.length ? lines[0][1] * PT * 0.8 + lines.reduce((a, l) => a + lineH(l[1]), 0) - lineH(lines[lines.length - 1][1]) + 1 : 4);
  doc.setDrawColor(...C.line); doc.setFillColor(...C.soft); doc.roundedRect(M, y, boxW, boxH, 2, 2, 'FD');
  font('bold', 7.2, C.green); doc.text('STATEMENT FOR', M + pad, y + pad + 1.6);
  let by = y + pad + 6.2 + (lines.length ? lines[0][1] * PT * 0.8 : 0);
  for (const [style, size, t] of lines) { font(style, size); doc.text(t, M + pad, by); by += lineH(size); }
  y += boxH + 7;
  // ledger with running balance
  let bal = 0;
  const body = (events || []).map(e => {
    bal = Math.round((bal + (Number(e.debit) || 0) - (Number(e.credit) || 0)) * 100) / 100;
    return [e.date ? fmt.date(e.date) : '—', String(e.text || ''), e.debit ? formatMoney(e.debit) : '', e.credit ? formatMoney(e.credit) : '', formatMoney(bal)];
  });
  doc.autoTable({
    startY: y, margin: { left: M, right: M, top: PAGE.TOP + 4, bottom: PAGE.H - BOTTOM },
    head: [['Date', 'Description', 'Debit', 'Credit', 'Balance']], body: body.length ? body : [['', 'No transactions', '', '', '']],
    showHead: 'everyPage', rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.3, textColor: C.ink, lineColor: C.line, lineWidth: 0.2, overflow: 'linebreak' },
    headStyles: { fillColor: C.dark, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: [249, 251, 250] },
    columnStyles: { 0: { cellWidth: 26 }, 2: { cellWidth: 27, halign: 'right' }, 3: { cellWidth: 27, halign: 'right' }, 4: { cellWidth: 29, halign: 'right', fontStyle: 'bold' } },
    didParseCell: d => { if (d.section === 'head' && d.column.index >= 2) d.cell.styles.halign = 'right'; }
  });
  y = doc.lastAutoTable.finalY + 7;
  // ageing (right) + banking (left), moved together
  const ageRows = [['0–30 days', aging ? aging.b0 : 0], ['31–60 days', aging ? aging.b31 : 0], ['60+ days', aging ? aging.b60 : 0], ['AMOUNT DUE', aging ? aging.total : 0, true]];
  const bankRows = bank ? [['Bank', bank.bank], ['Account name', bank.account_name], ['Account no.', bank.account_no], bank.branch_code ? ['Branch code', bank.branch_code] : null].filter(Boolean) : [];
  const TOT_W = 82, BANK_W = W - 2 * M - TOT_W - 8;
  font('normal', 8.4);
  const bankLines = bankRows.map(([k, v]) => [k, wrap(v || '—', BANK_W - 27)]);
  const blockH = Math.max(ageRows.length * 6.2 + 3, bankRows.length ? 8 + bankLines.reduce((a, [, vl]) => a + vl.length * lineH(8.4) + 0.6, 0) : 0);
  if (y + blockH > BOTTOM) { doc.addPage(); y = PAGE.TOP + 4; }
  let ty = y + 4;
  for (const [k, v, strong] of ageRows) {
    if (strong) { doc.setFillColor(...C.dark); doc.roundedRect(right - TOT_W, ty - 4.9, TOT_W, 7.6, 1.4, 1.4, 'F'); font('bold', 10.5, [255, 255, 255]); } else font('normal', 9.2, [70, 76, 72]);
    doc.text(k, right - TOT_W + 4, ty); doc.text(formatMoney(v || 0), right - 3.5, ty, { align: 'right' });
    ty += strong ? 9 : 6.2;
  }
  if (bankRows.length) {
    let bky = y + 1;
    font('bold', 7.6, C.green); doc.text('BANKING DETAILS', M, bky + 3); bky += 8;
    for (const [k, vl] of bankLines) { font('normal', 8.4, C.grey); doc.text(k, M, bky); font('bold', 8.4, C.ink); vl.forEach((line, i) => doc.text(line, M + 27, bky + i * lineH(8.4))); bky += vl.length * lineH(8.4) + 0.6; }
  }
  pageFooters(doc, c);
  return doc;
}

function monthName(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  return m ? fmt.date(`${m[1]}-${m[2]}-01`, 'long').replace(/^\d+\s+/, '') : String(period || '');
}
