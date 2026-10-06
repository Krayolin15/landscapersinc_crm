/* =============================================================================
   Schema-driven forms with live validation.

   schemaForm(col, { values, fields:['name','phone',...] | null (all visible),
                     onChange(values), readonly })  -> { el, values(), validate(), set(k,v), showErrors(errs) }
   openRecordForm(col, { id, values, title, fields, onSaved(rec), submitLabel })
     -> modal that validates with the collection schema and saves via db.
   fieldInput(def, value, onChange) -> a single input for a field definition
   ========================================================================== */

import { h, debounce } from './dom.js';
import { icon } from './icons.js';
import { modal, confirm, toast, showError } from './overlays.js';
import { db } from '../core/db.js';
import { getDef } from '../core/schema.js';
import { saIdInfo } from '../core/validate.js';
import { canSeeField } from '../core/perms.js';
import * as fmt from '../core/format.js';

const optVal = o => (typeof o === 'object' ? o.value : o);
const optLab = o => (typeof o === 'object' ? o.label : fmt.titleCase(String(o).replace(/_/g, ' ')));

/** Build the input control for one field definition. */
export function fieldInput(f, value, onChange, { name, readonly } = {}) {
  const set = v => onChange && onChange(v);
  const common = { name, disabled: readonly || f.readonly, placeholder: f.placeholder || '' };
  switch (f.type) {
    case 'longtext':
      return h('textarea.textarea', { ...common, value: value ?? '', rows: f.rows || 4, onInput: e => set(e.target.value) });
    case 'richtext': {
      const ed = h('div.textarea', { contenteditable: readonly ? 'false' : 'true', style: 'min-height:120px', html: value || '', onInput: e => set(e.target.innerHTML) });
      const tb = readonly ? null : h('div.row.gap-4', { style: 'margin-bottom:6px' },
        [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'], ['list', 'insertUnorderedList'], ['list-ordered', 'insertOrderedList']].map(([ic, cmd]) =>
          h('button.btn.btn-ghost.btn-sm.btn-icon', { type: 'button', onMousedown: e => { e.preventDefault(); document.execCommand(cmd); set(ed.innerHTML); } }, icon(ic, 15))));
      return h('div', tb, ed);
    }
    case 'money':
      return h('div.input-group', h('span.addon', 'R'), h('input.input', { ...common, type: 'number', step: f.precise ? 'any' : '0.01', inputmode: 'decimal', min: f.min, value: value ?? '', onInput: e => set(e.target.value === '' ? null : Number(e.target.value)) }));
    case 'int': case 'number':
      return h('input.input', { ...common, type: 'number', step: f.type === 'int' ? '1' : 'any', min: f.min, max: f.max, inputmode: f.type === 'int' ? 'numeric' : 'decimal', value: value ?? '', onInput: e => set(e.target.value === '' ? null : Number(e.target.value)) });
    case 'percent':
      return h('div.input-group', h('input.input', { ...common, type: 'number', step: 'any', min: 0, max: 100, value: value ?? '', onInput: e => set(e.target.value === '' ? null : Number(e.target.value)) }), h('span.addon', '%'));
    case 'rating': {
      const wrap = h('div.row.gap-4');
      const draw = v => wrap.replaceChildren(...[1, 2, 3, 4, 5].map(n => h('button', { type: 'button', style: `color:${n <= (v || 0) ? 'var(--sun-500)' : 'var(--slate-300)'}`, onClick: () => { set(n); draw(n); } }, icon('star', 22))));
      draw(value);
      return wrap;
    }
    case 'date': return h('input.input', { ...common, type: 'date', value: value ? String(value).slice(0, 10) : '', onInput: e => set(e.target.value || null) });
    case 'datetime': return h('input.input', { ...common, type: 'datetime-local', value: value ? String(value).slice(0, 16) : '', onInput: e => set(e.target.value ? new Date(e.target.value).toISOString() : null) });
    case 'time': return h('input.input', { ...common, type: 'time', value: value ?? '', onInput: e => set(e.target.value || null) });
    case 'bool':
      return h('label.switch', h('input', { type: 'checkbox', checked: !!value, disabled: common.disabled, onChange: e => set(e.target.checked) }), h('span.track'), h('span.small', f.switchLabel || (value ? 'Yes' : 'No')));
    case 'enum':
      return h('select.select', { ...common, onChange: e => set(e.target.value || null) },
        h('option', { value: '' }, f.required ? 'Choose…' : '—'),
        (f.options || []).map(o => h('option', { value: optVal(o), selected: optVal(o) === value }, optLab(o))));
    case 'multi': case 'tags': return tagInput(f, value, set, common.disabled);
    case 'ref': return refPicker(f, value, set, common.disabled);
    case 'refs': return refsPicker(f, value, set, common.disabled);
    case 'color': return h('input.input', { ...common, type: 'color', value: value || '#1f7440', style: 'padding:4px;width:80px', onInput: e => set(e.target.value) });
    case 'phone': return h('input.input', { ...common, type: 'tel', inputmode: 'tel', placeholder: f.placeholder || '069 131 5387', value: value ? fmt.phone(value) : '', onInput: e => set(e.target.value) });
    case 'email': return h('input.input', { ...common, type: 'email', inputmode: 'email', autocomplete: 'email', value: value ?? '', onInput: e => set(e.target.value) });
    case 'url': return h('input.input', { ...common, type: 'url', value: value ?? '', placeholder: 'https://', onInput: e => set(e.target.value) });
    case 'sa_id': {
      const hint = h('div.field-hint');
      const upd = v => { const i = saIdInfo(v); hint.textContent = v && v.length === 13 ? (i.valid ? `✓ Born ${fmt.date(i.birthDate, 'long')} · ${i.gender} · ${i.citizen}` : `✗ ${i.reason}`) : ''; hint.style.color = i.valid ? 'var(--success)' : 'var(--danger)'; };
      const inp = h('input.input', { ...common, inputmode: 'numeric', maxlength: 13, value: value ?? '', onInput: e => { set(e.target.value); upd(e.target.value); } });
      upd(value);
      return h('div.stack.tight', inp, hint);
    }
    case 'json': return h('textarea.textarea.mono', { ...common, rows: 5, value: value == null ? '' : JSON.stringify(value, null, 2), onChange: e => { try { set(e.target.value ? JSON.parse(e.target.value) : null); e.target.style.borderColor = ''; } catch { e.target.style.borderColor = 'var(--danger)'; } } });
    case 'signature': return signatureInput(value, set, common.disabled);
    default: return h('input.input', { ...common, type: 'text', value: value ?? '', maxlength: f.maxLength, onInput: e => set(e.target.value) });
  }
}

