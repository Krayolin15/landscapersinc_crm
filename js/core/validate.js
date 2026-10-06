/* =============================================================================
   Validation — the gatekeeper that keeps the data correct.
   Every insert/update runs validateRecord() against the collection's schema
   BEFORE it is written. Errors block the save; warnings are shown but allowed.
   The same rules are mirrored as CHECK constraints in the database (js/sql/schema.js, step 01).
   ========================================================================== */

import { isValidISO, parse, iso, today } from './dates.js';
import { toCents } from './money.js';

export class ValidationError extends Error {
  constructor(errors, warnings = {}) {
    super('Please fix the highlighted fields: ' + Object.entries(errors).map(([k, v]) => `${k} — ${v}`).join('; '));
    this.name = 'ValidationError';
    this.errors = errors;
    this.warnings = warnings;
  }
}

/* ---------- South African identifiers ---------- */

export function luhnValid(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = +digits[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
/** SA ID: YYMMDD SSSS C A Z — valid birth date, citizenship 0/1/2, Luhn checksum. */
export function saIdInfo(id) {
  const s = String(id || '').replace(/\s/g, '');
  if (!/^\d{13}$/.test(s)) return { valid: false, reason: 'must be exactly 13 digits' };
  const yy = +s.slice(0, 2), mm = +s.slice(2, 4), dd = +s.slice(4, 6);
  const nowYY = +today().slice(2, 4);
  const year = yy > nowYY ? 1900 + yy : 2000 + yy;
  const bd = new Date(year, mm - 1, dd);
  if (bd.getMonth() !== mm - 1 || bd.getDate() !== dd) return { valid: false, reason: 'birth date part (YYMMDD) is not a real date' };
  if (!['0', '1', '2'].includes(s[10])) return { valid: false, reason: 'citizenship digit must be 0, 1 or 2' };
  if (!luhnValid(s)) return { valid: false, reason: 'checksum digit is wrong — check for a typo' };
  return { valid: true, birthDate: iso(bd), gender: +s.slice(6, 10) >= 5000 ? 'Male' : 'Female', citizen: s[10] === '0' ? 'SA citizen' : 'Permanent resident' };
}
export const isSaId = v => saIdInfo(v).valid;
export const isCompanyReg = v => /^\d{4}\/\d{6}\/\d{2}$/.test(String(v || '').trim());
export const isVatNumber = v => /^4\d{9}$/.test(String(v || '').replace(/\s/g, ''));
export const isTaxRef = v => /^\d{10}$/.test(String(v || '').replace(/\s/g, ''));
export const isBankAccount = v => /^\d{6,13}$/.test(String(v || '').replace(/\s/g, ''));
export const isBranchCode = v => /^\d{6}$/.test(String(v || '').replace(/\s/g, ''));
export const isEmail = v => /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/.test(String(v || '').trim());
/** SA numbers: 0XXXXXXXXX (10 digits) or +27XXXXXXXXX. */
export function isPhone(v) {
  const s = String(v || '').replace(/[\s()-]/g, '');
  return /^0\d{9}$/.test(s) || /^\+?27\d{9}$/.test(s);
}
export const isUrl = v => { try { const u = new URL(String(v)); return ['http:', 'https:'].includes(u.protocol); } catch { return false; } };
export const isTime = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));

/* ---------- field-level rules by type ---------- */

function checkType(f, v) {
  switch (f.type) {
    case 'email': return isEmail(v) ? null : 'is not a valid email address';
    case 'phone': return isPhone(v) ? null : 'should be a South African number like 069 131 5387 or +27 69 131 5387';
    case 'sa_id': { const r = saIdInfo(v); return r.valid ? null : `SA ID ${r.reason}`; }
    case 'company_reg': return isCompanyReg(v) ? null : 'should look like 2024/786147/07';
    case 'vat_number': return isVatNumber(v) ? null : 'should be 10 digits starting with 4';
    case 'tax_ref': return isTaxRef(v) ? null : 'should be 10 digits';
    case 'bank_account': return isBankAccount(v) ? null : 'should be 6–13 digits';
    case 'branch_code': return isBranchCode(v) ? null : 'should be 6 digits';
    case 'url': return isUrl(v) ? null : 'should start with http:// or https://';
    case 'date': return isValidISO(String(v)) ? null : 'is not a valid date';
    case 'datetime': return parse(v) ? null : 'is not a valid date/time';
    case 'time': return isTime(v) ? null : 'should be HH:MM (24-hour)';
    case 'int': return Number.isInteger(Number(v)) ? null : 'must be a whole number';
    case 'number': case 'percent': case 'rating': return isFinite(Number(v)) ? null : 'must be a number';
    case 'money': {
      if (!isFinite(Number(v))) return 'must be an amount';
      if (f.precise) return null; // unrounded rates (e.g. per-visit R630.315) are allowed
      return Math.abs(toCents(v) / 100 - Number(v)) < 1e-9 ? null : 'cannot have more than 2 decimals';
    }
    case 'bool': return typeof v === 'boolean' ? null : 'must be yes or no';
    case 'enum': return (f.options || []).map(o => (typeof o === 'object' ? o.value : o)).includes(v) ? null : `must be one of: ${(f.options || []).map(o => (typeof o === 'object' ? o.label : o)).join(', ')}`;
    case 'multi': case 'tags': return Array.isArray(v) ? null : 'must be a list';
    case 'json': return typeof v === 'object' ? null : 'must be structured data';
    default: return null;
  }
}

