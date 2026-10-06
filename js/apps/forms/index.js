/* =============================================================================
   Forms (#/forms) — the company's checklists and forms (HSE-CHK001…006, PPE issue,
   warning, counselling, grievance, incident investigations) and any new form:
   a builder, a mobile fill mode (drafts survive lost signal), responses with
   summaries, a review workflow, printing and CSV export. H&S checklist grids use
   the company's own 1–5 risk key; a score of 4–5 alerts management.
   ========================================================================== */

import { h, ensureStyle, uid, downloadText, toCSV } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, pageHeader, emptyState, listItem, callout, kpiTile, tabs, attribution, kv } from '../../ui/components.js';
import { toast, showError, confirm, prompt } from '../../ui/overlays.js';
import { fieldInput, refPicker } from '../../ui/form.js';
import { celebrate } from '../../ui/animate.js';
import { dataTable } from '../../ui/table.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { can } from '../../core/perms.js';
import { notify } from '../../core/notify.js';
import { uploadFiles } from '../../core/files.js';
import { today } from '../../core/dates.js';
import * as fmt from '../../core/format.js';
import { QTYPES, visibleQuestions, validateAnswers, summarise, worstRisk, fillQuestions, canReadResponse, seesAllResponses, categoryReaders, duplicateLabels, incidentFromResponse } from './logic.js';
import { FORM_DRAFT_PREFIX } from '../../core/auth.js';

ensureStyle('lsi-forms', `
.fq{padding:14px;border:1px solid var(--border);border-radius:16px;background:var(--surface-solid);margin-bottom:10px}
.fq.sec{background:var(--primary-soft);border-color:transparent}.fq .lbl{font-weight:650;margin-bottom:8px}.fq .hint{font-size:var(--fs-xs);color:var(--muted);margin-bottom:8px}
.fq.bad{border-color:var(--danger)}.fq .err{color:var(--danger);font-size:var(--fs-xs);margin-top:6px}
.grid-q{overflow-x:auto}.grid-q table{border-collapse:collapse;font-size:.82rem}.grid-q th,.grid-q td{border:1px solid var(--border);padding:4px}.grid-q th{background:var(--surface-2);white-space:nowrap}
.grid-q select{padding:2px;border-radius:6px;border:1px solid var(--border);background:var(--surface)}
.grid-q td.r3{background:#fdf1c7}.grid-q td.r4{background:#f8d7cf}.grid-q td.r5{background:#f3b6b6}
.opts{display:flex;flex-wrap:wrap;gap:8px}.opts label{display:flex;gap:6px;align-items:center;padding:8px 12px;border:1px solid var(--border);border-radius:12px;cursor:pointer}
.bq{display:grid;grid-template-columns:1fr 160px auto;gap:8px;align-items:start;padding:10px;border:1px solid var(--border);border-radius:14px;margin-bottom:8px;background:var(--surface-solid)}
@media (max-width:700px){.bq{grid-template-columns:1fr}}
`);

const me = () => store.get('user') || {};
const CAT_ICON = { checklist: 'list-checks', inspection: 'clipboard-check', incident: 'siren', hr: 'gavel', safety: 'hard-hat', survey: 'smile', request: 'inbox', quote_request: 'file-signature', other: 'clipboard-list' };
// drafts belong to one person on one device (and are deleted when they sign out — core/auth.js)
const draftKey = id => `${FORM_DRAFT_PREFIX}${me().id || 'anon'}.${id}`;
/** Responses this person may read (HR and incident responses are confidential — logic.js, and the RLS in js/sql/schema.js). */
const visibleResponses = (pred = () => true) => db.filter('form_responses', r => pred(r) && canReadResponse(r, me(), (db.get('forms', r.form_id) || {}).category));
const loadDraft = id => { try { return JSON.parse(localStorage.getItem(draftKey(id)) || 'null'); } catch { return null; } };

