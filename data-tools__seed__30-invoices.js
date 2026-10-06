// Invoices April–July 2026 (from the PDFs) and the September debtors list (opening balances).
// Sources: knowledge/invoices_apr_may.json, invoices_june.json, invoices_july.json, financials.json (Sep "Outstanding").
import { lineTotal, toCents } from '../../js__core__money.js';

const MON = { 1: 'January', 2: 'February', 3: 'March', 4: 'April', 5: 'May', 6: 'June', 7: 'July', 8: 'August', 9: 'September', 10: 'October', 11: 'November', 12: 'December' };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export async function build(ctx) {
  const clients = Array.from((ctx.records.clients || new Map()).values());
  const byCode = new Map(clients.map(c => [String(c.legacy_code).toUpperCase(), c]));
  function matchClient(name, codeHint) {
    if (codeHint && byCode.has(codeHint.toUpperCase())) return byCode.get(codeHint.toUpperCase());
    const n = norm(name); if (!n) return null;
    const first = n.split(' ')[0];
    const exact = clients.filter(c => norm(c.name) === n || norm(c.contact_name) === n);
    if (exact.length === 1) return exact[0];
    const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
    const invHasSurname = n.split(' ').length > 1;
    const firstOk = t => {
      const f = t.split(' ')[0];
      if (f === first) return true;
      const fuzzy = (f.length >= 4 && first.length >= 4 && lev(f, first) <= 1) || (first.length >= 4 && f.startsWith(first)) || (f.length >= 4 && first.startsWith(f));
      if (!fuzzy) return false;
      // a fuzzy first-name match needs the surname to agree when the invoice gives one (Shaun Pillay ≠ Shain)
      if (invHasSurname) return t.split(' ').length > 1 && t.includes(n.split(' ').slice(1).join(' '));
      return true;
    };
    let cand = clients.filter(c => [c.name, c.contact_name].some(x => firstOk(norm(x))));
    if (cand.length > 1) { const surname = n.split(' ').slice(1).join(' '); if (surname) { const s = cand.filter(c => norm(c.name).includes(surname)); if (s.length) cand = s; } }
    if (cand.length > 1) { const act = cand.filter(c => c.status === 'active'); if (act.length === 1) cand = act; }
    return cand.length === 1 ? cand[0] : null;
  }
  const addrKey = a => { const k = norm(a); return /^\d/.test(k) && k.split(' ').length >= 3 ? k : null; }; // full address incl. house number
  function matchByAddress(address) {
    const k = addrKey(address); if (!k) return null;
    const hits = clients.filter(c => addrKey(c.address) === k);
    return hits.length === 1 ? hits[0] : null;
  }
  const out = { invoices: [] };
  const mkLines = lines => lines.map(l => {
    const qty = l.quantity, unit = l.unit_price, amt = l.amount ?? l.line_amount_printed ?? l.line_amount_computed;
    const desc = String(l.description || '').replace(/\s+/g, ' ').trim();
    if (qty != null && unit != null && amt != null && toCents(lineTotal(qty, unit)) === toCents(amt)) return { description: desc, qty, unit_price: unit, discount_pct: 0, amount: amt };
    return { description: qty != null && unit != null ? `${desc} (printed: ${qty} × R${Number(unit).toFixed(2)})` : desc, qty: 1, unit_price: amt, discount_pct: 0, amount: amt };
  });
  function push(inv, lines, meta) {
    const byName = matchClient(inv.client_name, meta.codeHint);
    const byAddr = byName ? null : matchByAddress(inv.address);
    const client = byName || byAddr;
    if (byAddr) meta.note = [meta.note, `Linked to ${byAddr.legacy_code} ${byAddr.name} by matching address "${inv.address}" (name printed as "${inv.client_name}").`].filter(Boolean).join('\n');
    const total = inv.total;
    const sum = lines.reduce((a, l) => a + toCents(l.amount), 0);
    out.invoices.push({
      id: ctx.id('inv', meta.key), number: null, legacy_number: meta.number, reference: meta.reference || null,
      client_id: client ? client.id : null, client_name: inv.client_name, bill_to: [inv.client_name, inv.address].filter(Boolean).join('\n'),
      kind: meta.kind, period: meta.period, issue_date: inv.issue_date, due_date: meta.due || null,
      lines, vat_applied: false, discount: 0, subtotal: sum / 100, vat: 0, total,
      amount_paid: 0, status: 'not_recorded',
      total_override_reason: sum !== toCents(total) ? `Printed total R${Number(total).toFixed(2)} differs from the printed line amounts (R${(sum / 100).toFixed(2)}) on the original invoice — kept exactly as printed; confirm which is correct.` : null,
      terms: meta.terms || null, notes: [client ? null : 'Client could not be matched to a CRM record automatically — link it manually.', meta.note].filter(Boolean).join('\n') || null,
      source_file: meta.file, _src: meta.src
    });
  }

  // April & May (template A) + July (templates B/C) — deterministic parser output
  for (const g of ['invoices_apr_may', 'invoices_july']) {
    if (!ctx.has(g)) continue;
    const K = ctx.k(g).entities;
    for (const i of K.invoices) {
      const lines = K.invoice_lines.filter(l => l.invoice_id === i.invoice_id).sort((a, b) => a.line_no - b.line_no);
      const refCode = (i.reference_raw || '').match(/^\s*([A-Z]{1,4})\s*\[/);
      const numDigits = (i.invoice_number_raw || '').match(/(\d{3})\s*(AD)?\s*$/);
      const codeHint = refCode && numDigits ? `${refCode[1]}${numDigits[1]}` : (/HSBC/.test(i.invoice_number_raw + i.source_file_name) ? 'HSBC001' : null);
      const isAdhoc = /AD\b|AD\.pdf/i.test(i.source_file_name) || lines.some(l => /lawn|rubble|planting|delivery|deposit|tree|clean/i.test(l.description) && !/maintenance/i.test(l.description));
      const due = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s*$/.exec(i.due_date_raw || '');
      const mi = due ? Object.entries(MON).find(([, m]) => m.slice(0, 3).toLowerCase() === due[2].toLowerCase()) : null;
      const monthName = MON[+i.folder_month.slice(5, 7)];
      const printedPeriod = (lines.map(l => l.description).join(' ').match(/Month of ([A-Za-z]+)/) || [])[1];
      const periodMonth = printedPeriod ? Object.entries(MON).find(([, m]) => m.toLowerCase() === printedPeriod.toLowerCase()) : null;
      push({ client_name: i.client_name, address: i.client_address, issue_date: i.invoice_date, total: i.total_printed }, mkLines(lines), {
        key: i.invoice_id, number: (i.invoice_number_raw || '').replace(/\s+/g, ' ').trim() || null, reference: i.reference_raw ? i.reference_raw.replace(/\s+/g, ' ').trim() : null,
        codeHint, kind: isAdhoc ? 'adhoc' : 'maintenance', period: periodMonth ? `2026-${String(periodMonth[0]).padStart(2, '0')}` : i.folder_month,
        due: due && mi ? `${due[3]}-${String(mi[0]).padStart(2, '0')}-${due[1].padStart(2, '0')}` : null,
        terms: g === 'invoices_july' ? 'Additional projects or services are invoiced separately from monthly services and are due within 7 days of completion and by due date indicated. Economical increase effective from 1 March annually.' : null,
        note: i.interpretation ? `Parsing note: ${i.interpretation}.` : null, file: i._src.split(' | ')[0], src: i._src
      });
      void monthName;
    }
  }
  // June (read by an agent) — same shape after mapping
  if (ctx.has('invoices_june')) {
    const K = ctx.k('invoices_june').entities;
    for (const i of K.invoices) {
      const lines = K.invoice_lines.filter(l => l.invoice_id === i.invoice_id).sort((a, b) => a.line_no - b.line_no);
      const adhoc = lines.some(l => /adhoc|ad_hoc|once/i.test(l.service_category || ''));
      push({ client_name: i.client_name, address: i.client_address, issue_date: i.invoice_date, total: i.total_printed }, mkLines(lines), {
        key: i.invoice_id, number: i.invoice_number, codeHint: i.crm_client_id_match || null, kind: adhoc && lines.every(l => /adhoc|ad_hoc|once/i.test(l.service_category || '')) ? 'adhoc' : 'maintenance',
        period: i.service_period || '2026-06', terms: i.payment_terms || null, note: adhoc && !lines.every(l => /adhoc|ad_hoc|once/i.test(l.service_category || '')) ? 'Mixed invoice: maintenance and ad-hoc lines.' : null,
        file: (i.actual_file_location || i._src.split(' | ')[0]), src: i._src
      });
    }
  }
  // September debtors ("Outstanding" block) — union of both income-statement versions, as opening balances
  const F = ctx.k('financials').entities;
  for (const r of F.receivables || []) {
    const client = matchClient(r.debtor_name, null);
    const onlyB = (r.present_in || []).length === 1;
    out.invoices.push({
      id: ctx.id('inv', 'ob', r.debtor_name), number: null, legacy_number: null, reference: null,
      client_id: client ? client.id : null, client_name: r.debtor_name, kind: 'balance', period: r.as_at_period || '2026-09',
      issue_date: '2026-09-23', lines: [{ description: 'Opening balance brought forward (September "Outstanding" list)', qty: 1, unit_price: r.amount_outstanding, discount_pct: 0, amount: r.amount_outstanding }],
      vat_applied: false, discount: 0, subtotal: r.amount_outstanding, vat: 0, total: r.amount_outstanding, amount_paid: 0, status: 'unpaid',
      notes: [`Imported from the September income-statement "Outstanding" block. The original invoice number and date were not recorded there; 23 Sep 2026 is the date the workbook was exported.`, onlyB ? 'Listed only in the earlier version of the September sheet (LSI_INCOME_STATEMENT.xlsx) — the CRM billing copy also shows this client as NOT PAID. Confirm whether it is still owed.' : null, client ? null : 'Not matched to a CRM client — link it manually.'].filter(Boolean).join('\n'),
      _src: r._src
    });
  }
  // People invoiced (or owing) who appear in no CRM copy: create "needs review" client records and link them.
  const groups = new Map();
  for (const inv of out.invoices.filter(i => !i.client_id)) {
    const key = norm(inv.client_name).split(' ')[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(inv);
  }
  out.clients = [];
  for (const [key, invs] of groups) {
    const names = [...new Set(invs.map(i => i.client_name))];
    const best = names.sort((a, b) => b.length - a.length)[0];
    const addr = (invs.find(i => i.bill_to && i.bill_to.includes('\n')) || {}).bill_to;
    const id = ctx.id('cl', 'inv', key);
    out.clients.push({ id, name: best, status: 'unverified', client_type: 'residential', address: addr ? addr.split('\n').slice(1).join(' ') : null,
      notes: `Found on ${invs.length} invoice(s)/debtor entries (${[...new Set(invs.map(i => i.period))].join(', ')}) but not in any copy of the CRM workbook.${names.length > 1 ? ` Name spelled: ${names.join(' / ')}.` : ''} Confirm whether this is a current client and complete the contact details.`,
      tags: ['From invoices'], _src: invs.map(i => i._src).join(' ; ') });
    for (const i of invs) { i.client_id = id; i.notes = (i.notes || '').replace('Client could not be matched to a CRM record automatically — link it manually.', 'Client is not in the CRM workbook — created as "needs review".').replace('Not matched to a CRM client — link it manually.', 'Client is not in the CRM workbook — created as "needs review".'); }
  }
  return out;
}
