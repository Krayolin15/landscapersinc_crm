// Leads, quotes, prospects (cold-call log + retirement-village list) and call attempts.
// Source: knowledge/sales_leads.json (SALES WORKBOOK.xlsx, CALLS PDF, retirement list scan).
const STAGE = { 'new enquiry': 'new', qualified: 'qualified', 'site visit': 'site_visit', 'quote sent': 'quote_sent', 'follow-up': 'follow_up', 'follow up': 'follow_up', won: 'won', lost: 'lost' };
const QSTATUS = { sent: 'sent', accepted: 'accepted', expired: 'expired', rejected: 'rejected', draft: 'draft' };
const SOURCES = ['Referral', 'Google', 'Website', 'Repeat Client', 'Social Media', 'Walk-in'];
const GENERIC = /^(residential|commercial|estate agent|estate agents?|church|school|agency|business|industrial|property|office|n\/?a)$/i;
function segmentOf(s) {
  const t = String(s || '').toLowerCase();
  if (/estate agent|realty|pam golding|properties|property/.test(t)) return 'Estate agent';
  if (/retire|care|frail/.test(t)) return 'Retirement village';
  if (/school|college|curro/.test(t)) return 'School';
  if (/church/.test(t)) return 'Church';
  if (/hotel|lodge|guest/.test(t)) return 'Hospitality';
  if (/office park|business park|office/.test(t)) return 'Office park';
  if (/body corporate|hoa/.test(t)) return 'Body corporate';
  if (/estate|mews|village|manor|ridge|glades/.test(t)) return 'Estate / HOA';
  if (/mall|retail|dealership|bmw|alfa|motors/.test(t)) return 'Retail';
  if (/factory|industrial|commercial|capital|huhtamaki/.test(t)) return 'Commercial / industrial';
  if (/residential|house|home/.test(t)) return 'Residential';
  return null;
}
const iso = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const cap = s => (s ? s.trim().replace(/\b\w/g, c => c.toUpperCase()).replace(/\s+/g, ' ') : null);