/* ---------------- one question in fill mode ---------------- */
function answerInput(q, answers, set, form = {}) { // answers: the live answers object (read at event time, not render time)
  const v = answers[q.id];
  switch (q.type) {
    case 'section': return null;
    case 'paragraph': return fieldInput({ type: 'longtext', rows: 3 }, v, set);
    case 'number': case 'scale': return fieldInput({ type: 'number', min: q.min, max: q.max }, v, set);
    case 'money': return fieldInput({ type: 'money' }, v, set);
    case 'date': return fieldInput({ type: 'date' }, v, set);
    case 'time': return fieldInput({ type: 'time' }, v, set);
    case 'datetime': return fieldInput({ type: 'datetime' }, v, set);
    case 'yesno': return h('div.opts', ['Yes', 'No', 'N/A'].map(o => h('label', h('input', { type: 'radio', name: q.id, checked: v === o, onChange: () => set(o) }), o)));
    case 'checkbox': return h('label.row.gap-8', h('input', { type: 'checkbox', checked: !!v, onChange: e => set(e.target.checked) }), 'Done / confirmed');
    case 'choice': case 'dropdown': return q.type === 'dropdown' ? h('select.select', { onChange: e => set(e.target.value || null) }, h('option', { value: '' }, 'Choose…'), (q.options || []).map(o => h('option', { value: o, selected: v === o }, o)))
      : h('div.opts', (q.options || []).map(o => h('label', h('input', { type: 'radio', name: q.id, checked: v === o, onChange: () => set(o) }), o)));
    case 'checkboxes': { const cur = new Set(Array.isArray(v) ? v : []); return h('div.opts', (q.options || []).map(o => h('label', h('input', { type: 'checkbox', checked: cur.has(o), onChange: e => { e.target.checked ? cur.add(o) : cur.delete(o); set([...cur]); } }), o))); }
    case 'rating': return fieldInput({ type: 'rating' }, v, set);
    case 'grid': {
      const opts = (q.scale && q.scale.options) || [];
      const cur = v && typeof v === 'object' ? { ...v } : {};
      const cols = q.columns && q.columns.length ? q.columns : ['Value'];
      return h('div.grid-q', h('table', h('thead', h('tr', h('th', ''), cols.map(c => h('th', c)))), h('tbody', (q.rows || []).map(r => h('tr', h('th', { style: 'text-align:left;white-space:normal;min-width:180px' }, r), cols.map(c => {
        const val = (cur[r] || {})[c];
        const td = h('td', { class: val ? `r${val}` : '' });
        td.appendChild(opts.length ? h('select', { onChange: e => { cur[r] = { ...(cur[r] || {}), [c]: e.target.value || undefined }; td.className = e.target.value ? `r${e.target.value}` : ''; set({ ...cur }); } }, h('option', { value: '' }, '–'), opts.map(o => h('option', { value: o, selected: String(val) === String(o) }, o)))
          : h('input', { style: 'width:110px', value: val || '', onInput: e => { cur[r] = { ...(cur[r] || {}), [c]: e.target.value }; set({ ...cur }); } }));
        return td;
      }))))));
    }
    case 'photo': case 'file': {
      const cur = () => (Array.isArray(answers[q.id]) ? answers[q.id] : []);
      const box = h('div.chips');
      const paint = () => box.replaceChildren(...cur().map((f, i) => h('span.chip', icon('paperclip', 12), f.name,
        h('button.btn.btn-ghost.btn-icon.btn-sm', { type: 'button', title: `Remove ${f.name}`, 'aria-label': `Remove ${f.name}`, style: 'margin-left:2px;padding:0', onClick: () => { const next = cur().filter((_, j) => j !== i); set(next.length ? next : null); paint(); } }, icon('x', 12)))));
      const inp = h('input', { type: 'file', multiple: true, accept: q.type === 'photo' ? 'image/*' : undefined, capture: q.type === 'photo' ? 'environment' : undefined, onChange: async e => {
        const files = [...(e.target.files || [])]; if (!files.length) return;
        inp.disabled = true;
        // photos and files on HR and incident forms are confidential, like the response itself
        try { const recs = await uploadFiles(files, { drive_id: 'drive-sops', description: `Form upload: ${q.label}`, confidential: !!categoryReaders(form.category) }); set([...cur(), ...recs.map(r => ({ file_id: r.id, name: r.name }))]); paint(); }
        catch (err) { showError(err, 'Upload failed'); }
        finally { inp.disabled = false; inp.value = ''; }
      } });
      paint();
      return h('div.stack.tight', inp, box);
    }
    case 'signature': return fieldInput({ type: 'signature' }, v, set);
    case 'gps': return h('div.row.gap-8', btn({ label: v ? 'Update location' : 'Capture location', icon: 'map-pin', size: 'sm', onClick: () => navigator.geolocation && navigator.geolocation.getCurrentPosition(p => set({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }), () => toast.error('Location permission denied')) }), v ? h('span.small.muted', `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)} (±${v.acc} m)`) : null);
    case 'employee': return refPicker({ ref: 'employees' }, v, set);
    case 'client': return refPicker({ ref: 'clients' }, v, set);
    case 'site': return refPicker({ ref: 'sites' }, v, set);
    case 'vehicle': return refPicker({ ref: 'vehicles' }, v, set);
    case 'asset': return refPicker({ ref: 'assets' }, v, set);
    default: return fieldInput({ type: 'text' }, v, set);
  }
}