function tagInput(f, value, set, disabled) {
  let tags = Array.isArray(value) ? [...value] : value ? String(value).split(',').map(s => s.trim()).filter(Boolean) : [];
  const chips = h('div.chips');
  const input = h('input.input', { placeholder: f.options ? 'Choose…' : 'Type and press Enter', disabled, list: f.options ? undefined : undefined, style: 'flex:1;min-width:140px' });
  const draw = () => chips.replaceChildren(...tags.map(t => h('span.chip.active', optLab(t), disabled ? null : h('button.x', { type: 'button', onClick: () => { tags = tags.filter(x => x !== t); set(tags); draw(); } }, icon('x', 13)))));
  if (f.options) {
    const sel = h('select.select', { disabled, onChange: e => { if (e.target.value && !tags.includes(e.target.value)) { tags.push(e.target.value); set(tags); draw(); } e.target.value = ''; } }, h('option', { value: '' }, 'Add…'), f.options.map(o => h('option', { value: optVal(o) }, optLab(o))));
    draw();
    return h('div.stack.tight', chips, sel);
  }
  input.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) { e.preventDefault(); const t = input.value.trim().replace(/,$/, ''); if (!tags.includes(t)) tags.push(t); input.value = ''; set(tags); draw(); }
    if (e.key === 'Backspace' && !input.value && tags.length) { tags.pop(); set(tags); draw(); }
  });
  draw();
  return h('div.stack.tight', chips, input);
}

/** Searchable single-record picker. */
export function refPicker(f, value, set, disabled) {
  const col = f.ref;
  const label = id => (id ? db.label(col, id) : '');
  const input = h('input.input', { value: label(value), placeholder: `Search ${(getDef(col) || {}).label || col}…`, disabled, autocomplete: 'off' });
  const list = h('div.menu', { style: 'position:absolute;left:0;right:0;top:calc(100% + 4px);display:none;max-height:260px' });
  const box = h('div', { style: 'position:relative' }, input, list);
  const show = q => {
    const rows = db.list(col, { search: q, sort: (getDef(col) || {}).sort || undefined, limit: 40 });
    list.replaceChildren(...(value && !f.required ? [h('button.menu-item', { type: 'button', onMousedown: e => { e.preventDefault(); value = null; set(null); input.value = ''; list.style.display = 'none'; } }, icon('x', 14), 'Clear')] : []),
      ...rows.map(r => h('button.menu-item', { type: 'button', onMousedown: e => { e.preventDefault(); value = r.id; set(r.id); input.value = label(r.id); list.style.display = 'none'; } }, h('span', db.label(col, r)))),
      rows.length ? null : h('div.menu-title', 'No matches'));
    list.style.display = 'block';
  };
  input.addEventListener('focus', () => show(''));
  input.addEventListener('input', debounce(() => show(input.value), 120));
  input.addEventListener('blur', () => setTimeout(() => { list.style.display = 'none'; input.value = label(value); }, 150));
  return box;
}

function refsPicker(f, value, set, disabled) {
  let ids = Array.isArray(value) ? [...value] : [];
  const chips = h('div.chips');
  const draw = () => chips.replaceChildren(...ids.map(id => h('span.chip.active', db.label(f.ref, id), disabled ? null : h('button.x', { type: 'button', onClick: () => { ids = ids.filter(x => x !== id); set(ids); draw(); } }, icon('x', 13)))));
  const picker = refPicker({ ...f, required: true }, null, id => { if (id && !ids.includes(id)) { ids.push(id); set(ids); draw(); } setTimeout(() => { const inp = picker.querySelector('input'); if (inp) inp.value = ''; }, 10); }, disabled);
  draw();
  return h('div.stack.tight', chips, picker);
}

