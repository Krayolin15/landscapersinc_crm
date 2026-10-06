/* Admin → Company profile: settings key 'company_profile' + bank accounts CRUD. */
import { h } from '../../ui/dom.js';
import { pageHeader, card, btn, callout } from '../../ui/components.js';
import { fieldInput } from '../../ui/form.js';
import { toast, showError } from '../../ui/overlays.js';
import { entityListPage } from '../../ui/entity.js';
import { db } from '../../core/db.js';
import { isCompanyReg, isVatNumber, isTaxRef, isEmail, isPhone, isUrl } from '../../core/validate.js';
import { adminNav } from './nav.js';

const FIELDS = [
  { key: 'legal_name', label: 'Registered legal name', type: 'text', group: 'Identity' },
  { key: 'trading_name', label: 'Trading name', type: 'text', group: 'Identity' },
  { key: 'reg_no', label: 'Company registration no.', type: 'text', group: 'Identity', hint: 'e.g. 2024/786147/07', check: v => (v && !isCompanyReg(v) ? 'should look like 2024/786147/07' : null) },
  { key: 'coida_no', label: 'COIDA / Compensation Fund no.', type: 'text', group: 'Identity' },
  { key: 'bbbee_level', label: 'B-BBEE level', type: 'enum', group: 'Identity', options: ['1', '2', '3', '4', '5', '6', '7', '8', 'Exempt', 'Not certified'] },
  { key: 'vat_registered', label: 'VAT registered', type: 'bool', group: 'Tax' },
  { key: 'vat_number', label: 'VAT number', type: 'text', group: 'Tax', hint: '10 digits starting with 4', check: (v, all) => (all.vat_registered && !isVatNumber(v || '') ? 'is required and must be 10 digits starting with 4 when VAT registered' : null) },
  { key: 'tax_ref', label: 'Income tax reference', type: 'text', group: 'Tax', check: v => (v && !isTaxRef(v) ? 'should be 10 digits' : null) },
  { key: 'address', label: 'Registered address', type: 'longtext', group: 'Contact', wide: true },
  { key: 'postal_code', label: 'Postal code', type: 'text', group: 'Contact' },
  { key: 'phone', label: 'Phone', type: 'text', group: 'Contact', check: v => (v && !isPhone(v) ? 'should be a South African number' : null) },
  { key: 'email', label: 'Email', type: 'text', group: 'Contact', check: v => (v && !isEmail(v) ? 'is not a valid email' : null) },
  { key: 'accounts_email', label: 'Accounts email', type: 'text', group: 'Contact', check: v => (v && !isEmail(v) ? 'is not a valid email' : null) },
  { key: 'website', label: 'Website', type: 'text', group: 'Contact', check: v => (v && !isUrl(v) ? 'should start with http:// or https://' : null) },
  { key: 'directors', label: 'Directors', type: 'tags', group: 'Contact', wide: true },
  { key: 'invoice_prefix', label: 'Invoice number prefix', type: 'text', group: 'Documents', placeholder: 'e.g. INV-' },
  { key: 'next_invoice_no', label: 'Next invoice number', type: 'int', group: 'Documents', min: 1 },
  { key: 'quote_prefix', label: 'Quote number prefix', type: 'text', group: 'Documents', placeholder: 'e.g. QT-' },
  { key: 'next_quote_no', label: 'Next quote number', type: 'int', group: 'Documents', min: 1 },
  { key: 'default_due_days', label: 'Invoice due (days)', type: 'int', group: 'Documents', min: 0 },
  { key: 'quote_valid_days', label: 'Quote valid for (days)', type: 'int', group: 'Documents', min: 0 },
  { key: 'deposit_pct', label: 'Standard deposit', type: 'percent', group: 'Documents' },
  { key: 'invoice_terms', label: 'Invoice terms & conditions', type: 'longtext', group: 'Documents', wide: true },
  { key: 'invoice_footer_notes', label: 'Invoice footer notes', type: 'longtext', group: 'Documents', wide: true },
  { key: 'quote_terms', label: 'Quote terms & conditions', type: 'longtext', group: 'Documents', wide: true }
];