export async function build(ctx) {
  const E = ctx.k('sales_leads').entities;
  const out = { leads: [], quotes: [], prospects: [], call_attempts: [] };
  for (const l of E.leads) {
    const company = ctx.trim(l.client_company_industry);
    const contact = ctx.trim(l.contact_name);
    const name = company && !GENERIC.test(company) ? company : [contact, company].filter(Boolean).join(' — ') || `Lead ${l.lead_id}`;
    const stage = STAGE[String(l.stage || '').trim().toLowerCase()] || 'new';
    const extra = [];
    if (l.follow_up_date_raw && !iso(l.follow_up_date)) extra.push(`Follow-up as written: "${l.follow_up_date_raw}"`);
    if (l.last_contact_raw && !iso(l.last_contact)) extra.push(`Last contact as written: "${l.last_contact_raw}"`);
    if (l.enquiry_date_raw && !iso(l.enquiry_date)) extra.push(`Enquiry date as written: "${l.enquiry_date_raw}"`);
    out.leads.push({
      id: ctx.id('ld', 'row', l.row), legacy_id: l.lead_id, name, segment: segmentOf(`${company} ${l.notes || ''}`), contact_name: contact,
      phone: ctx.phone(l.phone_digits || l.phone), email: /@/.test(l.email || '') ? String(l.email).trim().split(/[\s;,/]+/)[0] : null, address: ctx.trim(l.address) === 'NA' ? null : ctx.trim(l.address),
      source: SOURCES.includes(ctx.trim(l.lead_source)) ? ctx.trim(l.lead_source) : l.lead_source ? 'Other' : null,
      value: ctx.money(l.value), stage, listed_by: cap(l.listed_by),
      enquiry_date: iso(l.enquiry_date), last_contact: iso(l.last_contact), follow_up_date: ['won', 'lost'].includes(stage) ? iso(l.follow_up_date) : iso(l.follow_up_date),
      next_action: ctx.trim(l.next_action) && !/^(na|n\/a)$/i.test(ctx.trim(l.next_action)) ? ctx.trim(l.next_action) : null,
      notes: [ctx.trim(l.notes) && !/^closed$/i.test(ctx.trim(l.notes)) ? ctx.trim(l.notes) : null, ...extra, l.follow_up_status && l.follow_up_status !== l.follow_up_status_expected_as_of_2026_09_23 ? `Sheet showed follow-up status "${l.follow_up_status}"` : null].filter(Boolean).join('\n') || null,
      raw: { row: l.row, follow_up_status: l.follow_up_status, days_active: l.days_active },
      _src: l._src
    });
  }
  const leadIdByRow = row => ctx.id('ld', 'row', row);
  for (const q of E.quotes) {
    if (!q.client && !q.amount && !q.description) continue; // blank row 21
    const status = QSTATUS[String(q.status || '').trim().toLowerCase()] || 'draft';
    const amt = ctx.money(q.amount);
    out.quotes.push({
      id: ctx.id('qt', 'row', q.row), number: null, legacy_number: q.quote_number != null ? String(q.quote_number) : null,
      lead_id: (q.matched_lead_rows || [])[0] ? leadIdByRow(q.matched_lead_rows[0]) : null,
      client_name: ctx.trim(q.client), title: ctx.trim(q.description) || 'Quote', issue_date: iso(q.date_issued), issue_date_raw: iso(q.date_issued) ? null : (q.date_issued_raw || q.date_issued || null),
      valid_until: iso(q.valid_until), status, total: amt, salesperson: cap(q.created_by),
      notes: [amt == null ? `Amount as written: "${q.amount_raw ?? q.amount}"` : null, q.past_valid_until_but_status_sent ? 'Still marked "Sent" after its valid-until date in the old register.' : null, (q.matched_lead_rows || []).length > 1 ? `Lead reference matched several rows: ${q.matched_lead_rows.join(', ')}` : null].filter(Boolean).join('\n') || null,
      deposit_status: status === 'accepted' ? 'requested' : 'not_required',
      _src: q._src
    });
  }
  for (const p of E.cold_call_prospects) {
    const cls = String(p.last_outcome_class || '');
    const status = !p.attempt_count ? 'not_called' : /positive|callback|open_for/.test(cls) ? 'callback' : /meeting|interested/.test(cls) ? 'interested' : /declin|negative|redirect/.test(cls) ? 'declined' : /routing|no_answer/.test(cls) ? 'unreachable' : 'in_progress';
    const pid = ctx.id('pr', 'calls', p.seq);
    out.prospects.push({ id: pid, name: ctx.trim(p.prospect_name), category: segmentOf(p.prospect_name), campaign: 'Cold calls — March 2026', phone: ctx.phone(p.phone), phones_all: (p.phone_numbers || []).map(ctx.phone).filter(Boolean), email: (p.emails_found || [])[0] || null, status, attempts: p.attempt_count || 0, last_outcome: ctx.trim(p.last_outcome), notes: (p.other_numbers_in_notes || []).length ? `Other numbers: ${p.other_numbers_in_notes.join(', ')}` : null, _src: p._src });
    for (const a of (E.cold_call_attempts || []).filter(x => x.prospect_seq === p.seq)) {
      out.call_attempts.push({ id: ctx.id('ca', p.seq, a.attempt_no), prospect_id: pid, attempt_no: a.attempt_no, date: iso(a.date), channel: /email/.test(a.outcome_class) ? 'email' : /whatsapp/.test(a.outcome_class) ? 'whatsapp' : /site_visit/.test(a.outcome_class) ? 'visit' : 'call', outcome: ctx.trim(a.outcome_text), outcome_class: ({ email_obtained: 'email_sent' })[a.outcome_class] || (['no_answer', 'email_sent', 'whatsapp_sent', 'callback', 'meeting', 'declined', 'routing_issue', 'site_visit', 'interested'].includes(a.outcome_class) ? a.outcome_class : 'other'), _src: a._src });
    }
  }
  for (const r of E.retirement_village_prospects) {
    out.prospects.push({ id: ctx.id('pr', 'retire', r.seq), name: ctx.trim(r.facility_name || r.name_as_printed), category: 'Retirement village', campaign: 'Retirement villages & care centres list (2017)', area: ctx.trim(r.area), phone: ctx.phone((r.phone_numbers_normalized || [])[0] || r.phone), phones_all: (r.phone_numbers_normalized || []).map(ctx.phone).filter(Boolean), care_type: ctx.trim(r.accommodation_care_type), status: 'verify_details', attempts: 0, notes: `As printed: "${r.name_as_printed}" · phone "${r.phone}" · list dated ${r.list_year} — verify the number before calling.`, _src: r._src });
  }
  return out;
}
