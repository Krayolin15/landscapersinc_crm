// Health & safety paperwork: the HSE inspection checklists (as fillable grid forms using the company's
// 1–5 risk key), the HR/incident forms (PPE issue, warning, counselling, grievance, investigations),
// the Section 16(1)/16(2)/First Aider/Fire Fighter appointments, the letter-of-appointment templates and
// work procedures (job descriptions) as Docs, and the inspection due dates.
// Source: knowledge/hs_forms_checklists_loa.json.
import { uniqueLabels } from '../../js__apps__forms__logic.js'; // the checklist columns repeat (MON–FRI over two weeks); answers are keyed by label
const iso = v => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : null; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const titleKey = k => k.replace(/^section_\d+_/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const fmtTitle = s => { const t = String(s || '').trim(); return t === t.toUpperCase() ? t.toLowerCase().replace(/^./, c => c.toUpperCase()) : t; }; // 'PRESSURE HOSE REGISTER' -> 'Pressure hose register'
const TYPE = { text: 'text', textarea: 'paragraph', long_text: 'paragraph', paragraph: 'paragraph', date: 'date', time: 'time', datetime: 'datetime', signature: 'signature', number: 'number', choice: 'choice', checkbox: 'checkbox', checkboxes: 'checkboxes', yes_no: 'yesno', yesno: 'yesno', info: 'section', photo: 'photo', sketch: 'photo' };

/** Turn a transcribed form section (strings, {label,type} objects, nested objects) into form questions. */
function toQuestions(value, prefix, out = []) {
  let n = 0;
  const id = () => `${prefix}${++n}`;
  const visit = (v, label) => {
    if (v == null || v === '') return;
    if (typeof v === 'string') { out.push(/\?\s*$/.test(v) ? { id: id(), type: 'yesno', label: v } : label ? { id: id(), type: 'section', label, help: v } : { id: id(), type: 'text', label: v }); return; }
    if (Array.isArray(v)) { if (label) out.push({ id: id(), type: 'section', label }); v.forEach(x => visit(x)); return; }
    if (typeof v === 'object') {
      if (v.label || v.question) {
        const t = TYPE[String(v.type || '').toLowerCase()] || (v.options ? 'choice' : /\?\s*$/.test(v.label || v.question) ? 'yesno' : 'text');
        out.push({ id: id(), type: t, label: v.label || v.question, ...(v.options ? { options: v.options } : {}), ...(v.repeatable ? { help: 'Repeat for each line' } : {}), ...(v.note ? { help: v.note } : {}) });
        return;
      }
      if (label) out.push({ id: id(), type: 'section', label, help: v.text || v.description || null });
      for (const [k, x] of Object.entries(v)) if (!['text', 'description', '_src'].includes(k)) visit(x, titleKey(k));
    }
  };
  visit(value);
  return out;
}

export async function build(ctx) {
  const E = ctx.k('hs_forms_checklists_loa').entities;
  const out = { forms: [], docs: [], appointments: [], events: [], tasks: [] };
  const RISK = (E.risk_rating_key[0] || { levels: [] }).levels;
  const riskHelp = RISK.map(l => `${l.level} = ${l.label}`).join(' · ');

  /* ---------- inspection checklists → grid forms ---------- */
  for (const c of E.checklists) {
    const sections = c.item_sections || [{ section: null, items: c.items || [] }];
    const questions = [{ id: 'q0', type: 'section', label: 'Risk rate deviation key', help: riskHelp }];
    sections.forEach((s, si) => questions.push({ id: `g${si + 1}`, type: 'grid', label: s.section || c.title, rows: s.items, columns: uniqueLabels(c.response_columns), scale: { options: RISK.map(l => String(l.level)) }, help: c.response_type }));
    (c.footer_fields || []).forEach((f, i) => questions.push({ id: `f${i + 1}`, type: /sign/i.test(f.label || f) ? 'signature' : /date/i.test(f.label || f) ? 'date' : 'text', label: f.label || f }));
    if (c.damaged_items_note) questions.push({ id: 'dmg', type: 'paragraph', label: 'Damaged / defective items and action taken', help: c.damaged_items_note });
    // the checklist's register page (e.g. PRESSURE HOSE REGISTER: #, Asset #, … × 28 numbered rows) becomes a fillable free-text grid
    const reg = c.register_page && typeof c.register_page === 'object' ? c.register_page : null;
    let regNote = typeof c.register_page === 'string' ? ` Register: ${c.register_page}` : '';
    if (reg && Array.isArray(reg.columns)) {
      const sic = reg.columns.map(x => (/\(sic\b[^)]*\)/i.exec(x) || [])[0]).filter(Boolean);
      const cols = reg.columns.filter(x => x !== '#').map(x => x.replace(/\s*\(sic\b[^)]*\)/i, '').trim());
      questions.push({ id: 'reg', type: 'grid', label: fmtTitle(reg.title || 'Register'), rows: Array.from({ length: reg.numbered_rows || 20 }, (_, i) => String(i + 1)), columns: cols, scale: { options: [] }, help: `Register page of ${c.doc_code} — ${reg.numbered_rows || 20} numbered rows.${sic.length ? ` Note on the original: ${sic.join('; ')}.` : ''}` });
      regNote = ` Includes the ${fmtTitle(reg.title || 'register')} (${cols.map(fmtTitle).join(', ')}).`;
    } else if (reg && Array.isArray(reg.required_stock)) {
      // HSE-CHK005: first-aid box list of required stock with a tick column
      questions.push({ id: 'stock', type: 'checkboxes', label: fmtTitle(reg.title || 'Required stock'), options: reg.required_stock.map(s => `${s.qty ? s.qty + ' — ' : ''}${s.item}`), help: `Tick every item that is present and in date${reg.type ? ` (${reg.type})` : ''}.` });
      regNote = ` Includes the ${fmtTitle(reg.title || 'required stock list')} (${reg.required_stock.length} items).`;
    }
    out.forms.push({ id: ctx.id('form', c.doc_code), title: c.title, category: 'inspection', doc_code: c.doc_code, description: `Revision ${c.revision}${c.revision_note ? ` (${c.revision_note})` : ''} · effective ${c.effective_date} · review ${c.review_date}. ${c.response_type}.${regNote}`,
      questions, accepting: true, require_signature: questions.some(q => q.type === 'signature'), source_path: String(c._src || '').split(' | ')[0], _src: c._src });
  }
  /* ---------- HR & incident forms ---------- */
  const CAT = code => (/FORM-001/i.test(code) ? 'safety' : /FORM-00[45]/i.test(code) ? 'incident' : 'hr');
  for (const f of E.forms) {
    const { id: _i, doc_code, revision, title, effective_date, effective_date_raw, review_date, review_date_raw, revision_date_raw, effective_date_note, validity, page_count, _src, ...body } = f;
    const qs = f.form_fields ? toQuestions(f.form_fields, 'q') : toQuestions(body, 'q');
    if (f.form_fields) for (const [k, v] of Object.entries(body)) if (k !== 'form_fields' && k !== 'page2' && v) qs.push(...toQuestions({ [k]: v }, `x${k.slice(0, 3)}`).map(q => (q.type === 'text' ? { ...q, type: 'section', help: q.label, label: titleKey(k) } : q)));
    out.forms.push({ id: ctx.id('form', doc_code), title: title.replace(/\s*\(.*\)\s*$/, ''), category: CAT(doc_code), doc_code, description: [`Revision ${revision}`, effective_date ? `effective ${effective_date}` : effective_date_raw ? `effective (as printed) ${effective_date_raw}` : null, review_date ? `review ${review_date}` : revision_date_raw ? `revision date (as printed) ${revision_date_raw}` : null, effective_date_note, validity ? `Validity: ${validity}` : null, `${page_count || 1} page(s)`].filter(Boolean).join(' · '),
      questions: qs, accepting: true, require_signature: qs.some(q => q.type === 'signature'), source_path: String(_src || '').split(' | ')[0], _src });
  }
  for (const r of E.register_templates || []) out.forms.push({ id: ctx.id('form', r.id), title: 'Attendance / sign-in register', category: 'checklist', doc_code: null, description: r.mismatch_note || null,
    questions: [{ id: 'r1', type: 'grid', label: 'Register', rows: Array.from({ length: r.numbered_rows || 20 }, (_, i) => String(i + 1)), columns: r.columns.filter(c => c !== '#'), scale: { options: [] } }], accepting: true, _src: r._src });

  /* ---------- appointments ---------- */
  const person = n => (/guruvadu/i.test(n || '') ? 'emp-guruvadu' : /naidoo/i.test(n || '') ? 'emp-naidoo' : null);
  for (const a of E.appointments) {
    const role = E.appointment_role_definitions.find(r => r.doc_code && r.doc_code === a.doc_code) || null;
    if (!a.appointee) {
      out.tasks.push({ id: ctx.id('task', 'appoint', a.id), title: `Appoint a ${a.appointment_type.replace(/ \/.*$/, '')} (${a.doc_code || 'letter of appointment'})`, notes: `${a.status}. Legal basis: ${a.legal_basis}.${a.prerequisite ? ` Prerequisite: ${a.prerequisite}.` : ''}${a.area ? ` Area: ${a.area}.` : ''} Use the ${a.doc_code} template in Docs.`, list_name: 'Health & safety', status: 'todo', priority: 'high', _src: a._src });
      continue;
    }
    out.appointments.push({ id: ctx.id('appt', a.id), employee_id: person(a.appointee), person_name: a.appointee, appointment: a.appointment_type, legal_reference: a.legal_basis, appointed_by: a.appointed_by || null,
      appointment_date: iso(a.effective_date), review_date: a.end_date ? iso(a.end_date) : null, duties: role ? role.duties.map(d => `• ${d}`).join('\n') : a.status || null,
      notes: [a.doc_code ? `${a.doc_code} rev ${a.revision}; letter dated ${a.letter_date_raw}` : null, a.end_condition, a.status && a.appointee ? a.status : null].filter(Boolean).join(' · ') || null, _src: a._src });
  }

  /* ---------- letters of appointment (templates) + work procedures as Docs ---------- */
  for (const t of E.loa_templates) {
    const role = E.appointment_role_definitions.find(r => r.doc_code === t.doc_code);
    const html = [`<p><strong>${esc(t.doc_code)}</strong> · Revision ${esc(t.revision)} · Effective ${esc(t.effective_date_raw)} · Review ${esc(t.review_date_raw)}</p>`,
      role ? `<p><strong>Appointed by:</strong> ${esc(role.appointed_by)} · <strong>Validity:</strong> ${esc(role.validity)}</p>` : '',
      role && role.prerequisites && role.prerequisites.length ? `<h3>Prerequisites</h3><ul>${role.prerequisites.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : '',
      (t.responsibilities || (role && role.duties) || []).length ? `<h3>Responsibilities</h3><ul>${(t.responsibilities || role.duties).map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : '',
      t.form_fields ? `<h3>To complete</h3><ul>${t.form_fields.map(f => `<li>${esc(f.label)}: ________________</li>`).join('')}</ul>` : '',
      role && role.signatures_required ? `<h3>Signatures</h3><p>${esc([].concat(role.signatures_required).join('; '))}</p>` : ''].join('\n');
    out.docs.push({ id: ctx.id('doc', 'loa', t.doc_code), title: t.title.replace(/\s*\(blank template\)/i, ''), category: 'template', template: true, doc_code: t.doc_code, revision: t.revision, effective_date: iso(t.effective_date), review_date: iso(t.review_date), content: html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), locked: true, owner_role: 'manager', _src: t._src });
  }
  for (const s of E.signed_letters_of_appointment || []) out.docs.push({ id: ctx.id('doc', 'loa-signed', s.id), title: s.title, category: 'contract', doc_code: s.doc_code, revision: s.revision, effective_date: iso(s.appointment_effective_date), review_date: iso(s.review_date),
    content: `<p>Signed letter of appointment: <strong>${esc(s.appointee)}</strong> (ID ${esc(s.appointee_id_number)}) appointed by <strong>${esc(s.appointer)}</strong>, effective ${esc(s.appointment_effective_date_raw)}. Both pages signed (scanned copy in the document vault).</p>`, text: `Signed letter of appointment ${s.appointee} ${s.appointer}`, locked: true, owner_role: 'manager', _src: s._src });
  for (const j of E.job_descriptions) {
    const list = (h, a) => (a && a.length ? `<h3>${h}</h3><ul>${a.map(x => `<li>${esc(typeof x === 'string' ? x : Object.values(x).join(' — '))}</li>`).join('')}</ul>` : '');
    const resp = Array.isArray(j.responsibilities) ? j.responsibilities : Object.entries(j.responsibilities || {}).flatMap(([k, v]) => [`${titleKey(k)}:`, ...[].concat(v)]);
    const html = [`<p><strong>${esc(j.doc_code)}</strong> · Revision ${esc(j.revision)} · Approved by ${esc(j.approved_by)}</p>`, j.purpose ? `<h3>Purpose</h3><p>${esc(j.purpose)}</p>` : '', j.scope ? `<h3>Scope</h3><p>${esc(j.scope)}</p>` : '',
      list('General conditions', j.general_conditions), list('Responsibilities', resp), list('Authority', [].concat(j.authority || [])), list('Related documentation', [].concat(j.related_documentation || [])), list('Acknowledgement', [].concat(j.acknowledgement_fields || []).map(f => (typeof f === 'string' ? f : f.label || JSON.stringify(f)))), j.note ? `<p><em>${esc(j.note)}</em></p>` : ''].join('\n');
    out.docs.push({ id: ctx.id('doc', 'wp', j.doc_code), title: j.title, category: 'job_description', doc_code: j.doc_code, revision: j.revision, content: html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), locked: true, owner_role: 'manager', _src: j._src });
  }
  const pm = (E.ppe_matrix || [])[0];
  if (pm) out.docs.push({ id: 'doc-ppe-matrix', title: pm.title, category: 'policy', doc_code: pm.doc_code, content: `<p>Environments: ${esc(pm.environments.join(', '))}</p><table><thead><tr><th>Item</th><th>Required in</th></tr></thead><tbody>${pm.rows.map(r => `<tr><td>${esc(r.item)}</td><td>${esc((r.required_in_environments || []).join(', '))}${r.note ? ` (${esc(r.note)})` : ''}</td></tr>`).join('')}</tbody></table><p><em>This is a generic OHASA template without a landscaping column — see Data health.</em></p>`, text: pm.rows.map(r => r.item).join(' '), locked: true, owner_role: 'manager', _src: pm._src });

  /* ---------- inspection schedule ---------- */
  const monthly = { 'HSE-CHK001': 'Pressure hose inspection (HSE-CHK001)', 'HSE-CHK004': 'Fire-fighting equipment inspection (HSE-CHK004)', 'HSE-CHK005': 'First aid box inspection & stock check (HSE-CHK005)', 'HSE-CHK006': 'Spill kit inspection (HSE-CHK006)' };
  for (const [code, title] of Object.entries(monthly)) out.events.push({ id: ctx.id('ev', 'insp', code), title, category: 'compliance', calendar_id: 'cal-compliance', start_date: '2026-10-01', all_day: true, recurrence: 'monthly', reminders: [1440], visibility: 'company', status: 'confirmed',
    description: `Monthly inspection on form ${code} (Forms app → fill the checklist). The checklist columns are Jan–Dec, so it is due every month; the 1st of the month is used as the due day.`, related_collection: 'forms', related_id: ctx.id('form', code), _src: 'knowledge/hs_forms_checklists_loa.json calendar_candidates' });
  out.events.push({ id: ctx.id('ev', 'insp', 'HSE-CHK002'), title: 'Vehicle inspection (HSE-CHK002)', category: 'vehicle', calendar_id: 'cal-compliance', start_date: '2026-09-28', all_day: true, recurrence: 'weekdays', reminders: [], visibility: 'company', status: 'confirmed',
    description: 'Daily pre-trip vehicle check, Monday–Friday (checklist columns MON–FRI over two weeks).', related_collection: 'forms', related_id: ctx.id('form', 'HSE-CHK002'), _src: 'knowledge/hs_forms_checklists_loa.json checklists CHK-002' });
  for (const c of E.calendar_candidates.filter(c => !c.date)) out.tasks.push({ id: ctx.id('task', 'hs', c.title), title: c.title, notes: [c.who ? `Who: ${c.who}` : null, c.date_raw].filter(Boolean).join('\n') || null, list_name: 'Health & safety', status: 'todo', priority: 'normal', _src: 'knowledge/hs_forms_checklists_loa.json calendar_candidates' });
  return out;
}