const isEmpty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * validateRecord(def, rec, ctx)
 *  def: collection schema { fields: {name: {type, required, min, max, minLength, maxLength, pattern, unique, options, ref}}, rules: [(rec, ctx) => ({field, message, level})] }
 *  ctx: { existing: [...records in the collection], lookup: (collection, id) => record|null, isUpdate, id }
 * returns { ok, errors: {field: msg}, warnings: {field: msg} }
 */
export function validateRecord(def, rec, ctx = {}) {
  const errors = {}, warnings = {};
  const fields = (def && def.fields) || {};
  for (const [name, f] of Object.entries(fields)) {
    if (f.computed) continue;
    const v = rec[name];
    const label = f.label || name;
    if (isEmpty(v)) {
      if (f.required && !(ctx.isUpdate && !(name in rec))) errors[name] = `${label} is required`;
      else if (f.recommended && !ctx.isUpdate) warnings[name] = `${label} is empty`;
      continue;
    }
    const typeErr = checkType(f, v);
    if (typeErr) { (f.strict === false ? warnings : errors)[name] = `${label} ${typeErr}`; continue; }
    const n = Number(v);
    if (f.min != null && ['int', 'number', 'money', 'percent', 'rating'].includes(f.type) && n < f.min) errors[name] = `${label} cannot be less than ${f.min}`;
    if (f.max != null && ['int', 'number', 'money', 'percent', 'rating'].includes(f.type) && n > f.max) errors[name] = `${label} cannot be more than ${f.max}`;
    if (f.type === 'percent' && (n < 0 || n > 100) && f.min == null) errors[name] = `${label} must be between 0 and 100`;
    if (f.minLength && String(v).trim().length < f.minLength) errors[name] = `${label} is too short`;
    if (f.maxLength && String(v).length > f.maxLength) errors[name] = `${label} is too long (max ${f.maxLength})`;
    if (f.pattern && !new RegExp(f.pattern).test(String(v))) errors[name] = `${label} ${f.patternHint || 'has the wrong format'}`;
    if (f.type === 'date' && f.notFuture && String(v) > today()) warnings[name] = `${label} is in the future`;
    if (f.type === 'date' && f.notPast && String(v) < today()) warnings[name] = `${label} is in the past`;
    if (f.unique && ctx.existing) {
      const norm = x => String(x ?? '').trim().toLowerCase();
      const clash = ctx.existing.find(r => r.id !== (ctx.id || rec.id) && !r.deleted_at && norm(r[name]) === norm(v));
      if (clash) errors[name] = `${label} "${v}" already exists`;
    }
    if (f.type === 'ref' && f.ref && ctx.lookup && !f.softRef) {
      if (!ctx.lookup(f.ref, v)) errors[name] = `${label} points to a record that does not exist`;
    }
  }
  // cross-field rules
  for (const rule of (def && def.rules) || []) {
    try {
      const res = rule(rec, ctx);
      for (const r of [].concat(res || [])) {
        if (!r) continue;
        (r.level === 'warning' ? warnings : errors)[r.field || '_record'] = r.message;
      }
    } catch (e) { console.warn('rule failed', e); }
  }
  return { ok: Object.keys(errors).length === 0, errors, warnings };
}

/** Common cross-field rules, reusable in schema definitions. */
export const RULES = {
  dateOrder: (startField, endField, label = 'End date') => rec =>
    rec[startField] && rec[endField] && String(rec[endField]) < String(rec[startField])
      ? { field: endField, message: `${label} cannot be before the start` } : null,
  nonNegative: field => rec => (rec[field] != null && Number(rec[field]) < 0 ? { field, message: 'cannot be negative' } : null),
  /** total must equal the sum of lines (to the cent) */
  totalMatches: (totalField, computeFn) => rec => {
    if (rec[totalField] == null) return null;
    const expected = computeFn(rec);
    return expected != null && toCents(expected) !== toCents(rec[totalField])
      ? { field: totalField, message: `total R${Number(rec[totalField]).toFixed(2)} does not match the lines (R${Number(expected).toFixed(2)})` } : null;
  }
};

/** Normalise user input before validation (trim, phone formats, numbers from strings). */
export function normalise(def, rec) {
  const out = { ...rec };
  for (const [name, f] of Object.entries((def && def.fields) || {})) {
    let v = out[name];
    if (v === undefined) continue;
    if (typeof v === 'string') v = v.replace(/\s+$/, '').replace(/^\s+/, '');
    if (v === '') { out[name] = null; continue; }
    switch (f.type) {
      case 'int': if (typeof v === 'string' && v !== '') v = parseInt(v.replace(/[\s,]/g, ''), 10); break;
      case 'number': case 'percent': case 'rating': if (typeof v === 'string') v = Number(v.replace(/[\s,]/g, '')); break;
      case 'money': if (typeof v === 'string') { const n = Number(v.replace(/[R\s,]/g, '')); v = isFinite(n) ? n : v; } break;
      case 'phone': if (typeof v === 'string') v = v.replace(/[^\d+]/g, ''); break;
      case 'sa_id': case 'bank_account': case 'branch_code': case 'vat_number': case 'tax_ref': if (typeof v === 'string') v = v.replace(/\s/g, ''); break;
      case 'email': if (typeof v === 'string') v = v.toLowerCase(); break;
      case 'bool': if (typeof v === 'string') v = ['true', 'yes', '1', 'on'].includes(v.toLowerCase()); break;
      case 'date': if (v instanceof Date) v = iso(v); break;
      default: break;
    }
    out[name] = v;
  }
  return out;
}
