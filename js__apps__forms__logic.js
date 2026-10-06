/* Forms — pure logic (no DOM, no db). Question format: docs__CONTRACT.html §9. Tested in tests__forms.test.js. */

export const QTYPES = [
  ['section', 'Section header'], ['text', 'Short answer'], ['paragraph', 'Paragraph'], ['number', 'Number'], ['money', 'Amount (R)'], ['date', 'Date'], ['time', 'Time'], ['datetime', 'Date & time'],
  ['yesno', 'Yes / No'], ['checkbox', 'Tick box'], ['choice', 'Multiple choice'], ['checkboxes', 'Checkboxes'], ['dropdown', 'Dropdown'], ['scale', 'Linear scale'], ['rating', 'Star rating'],
  ['grid', 'Checklist grid'], ['photo', 'Photo'], ['file', 'File upload'], ['signature', 'Signature'], ['gps', 'GPS location'], ['employee', 'Employee'], ['client', 'Client'], ['site', 'Site'], ['vehicle', 'Vehicle'], ['asset', 'Asset']
];
/** A grid scored with the H&S risk key (numeric scale). Free-text grids such as asset registers are not risk grids. */
export const isRiskGrid = q => q.type === 'grid' && !!(q.scale && Array.isArray(q.scale.options) && q.scale.options.length && q.scale.options.every(o => Number.isFinite(Number(o))));
const empty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

/** Questions shown for the current answers (conditional logic: show_if { question, equals }). */
export function visibleQuestions(questions, answers = {}) {
  return (questions || []).filter(q => {
    if (!q.show_if || !q.show_if.question) return true;
    const a = answers[q.show_if.question];
    const want = q.show_if.equals;
    return Array.isArray(a) ? a.includes(want) : String(a ?? '') === String(want ?? '');
  });
}

/** { ok, errors: { [questionId]: message } } — required, number ranges, emails in text answers are not forced. */
export function validateAnswers(questions, answers = {}) {
  const errors = {};
  for (const q of visibleQuestions(questions, answers)) {
    if (q.type === 'section') continue;
    const a = answers[q.id];
    if (q.required && empty(a)) { errors[q.id] = 'This question is required'; continue; }
    if (empty(a)) continue;
    if (['number', 'money', 'scale'].includes(q.type)) {
      const n = Number(a);
      if (!Number.isFinite(n)) errors[q.id] = 'Enter a number';
      else if (q.min != null && n < q.min) errors[q.id] = `Must be at least ${q.min}`;
      else if (q.max != null && n > q.max) errors[q.id] = `Must be at most ${q.max}`;
    }
    if (q.type === 'grid' && q.required && Array.isArray(q.rows)) {
      const missing = q.rows.filter(r => empty(a[r]));
      if (missing.length) errors[q.id] = `${missing.length} row(s) not completed`;
    }
    if (['choice', 'dropdown'].includes(q.type) && Array.isArray(q.options) && q.options.length && !q.options.map(String).includes(String(a))) errors[q.id] = 'Pick one of the options';
  }
  return { ok: !Object.keys(errors).length, errors };
}

/** Per-question summary across responses: counts for choices, averages for numbers, worst cells for grids. */
export function summarise(questions, responses) {
  const out = [];
  for (const q of questions || []) {
    if (q.type === 'section') continue;
    const vals = responses.map(r => (r.answers || {})[q.id]).filter(v => !empty(v));
    const s = { id: q.id, label: q.label, type: q.type, answered: vals.length };
    if (['choice', 'dropdown', 'yesno', 'checkbox'].includes(q.type)) { s.counts = {}; vals.forEach(v => { const k = String(v === true ? 'Yes' : v === false ? 'No' : v); s.counts[k] = (s.counts[k] || 0) + 1; }); }
    else if (q.type === 'checkboxes') { s.counts = {}; vals.forEach(v => (Array.isArray(v) ? v : [v]).forEach(x => { s.counts[x] = (s.counts[x] || 0) + 1; })); }
    else if (['number', 'money', 'scale', 'rating'].includes(q.type)) { const ns = vals.map(Number).filter(Number.isFinite); s.avg = ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null; s.min = ns.length ? Math.min(...ns) : null; s.max = ns.length ? Math.max(...ns) : null; }
    else if (isRiskGrid(q)) {
      // H&S risk key: higher number = worse. Report rows that ever scored ≥ 3 (medium risk or worse).
      const flagged = {};
      vals.forEach(v => Object.entries(v || {}).forEach(([row, cols]) => Object.values(cols || {}).forEach(x => { if (Number(x) >= 3) flagged[row] = Math.max(flagged[row] || 0, Number(x)); })));
      s.flagged = flagged;
    }
    out.push(s);
  }
  return out;
}

/* ---------------- confidentiality ---------------- */
/** Response categories only some roles may read (owner/admin always may; so may the person who submitted).
    Mirrors the form_responses policies in js__sql__schema.js (step 02). */
