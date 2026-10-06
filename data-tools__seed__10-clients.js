// Clients, sites, maintenance contracts, planned contract changes and CRM ad-hoc jobs
// Source: knowledge/crm_workbooks.json (4 copies of the CRM workbook, reconciled by the reader).
export const ESTATES = [
  ['Sienna', 'Sienna Estate', 'Mount Edgecombe'], ['Carron Glen', 'Carron Glen Estate', 'Mount Edgecombe'], ['Kindles', 'The Kindles', 'Mount Edgecombe'],
  ['Forestclay', 'Forestclay', 'Mount Edgecombe'], ['Campbells Town', 'Campbells Town', 'Mount Edgecombe'], ['Callaway', 'Callaway', 'Mount Edgecombe'],
  ['La Lucia', 'La Lucia', 'La Lucia'], ['Zimbali', 'Zimbali', 'Zimbali'], ['Hawaan', 'Hawaan Estate', 'Umhlanga'], ['Glen Anil', 'Glen Anil', 'Glen Anil'],
  ['Berea', 'Berea', 'Berea'], ['Broadlands', 'Broadlands', 'Broadlands'], ['Sparks', 'Sparks', 'Sparks'], ['Merrick Hills', 'Merrick Hills', 'Mount Edgecombe'],
  ['Verulam', 'Verulam', 'Verulam'], ['Izinga', 'Izinga', 'Umhlanga'], ['Umhlanga', 'Umhlanga', 'Umhlanga'], ['Durban North', 'Durban North', 'Durban North'],
  ['Somerset', 'Somerset Park', 'Somerset Park'], ['Ilchester', 'Somerset Park', 'Somerset Park'], ['Illcester', 'Somerset Park', 'Somerset Park'],
  ['Mount Edgecombe', 'Mount Edgecombe', 'Mount Edgecombe'], ['Kingfisher', 'Kingfisher Office Park', 'Mount Edgecombe'], ['38 on the lakes', 'The Lakes', 'Mount Edgecombe']
];
export function locate(address) {
  const a = String(address || '').toLowerCase();
  for (const [needle, suburb, region] of ESTATES) if (a.includes(needle.toLowerCase())) return { suburb, region };
  return { suburb: null, region: null };
}
const NA = v => (v == null || /^\s*(n\/?a|none|-)?\s*$/i.test(String(v)) ? null : String(v).replace(/\s+/g, ' ').trim());
const SERVICE = { 'GARDEN MAINTENANCE': 'garden_maintenance', 'GARDEN MAINTENANCE & POOL': 'garden_pool', POOL: 'pool' };
const FREQ = { WEEKLY: 'weekly', FORTNIGHT: 'fortnightly', ONCE: 'monthly', DAILY: 'daily' };

