// Fleet (H100, NP200, trailer), vehicle logs (services, licences, roadworthy), suppliers & purchases
// (vehicles, the Garden Green / Splash n Grow acquisition, JPJ training, Random Harvest accommodation),
// references, the Carron Glen project plan + rehabilitation quote, DSW refuse-site application,
// and fleet / licence dates on the calendar.
// Sources: knowledge/projects_fleet_purchases.json, schedule_ops_registers.json (service dates sheet).
const iso = v => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : null; };
const strip = o => { const { _src, ...r } = o; return r; };

export async function build(ctx) {
  const F = ctx.k('projects_fleet_purchases').entities;
  const S = ctx.k('schedule_ops_registers').entities;
  const out = { vehicles: [], vehicle_logs: [], suppliers: [], purchases: [], references: [], jobs: [], quotes: [], compliance_docs: [], events: [], tasks: [] };

  /* ---------- vehicles ---------- */
  const sheet = name => S.vehicles.find(v => v.vehicle.replace(/\s/g, '') === name.replace(/\s/g, ''));
  const VEH = [
    { id: 'veh-h100', name: 'H100', src: F.vehicles.find(v => v.id === 'VEH-H100'), sheet: sheet('H100'), kind: 'bakkie', lic: F.vehicle_licences.find(l => l.vehicle === 'VEH-H100'), pur: 'PUR-01' },
    { id: 'veh-np200', name: 'NP 200', src: F.vehicles.find(v => v.id === 'VEH-NP200'), sheet: sheet('NP 200'), kind: 'bakkie', lic: F.vehicle_licences.find(l => l.vehicle === 'VEH-NP200'), pur: 'PUR-02' }
  ];
  for (const v of VEH) {
    const x = v.src, sh = v.sheet || {}, p = F.purchases.find(q => q.id === v.pur);
    const nextBad0 = sh.next_service_date && sh.last_service_date && sh.next_service_date < sh.last_service_date;
    const interval = !nextBad0 && sh.derived_service_interval_km > 0 ? sh.derived_service_interval_km : null;
    const nextBad = sh.next_service_date && sh.last_service_date && sh.next_service_date < sh.last_service_date;
    out.vehicles.push({
      id: v.id, name: v.name, kind: v.kind, registration: `${x.licence_number_formatted.split(' / ')[0]} (register ${x.register_number})`, make: `${x.make} ${x.series_name} (${String(x.model_year).slice(0, 4)}, ${x.colour.toLowerCase()})`, vin: x.vin,
      purchase_date: iso(p.invoice_date || p.agreement_date), purchase_price: p.total || p.price, seller: p.supplier.split(' (')[0],
      odometer_km: sh.last_service_mileage_km || (typeof x.mileage_at_purchase_km === 'number' ? x.mileage_at_purchase_km : null),
      last_service_date: iso(sh.last_service_date), last_service_km: sh.last_service_mileage_km || null,
      next_service_date: nextBad ? null : iso(sh.next_service_date), next_service_km: sh.next_service_mileage_km || null, service_interval_km: interval,
      licence_expiry: iso(x.licence_disc_expiry), status: 'active',
      notes: [
        `Engine ${x.engine_number} · tare ${x.tare_kg} kg · first licensed ${x.date_first_licensing} · roadworthy ${x.roadworthy_test_date} · registered to JKN Property Consortium on ${x.date_registered_to_company} (${x.registering_authority}).`,
        `Licence disc expires ${x.licence_disc_expiry}; the service-dates sheet says licence renewal ${sh.license_renewal_date_raw || '—'} — confirm which date is right.`,
        nextBad ? `The service sheet records next service ${sh.next_service_date} (before the last service on ${sh.last_service_date}) — likely a typo; next service is due at ${sh.next_service_mileage_km} km.` : null,
        p.buyer_entity_note ? `Purchase: ${p.buyer_entity_note}.` : null
      ].filter(Boolean).join('\n'),
      _src: [x._src, sh._src].filter(Boolean).join(' ; ')
    });
    if (sh.last_service_date) out.vehicle_logs.push({ id: ctx.id('vlog', v.id, 'service', sh.last_service_date), vehicle_id: v.id, date: iso(sh.last_service_date), type: 'service', odometer_km: sh.last_service_mileage_km, description: 'Service (service-dates sheet)', next_due_date: nextBad ? null : iso(sh.next_service_date), next_due_km: sh.next_service_mileage_km, _src: sh._src });
    if (v.lic) out.vehicle_logs.push({ id: ctx.id('vlog', v.id, 'licence', v.lic.date), vehicle_id: v.id, date: iso(v.lic.date), type: 'licence', amount: v.lic.total_amount_paid, supplier: `${v.lic.registering_authority} registering authority`, description: `Licence disc (receipt ${v.lic.receipt_number}, control ${v.lic.control_number}) — licence fee R${v.lic.fee_paid} + transaction fee R${v.lic.transaction_fee_paid}`, next_due_date: iso(v.lic.date_of_expiry), _src: v.lic._src });
    out.vehicle_logs.push({ id: ctx.id('vlog', v.id, 'roadworthy'), vehicle_id: v.id, date: iso(x.roadworthy_test_date), type: 'inspection', description: 'Roadworthy test (from the licence document)', _src: x._src });
  }
  const tr = sheet('Trailer');
  if (tr) out.vehicles.push({ id: 'veh-trailer', name: 'Trailer', kind: 'trailer', licence_expiry: iso(tr.license_renewal_date), status: 'active', notes: 'Registration number, make and purchase details not recorded. Service columns say N/A.', _src: tr._src });

  /* ---------- suppliers & purchases ---------- */
  const supId = n => ctx.id('sup', n);
  const SUPS = [
    { key: 'MA MOTORS', name: 'MA Motors (MA Enterprises (Pty) Ltd)', category: 'Used vehicle dealer' },
    { key: 'Shawn Govender', name: 'Shawn Govender (private vehicle seller)', category: 'Private seller' },
    { key: 'Garden Green', name: 'Garden Green Design & Splash n Grow — Dale Smit', category: 'Business seller (acquisition)' },
    { key: 'Random Harvest', name: 'Random Harvest Country Cottages', category: 'Accommodation' },
    { key: 'JPJ', name: 'JPJ Landscapes (Judy Panton-Jones)', category: 'Training — landscape design & horticulture' }
  ];
  for (const s of SUPS) {
    const x = F.suppliers.find(y => y.name.includes(s.key.split(' ')[0])) || {};
    const bank = F.bank_accounts.find(b => (b.owner || '').toLowerCase().includes(s.key.split(' ')[0].toLowerCase()));
    out.suppliers.push({ id: supId(s.key), name: s.name, category: s.category, contact_name: s.key === 'JPJ' ? 'Judy Panton-Jones' : null, phone: ctx.phone(x.phone) || (s.key === 'JPJ' ? '0845187589' : null), email: x.email || (s.key === 'JPJ' ? 'judy@jpjlandscapes.co.za' : null), address: x.address || null,
      notes: [x.registration_ck ? `Reg ${x.registration_ck}` : null, bank ? `Bank: ${bank.bank} ${bank.account_number}${bank.branch_code ? ' (branch ' + bank.branch_code + ')' : ''}` : x.bank ? `Bank: ${x.bank}` : null].filter(Boolean).join(' · ') || null, _src: x._src || 'knowledge/projects_fleet_purchases.json payments' });
  }
  const pays = id => F.payments.filter(p => (F.purchases.find(q => q.id === id) || {}).payment_refs?.includes(p.id) || p.id === (F.purchases.find(q => q.id === id) || {}).deposit_paid_ref);
  for (const p of F.purchases) {
    const sup = SUPS.find(s => p.supplier.includes(s.key.split(' ')[0]));
    const paid = pays(p.id);
    out.purchases.push({
      id: ctx.id('pur', p.id), date: iso(p.invoice_date || p.agreement_date || p.agreement_made) || iso(paid[0] && paid[0].date), supplier_id: sup ? supId(sup.key) : null, supplier_name: sup ? sup.name : p.supplier,
      description: p.item, amount: p.total ?? p.price ?? null, reference: p.document || null,
      status: p.type === 'accommodation' ? 'ordered' : 'paid', vehicle_id: p.id === 'PUR-01' ? 'veh-h100' : p.id === 'PUR-02' ? 'veh-np200' : null,
      notes: [p.buyer_entity_note, p.deposit ? `Deposit R${p.deposit.amount} due ${p.deposit.due}; balance R${p.balance.amount} due ${p.balance.due}. No proof of payment in the files.` : null,
        p.type === 'accommodation' ? `Deposit R${p.deposit_paid} paid (${(F.payments.find(x => x.id === p.deposit_paid_ref) || {}).date || ''}); balance R${p.balance_outstanding_after_deposit} per the pro forma.` : null,
        p.purpose ? `Purpose: ${p.purpose}.` : null, paid.length ? `Payments: ${paid.map(x => `${x.date} R${x.amount} ref "${x.recipient_reference}"`).join('; ')}.` : null, p.ledger_cross_reference || null].filter(Boolean).join('\n') || null,
      _src: p._src
    });
  }

  /* ---------- references ---------- */
  for (const r of F.references) out.references.push({ id: ctx.id('ref', r.id), from_name: r.signatory && !/not printed/.test(r.signatory) ? r.signatory : r.referee_org.replace(/ \(.*$/, ''), organisation: r.referee_org, date: iso(r.date), contact: [r.contact, r.email].filter(x => x && !/not printed/.test(x)).join(' · ') || null,
    summary: [r.relationship, r.services_mentioned ? `Services: ${r.services_mentioned.join(', ')}` : null].filter(Boolean).join('\n'), quote: (r.key_points || []).join(' '), _src: r._src });

  /* ---------- Carron Glen project + rehabilitation quote ---------- */
  const prj = F.projects[0];
  const carron = [...(ctx.records.clients || new Map()).values()].find(c => /carron glen/i.test(c.name) || c.legacy_code === 'CGE048');
  const scope = F.project_scope_items.filter(s => s.project === prj.id);
  const works = F.completed_works.filter(w => w.project === prj.id);
  out.jobs.push({ id: 'job-carron-glen-plan', title: 'Carron Glen Estate — landscape & garden maintenance project', client_id: carron ? carron.id : null, client_name: 'Carron Glen Estate', service_type: 'garden_maintenance', status: 'in_progress',
    notes: `${prj.objective || ''}\n\nScope (${scope.length} items): ${scope.map(s => `${s.category}: ${s.item}`).join(' · ')}\n\nCompleted rehabilitation works: ${works.map(w => w.work).join('; ')}.\n\nMonthly visit plan: ${F.maintenance_schedule.map(m => m.tasks.join(', ')).join(' | ')}`, _src: prj._src });
  const q = F.quotes[0];
  const ql = F.quote_lines.filter(l => l.quote === q.id);
  out.quotes.push({ id: 'qt-carron-rehab', number: null, legacy_number: null, client_id: carron ? carron.id : null, client_name: 'Carron Glen Estate', title: 'Once-off landscape rehabilitation — Carron Glen Estate', issue_date: null, issue_date_raw: 'not stated on the project plan',
    status: 'accepted', lines: ql.map(l => ({ description: l.description, qty: 1, unit_price: l.amount, discount_pct: 0, amount: l.amount })), discount: q.discount_amount_derived, total: 0, vat_applied: false, deposit_status: 'not_required', job_id: 'job-carron-glen-plan',
    notes: `Quoted R${q.total} and discounted to R0.00 in the project plan (${q.closing_text || ''}). The works are listed as completed.`, _src: q._src });

  /* ---------- DSW refuse site + vehicle / business registration documents ---------- */
  const dsw = F.dsw_applications[0];
  out.compliance_docs.push({ id: 'cd-dsw-cornubia', name: 'DSW disposal-site account application (Bellair / Mt Edgecombe)', doc_type: 'other', issuer: 'eThekwini Durban Solid Waste', issue_date: null, status: 'unknown', key_facts: { application: strip(dsw), tariffs: F.disposal_tariffs.map(strip), consent: F.consents.map(strip) },
    summary: `Garden refuse disposal: bakkie or trailer load R175.53 excl VAT (R201.85 incl) from 1 July 2025. Neither site is ticked on the form; Jared Naidoo consented to use municipal account 83633051717 for DSW access.`, _src: dsw._src });
  for (const b of F.business_registration_certificates) out.compliance_docs.push({ id: 'cd-brnc', name: 'Business registration number certificate (vehicles)', doc_type: 'company_registration', number: b.business_registration_number, issuer: `${b.registering_authority} registering authority`, issue_date: iso(b.issue_date || b.date), status: 'valid', key_facts: strip(b), summary: `Traffic business registration number ${b.business_registration_number} used to register the fleet in the company name.`, _src: b._src });

  /* ---------- fleet calendar ---------- */
  for (const c of F.calendar_candidates.filter(c => iso(c.date))) {
    out.events.push({ id: ctx.id('ev', 'fleet', c.date, c.title), title: c.title.split(' - ')[0], category: /licen|roadworth|service|vehicle|H100|NP200/i.test(c.title) ? 'vehicle' : /pay|deposit|balance/i.test(c.title) ? 'invoice' : 'deadline', calendar_id: 'cal-compliance', start_date: iso(c.date), all_day: true,
      description: [c.title, c.who ? `Who: ${c.who}` : null, c.note].filter(Boolean).join('\n'), recurrence: c.recurrence === 'annual' ? 'yearly' : 'none', reminders: [60 * 1440, 30 * 1440, 7 * 1440], visibility: 'company', status: 'confirmed', _src: 'knowledge/projects_fleet_purchases.json calendar_candidates' });
  }
  for (const c of F.calendar_candidates.filter(c => !iso(c.date))) out.tasks.push({ id: ctx.id('task', 'fleet', c.title), title: c.title, notes: [c.who ? `Who: ${c.who}` : null, c.note].filter(Boolean).join('\n'), list_name: 'Fleet & purchases', status: 'todo', priority: 'normal', _src: 'knowledge/projects_fleet_purchases.json calendar_candidates' });
  return out;
}