/* ---------------- fill ---------------- */
function fill(ctx) {
  const f = db.get('forms', decodeURIComponent(ctx.params.id));
  if (!f) return emptyState({ icon: 'search-x', title: 'Form not found' });
  const qs = fillQuestions(f);
  const answers = loadDraft(f.id) || {};
  const box = h('div');
  let busy = false;
  const errs = {};
  const draw = () => {
    box.replaceChildren(...visibleQuestions(qs, answers).map(q => q.type === 'section'
      ? h('div.fq.sec', h('div.lbl', q.label), q.help ? h('div.small', { style: 'white-space:pre-line' }, q.help) : null)
      : h('div', { class: ['fq', errs[q.id] ? 'bad' : ''], dataset: { q: q.id } }, h('div.lbl', q.label, q.required ? h('span.req', ' *') : null), q.help ? h('div.hint', q.help) : null,
        answerInput(q, answers, x => { answers[q.id] = x; try { localStorage.setItem(draftKey(f.id), JSON.stringify(answers)); } catch { /* storage full */ } if (qs.some(o => o.show_if && o.show_if.question === q.id)) draw(); }, f),
        errs[q.id] ? h('div.err', errs[q.id]) : null)));
  };
  draw();
  const submit = async () => {
    if (busy) return;
    const v = validateAnswers(qs, answers);
    Object.keys(errs).forEach(k => delete errs[k]); Object.assign(errs, v.errors);
    if (!v.ok) { draw(); toast.error('Please complete the highlighted questions'); box.querySelector('.fq.bad')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const sig = qs.find(q => q.type === 'signature');
    const emp = qs.find(q => q.type === 'employee'), cl = qs.find(q => q.type === 'client');
    busy = true; submitBtn.disabled = true;
    try {
      const rec = await db.insert('form_responses', { form_id: f.id, form_title: f.title, form_category: f.category || null, answers, signature: sig ? answers[sig.id] : null, subject_employee_id: emp ? answers[emp.id] || null : null, client_id: cl ? answers[cl.id] || null : null, status: 'submitted' });
      localStorage.removeItem(draftKey(f.id));
      const risk = worstRisk(qs, answers);
      const managers = db.filter('profiles', p => ['owner', 'admin', 'manager'].includes(p.role)).map(p => p.id);
      const targets = [...new Set([...(f.notify_ids || []), ...(risk >= 4 || f.category === 'incident' ? managers : [])])].filter(x => x !== me().id && canReadResponse(rec, db.get('profiles', x), f.category)); // a confidential response only alerts people who may open it
      if (targets.length) notify(targets, { title: risk >= 4 ? `High risk on ${f.title}` : `${f.title} submitted`, body: `${me().name}${risk ? ` · worst risk ${risk}` : ''}`, icon: risk >= 4 ? 'siren' : 'clipboard-check', tile: risk >= 4 ? 't-rose' : 't-violet', link: `#/forms/${encodeURIComponent(f.id)}/responses?r=${rec.id}`, kind: 'form', source_key: `form|${rec.id}` }).catch(() => {});
      celebrate({ confetti: false });
      toast.success('Submitted — thank you');
      if (f.category === 'incident' && can('write', 'incidents') && (await confirm('Log this as an incident in Health & Safety as well? Only the date, type, place, people and description are copied — medical and signature answers stay on the confidential form.', { ok: 'Log incident' }))) {
        const inc = incidentFromResponse(qs, answers, { today: today(), responseId: rec.id });
        await db.insert('incidents', { ...inc, severity: risk >= 4 ? 'high' : 'medium', status: 'investigating' }).then(() => toast.success('Incident logged in Health & Safety')).catch(e => showError(e, 'The form was saved, but the incident was not logged'));
      }
      ctx.navigate(`forms/${encodeURIComponent(f.id)}/responses?r=${rec.id}`);
    } catch (e) { showError(e); }
    finally { busy = false; submitBtn.disabled = false; }
  };
  const submitBtn = btn({ label: 'Submit', icon: 'send', variant: 'primary', onClick: submit });
  return h('div', { style: 'max-width:900px;margin:0 auto' },
    pageHeader({ title: f.title, sub: [f.doc_code, f.description].filter(Boolean).join(' · '), icon: CAT_ICON[f.category] || 'clipboard-list', tile: 't-violet', crumbs: [{ label: 'Forms', href: '#/forms' }, { label: f.title }] }),
    !f.accepting ? callout('warning', 'Not accepting responses', 'This form has been closed.', 'lock') : null,
    loadDraft(f.id) ? callout('info', 'Draft restored', 'Your unsent answers were saved on this device.', 'save') : null,
    box,
    f.accepting ? h('div.row', { style: 'margin:14px 0 40px' }, btn({ label: 'Clear', variant: 'ghost', onClick: async () => { if (await confirm('Clear all answers?')) { localStorage.removeItem(draftKey(f.id)); Object.keys(answers).forEach(k => delete answers[k]); draw(); } } }), h('span.spacer'), submitBtn) : null);
}

/* ---------------- builder ---------------- */
function builder(ctx) {
  const f = db.get('forms', decodeURIComponent(ctx.params.id));
  if (!f) return emptyState({ icon: 'search-x', title: 'Form not found' });
  const st = { title: f.title, description: f.description || '', category: f.category || 'other', doc_code: f.doc_code || '', accepting: f.accepting !== false, require_signature: !!f.require_signature, questions: JSON.parse(JSON.stringify(f.questions || [])) };
  const list = h('div');
  const draw = () => list.replaceChildren(...st.questions.map((q, i) => h('div.bq',
    h('div.stack.tight', h('input.input', { value: q.label || '', placeholder: 'Question', onInput: e => { q.label = e.target.value; } }),
      ['choice', 'checkboxes', 'dropdown'].includes(q.type) ? h('input.input', { value: (q.options || []).join(', '), placeholder: 'Options, separated by commas', onInput: e => { q.options = e.target.value.split(',').map(s => s.trim()).filter(Boolean); } }) : null,
      q.type === 'grid' ? h('div.stack.tight', h('textarea.textarea', { rows: 3, value: (q.rows || []).join('\n'), placeholder: 'Rows (one per line)', onInput: e => { q.rows = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); } }), h('input.input', { value: (q.columns || []).join(', '), placeholder: 'Columns, e.g. Jan, Feb, Mar', onInput: e => { q.columns = e.target.value.split(',').map(s => s.trim()).filter(Boolean); } }), h('input.input', { value: ((q.scale || {}).options || []).join(', '), placeholder: 'Cell values, e.g. 1, 2, 3, 4, 5 (blank = free text)', onInput: e => { q.scale = { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }; } })) : null,
      h('input.input', { value: q.help || '', placeholder: 'Help text (optional)', onInput: e => { q.help = e.target.value; } }),
      i > 0 ? h('div.row.gap-8.small', 'Show only if', h('select.select', { style: 'width:auto', onChange: e => { q.show_if = e.target.value ? { question: e.target.value, equals: (q.show_if || {}).equals || 'Yes' } : null; draw(); } }, h('option', { value: '' }, '(always shown)'), st.questions.slice(0, i).filter(x => x.type !== 'section').map(x => h('option', { value: x.id, selected: q.show_if && q.show_if.question === x.id }, fmt.truncate(x.label, 40)))),
        q.show_if ? h('input.input', { style: 'width:120px', value: q.show_if.equals, onInput: e => { q.show_if.equals = e.target.value; } }) : null) : null),
    h('select.select', { onChange: e => { q.type = e.target.value; draw(); } }, QTYPES.map(([v, l]) => h('option', { value: v, selected: q.type === v }, l))),
    h('div.row.gap-4', h('label.small.row.gap-4', h('input', { type: 'checkbox', checked: !!q.required, onChange: e => { q.required = e.target.checked; } }), 'Req.'),
      btn({ icon: 'arrow-up', size: 'sm', variant: 'ghost', title: 'Up', onClick: () => { if (i) { [st.questions[i - 1], st.questions[i]] = [st.questions[i], st.questions[i - 1]]; draw(); } } }),
      btn({ icon: 'copy', size: 'sm', variant: 'ghost', title: 'Duplicate', onClick: () => { st.questions.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(q)), id: uid().slice(0, 8) }); draw(); } }),
      btn({ icon: 'trash-2', size: 'sm', variant: 'ghost', title: 'Delete', onClick: () => { st.questions.splice(i, 1); draw(); } })))));
  draw();
  const save = async () => {
    const clash = st.questions.filter(q => q.type === 'grid').map(q => [q, [...duplicateLabels(q.rows), ...duplicateLabels(q.columns)]]).find(([, d]) => d.length);
    if (clash) { toast.error(`“${clash[0].label || 'Checklist grid'}” repeats ${clash[1].map(x => `“${x}”`).join(', ')} — each row and column needs its own name (e.g. “MON (wk 1)”, “MON (wk 2)”).`); return; }
    try { await db.update('forms', f.id, { ...st, questions: st.questions.filter(q => q.label || q.type === 'section') }); toast.success('Form saved'); } catch (e) { showError(e); }
  };
  return h('div', pageHeader({ title: `Edit: ${f.title}`, icon: 'pencil-ruler', tile: 't-violet', crumbs: [{ label: 'Forms', href: '#/forms' }, { label: f.title, href: `#/forms/${encodeURIComponent(f.id)}` }, { label: 'Edit' }],
    actions: [btn({ label: 'Preview', icon: 'eye', variant: 'ghost', onClick: () => ctx.navigate(`forms/${encodeURIComponent(f.id)}`) }), btn({ label: 'Save', icon: 'check', variant: 'primary', onClick: save })] }),
    card({ cls: 'solid', style: 'margin-bottom:14px' }, h('div.form-grid',
      h('div.field', h('label.field-label', 'Title'), h('input.input', { value: st.title, onInput: e => { st.title = e.target.value; } })),
      h('div.field', h('label.field-label', 'Form code'), h('input.input', { value: st.doc_code, onInput: e => { st.doc_code = e.target.value; } })),
      h('div.field', h('label.field-label', 'Category'), fieldInput({ type: 'enum', required: true, options: ['checklist', 'incident', 'hr', 'safety', 'inspection', 'survey', 'request', 'quote_request', 'other'] }, st.category, x => { st.category = x; })),
      h('div.field', h('label.field-label', 'Settings'), h('label.row.gap-8', h('input', { type: 'checkbox', checked: st.accepting, onChange: e => { st.accepting = e.target.checked; } }), 'Accepting responses'), h('label.row.gap-8', h('input', { type: 'checkbox', checked: st.require_signature, onChange: e => { st.require_signature = e.target.checked; } }), 'Require a signature')),
      h('div.field.full', h('label.field-label', 'Description'), fieldInput({ type: 'longtext', rows: 2 }, st.description, x => { st.description = x; })))),
    list, h('div.row.gap-8', btn({ label: 'Add question', icon: 'plus', onClick: () => { st.questions.push({ id: uid().slice(0, 8), type: 'text', label: '' }); draw(); } }), btn({ label: 'Add section', icon: 'heading', variant: 'ghost', onClick: () => { st.questions.push({ id: uid().slice(0, 8), type: 'section', label: 'New section' }); draw(); } })));
}