function signatureInput(value, set, disabled) {
  const canvas = h('canvas.sig-pad');
  const wrap = h('div.stack.tight', canvas, disabled ? null : h('div.row', h('span.small.muted', 'Sign with your finger or mouse'), h('div.spacer'), h('button.btn.btn-ghost.btn-sm', { type: 'button', onClick: () => { pad && pad.clear(); set(null); } }, icon('eraser', 14), 'Clear')));
  let pad = null;
  requestAnimationFrame(() => {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio; canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d').scale(ratio, ratio);
    if (window.SignaturePad) {
      pad = new window.SignaturePad(canvas, { penColor: '#103d24' });
      if (value) pad.fromDataURL(value, { ratio });
      if (disabled) pad.off();
      pad.addEventListener('endStroke', () => set(pad.toDataURL('image/png')));
    }
  });
  return wrap;
}

/**
 * schemaForm(col, { values, fields, onChange, readonly, layout:'grid'|'stack' })
 */
export function schemaForm(col, o = {}) {
  const def = getDef(col) || { fields: {} };
  const values = { ...(o.values || {}) };
  const names = (o.fields || Object.keys(def.fields)).filter(n => def.fields[n] && !def.fields[n].hidden && !def.fields[n].computed && canSeeField(col, n));
  const wrappers = {};
  const touched = new Set();
  const el = h('div', { class: o.layout === 'stack' ? 'stack' : 'form-grid' });
  let lastGroup = null;
  for (const n of names) {
    const f = def.fields[n];
    if (f.group && f.group !== lastGroup) { el.appendChild(h('div.form-section', f.group)); lastGroup = f.group; }
    if (values[n] === undefined && f.default !== undefined && !o.values?.id) values[n] = typeof f.default === 'function' ? f.default() : f.default;
    const err = h('div.field-error', { style: 'display:none' });
    const input = fieldInput(f, values[n], v => { values[n] = v; touched.add(n); live(); o.onChange && o.onChange(values, n); }, { name: n, readonly: o.readonly });
    const wide = ['longtext', 'richtext', 'json', 'signature', 'refs', 'tags', 'multi'].includes(f.type) || f.wide;
    const w = h('div', { class: ['field', wide ? 'full' : ''] },
      h('label.field-label', f.label || fmt.titleCase(n.replace(/_/g, ' ')), f.required ? h('span.req', '*') : null),
      input, f.hint ? h('div.field-hint', f.hint) : null, err);
    wrappers[n] = { w, err };
    el.appendChild(w);
  }
  const showErrors = (errors = {}, warnings = {}, only) => {
    for (const n of names) {
      const { w, err } = wrappers[n];
      const msg = errors[n] || warnings[n];
      const show = msg && (!only || only.has(n));
      w.classList.toggle('invalid', !!(errors[n] && show));
      err.style.display = show ? '' : 'none';
      err.style.color = errors[n] ? '' : 'var(--warning)';
      err.textContent = show ? msg : '';
    }
  };
  const live = debounce(() => {
    const res = db.check(col, values, { id: values.id });
    showErrors(res.errors, res.warnings, touched);
  }, 250);
  return {
    el,
    values: () => ({ ...values }),
    set: (k, v) => { values[k] = v; },
    validate: () => { const res = db.check(col, values, { id: values.id }); showErrors(res.errors, res.warnings); return res; },
    showErrors
  };
}

/**
 * openRecordForm(col, { id, values, title, fields, onSaved, submitLabel, size })
 * Creates or edits a record in a modal. Validation errors are shown inline.
 */
export function openRecordForm(col, o = {}) {
  const def = getDef(col) || {};
  const existing = o.id ? db.get(col, o.id) : null;
  const form = schemaForm(col, { values: { ...(existing || {}), ...(o.values || {}) }, fields: o.fields });
  return modal({
    title: o.title || `${existing ? 'Edit' : 'New'} ${(def.singular || 'record').toLowerCase()}`,
    icon: def.icon, tile: def.tile, size: o.size || (Object.keys(def.fields || {}).length > 8 ? 'wide' : ''),
    body: h('div', o.intro || null, form.el),
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: o.submitLabel || (existing ? 'Save changes' : `Add ${(def.singular || 'record').toLowerCase()}`), variant: 'primary', icon: 'check',
        onClick: async () => {
          const res = form.validate();
          if (!res.ok) { toast.error('Please fix the highlighted fields'); return false; }
          if (Object.keys(res.warnings).length && !(await confirm(Object.values(res.warnings).join(' · '), { title: 'Save anyway?', ok: 'Save anyway' }))) return false;
          try {
            const vals = form.values();
            const rec = existing ? await db.update(col, existing.id, vals) : await db.insert(col, vals);
            toast.success(existing ? 'Saved' : `${def.singular || 'Record'} added`, { text: db.label(col, rec) });
            o.onSaved && o.onSaved(rec);
          } catch (e) { if (e.errors) form.showErrors(e.errors, e.warnings); showError(e); return false; }
        }
      }
    ]
  });
}