export async function build(ctx) {
  const k = ctx.k('crm_workbooks');
  const E = k.entities;
  const out = { clients: [], sites: [], contracts: [], contract_changes: [], jobs: [] };
  const notesBy = {};
  for (const n of E.client_notes || []) if (n.client_id && n.note) (notesBy[n.client_id] = notesBy[n.client_id] || []).push(n.note);
  const adhocBy = {};
  for (const j of E.adhoc_jobs || []) (adhocBy[j.client_id] = adhocBy[j.client_id] || []).push(j);

  for (const c of E.clients) {
    const code = c.client_id;
    const addr = NA((c.addresses || [])[0]);
    const loc = locate((c.addresses || []).join(' '));
    const onlyAdhoc = (c.client_types || []).length && !(c.client_types || []).includes('maintenance');
    const company = NA(c.company_name);
    const email = (c.emails || []).map(NA).find(e => e && /@/.test(e)) || null;
    const notes = notesBy[code] || [];
    const instr = notes.filter(n => /cut|am|pm|@|start|finish/i.test(n) && !/overseas|december/i.test(n));
    out.clients.push({
      id: ctx.id('cl', code), legacy_code: code, name: ctx.trim(c.account_name), company,
      client_type: company && /agency|maxprop|wakefields|trafalgar|batsalani/i.test(company) ? 'managing_agent' : company ? 'commercial' : 'residential',
      status: onlyAdhoc ? 'adhoc' : (String(c.status || '').toUpperCase() === 'LEFT' ? 'left' : 'active'),
      contact_name: ctx.trim(c.contact_person), position: NA(c.position), phone: ctx.phone(c.mobile_number), email,
      address: addr, suburb: loc.suburb, region: loc.region,
      salesperson: (adhocBy[code] || []).map(j => j.salesperson).filter(Boolean).map(s => s[0] + s.slice(1).toLowerCase())[0] || null,
      standing_instructions: instr.join(' · ') || null, notes: notes.filter(n => !instr.includes(n)).join('\n') || null,
      tags: [...(c.client_types || []).map(t => (t === 'maintenance' ? 'Maintenance contract' : 'Ad-hoc work'))],
      _src: c._src
    });
  }

  for (const m of E.maintenance_contracts) {
    const cid = ctx.id('cl', m.client_id);
    const siteName = ctx.trim(m.contact_person);
    const addr = ctx.trim(m.physical_address);
    const loc = locate(`${addr} ${siteName}`);
    const siteId = ctx.id('site', m.contract_key);
    const freq = FREQ[String(m.contract_type || '').toUpperCase()] || 'custom';
    const vpm = m.visits_per_month_implied || null;
    const monthly = ctx.money(m.contract_value_r_per_month);
    out.sites.push({ id: siteId, client_id: cid, name: m.company_name && NA(m.company_name) && siteName !== ctx.trim(m.company_name) ? siteName : addr || siteName, address: addr, suburb: loc.suburb, region: loc.region, contact_name: siteName, contact_phone: ctx.phone(m.mobile_number), instructions: /cut|@|am\b|pm\b/i.test(m.notes || '') ? ctx.trim(m.notes) : null, status: 'active', _src: m._src });
    const bill = String(m.invoice_status_root_billing_copy || m.invoice_status_sales_copy || '').trim().toUpperCase();
    const paid = String(m.paid_status_root_billing_copy || '').trim().toUpperCase();
    out.contracts.push({
      id: ctx.id('ct', m.contract_key), client_id: cid, site_id: siteId, legacy_code: m.client_id, name: siteName + (addr && !siteName.includes(addr) ? ` — ${addr}` : ''), site_name: addr,
      service_type: SERVICE[String(m.service_type || '').toUpperCase()] || 'garden_maintenance', frequency: freq, visits_per_month: vpm,
      monthly_value: monthly, per_visit_rate: monthly != null && vpm ? monthly / vpm : null,
      status: 'active', billing_status: paid === 'PAID' ? 'paid' : paid === 'NOT PAID' ? 'not_paid' : bill === 'INVOICE SENT' ? 'invoice_sent' : bill === 'INVOICE NOT SENT' ? 'invoice_not_sent' : 'unknown',
      notes: [ctx.trim(m.notes), m.per_visit_value_sales_copy != null && monthly != null && vpm && Math.abs(m.per_visit_value_sales_copy - monthly / vpm) > 0.01 ? `Legacy sheet per-visit value R${m.per_visit_value_sales_copy} differs from the rule (R${(monthly / vpm).toFixed(3)}).` : null, m.values_by_version ? `Value differs between CRM copies: ${JSON.stringify(m.values_by_version)}` : null].filter(Boolean).join('\n') || null,
      legacy_per_visit: m.per_visit_value_sales_copy ?? null, versions: m.present_in_versions, _src: m._src
    });
    if (/TWICE A MONTH IN DECEMBER/i.test(m.notes || '')) out.contract_changes.push({ id: ctx.id('cc', m.contract_key, 'dec'), contract_id: ctx.id('ct', m.contract_key), effective_date: '2026-12-01', summary: 'Move to twice a month in December', new_frequency: 'fortnightly', status: 'planned', notes: 'Source says only "IN DECEMBER" — exact start date and new price to be confirmed.', _src: m._src });
    if (/OVERSEAS/i.test(m.notes || '')) out.clients.find(c => c.id === cid).notes = [out.clients.find(c => c.id === cid).notes, `${m.notes} — confirm whether visits/billing are paused.`].filter(Boolean).join('\n');
  }

  for (const j of E.adhoc_jobs || []) {
    const st = String(j.job_status || '').toUpperCase();
    const value = ctx.money(j.work_value);
    const dep = ctx.money(j.deposit);
    out.jobs.push({
      id: ctx.id('job', j.job_key), title: ctx.trim(j.type_of_work) || 'Ad-hoc job', client_id: ctx.id('cl', j.client_id), client_name: ctx.trim(j.contact_person), site_address: ctx.trim(j.physical_address), suburb: locate(j.physical_address).suburb,
      service_type: /lawn|grass/i.test(j.type_of_work) ? 'lawn' : /design/i.test(j.type_of_work) ? 'design' : /rock/i.test(j.type_of_work) ? 'hardscape' : /tree/i.test(j.type_of_work) ? 'tree' : /pressure/i.test(j.type_of_work) ? 'pressure_cleaning' : /rose|plant/i.test(j.type_of_work) ? 'planting' : 'other',
      status: st.includes('CLOSED PAID') ? 'closed_paid' : st.includes('AWAITING') ? 'awaiting_deposit' : st === 'ACTIVE' ? 'in_progress' : 'completed',
      value, deposit: dep, deposit_status: /CLOSED PAID|PAID/i.test(j.deposit_status || '') ? 'paid' : /AWAITING/i.test(j.deposit_status || '') ? 'awaiting_payment' : dep ? 'requested' : 'not_required',
      owing: ctx.money(j.owing), salesperson: j.salesperson ? j.salesperson[0] + j.salesperson.slice(1).toLowerCase() : null,
      notes: [ctx.trim(j.notes), j.status_by_version ? `Status differs between CRM copies: ${JSON.stringify(j.status_by_version)}` : null].filter(Boolean).join('\n') || null,
      invoice_status: ctx.trim(j.job_status), _src: j._src
    });
  }
  return out;
}