/* ---------------- responses ---------------- */
function responses(ctx) {
  const f = db.get('forms', decodeURIComponent(ctx.params.id));
  if (!f) return emptyState({ icon: 'search-x', title: 'Form not found' });
  const qs = fillQuestions(f);
  const rows = () => visibleResponses(r => r.form_id === f.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const reviewer = can('update', 'form_responses') && seesAllResponses(f.category, me());
  const REFS = { employee: 'employees', client: 'clients', site: 'sites', vehicle: 'vehicles', asset: 'assets' };
  /** A plain-text answer for the CSV export (a signature is recorded as "signed", never copied into a spreadsheet). */
  const plain = (q, a) => { if (a == null || a === '') return ''; if (q.type === 'signature') return 'signed'; if (q.type === 'datetime') return fmt.dateTime(a); if (REFS[q.type]) return db.label(REFS[q.type], a) || a; if (q.type === 'gps' && a.lat != null) return `${a.lat}, ${a.lng}`; if (Array.isArray(a)) return a.map(x => (x && typeof x === 'object' ? x.name : x)).join('; '); if (typeof a === 'object') return JSON.stringify(a); return String(a); };
  const detail = h('div');
  const show = r => {
    if (!r) { detail.replaceChildren(); return; }
    const val = q => { const a = (r.answers || {})[q.id]; if (a == null || a === '') return h('span.faint', '—'); if (q.type === 'signature') return typeof a === 'string' && a.startsWith('data:image/') ? h('img', { src: a, alt: `Signature: ${q.label}`, style: 'height:60px;background:#fff;border-radius:8px' }) : 'Signed'; if (q.type === 'datetime') return fmt.dateTime(a); if (q.type === 'grid') return h('div.grid-q', h('table', h('tbody', Object.entries(a).map(([row, cols]) => h('tr', h('th', { style: 'text-align:left' }, row), Object.entries(cols || {}).map(([c, v]) => h('td', { class: `r${v}` }, `${c}: ${v}`))))))); if (Array.isArray(a)) return a.map(x => (typeof x === 'object' ? x.name : x)).join(', '); if (typeof a === 'object') return a.lat ? `${a.lat}, ${a.lng}` : JSON.stringify(a); if (['employee', 'client', 'site', 'vehicle', 'asset'].includes(q.type)) return db.label({ employee: 'employees', client: 'clients', site: 'sites', vehicle: 'vehicles', asset: 'assets' }[q.type], a) || a; return String(a); };
    detail.replaceChildren(card({ title: `Response · ${fmt.dateTime(r.created_at)}`, sub: attribution(r), icon: 'file-check', cls: 'solid', actions: [btn({ label: 'Print', icon: 'printer', size: 'sm', variant: 'ghost', onClick: () => window.print() })] },
      kv(qs.filter(q => q.type !== 'section').map(q => [q.label, val(q)])),
      r.signature && !qs.some(q => q.type === 'signature' && (r.answers || {})[q.id] === r.signature) && String(r.signature).startsWith('data:image/') ? h('img', { src: r.signature, alt: 'Signature', style: 'height:70px;margin-top:10px' }) : null,
      reviewer ? h('div.row.gap-8', { style: 'margin-top:12px' }, h('span.small', 'Status:'), ...['submitted', 'reviewed', 'actioned', 'closed'].map(s => h('button', { class: ['chip', r.status === s ? 'active' : ''], onClick: () => db.update('form_responses', r.id, { status: s, reviewed_by: me().name }).then(() => show(db.get('form_responses', r.id))) }, fmt.titleCase(s)))) : null));
  };
  const table = dataTable({
    columns: [{ key: 'created_at', label: 'Submitted', render: r => fmt.dateTime(r.created_at), sort: true }, { key: 'by', label: 'By', render: r => r.created_by_name || '—' },
      { key: 'risk', label: 'Worst risk', render: r => { const w = worstRisk(qs, r.answers); return w == null ? '—' : badge(String(w), w >= 4 ? 'red' : w >= 3 ? 'gold' : 'green'); } }, { key: 'status', label: 'Status', render: r => badge(r.status || 'submitted', r.status === 'closed' ? 'green' : 'blue') }],
    rows, sort: '-created_at', onRowClick: show, exportName: `form-${f.doc_code || f.id}`
  });
  const sum = summarise(qs, rows());
  if (ctx.query.r) setTimeout(() => { const r = db.get('form_responses', ctx.query.r); show(r && rows().some(x => x.id === r.id) ? r : null); }, 50);
  ctx.dispose.add(db.on('form_responses', () => table.refresh()));
  return h('div', pageHeader({ title: `${f.title} — responses`, sub: seesAllResponses(f.category, me()) ? null : 'Confidential form — you see only the responses you submitted.', icon: 'bar-chart-3', tile: 't-violet', crumbs: [{ label: 'Forms', href: '#/forms' }, { label: f.title, href: `#/forms/${encodeURIComponent(f.id)}` }, { label: 'Responses' }],
    actions: [btn({ label: 'CSV', icon: 'download', variant: 'ghost', onClick: () => downloadText(toCSV(rows().map(r => ({ submitted: fmt.dateTime(r.created_at), by: r.created_by_name, status: r.status, ...Object.fromEntries(qs.filter(q => q.type !== 'section').map(q => [q.label, plain(q, (r.answers || {})[q.id])])) }))), `${f.title}.csv`, 'text/csv') }), btn({ label: 'Fill in', icon: 'pencil', variant: 'primary', onClick: () => ctx.navigate(`forms/${encodeURIComponent(f.id)}`) })] }),
    h('div.grid.cols-3.stagger', { style: 'margin-bottom:14px' }, kpiTile({ label: 'Responses', value: rows().length, icon: 'inbox', tile: 't-violet' }), kpiTile({ label: 'Awaiting review', value: rows().filter(r => (r.status || 'submitted') === 'submitted').length, icon: 'eye', tile: 't-sun' }), kpiTile({ label: 'High-risk findings', value: rows().filter(r => (worstRisk(qs, r.answers) || 0) >= 4).length, icon: 'siren', tile: 't-rose' })),
    sum.some(s => s.counts || s.flagged && Object.keys(s.flagged).length) ? card({ title: 'Summary', icon: 'chart-bar', cls: 'solid', style: 'margin-bottom:14px' }, h('div.stack', sum.filter(s => s.counts || (s.flagged && Object.keys(s.flagged).length) || s.avg != null).slice(0, 12).map(s => h('div', h('strong', s.label), h('div.small', s.counts ? Object.entries(s.counts).map(([k, n]) => `${k}: ${n}`).join(' · ') : s.flagged ? `Medium-or-worse risk: ${Object.entries(s.flagged).map(([r, v]) => `${r} (${v})`).join('; ')}` : `Average ${fmt.num(s.avg, 1)} (min ${s.min}, max ${s.max})`))))) : null,
    h('div.grid', { style: 'grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px' }, card({ cls: 'solid', body: table }), detail));
}

/* ---------------- home ---------------- */
function home(ctx) {
  const forms = db.all('forms').sort((a, b) => String(a.doc_code || a.title).localeCompare(String(b.doc_code || b.title), undefined, { numeric: true }));
  const cats = [...new Set(forms.map(f => f.category || 'other'))];
  const count = id => visibleResponses(r => r.form_id === id).length;
  return h('div',
    pageHeader({ title: 'Forms & checklists', sub: 'Fill in checklists and forms on your phone — every submission is signed, dated and kept.', icon: 'clipboard-list', tile: 't-violet',
      actions: [can('write', 'forms') ? btn({ label: 'New form', icon: 'plus', variant: 'primary', onClick: async () => { const t = await prompt('Form title', { title: 'New form' }); if (!t) return; const f = await db.insert('forms', { title: t, category: 'other', questions: [{ id: uid().slice(0, 8), type: 'text', label: 'Name', required: true }], accepting: true }); ctx.navigate(`forms/${encodeURIComponent(f.id)}/edit`); } }) : null] }),
    forms.length ? h('div.stack', cats.map(c => card({ title: fmt.titleCase(c.replace(/_/g, ' ')), icon: CAT_ICON[c] || 'clipboard-list', cls: 'solid' }, h('div.list.divider-list', forms.filter(f => (f.category || 'other') === c).map(f => listItem({
      title: `${f.doc_code ? f.doc_code + ' · ' : ''}${f.title}`, sub: `${(f.questions || []).filter(q => q.type !== 'section').length} questions · ${count(f.id)} responses${f.accepting === false ? ' · closed' : ''}`, icon: CAT_ICON[c] || 'clipboard-list', tile: 't-violet',
      right: h('div.row.gap-4', h('a.btn.btn-sm.btn-primary', { href: `#/forms/${encodeURIComponent(f.id)}` }, 'Fill in'), h('a.btn.btn-sm.btn-ghost', { href: `#/forms/${encodeURIComponent(f.id)}/responses` }, 'Responses'), can('write', 'forms') ? h('a.btn.btn-sm.btn-ghost', { href: `#/forms/${encodeURIComponent(f.id)}/edit` }, icon('pencil', 14)) : null)
    })))))) : emptyState({ icon: 'clipboard-list', title: 'No forms yet' }));
}

export default {
  id: 'forms',
  routes: { '': home, new: ctx => { ctx.navigate('forms'); return h('div'); }, ':id/edit': builder, ':id/responses': responses, ':id': fill },
  detail: { forms: (id, ctx) => fill({ ...ctx, params: { id } }), form_responses: (id, ctx) => { const r = db.get('form_responses', id); if (r && !canReadResponse(r, me(), (db.get('forms', r.form_id) || {}).category)) return emptyState({ icon: 'lock', title: 'This response is confidential' }); return r ? responses({ ...ctx, params: { id: r.form_id }, query: { r: id } }) : emptyState({ icon: 'search-x', title: 'Response not found' }); } }
};
void tabs;
