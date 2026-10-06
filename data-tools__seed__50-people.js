// Employees (one master record per person, merged across HR scans, medicals, the schedule,
// payroll and the old CRM), certificates, medical fitness certificates, PPE issues and crews.
// Links payroll, deductions and sign-in profiles to the employee records.
// Sources: knowledge/people_hr.json, medicals.json, schedule_ops_registers.json, financials.json, existing_crm_seed.json.
const title = s => String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim();
const iso = v => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : null; };

// The master list. `keys` are every spelling used on schedules / payroll / file names.
const PEOPLE = [
  { key: 'guruvadu', full: 'Anthony Samuel Guruvadu', known: 'Anthony', keys: ['ANTHONY'], hr: 'HR-EMP-AG', med: 'MEDEMP-05', position: 'General Manager', dept: 'Management', type: 'permanent', profile: 'prof-anthony' },
  { key: 'naidoo', full: 'Jared Emmanuel Naidoo', known: 'Jared', keys: ['JARED'], hr: 'HR-EMP-JN', position: 'Director', dept: 'Management', type: 'director', profile: 'prof-jared', note: 'Sole director (CIPC). Not on the monthly payroll.' },
  { key: 'gunpath', full: 'Renesh Gunpath', known: 'Renesh', keys: ['RENESH'], hr: 'HR-EMP-RG', med: 'MEDEMP-07', position: 'Operational Manager / Site Manager', dept: 'Operations', type: 'permanent', profile: 'prof-renesh', start: '2026-07-01',
    note: 'Signed Site Manager contract (R10,000/month, Mon–Fri 07:00–16:00, 3-month probation). The contract says start date "1 JULY 2021" but it was signed 26/06/2026 and payroll starts July 2026 — recorded as 1 July 2026; confirm (see Data health).' },
  { key: 'wayne', full: 'Wayne', known: 'Wayne', keys: ['WAYNE'], position: 'Field & Sales', dept: 'Sales', type: 'permanent', profile: 'prof-wayne', note: 'Surname not recorded in any source file.' },
  { key: 'mngoma', full: 'Sinakhokonke Mngoma', known: 'Sinoko', keys: ['SINOKO', 'SKOKO', 'SINKONKE', 'SIN'], hr: 'HR-EMP-SM', med: 'MEDEMP-08', position: 'Landscaper (garden services / general worker)', dept: 'Field', type: 'permanent',
    note: 'Payroll spells the name SINOKO (Apr–Jun), SKOKO (Jul–Sep) and SINKONKE (September deduction) — treated as one person; the medical file is labelled "Sin".' },
  { key: 'thaba', full: 'Simfumene Thaba', known: 'Juicy', keys: ['JUICY', 'JUICE'], hr: 'HR-EMP-ST', med: 'MEDEMP-03', position: 'Landscaper (garden services / general worker)', dept: 'Field', type: 'permanent' },
  { key: 'mkhize', full: 'Mthokozisi Edward Mkhize', known: 'Mkize', keys: ['MKIZE', 'MKHIZE'], hr: 'HR-EMP-MM', med: 'MEDEMP-06', position: 'Landscaper (garden services / general worker)', dept: 'Field', type: 'permanent' },
  { key: 'ndumo', full: 'Thabiso Nicholas Ndumo', known: 'Zulu', keys: ['ZULU'], hr: 'HR-EMP-TN', med: 'MEDEMP-10', position: 'Landscaper (garden services / general worker)', dept: 'Field', type: 'permanent' },
  { key: 'mataba', full: 'Mandlakayise Mataba', known: 'Mandla', keys: ['MANDLA'], hr: 'HR-EMP-MA', med: 'MEDEMP-04', position: 'Landscaper (garden services / general worker)', dept: 'Field', type: 'permanent' },
  { key: 'bengu', full: 'Stanford Simtembile Bengu', known: 'Bengu', keys: ['BENGU'], med: 'MEDEMP-01', position: 'Landscaper', dept: 'Field', type: 'permanent',
    note: 'The Carron Glen minutes (3 Aug 2026) ask to remove "T.Bengu" from that site; the only Bengu on file is Stanford S. Bengu — confirm it is the same person.' },
  { key: 'celu', full: 'Sonwabo Celu', known: 'Celu', keys: ['CELU'], med: 'MEDEMP-02', position: 'Landscaper', dept: 'Field', type: 'permanent' },
  { key: 'mzimela', full: 'S Mzimela', known: 'Sipho', keys: ['SIPHO'], med: 'MEDEMP-09', position: 'Landscaper', dept: 'Field', type: 'permanent', note: 'Only the initial "S" is printed on the medical certificate; the file name and schedules say Sipho.' },
  { key: 'videsh', full: 'Videsh', known: 'Videsh', keys: ['VIDESH'], position: 'Not recorded', dept: 'Field', type: 'casual', note: 'Appears only on the payroll — no other record found. Confirm who this is.' },
  { key: 'ramsaroop', full: 'Lutchman Ramsaroop', known: 'Lutchman', keys: ['LUTCHMAN'], hr: 'HR-EMP-LR', position: 'Landscape Technician', dept: 'Field', type: 'permanent', status: 'left', employee_no: '001',
    note: 'Ex-employee (files "Ex Employee" / "Lutchman ex employee"). PPE issued 13/04/2026; the ex-employee register says PPE returned "Partial". Leaving date not recorded; not on the Jan–Sep 2026 payroll.' }
];

