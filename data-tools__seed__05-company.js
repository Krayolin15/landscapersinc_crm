// Company profile, sign-in accounts, bank account, compliance documents, the Carron Glen
// meeting + action items, external contacts, and the compliance calendar.
// Source: knowledge/company_compliance.json (+ existing_crm_seed.json TEAM_MEMBERS / COMPANY_PROFILE).
import { createHash } from 'node:crypto';
import { hashPassword } from '../../tools__hash.js';

const iso = v => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : null; };
const strip = o => { const { _src, ...r } = o; return r; };
const statusFor = exp => (!exp ? 'unknown' : exp < '2026-09-23' ? 'expired' : exp <= '2026-12-22' ? 'expiring' : 'valid');
const salt = id => createHash('sha256').update(`lsi-seed-salt|${id}`).digest('hex').slice(0, 32); // deterministic data pack

export async function build(ctx) {
  const C = ctx.k('company_compliance').entities;
  const facts = Object.fromEntries(C.company_facts.map(f => [f.fact, f.value]));
  const out = { settings: [], profiles: [], bank_accounts: [], compliance_docs: [], meetings: [], tasks: [], contacts: [], events: [], calendars: [] };

  /* ---------- company profile ---------- */
  out.settings.push({ id: 'set-company-profile', key: 'company_profile', description: 'Company details used on quotes, invoices and letterheads.', value: {
    trading_name: 'Landscapers Inc', legal_name: 'JKN Property Consortium (Pty) Ltd', reg_no: facts.registration_number, cipc_enterprise_no: facts.cipc_enterprise_number,
    address: facts.registered_office_address, postal_code: '4300', phone: facts.company_phone, email: 'Sales@landscapersinc.co.za', accounts_email: null, website: null,
    whatsapp: '+27 70 695 7485', directors: ['Jared Emmanuel Naidoo'], vat_registered: false, vat_number: null, tax_ref: facts.sars_income_tax_reference, bbbee_level: '1', coida_no: null,
    financial_year_end: 'February', tagline: facts.tagline, positioning: facts.positioning,
    invoice_prefix: 'LSI-', next_invoice_no: 1001, quote_prefix: 'QT-', next_quote_no: 1001, default_due_days: 7, quote_valid_days: 30, deposit_pct: 50,
    invoice_terms: 'Additional projects or services are invoiced separately from monthly services and are due within 7 days of completion and by due date indicated. Economical increase effective from 1 March annually.',
    invoice_footer_notes: 'Please use your invoice number as the payment reference and send proof of payment to Sales@landscapersinc.co.za or WhatsApp 070 695 7485.',
    quote_terms: 'This quotation is valid for 30 days. A 50% deposit confirms the booking; the balance is due on completion. Any work not listed is quoted separately.'
  }, _src: 'knowledge/company_compliance.json company_facts' });

  /* ---------- sign-in accounts (local mode; Supabase uses its own auth) ---------- */
  const users = [
    { key: 'jared', name: 'Jared Emmanuel Naidoo', role: 'owner', title: 'Director', department: 'Management', color: '#175a33' },
    { key: 'anthony', name: 'Anthony Samuel Guruvadu', role: 'admin', title: 'General Manager', department: 'Management', email: 'anthonyguruvadu@gmail.com', color: '#1e9bc4' },
    { key: 'renesh', name: 'Renesh Gunpath', role: 'manager', title: 'Operational Manager', department: 'Operations', color: '#c8733a' },
    { key: 'wayne', name: 'Wayne', role: 'sales', title: 'Field & Sales', department: 'Sales', color: '#f2b42f' }
  ];
  // the old CRM's default passwords are private: they live in knowledge/existing_crm_logins.json, never in this code
  const logins = ctx.has('existing_crm_logins') ? ctx.k('existing_crm_logins').entities.logins : [];
  if (!logins.length) ctx.notes.push('knowledge/existing_crm_logins.json missing — the four staff logins are created without a password (local mode sign-in disabled until an admin sets one)');
  for (const u of users) {
    const id = `prof-${u.key}`;
    const pw = (logins.find(l => l.key === u.key) || {}).pw;
    const { hash, salt: s } = pw ? hashPassword(pw, salt(id)) : { hash: null, salt: null };
    out.profiles.push({ id, name: u.name, email: u.email || null, role: u.role, title: u.title, department: u.department, color: u.color, status: 'active', password_hash: hash, password_salt: s, must_change_password: true,
      _src: 'knowledge/company_compliance.json people; existing_crm_seed.json TEAM_MEMBERS (default password from the old CRM, must be changed at first sign-in)' });
  }

  /* ---------- bank ---------- */
  const b = C.bank_accounts[0];
  out.bank_accounts.push({ id: 'bank-std-10264092722', account_name: b.account_holder, bank: 'Standard Bank (Cornubia)', account_no: b.account_number, branch_code: '051001', account_type: 'Current (MyMoBiz)', is_default: true,
    notes: `Universal branch code for electronic payments 051001. Letters also print Cornubia branch codes 006227 (Aug 2026) and 046227 (Dec 2025). SWIFT ${b.swift}. Opened ${b.date_account_opened || b.date_opened}. Confirm which code to print — see Data health.`, _src: b._src });

  /* ---------- compliance documents ---------- */
  const doc = (id, name, doc_type, number, issuer, issue, expiry, x, summary) => out.compliance_docs.push({ id, name, doc_type, number: number || null, issuer: issuer || null, issue_date: iso(issue), expiry_date: iso(expiry), status: statusFor(iso(expiry)), key_facts: strip(x), summary, _src: x._src });
  const reg = C.company_registrations[0];
  doc('cd-cipc-cor211', 'CIPC registration (COR 21.1 address change)', 'company_registration', reg.registration_number, 'CIPC', reg.issued_at, null, reg, `JKN Property Consortium (Pty) Ltd, registered ${reg.registration_date}. Registered office: ${facts.registered_office_address}. Financial year end February.`);
  const tax = C.tax_registrations[0];
  doc('cd-sars-it', 'SARS income tax registration', 'tax_clearance', tax.taxpayer_reference_number, 'SARS', tax.notice_date, null, tax, `Income tax reference ${tax.taxpayer_reference_number}, registered ${tax.date_of_registration}. Provisional taxpayer — payments due end of August and end of February. NOTE: this is a registration notice, not a Tax Compliance Status PIN.`);
  const bee = C.bbbee_certificates[0];
  doc('cd-bbbee', 'B-BBEE EME certificate (Level 1)', 'bbbee', bee.certificate_number, 'CIPC for the dtic', bee.date_of_issue, bee.expiry_date, bee, `Level 1 contributor, 135% procurement recognition. Valid ${bee.date_of_issue} to ${bee.expiry_date}. Renew about 60 days before expiry.`);
  const ins = C.insurance_policies[0];
  doc('cd-outsurance', 'Public liability insurance — OUTsurance', 'insurance', ins.policy_number, 'OUTsurance Business', ins.confirmation_date, '2027-01-13', ins, `Policy ${ins.policy_number}, inception ${ins.inception_date}, public liability R1,000,000; premium collected monthly on the 1st. Review at the January anniversary.`);
  for (const a of C.authorisations) {
    if (/COIDA/.test(a.document_type)) doc('cd-coida-poa', 'COIDA special power of attorney', 'coida', a.coid_number, 'Compensation Fund (Dept. of Labour)', a.date, a.valid_until_derived, a, 'Special power of attorney for the Compensation Fund, valid 12 months from 1 June 2026. Appointee and COID number were left blank on the signed copy.');
    else doc('cd-proxy-2026-07-17', 'Proxy — Jared Naidoo to Anthony Guruvadu', 'proxy', null, 'Jared Naidoo', a.date, null, a, 'Letter of authority from 17 July 2026 until revoked: Anthony Guruvadu may act for the business on Jared Naidoo’s behalf.');
  }
  C.bank_confirmation_letters.forEach(l => doc(ctx.id('cd-bank', l.id), `Bank confirmation letter (${l.date})`, 'bank_confirmation', l.account_number, 'Standard Bank', l.date, null, l, `Account ${l.account_number}, ${l.branch} branch code ${l.branch_code}${l.branch_code_electronic_payments ? `, electronic payments ${l.branch_code_electronic_payments}` : ''}.`));
  C.identity_documents.forEach(d => doc('cd-director-id', 'Director ID — Jared Emmanuel Naidoo (certified copy)', 'director_id', d.identity_number, 'Department of Home Affairs', d.date_of_issue, null, d, 'Certified copy of the director’s smart ID card.'));
  C.contract_templates.forEach(t => doc(ctx.id('cd-tpl', t.id), t.title, 'contract', null, 'Landscapers Inc', t.effective_date || t.document_date, null, t, 'Employment contract template.'));
  C.business_profiles.forEach(p => doc('cd-profile-2026', p.title, 'profile', null, 'Landscapers Inc', null, null, p, 'Company profile / contract submission document.'));
  const ps = C.price_schedule_summaries;
  doc('cd-price-schedule-2026', 'Client paid & invoice schedule 2026 (price schedule)', 'pricing_schedule', null, 'Landscapers Inc', '2026-06-04', null, { summaries: ps.map(strip), entries: C.price_schedule_entries.map(strip), _src: C.price_schedule_entries.map(e => e._src).filter((v, i, a) => v && a.indexOf(v) === i).join(' ; ') }, `Two tables of maintenance clients by service day: A ${ps[0].rows} rows (R${ps[0].computed_total_rand}), B ${ps[1].rows} rows (R${ps[1].computed_total_rand}); no totals printed on the source.`);

  /* ---------- meeting + actions ---------- */
  for (const m of C.meetings) {
    const acts = C.action_items.filter(a => a.meeting_id === m.id);
    out.meetings.push({ id: ctx.id('mtg', m.id), title: m.title, kind: 'client', date: m.date, time: m.time, attendees: (m.attendees || []).join(', '), agenda: m.agenda || null,
      minutes: `<p>${String(m.purpose || '').replace(/[<>]/g, '')}</p>` + (m.discussion_points ? `<ul>${[].concat(m.discussion_points).map(d => `<li>${String(typeof d === 'string' ? d : JSON.stringify(d)).replace(/[<>]/g, '')}</li>`).join('')}</ul>` : ''),
      actions: acts.map(a => ({ item: a.item, topic: a.topic, action: a.action, owner: a.owner, due: a.due_date, status: a.status })), _src: m._src });
    for (const a of acts) out.tasks.push({ id: ctx.id('task', m.id, a.item), title: `Carron Glen ${a.item}: ${a.topic}`, notes: `${a.action}\n\nFrom the minutes of ${m.title} (${m.date}). No owner or due date was recorded — assign one.`, list_name: 'Carron Glen project', status: 'todo', priority: 'normal', related_collection: 'meetings', related_id: ctx.id('mtg', m.id), _src: a._src || m._src });
    out.events.push({ id: ctx.id('ev', m.id), title: m.title, category: 'meeting', start_date: m.date, start_time: m.time, end_time: '14:30', location: m.location, description: `Attendees: ${(m.attendees || []).join(', ')}. Minutes in Strategy → Meetings.`, visibility: 'company', status: 'confirmed', related_collection: 'meetings', related_id: ctx.id('mtg', m.id), _src: m._src });
  }

  /* ---------- external contacts ---------- */
  for (const x of C.external_contacts) out.contacts.push({ id: ctx.id('ct', x.name), name: x.name, kind: /bank|insur|attorney/i.test(x.name) ? 'partner' : 'authority', phone: ctx.phone((x.phone || '').split(/[ (]/).length > 1 ? x.phone.replace(/\(.*$/, '') : x.phone), notes: [x.website, x.address_or_note].filter(Boolean).join('\n') || null, _src: 'knowledge/company_compliance.json external_contacts' });

  /* ---------- compliance calendar ---------- */
  out.calendars.push({ id: 'cal-company', name: 'Company', color: '#175a33', kind: 'company', description: 'Company-wide events, deadlines and renewals.', visible_by_default: true, _generated: true });
  out.calendars.push({ id: 'cal-compliance', name: 'Compliance & renewals', color: '#e0525e', kind: 'system', description: 'Tax, B-BBEE, insurance, COIDA and CIPC deadlines.', visible_by_default: true, _generated: true });
  const REC = { annual: 'yearly', 'annual (February)': 'yearly', 'annual (August)': 'yearly', 'annual (end February)': 'yearly', 'annual (11 December)': 'yearly', 'monthly on the 1st': 'monthly' };
  for (const c of C.calendar_candidates.filter(c => c.date && c.type !== 'meeting')) {
    out.events.push({ id: ctx.id('ev', c.date, c.title), title: c.title.split(' - ')[0], category: c.type === 'payment' ? 'invoice' : c.type === 'milestone' ? 'deadline' : 'compliance', calendar_id: 'cal-compliance', start_date: c.date, all_day: true,
      description: [c.title, c.who ? `Who: ${c.who}` : null, c.date_basis ? `Date basis: ${c.date_basis}` : null].filter(Boolean).join('\n'), recurrence: REC[c.recurrence] || 'none', reminders: [c.reminder_lead_days ? c.reminder_lead_days * 1440 : 30 * 1440, 7 * 1440, 1440], visibility: 'company', status: 'confirmed', _src: 'knowledge/company_compliance.json calendar_candidates' });
  }
  for (const c of C.calendar_candidates.filter(c => !c.date && !/^Carron Glen/.test(c.title))) out.tasks.push({ id: ctx.id('task', c.title), title: c.title, notes: [c.who ? `Who: ${c.who}` : null, c.date_basis].filter(Boolean).join('\n'), list_name: 'Compliance', status: 'todo', priority: 'high', _src: 'knowledge/company_compliance.json calendar_candidates' });
  return out;
}
