// Every discrepancy and open question found while reading the company's files becomes a
// "Data health" issue the owner can answer or fix — nothing is silently guessed.
// Source: the `discrepancies` and `open_questions` of every knowledge/*.json file.
import { readdirSync } from 'node:fs';

const GROUP_LABEL = {
  company_compliance: 'Company documents', crm_workbooks: 'CRM workbooks', financials: 'Income statements', hs_policies_procedures: 'H&S policies', hs_forms_checklists_loa: 'H&S forms & checklists',
  invoices_apr_may: 'Invoices Apr–May', invoices_june: 'Invoices June', invoices_july: 'Invoices July', kpi_trackers: 'KPI trackers', marketing_options: 'Marketing', medicals: 'Medicals',
  people_hr: 'People & HR', projects_fleet_purchases: 'Projects, fleet & purchases', sales_leads: 'Sales workbook', schedule_ops_registers: 'Schedule & ops registers', sops_toolbox: 'SOPs & toolbox talks',
  strategy_roles: 'Strategy & roles', carron_glen_proposal: 'Carron Glen proposal', training_firefighting_hsrep: 'Training — fire & SHE rep', training_firstaid: 'Training — first aid', training_heights: 'Training — working at heights'
};
const sev = s => { s = String(s || '').toLowerCase(); return /high|critical|major/.test(s) ? 'high' : /low|minor|info/.test(s) ? 'low' : 'medium'; };
const text = v => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

export async function build(ctx) {
  const out = { data_issues: [] };
  const groups = readdirSync(ctx.KNOW).filter(f => f.endsWith('.json') && f !== 'existing_crm_seed.json').map(f => f.replace(/\.json$/, '')).sort();
  for (const g of groups) {
    const K = ctx.k(g);
    const label = GROUP_LABEL[g] || g;
    (K.discrepancies || []).forEach((d, i) => {
      const o = typeof d === 'string' ? { issue: d } : d;
      const title = text(o.issue || o.topic || o.description || o.detail || o.area || 'Discrepancy').replace(/\s+/g, ' ').trim();
      const detail = [o.description && o.description !== title ? o.description : null, o.detail && o.detail !== title ? o.detail : null, o.evidence ? `Evidence: ${text(o.evidence)}` : null, o.where ? `Where: ${text(o.where)}` : null, o.file ? `File: ${o.file}` : null, o.recommendation ? `Suggested: ${text(o.recommendation)}` : null].filter(Boolean).join('\n\n');
      out.data_issues.push({ id: ctx.id('di', g, 'd', o.id || i), code: o.id || `${g.toUpperCase().slice(0, 6)}-D${String(i + 1).padStart(2, '0')}`, source_group: label, severity: sev(o.severity), title: title.length > 220 ? title.slice(0, 217) + '…' : title, detail: (title.length > 220 ? title + '\n\n' : '') + detail || null, status: 'open', related: o.category || o.type ? { category: o.category || o.type } : null, _src: o._src || `knowledge/${g}.json discrepancies[${i}]` });
    });
    (K.open_questions || []).forEach((q, i) => {
      const t = text(q).replace(/\s+/g, ' ').trim();
      out.data_issues.push({ id: ctx.id('di', g, 'q', i), code: `${g.toUpperCase().slice(0, 6)}-Q${String(i + 1).padStart(2, '0')}`, source_group: label, severity: 'low', title: t.length > 220 ? t.slice(0, 217) + '…' : t, question: t, status: 'open', _src: `knowledge/${g}.json open_questions[${i}]` });
    });
  }
  return out;
}
