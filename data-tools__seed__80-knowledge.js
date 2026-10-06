// The company knowledge base: every policy, procedure, SOP, job description, workflow, code of conduct,
// meeting agenda, strategy document and training guide as a readable Doc (full text from the source file),
// checklists as Forms, the 12-month plan + Q3 focus areas as Goals, the GM & Sales KPI trackers,
// the service catalogue + design/paving options, the toolbox talk, and recurring management meetings.
// Sources: knowledge/{hs_policies_procedures,sops_toolbox,strategy_roles,kpi_trackers,marketing_options,
//          training_*,company_compliance}.json and the text dumps in <scratchpad>/txt/.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const iso = v => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : null; };

const plain = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

export async function build(ctx) {
  const SP = dirname(ctx.KNOW);
  const read = rel => { const p = rel && join(SP, rel); return p && existsSync(p) ? readFileSync(p, 'utf8') : null; };
  const groups = existsSync(join(SP, 'groups.json')) ? JSON.parse(readFileSync(join(SP, 'groups.json'), 'utf8')).groups : [];
  const txtFor = src => { for (const g of groups) for (const f of g.files) if (f.src === src || f.src.endsWith(src.replace(/^x2?\//, ''))) return f.txt; return null; };
  const out = { docs: [], forms: [], goals: [], kpi_definitions: [], kpi_entries: [], services: [], design_options: [], toolbox_talks: [], events: [] };
  const doc = (id, title, category, txt, extra = {}) => {
    const raw = read(txt);
    const html = raw ? dumpToHtml(raw) : `<p>${esc(extra.fallback || 'The original file is in the document vault.')}</p>`;
    const { fallback, ...rest } = extra;
    out.docs.push({ id, title, category, content: html, text: plain(html).slice(0, 20000), locked: true, owner_role: 'manager', ...rest });
  };

  /* ---------- H&S policies & procedures ---------- */
  const H = ctx.k('hs_policies_procedures').entities;
  for (const p of [...H.policies, ...H.procedures]) {
    const code = `${p.category === 'policy' ? 'POL' : 'PRO'} ${String(p.doc_no).padStart(3, '0')}`;
    doc(ctx.id('doc', p.category, p.doc_no), p.title.replace(/\s+/g, ' '), p.category, p.txt, { doc_code: code, revision: p.version, effective_date: iso(p.effective_date), review_date: iso(p.next_revision_date), _src: p.src });
  }
  /* ---------- SOPs ---------- */
  const T = ctx.k('sops_toolbox').entities;
  for (const s of T.sops) doc(ctx.id('doc', 'sop', s.title), s.title, /REMAINING/.test(s.title) ? 'general' : 'sop', txtFor(s.src), { doc_code: null, _src: s.src, fallback: s.title });
  /* ---------- strategy, roles, workflows, codes of conduct, agendas ---------- */
  const R = ctx.k('strategy_roles');
  const CAT = t => (/job description|role & responsib|role profile/i.test(t) ? 'job_description' : /agenda/i.test(t) ? 'agenda' : /code of conduct/i.test(t) ? 'policy' : /workflow|sop|registers/i.test(t) ? 'procedure' : /plan|focus|programme/i.test(t) ? 'plan' : 'general');
  for (const d of R.documents.filter(d => d.txt)) doc(ctx.id('doc', 'strategy', d.title), d.title, CAT(d.title), d.txt, { _src: d.src || d.file || d.txt });
  /* ---------- training guides ---------- */
  for (const g of ['training_firstaid', 'training_heights', 'training_firefighting_hsrep']) {
    if (!ctx.has(g)) continue;
    const K = ctx.k(g);
    // the learner guides are scans: build the doc from the structured transcription
    const SKIP = new Set(['training_courses', 'certificates', 'training_records', 'calendar_candidates', 'page_inventory', 'company_facts', 'organisations', 'training_material_contributors', 'material_review_notes', 'sample_documents_in_training']);
    const fmtItem = x => (typeof x !== 'object' || x === null ? String(x) : Object.entries(x).filter(([k, v]) => k !== '_src' && k !== 'course_id' && v != null && v !== '').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.map(y => (typeof y === 'object' ? JSON.stringify(y) : y)).join('; ') : typeof v === 'object' ? JSON.stringify(v) : v}`).join(' — '));
    const extras = Object.entries(K.entities).filter(([k, v]) => !SKIP.has(k) && Array.isArray(v) && v.length);
    (K.entities.training_courses || []).forEach((c, ci) => {
      const title = c.course || c.title;
      const us = c.saqa_unit_standard || c.unit_standard_no;
      const mods = (c.modules || c.topics || []).map(m => `<li>${esc(fmtItem(m))}</li>`).join('');
      const sections = extras.map(([k, v]) => [k, v.filter(x => !x.course_id || x.course_id === c.course_id)]).filter(([k, v]) => v.length && (ci === 0 || ['course_modules', 'learning_outcomes'].includes(k)));
      const html = [
        `<p>${esc([c.provider, c.material_type, c.programme, us ? `Unit standard ${us}` : null, c.nqf_level ? `NQF ${c.nqf_level}` : null, c.credits ? `${c.credits} credits` : null].filter(Boolean).join(' · '))}</p>`,
        c.stated_purpose ? `<p>${esc(c.stated_purpose)}</p>` : '',
        mods ? `<h3>Modules / topics</h3><ul>${mods}</ul>` : '',
        ...sections.map(([k, v]) => `<h3>${esc(k.replace(/_/g, ' ').replace(/^./, x => x.toUpperCase()))}</h3><ul>${v.map(x => `<li>${esc(fmtItem(x))}</li>`).join('')}</ul>`),
        '<p><em>Transcribed from the scanned learner guide; the original PDF is in the document vault.</em></p>'
      ].join('\n');
      out.docs.push({ id: ctx.id('doc', 'training', title), title: `Training guide — ${title}`, category: 'general', content: html, text: plain(html).slice(0, 20000), locked: true, owner_role: 'manager', doc_code: us ? `US ${us}` : null, _src: c._src });
    });
  }

  /* ---------- checklists → Forms ---------- */
  const byDoc = new Map();
  for (const c of R.entities.checklist_items) { if (!byDoc.has(c.doc_title)) byDoc.set(c.doc_title, []); byDoc.get(c.doc_title).push(c); }
  for (const [title, secs] of byDoc) out.forms.push({ id: ctx.id('form', 'checklist', title), title: `${title} — checklist`, category: 'checklist', description: `Built from “${title}”. Tick items as they are done; success measures are shown per section.`,
    questions: secs.flatMap((s, si) => [{ id: `s${si}`, type: 'section', label: s.section, help: s.success_measure || null }, ...s.items.map((it, ii) => ({ id: `s${si}q${ii}`, type: 'checkbox', label: it, required: false }))]), accepting: true, _src: secs[0]._src });

  /* ---------- goals: 12-month plan pillars + Q3 focus areas + leadership programme ---------- */
  for (const p of R.entities.revenue_growth_pillars) {
    const pid = ctx.id('goal', p.pillar);
    const kpis = (R.entities.kpis_targets.find(k => k.pillar === p.pillar) || {}).kpis || [];
    out.goals.push({ id: pid, title: p.objective, pillar: p.pillar, plan: '12-Month Revenue Growth Plan', status: 'not_started', progress: 0, measure: kpis.join(', ') || null, description: [p.target_markets ? `Target markets: ${p.target_markets.join(', ')}` : null, p.upsell_opportunities ? `Upsell: ${p.upsell_opportunities.join(', ')}` : null].filter(Boolean).join('\n') || null, _src: 'x/Landscapers Inc 12 month plan.docx' });
    (p.initiatives || []).forEach((it, i) => out.goals.push({ id: ctx.id('goal', p.pillar, i), title: it.replace(/\.$/, ''), pillar: p.pillar, plan: '12-Month Revenue Growth Plan', parent_id: pid, status: 'not_started', progress: 0, _src: 'x/Landscapers Inc 12 month plan.docx' }));
  }
  for (const a of R.entities.key_focus_areas_q3_2026) a.items.forEach((it, i) => out.goals.push({ id: ctx.id('goal', 'q3', a.category, i), title: it.replace(/\.$/, ''), pillar: a.category, plan: 'Key focus areas July–September 2026', phase: 'Q3 2026', start_date: '2026-07-01', due_date: '2026-09-30', status: 'not_started', progress: 0, description: 'Progress was not recorded in the source — update it at the quarter-end review.', _src: 'x/Landscapers Inc key focus areas (JULY-SEPT 2026).docx' }));
  const L = R.entities.leadership_development_programme;
  if (L) out.goals.push({ id: 'goal-leadership-anthony', title: `Leadership Development Programme — ${L.candidate}`, pillar: 'People', plan: 'Leadership Development Programme', owner_name: L.candidate, start_date: iso(L.commencement_date), due_date: iso(L.completion_date), status: 'on_track', progress: 0,
    measure: (L.competency_scorecard || []).map(c => `${c.Competency} ${c.Current} → ${c.Target}`).join(' · '), description: `${L.review_cycle || ''}\n${L.actual_span_note || ''}`.trim(), _src: 'Landscapers_inc_Leadership_Development_Programme_Anthony.docx' });

  /* ---------- KPI trackers (GM + Sales) ---------- */
  const K = ctx.k('kpi_trackers').entities;
  const METRICS = {
    GM: [['revenue', 'Weekly revenue', 'rand', 'revenue_target'], ['quotes_sent', 'Quotes sent', 'count', 'quotes_target'], ['quotes_won', 'Quotes won', 'count'], ['conversion_pct', 'Quote conversion', 'percent', null, v => Math.round(v * 1000) / 10], ['new_clients', 'New clients', 'count'], ['jobs_completed', 'Jobs completed', 'count'], ['client_complaints', 'Client complaints', 'count'], ['staff_attendance_pct', 'Staff attendance', 'percent'], ['total_score_cached', 'GM total score', 'score']],
    Sales: [['cold_calls_made', 'Cold calls made', 'count', 'cold_calls_target'], ['meetings_booked', 'Meetings booked', 'count', 'meetings_target'], ['quotes_in_pipeline', 'Quotes in pipeline', 'count', 'quotes_target'], ['new_clients', 'New clients', 'count', 'new_clients_target'], ['total_score_cached', 'Sales total score', 'score']]
  };
  for (const [card, mets] of Object.entries(METRICS)) {
    const who = card === 'GM' ? 'Anthony' : 'Wayne';
    for (const [field, name, unit, tField, conv] of mets) {
      const key = `${card.toLowerCase()}_${field.replace(/_cached$/, '')}`;
      const tgt = K.kpi_targets.find(t => t.scorecard === card && t.metric.toLowerCase().startsWith(name.toLowerCase().split(' ')[0])) || null;
      out.kpi_definitions.push({ id: `kpi-${key}`, key, name, owner_role: card === 'GM' ? 'manager' : 'sales', tracker: card === 'GM' ? 'GM KPI Tracker (Anthony)' : 'Sales KPI Tracker (Wayne)', unit, target: tgt && typeof tgt.target === 'number' ? (unit === 'percent' && tgt.target <= 1 ? tgt.target * 100 : tgt.target) : field === 'total_score_cached' ? 100 : null,
        target_period: 'week', direction: /complaint/.test(field) ? 'lower' : 'higher', description: tgt ? `${tgt.unit}; ${tgt.basis}` : null, _src: (K.kpi_trackers.find(t => t.subject_employee === who) || {}).file });
      for (const e of K.kpi_entries.filter(x => x.employee === who && x[field] != null)) {
        const note = field === 'total_score_cached' ? [e.reviewer_comments ? `${e.reviewer}: ${e.reviewer_comments}` : null, (K.coaching_notes.find(c => c.kpi_entry_id === e.id) || {}).note || null, e.recomputed && e.recomputed.note_leadership ? e.recomputed.note_leadership : null].filter(Boolean).join('\n') : null;
        out.kpi_entries.push({ id: ctx.id('kpie', key, e.week_ending), kpi_key: key, kpi_name: name, person_name: who, profile_id: `prof-${who.toLowerCase()}`, date: e.week_ending, period: 'week', value: conv ? conv(e[field]) : e[field], target: tField && e[tField] != null ? e[tField] : null, notes: note || null, _src: (K.kpi_trackers.find(t => t.subject_employee === who) || {}).file });
      }
    }
  }

  /* ---------- services & design options ---------- */
  const M = ctx.k('marketing_options').entities;
  const C = ctx.k('company_compliance').entities;
  const svcCat = n => { n = n.toLowerCase(); return /gutter|roof/.test(n) ? 'gutter' : /tree|palm|fell|prun|canopy|branch/.test(n) ? 'tree' : /rubble|clean|refuse|debris|clear|alien|storm/.test(n) ? 'cleanup' : /pressure/.test(n) ? 'pressure_cleaning' : /lawn|grass|mow|\bedg|weed|fertil|till|soil|common area/.test(n) ? 'garden_maintenance' : /hardscap|rock|pav/.test(n) ? 'hardscape' : /irrigat/.test(n) ? 'irrigation' : /plant|hedg|bed|rejuven/.test(n) ? 'planting' : 'other'; };
  const WET = /mow|grass|lawn|\bedg|fertil|weed|spray|till|soil/i;
  const seen = new Set();
  for (const s of [...M.profile_services.map(x => ({ name: x.name, catalogue: 'Company profile', _src: x._src })), ...C.services.map(x => ({ name: x.service, catalogue: x.catalogue, description: x.description, _src: x._src }))]) {
    const key = s.name.toLowerCase().replace(/&/g, 'and').replace(/\(.*\)/g, '').replace(/[^a-z]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.services.push({ id: ctx.id('svc', s.name), code: null, name: s.name.replace(/\s*\(.*\)$/, ''), category: svcCat(s.name), unit: 'job', rate: null, weather_sensitive: WET.test(s.name), description: [s.description, `Listed under “${s.catalogue}”.`].filter(Boolean).join(' '), active: true, _src: s._src });
  }
  for (const d of M.design_options) {
    out.design_options.push({ id: ctx.id('dopt', d.deck, d.slide_no), deck: d.deck, slide_no: d.slide_no, name: d.name, description: d.description, price_hint: d.price_hint, image_paths: d.image_paths || [], _src: d._src });
    // "R8,50 per paver", "R250,00 a square meter" — South African comma decimals
    const price = /R\s?(\d[\d ]*(?:[.,]\d{1,2})?)\s*(?:per|a|\/)\s*(paver|square met|m²|m2|sqm)/i.exec(d.price_hint || '');
    if (price) out.services.push({ id: ctx.id('svc', 'design', d.name), name: d.name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()), category: 'hardscape', unit: /paver/i.test(price[2]) ? 'each' : 'm2', rate: Number(price[1].replace(/\s/g, '').replace(',', '.')), weather_sensitive: false, description: `${d.deck}: ${d.price_hint} (price per ${/paver/i.test(price[2]) ? 'paver' : 'square metre'}; the starting price)`, active: true, _src: d._src });
  }

  /* ---------- toolbox talk ---------- */
  for (const t of T.toolbox_talks) {
    const att = T.toolbox_talk_attendees.filter(a => true);
    out.toolbox_talks.push({ id: ctx.id('tbt', t.talk_id), date: iso(t.best_estimate_date), topic: t.topic, presenter: t.supervisor, attendee_names: att.map(a => a.name_as_written + (a.name_confidence && a.name_confidence !== 'high' ? ' (?)' : '')).join(', '),
      notes: `Site: ${t.site}. Topics: ${(t.topics_covered || []).join('; ')}.\nHeader date written ${t.header_date_written}; register dates ${t.register_dates_written} — recorded as ${iso(t.best_estimate_date)}.\n${t.attendee_count} attendees signed.`, _src: t._src });
  }

  /* ---------- recurring management meetings & reviews ---------- */
  const REC = [
    ['Weekly Operations Meeting', 'weekly', '07:30', 45, 'Weekly Operations Meeting Agenda (Operations Manager)'],
    ['Weekly CEO / GM coaching meeting', 'weekly', '16:00', 60, 'Leadership Development Programme — weekly coaching'],
    ['Weekly sales pipeline review', 'weekly', '15:00', 45, 'Sales workflow — pipeline review with the GM'],
    ['GM weekly report to the CEO', 'weekly', '17:00', 30, 'GM Role — weekly business report'],
    ['KPI trackers updated (GM & Sales)', 'weekly', '16:30', 30, 'KPI trackers: one row per Friday week-ending'],
    ['Monthly business review with the CEO', 'monthly', '10:00', 90, 'GM Role — monthly business review & revenue dashboard'],
    ['H&S committee meeting', 'quarterly', '10:00', 60, 'Health & Safety representative training — committee meets at least every 3 months'],
    ['Month-end client sign-off (complexes & estates)', 'monthly', '09:00', 60, 'REMAINING SOPS note — month-end audit / sign-off with clients']
  ];
  for (const [t, rec, time, mins, basis] of REC) {
    const start = rec === 'weekly' ? '2026-10-02' : rec === 'monthly' ? '2026-10-30' : '2026-10-15';
    const [hh, mm] = time.split(':').map(Number); const end = `${String(hh + Math.floor((mm + mins) / 60)).padStart(2, '0')}:${String((mm + mins) % 60).padStart(2, '0')}`;
    out.events.push({ id: ctx.id('ev', 'rec', t), title: t, category: 'meeting', calendar_id: 'cal-company', start_date: start, start_time: time, end_time: end, recurrence: rec,
      description: `${basis}. The source documents set the frequency but not the day or time — ${start} ${time} was chosen as a starting point; edit the series to the day that suits the team.`, reminders: [30, 1440], visibility: 'company', status: 'tentative', _src: `knowledge/strategy_roles.json, kpi_trackers.json, training_firefighting_hsrep.json, sops_toolbox.json calendar_candidates` });
  }
  for (const [date, title, cat] of [['2026-08-01', 'Leadership Development Programme starts (Anthony Guruvadu)', 'training'], ['2027-07-01', 'Leadership Development Programme completion (Anthony Guruvadu)', 'deadline'], ['2026-09-30', 'Key focus areas (Jul–Sep 2026) — quarter-end review', 'deadline'], ['2026-09-30', 'Renesh Gunpath — end of 3-month probation (if start was 1 July 2026)', 'hr'], ['2026-07-13', 'Toolbox talk — General landscaping safety (Carron Glen)', 'training'], ['2027-03-31', 'Check the clinic audiometer calibration before the 2027 re-medicals', 'compliance']])
    out.events.push({ id: ctx.id('ev', date, title), title, category: cat, calendar_id: cat === 'compliance' ? 'cal-compliance' : 'cal-company', start_date: date, all_day: true, reminders: [7 * 1440, 1440], visibility: 'company', status: 'confirmed', _src: 'knowledge calendar_candidates (strategy_roles, people_hr, sops_toolbox, medicals)' });
  return out;
}
