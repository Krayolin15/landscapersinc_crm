/* =============================================================================
   Schema registry — ONE definition per collection drives:
     · validation on every write (js__core__validate.js)
     · auto-generated forms, tables, detail pages (js__ui__entity.js)
     · global search
     · Supabase tables, CHECK constraints and RLS (js__sql__schema.js — handed out by Admin → Go live)

   Field types: text · longtext · richtext · email · phone · url · int · number ·
   money · percent · rating · date · datetime · time · bool · enum · multi · tags ·
   ref · refs · json · file · files · color · sa_id · company_reg · vat_number ·
   tax_ref · bank_account · branch_code · signature

   Field options: label, required, recommended, unique, default, options (enum),
   ref (collection), softRef, min, max, precise (money > 2dp), minLength, maxLength,
   pattern/patternHint, hint, placeholder, group (form section), list (show as
   table column), hidden (hide in form), readonly, sensitive (roles in def.sensitiveRoles only),
   computed (derived, never stored), notFuture, notPast, strict:false (warn only)
   ========================================================================== */

import { WORKSPACE } from '../schema/workspace.js';
import { BUSINESS } from '../schema/business.js';

/** Columns every table has (added automatically). */
export const SYSTEM_FIELDS = [
  'id', 'created_at', 'created_by', 'created_by_name', 'updated_at', 'updated_by', 'updated_by_name',
  'deleted_at', 'deleted_by', 'deleted_by_name', '_src', '_seed'
];
/** Collections whose writes are not themselves audited (noise / would recurse). */
export const AUDIT_EXEMPT = new Set(['audit_log', 'notifications', 'mail_flags', 'predictions', 'presence', 'reminder_log', 'chat_reads']);

export const SCHEMA = { ...WORKSPACE, ...BUSINESS };

export function getDef(col) { return SCHEMA[col] || null; }
export function fieldsOf(col) { return Object.entries((SCHEMA[col] && SCHEMA[col].fields) || {}).map(([name, f]) => ({ name, ...f })); }
export function optionValues(f) { return (f.options || []).map(o => (typeof o === 'object' ? o.value : o)); }
export function optionLabel(f, v) { const o = (f.options || []).find(x => (typeof x === 'object' ? x.value : x) === v); return o ? (typeof o === 'object' ? o.label : o) : v; }
export function listColumns(col) { return fieldsOf(col).filter(f => f.list); }