export const CONFIDENTIAL = { hr: ['manager', 'hr'], incident: ['manager', 'hr', 'operations'] };
export const categoryReaders = category => CONFIDENTIAL[category] || null;
export function canReadResponse(r, user, category) {
  const roles = categoryReaders((r && r.form_category) || category);
  if (!roles) return true;
  if (!user) return false;
  return ['owner', 'admin'].includes(user.role) || (r && r.created_by === user.id) || roles.includes(user.role);
}
/** Can this user read every response to a form of this category (not just their own)? */
export const seesAllResponses = (category, user) => { const roles = categoryReaders(category); return !roles || (!!user && (['owner', 'admin'].includes(user.role) || roles.includes(user.role))); };

/* ---------------- grid labels ---------------- */
/** Grid answers are keyed by row and column label, so repeated labels would overwrite each other. */
export function duplicateLabels(list) {
  const seen = new Set(), dup = [];
  for (const x of list || []) { const k = String(x).trim().toLowerCase(); if (seen.has(k) && !dup.includes(x)) dup.push(x); seen.add(k); }
  return dup;
}
/** Makes repeated labels unique: MON, TUES, …, MON, TUES → "MON (wk 1)" … "MON (wk 2)" (weekdays) or "Item (2)". */
export function uniqueLabels(list) {
  const total = {}, seen = {};
  const key = x => String(x).trim().toLowerCase();
  (list || []).forEach(x => { total[key(x)] = (total[key(x)] || 0) + 1; });
  const weekday = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day)?$/i;
  return (list || []).map(x => {
    const k = key(x); if (total[k] < 2) return x;
    const n = (seen[k] = (seen[k] || 0) + 1);
    return weekday.test(String(x).trim()) ? `${x} (wk ${n})` : `${x} (${n})`;
  });
}

/* ---------------- signatures ---------------- */
/** The questions a person fills in: when the form requires a signature, its first signature question is required
    (later ones — e.g. "Signed: Management Representative" on the grievance form — are signed after review),
    and a form that requires one but has no signature question gets one at the end. */
export function fillQuestions(form) {
  const qs = (form && form.questions) || [];
  if (!form || !form.require_signature) return qs;
  const first = qs.find(q => q.type === 'signature');
  if (!first) return [...qs, { id: '_signature', type: 'signature', label: 'Signature', required: true }];
  return qs.map(q => (q === first ? { ...q, required: true } : q));
}

/* ---------------- incident forms → Health & Safety incident ---------------- */
// the company's incident forms (LI-FORM-004/005) name types their own way; map them onto the incident register's types
const INCIDENT_TYPE = [
  [/customer complaint|complaint/i, 'complaint'], [/near miss|potential|non-?conformance|housekeeping/i, 'near_miss'],
  [/injury|lost time|\biod\b/i, 'injury'], [/vehicle/i, 'vehicle'], [/spill|environment/i, 'environmental'],
  [/equipment|plant/i, 'equipment'], [/prop/i, 'property_damage'], [/theft|security/i, 'security']
];
export const incidentType = label => { for (const [re, t] of INCIDENT_TYPE) if (re.test(String(label || ''))) return t; return 'near_miss'; };
/** The incident-register fields an incident form response supports. Only the narrative questions are copied —
    medical, identity and signature answers stay on the (confidential) response. */
export function incidentFromResponse(questions, answers = {}, { today, responseId } = {}) {
  const qs = (questions || []).filter(q => q.type !== 'section');
  const ans = q => { const a = answers[q.id]; return a == null || a === '' || typeof a === 'object' ? null : String(a).trim() || null; };
  const find = (re, types) => qs.find(q => re.test(q.label || '') && (!types || types.includes(q.type)) && ans(q) != null);
  const typeQ = find(/type of incident|incident type|^type$/i, ['choice', 'dropdown', 'text']);
  const dateQ = find(/incident date|date of (the )?incident|^date$/i, ['date']);
  const locQ = find(/^location|site/i, ['text', 'site']);
  const first = find(/^first name/i, ['text']), last = find(/^surname|last name/i, ['text']);
  const narrative = qs.filter(q => ['text', 'paragraph'].includes(q.type) && /description|what happened|sequence|timeline|observation|finding/i.test(q.label || '') && ans(q) != null);
  let date = dateQ ? ans(dateQ) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || (today && date > today)) date = today || null; // the register refuses future dates
  const ref = responseId ? `\n\n(From form response ${responseId}.)` : '';
  return {
    date, type: incidentType(typeQ && ans(typeQ)),
    location: locQ && locQ.type === 'text' ? ans(locQ) : null,
    site_id: locQ && locQ.type === 'site' ? ans(locQ) : null,
    people_involved: [first && ans(first), last && ans(last)].filter(Boolean).join(' ') || null,
    description: (narrative.map(q => `${q.label}: ${ans(q)}`).join('\n') || 'See the form response for the details.') + ref
  };
}

/** Highest risk score in a response's grids (for H&S checklists); null when there is no grid answer. */
export function worstRisk(questions, answers) {
  let worst = null;
  for (const q of questions || []) if (isRiskGrid(q)) for (const cols of Object.values((answers || {})[q.id] || {})) for (const v of Object.values(cols || {})) { const n = Number(v); if (Number.isFinite(n)) worst = Math.max(worst ?? 0, n); }
  return worst;
}