export async function build(ctx) {
  const HR = ctx.k('people_hr').entities, MED = ctx.k('medicals').entities, FIN = ctx.k('financials').entities;
  const out = { employees: [], certificates: [], medicals: [], ppe_issues: [], crews: [] };
  const byKey = new Map();
  PEOPLE.forEach(p => p.keys.forEach(k => byKey.set(k, p)));
  const empId = p => `emp-${p.key}`;
  const who = name => byKey.get(String(name || '').trim().toUpperCase()) || null;

  // payroll: latest monthly amount per person (file A version, as in 40-finance)
  const A = 'LSI INCOME STATEMENT (1).xlsx';
  const pay = FIN.payroll_entries.filter(x => !x.present_in || x.present_in.includes(A));
  const latestPay = p => { const rows = pay.filter(x => who(x.employee_name) === p).sort((a, b) => String(b.period).localeCompare(String(a.period))); return rows[0] || null; };
  const firstPay = p => pay.filter(x => who(x.employee_name) === p).map(x => x.period).sort()[0] || null;

  for (const p of PEOPLE) {
    const hr = p.hr ? HR.employees.find(e => e.id === p.hr) : null;
    const med = p.med ? MED.employees.find(e => e.id === p.med) : null;
    const idNo = (hr && hr.sa_id_number) || (med && med.sa_id_number) || null;
    const dob = (hr && iso(hr.dob_from_id)) || (med && iso(med.date_of_birth)) || null;
    const lp = latestPay(p), fp = firstPay(p);
    const [first, ...rest] = p.full.split(' ');
    out.employees.push({
      id: empId(p), employee_no: p.employee_no || null, full_name: p.full, first_name: first, last_name: rest.length ? rest[rest.length - 1] : null, known_as: p.known,
      aliases: p.keys.filter(k => k.toLowerCase() !== p.known.toLowerCase()), id_number: idNo, date_of_birth: dob, gender: (hr && hr.gender_from_id) || (med && med.gender_from_id) || null,
      address: p.key === 'gunpath' ? '37 Stoneham Ave, Phoenix' : null,
      position: p.position, department: p.dept, employment_type: p.type, status: p.status || 'active',
      start_date: p.start || (fp ? `${fp}-01` : null), ppe_returned: p.status === 'left' ? 'partial' : null,
      pay_basis: lp ? 'monthly' : null, pay_rate: lp ? lp.amount : null,
      profile_id: p.profile || null,
      notes: [p.note, fp && !p.start ? `Start date taken from the first payroll month (${fp}); confirm the actual start date.` : null, lp ? `Latest payroll: R${lp.amount} for ${lp.period}.` : null].filter(Boolean).join('\n') || null,
      _src: [hr && hr._src, med && med._src, lp && lp._src, 'knowledge/schedule_ops_registers.json employees'].filter(Boolean).join(' ; ')
    });
    if (p.profile) ctx.patch('profiles', p.profile, { employee_id: empId(p) });
  }

  // link payroll + deductions to the employee
  for (const r of ctx.records.payroll ? ctx.records.payroll.values() : []) { const p = who(r.employee_name); if (p) ctx.patch('payroll', r.id, { employee_id: empId(p) }); }
  for (const r of ctx.records.deductions ? ctx.records.deductions.values() : []) { const p = who(r.employee_name); if (p) ctx.patch('deductions', r.id, { employee_id: empId(p) }); }

  /* ---------- certificates ---------- */
  const TYPE = { WAH: 'working_at_heights', CSR: 'she_rep', FF: 'fire_fighting', FA: 'first_aid' };
  for (const c of HR.certificates) {
    const p = PEOPLE.find(x => x.hr === c.holder_employee_id);
    const code = String(c.short_code || '').split(' ')[0];
    const isJpj = /JPJ/.test(c.provider);
    const done = isJpj ? (c.course_dates || []).slice(-1)[0] : iso(c.date_of_issue);
    out.certificates.push({
      id: ctx.id('cert', c.id), employee_id: p ? empId(p) : null, person_name: p ? p.full : title(c.holder_name_as_printed), id_number: c.holder_id_number || null,
      course: title(c.course_title).replace(/\s+-\s+/g, ' — '), course_type: isJpj ? 'horticulture' : TYPE[code] || 'other',
      level: c.nqf_level != null ? `NQF ${c.nqf_level}${c.first_aid_level_in_text ? ` (text says First Aid Level ${c.first_aid_level_in_text})` : ''}` : null,
      provider: c.provider, accreditation: c.provider_accreditation || null,
      unit_standards: c.unit_standard && !/none/.test(c.unit_standard) ? `US ${c.unit_standard}${c.credits ? ` · ${c.credits} credits` : ''}` : null,
      certificate_no: c.certificate_no && !/none/.test(c.certificate_no) ? c.certificate_no : null,
      issue_date: done, expiry_date: iso(c.expiry_date),
      validity_rule: c.expiry_date && iso(c.expiry_date) ? 'Expiry printed on the certificate' : 'No expiry printed',
      result: isJpj ? `${c.result_percent}% — ${title(c.result_text)}` : 'Competent',
      notes: c.nqf_level_note || null, _src: c._src
    });
  }

  /* ---------- medicals (fitness outcome only — clinical details stay in the source file) ---------- */
  const OUT = s => (/no restriction/i.test(s) ? 'fit' : /restrict/i.test(s) ? 'fit_with_restrictions' : /temporar/i.test(s) ? 'temporarily_unfit' : /unfit/i.test(s) ? 'unfit' : 'fit');
  for (const m of MED.medical_certificates) {
    const p = PEOPLE.find(x => x.med === m.employee_id);
    const wah = MED.working_at_heights_evaluations.find(w => w.certificate_id === m.id);
    out.medicals.push({
      id: ctx.id('med', m.id), employee_id: p ? empId(p) : null, person_name: p ? p.full : title(m.employee_name), exam_type: 'periodic',
      exam_date: iso(m.exam_date), practitioner: 'North Coast Occupational Health — Dr D.G. Govender (OMP, PR 1476971)', outcome: OUT(m.fitness_outcome),
      restrictions: /none/i.test(m.restrictions || '') ? null : m.restrictions,
      tests: (m.protocols_performed || []).map(t => ({ test: t, done: true })).concat(wah ? [{ test: 'Fit to work at heights', done: true, result: wah.fit_to_work_at_heights }] : []),
      expiry_date: iso(m.expiry_date), confidential_note: 'Clinical results (audiogram, lung function, vision) are in the original medical file and are not copied into the system.',
      _src: m._src
    });
  }

  /* ---------- PPE issue ---------- */
  for (const i of HR.ppe_issues) {
    const lines = HR.ppe_issue_lines.filter(l => l.ppe_issue_id === i.id);
    const p = PEOPLE.find(x => x.hr === i.employee_id);
    out.ppe_issues.push({ id: ctx.id('ppe', i.id), employee_id: p ? empId(p) : null, employee_name: i.employee_name, date: iso(i.issue_date),
      items: lines.map(l => ({ item: title(l.item_and_size), size: /not stated/.test(l.size) ? null : l.size, qty: l.quantity })),
      items_text: lines.map(l => `${title(l.item_and_size)} ×${l.quantity}`).join(', '), returned: 'partial',
      notes: `Form ${i.form_reference} rev ${i.form_revision}. Issued by ${i.issued_by}. Receipt signatures blank on all lines; ex-employee register says returned "Partial" (items not listed).`, _src: i._src });
  }

  /* ---------- crews (the two regular teams on the September schedule) ---------- */
  const S = ctx.k('schedule_ops_registers').entities;
  const crewDefs = [
    { id: 'crew-1', name: 'Crew 1 — Sipho, Bengu, Sinoko', members: ['SIPHO', 'BENGU', 'SINOKO'], color: '#1f7440' },
    { id: 'crew-2', name: 'Crew 2 — Zulu, Mkize, Mandla, Juice', members: ['ZULU', 'MKIZE', 'MANDLA', 'JUICE'], color: '#1e9bc4' }
  ];
  for (const c of crewDefs) {
    const rows = S.crew_combinations.filter(x => x.crew.some(n => c.members.includes(n.trim().toUpperCase()))).reduce((a, x) => a + x.schedule_rows, 0);
    out.crews.push({ id: c.id, name: c.name, members: c.members.map(k => empId(who(k))), color: c.color, capacity_per_day: 6, active: true, leader_id: null,
      notes: `Built from the September 2026 schedule, where these names work together most often (${rows} schedule rows include them). No team leader / driver is recorded — set one so dispatch can assign a vehicle.`, _src: 'knowledge/schedule_ops_registers.json crew_combinations' });
    c.members.forEach(k => ctx.patch('employees', empId(who(k)), { crew_id: c.id }));
  }
  return out;
}
export const ALIASES = Object.fromEntries(PEOPLE.flatMap(p => p.keys.map(k => [k, `emp-${p.key}`])));