export function companyPage(ctx) {
  const rec0 = db.find('settings', s => s.key === 'company_profile');
  const values = { ...(rec0 ? rec0.value : {}) }; // never invent values — starts empty if no record exists yet
  const wrappers = {};
  const form = h('div.form-grid');
  let lastGroup = null;
  for (const f of FIELDS) {
    if (f.group !== lastGroup) { form.appendChild(h('div.form-section', f.group)); lastGroup = f.group; }
    const err = h('div.field-error', { style: 'display:none' });
    const input = fieldInput(f, values[f.key], v => { values[f.key] = v; });
    const w = h('div', { class: ['field', f.wide ? 'full' : ''] }, h('label.field-label', f.label), input, f.hint ? h('div.field-hint', f.hint) : null, err);
    wrappers[f.key] = { w, err };
    form.appendChild(w);
  }

  const logo = h('div.row.gap-8');
  const drawLogo = async () => {
    logo.replaceChildren(h('span.small.muted', 'No logo uploaded yet.'));
    if (!values.logo) return;
    try {
      const { fileUrl } = await import('../../core/files.js');
      const rec = db.get('files', values.logo);
      if (!rec) return;
      const url = await fileUrl(rec);
      logo.replaceChildren(url ? h('img', { src: url, alt: 'Company logo', style: 'height:56px;border-radius:8px;background:#fff;padding:4px' }) : h('span.small.muted', rec.name));
    } catch { /* ignore preview failure */ }
  };
  drawLogo();
  const logoInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onChange: async e => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    const { uploadFiles } = await import('../../core/files.js');
    const [rec] = await uploadFiles(files, { drive_id: 'company', linked: [] });
    if (rec) { values.logo = rec.id; drawLogo(); }
  } });

  function validate() {
    const errors = {};
    for (const f of FIELDS) {
      const msg = f.check ? f.check(values[f.key], values) : null;
      if (msg) errors[f.key] = `${f.label} ${msg}`;
    }
    for (const f of FIELDS) { const { w, err } = wrappers[f.key]; const msg = errors[f.key]; w.classList.toggle('invalid', !!msg); err.style.display = msg ? '' : 'none'; err.textContent = msg || ''; }
    return errors;
  }

  async function save() {
    const errors = validate();
    if (Object.keys(errors).length) { toast.error('Please fix the highlighted fields'); return; }
    try {
      const rec = db.find('settings', s => s.key === 'company_profile');
      if (rec) await db.update('settings', rec.id, { value: values });
      else await db.insert('settings', { key: 'company_profile', value: values, description: 'Company details used on quotes, invoices and letterheads.' });
      toast.success('Company profile saved');
    } catch (e) { showError(e); }
  }

  const bankAccounts = entityListPage('bank_accounts', ctx, { title: 'Bank accounts', sub: 'Shown on invoices — the default account is used unless another is chosen.' });

  return h('div',
    pageHeader({ title: 'Company profile', sub: 'Used on quotes, invoices and letterheads. Nothing here is invented — fields start blank until you fill them in.', icon: 'building-2', tile: 't-slate',
      actions: [adminNav(ctx, 'company'), btn({ label: 'Save', icon: 'check', variant: 'primary', onClick: save })] }),
    !rec0 ? callout('info', 'No company profile saved yet', 'Fill in what you know and save — nothing is pre-filled or guessed.', 'info') : null,
    card({ title: 'Logo', icon: 'image', cls: 'solid' }, h('div.row.gap-8', logo, btn({ label: 'Upload logo', icon: 'upload', size: 'sm', onClick: () => logoInput.click() }), logoInput)),
    card({ cls: 'solid', style: 'margin-top:16px' }, form),
    h('div', { style: 'margin-top:16px' }, bankAccounts));
}
