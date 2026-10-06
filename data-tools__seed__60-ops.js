// Operations: the September 2026 schedule as visits (linked to the CRM site, client, contract and crew),
// job 99 and its visits, the ops-register asset list + maintenance log, and the weekly ops KPIs.
// Source: knowledge/schedule_ops_registers.json. Needs 10-clients (sites) and 50-people (crews) first.
import { ALIASES } from './50-people.js';

const norm = s => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(\d+)\s+([a-z])\b/g, '$1$2').replace(/\s+/g, ' ').trim();
const title = s => String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/\s+/g, ' ').trim();
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
const similar = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a) || lev(a, b) <= 2));
const STOP = new Set(['so', 'the', 'estate', 'gardens', 'garden', 'clean', 'up', 'bins', 'unit', 'drive', 'road', 'street', 'avenue', 'ave', 'cres', 'crescent', 'place']);
/** every "number word" pair in a name, e.g. "7 Sienna Estate/ 19 David" → [[7,'sienna'],[19,'david']] */
const pairs = s => [...norm(s).matchAll(/\b(\d+[a-z]?)\s+(?:\d+(?:st|nd|rd|th)\s+)?([a-z]+)/g)].map(m => [m[1], m[2]]);
const words = s => norm(s).split(' ').filter(w => w && !/^\d/.test(w) && !STOP.has(w));

export async function build(ctx) {
  const S = ctx.k('schedule_ops_registers').entities;
  const out = { visits: [], jobs: [], assets: [], asset_maintenance: [], kpi_definitions: [], kpi_entries: [] };
  const sites = [...(ctx.records.sites || new Map()).values()];
  const clients = [...(ctx.records.clients || new Map()).values()];
  const contracts = [...(ctx.records.contracts || new Map()).values()];

  /* ---------- match schedule sites to CRM sites ---------- */
  const matchSite = (key, contact) => {
    const k = key.replace(/^SO\s+/i, '');
    const kp = pairs(k), kw = words(k);
    let hits = [];
    if (kp.length) {
      const [n, w] = kp[0];
      hits = sites.filter(s => pairs(s.name + ' ' + (s.address || '')).some(([sn, sw]) => sn === n && similar(sw, w)));
      if (!hits.length && /^\d/.test(norm(k))) { // e.g. "10 A REDWOOD"
        hits = sites.filter(s => norm(s.name).startsWith(norm(k).split(' ')[0] + ' ') && words(s.name).some(x => kw.some(y => similar(x, y))));
      }
    } else if (kw.length) {
      hits = sites.filter(s => !/^\d/.test(norm(s.name)) && words(s.name).some(x => similar(x, kw[0])));
    }
    if (hits.length > 1 && contact) { const c = norm(contact).split(' ')[0]; const byC = hits.filter(s => norm((clients.find(x => x.id === s.client_id) || {}).name).includes(c)); if (byC.length === 1) hits = byC; }
    if (hits.length === 1) return { site: hits[0], how: 'address' };
    if (contact && !/empty/i.test(contact)) { // site named after the client, e.g. "Losh Naidoo", "Ismail Snupit"
      const c = norm(contact).split(' ')[0];
      const cl = clients.filter(x => norm(x.name).split(' ')[0] === c || similar(norm(x.name).split(' ')[0], c) && c.length >= 5);
      if (cl.length === 1) { const ss = sites.filter(s => s.client_id === cl[0].id); if (ss.length === 1) return { site: ss[0], how: 'contact' }; return { client: cl[0], how: 'contact-client' }; }
    }
    return { site: hits[0] || null, how: hits.length > 1 ? 'ambiguous' : 'none', candidates: hits.length };
  };
  const siteMap = new Map();
  for (const s of S.sites) siteMap.set(s.site_key, matchSite(s.site_key, (s.contacts || [])[0]));

  const CREW = { 'crew-1': ['SIPHO', 'BENGU', 'SINOKO'], 'crew-2': ['ZULU', 'MKIZE', 'MANDLA', 'JUICE'] };
  const crewOf = names => { const up = names.map(n => n.trim().toUpperCase()).filter(Boolean); for (const [id, m] of Object.entries(CREW)) if (up.length && up.every(n => m.includes(n))) return id; return null; };
  const person = n => ALIASES[String(n).trim().toUpperCase()];

  for (const e of S.schedule_entries) {
    const m = siteMap.get(e.site_key) || {};
    const site = m.site || null;
    const clientId = site ? site.client_id : m.client ? m.client.id : null;
    const contract = clientId ? contracts.filter(c => c.client_id === clientId).sort((a, b) => (a.status === 'active' ? -1 : 1) - (b.status === 'active' ? -1 : 1))[0] : null;
    const d = e.derived_from_notes || {};
    const crew = e.crew || [];
    out.visits.push({
      id: ctx.id('vis', e.entry_id), date: e.date, site_id: site ? site.id : null, site_name: title(e.site_raw || e.site), client_id: clientId, client_name: e.contact && !/^empty$/i.test(e.contact.trim()) ? e.contact.trim() : null,
      contract_id: contract ? contract.id : null, kind: /clean ?up/i.test(e.site) ? 'maintenance' : 'maintenance', crew_id: crewOf(crew), crew_names: crew.map(title).join(' · ') || null,
      start_time: d.start_time || null, finish_by: d.finish_by_time || null, planned_minutes: d.duration_minutes || null, instructions: d.instruction || (e.notes && !d.finish_by_time && !d.duration_minutes ? e.notes : null) || null,
      status: 'scheduled', site_check: e.site_check || null,
      notes: [e.notes && (d.finish_by_time || d.duration_minutes) ? `Schedule note: ${e.notes}` : null, `Imported from the September 2026 schedule (${e.sheet} row ${e.row}); completion was not recorded per visit — the weekly KPI sheet has the totals.`,
        !site ? (m.how === 'ambiguous' ? `Site "${e.site}" matched ${m.candidates} CRM sites — link the right one.` : `Site "${e.site}" is not in the CRM site list — link or add it.`) : m.how === 'contact' ? `Linked to the CRM site by the contact name "${e.contact}".` : null,
        crew.some(n => /ADHOC/i.test(n)) ? 'Includes an ad-hoc (casual) worker.' : null, crew.filter(n => !person(n) && !/ADHOC/i.test(n)).length ? `Unrecognised crew name(s): ${crew.filter(n => !person(n) && !/ADHOC/i.test(n)).join(', ')}` : null].filter(Boolean).join('\n'),
      _src: e._src
    });
  }

  /* ---------- contracts learn their visit days, crew and fortnightly anchor from the September schedule ---------- */
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const byContract = new Map();
  for (const v of out.visits) if (v.contract_id) { if (!byContract.has(v.contract_id)) byContract.set(v.contract_id, []); byContract.get(v.contract_id).push(v); }
  for (const [cid, vs] of byContract) {
    const days = [...new Set(vs.map(v => DAYS[new Date(v.date + 'T12:00:00').getDay()]))].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
    const crewCount = {};
    vs.forEach(v => { if (v.crew_id) crewCount[v.crew_id] = (crewCount[v.crew_id] || 0) + 1; });
    const crew = Object.entries(crewCount).sort((a, b) => b[1] - a[1])[0];
    const finish = vs.map(v => v.finish_by).filter(Boolean);
    const dates = vs.map(v => v.date).sort();
    ctx.patch('contracts', cid, {
      preferred_days: days, crew_id: crew ? crew[0] : null, preferred_time: null, finish_by: finish.length ? finish.sort()[0] : null, schedule_anchor: dates[0],
      schedule_note: `Visit days (${days.join(', ')})${crew ? ', usual crew' : ''} and first visit date taken from the September 2026 schedule (${vs.length} visits: ${dates.join(', ')}).`
    });
  }

  /* ---------- job 99 + its visits ---------- */
  for (const j of S.jobs) {
    const quote = [...(ctx.records.quotes || new Map()).values()].find(q => String(q.legacy_number) === String(j.quote_no));
    out.jobs.push({ id: `job-${j.job_no}`, number: String(j.job_no), title: `${title(j.service_type)} — ${j.property_address}`, client_name: j.client_name, site_address: j.property_address, service_type: 'design', quote_id: quote ? quote.id : null,
      status: 'scheduled', booked_date: j.date_booked, start_date: j.scheduled_date, est_finish: j.estimated_finish, supervisor: j.supervisor, team: title(j.team_assigned), vehicle_id: /H100/i.test(j.vehicle) ? 'veh-h100' : null, invoice_status: j.invoice_status,
      notes: [j.notes, `Contact ${j.contact_person}: ${j.contact_number_note ? '0' + j.contact_number + ' (leading 0 restored — the sheet stored it as a number)' : j.contact_number}.`, `Quote number ${j.quote_no} on the job register${quote ? '' : ' (not found in the quote register)'}.`].filter(Boolean).join('\n'), _src: j._src });
    for (const v of S.job_visits.filter(x => x.job_no === j.job_no)) out.visits.push({
      id: ctx.id('vis', 'job', j.job_no, v.date), date: v.date, site_name: v.property_address, client_name: v.client_name, job_id: `job-${j.job_no}`, kind: 'project', crew_names: title(v.team), start_time: v.arrival_time, finish_by: v.estimated_finish_time,
      planned_minutes: v.derived_planned_duration_hours ? Math.round(v.derived_planned_duration_hours * 60) : null, instructions: `${title(v.service_type)} · equipment: ${(v.equipment_required || []).join(', ')} · vehicle ${v.vehicle} · supervisor ${v.supervisor}`,
      status: /complete/i.test(v.status) ? 'completed' : 'scheduled', notes: v.notes, _src: v._src });
  }

  /* ---------- ops-register assets + maintenance ---------- */
  const CAT = { MACHINE: 'machine', 'MANUAL TOOL': 'manual_tool', 'HAND TOOL': 'hand_tool', PPE: 'ppe', VEHICLE: 'vehicle', TRAILER: 'trailer' };
  const COND = { GOOD: 'good', FAIR: 'fair', SERVICE: 'service', BROKEN: 'broken', LOST: 'lost' };
  for (const a of S.assets) out.assets.push({
    id: ctx.id('ast', 'ops', a.asset_id), asset_no: `OPS-${String(a.asset_id).padStart(3, '0')}`, name: a.asset_name, category: CAT[String(a.category).toUpperCase()] || 'other', brand: a.brand ? title(a.brand) : null, model: a.model || null, serial_number: a.serial_number || null,
    quantity: 1, purchase_date: a.purchase_date, cost: a.purchase_cost ?? null, cost_raw: a.purchase_cost == null && a.purchase_cost_raw ? a.purchase_cost_raw : null, assigned_to: a.assigned_to ? title(a.assigned_to) : null, location: a.location ? title(a.location) : null,
    condition: COND[String(a.condition).toUpperCase()] || 'good', status: /inactive/i.test(a.status) ? 'inactive' : /dispos|sold/i.test(a.status) ? 'disposed' : 'active', warranty_expiry: a.warranty_expiry || null, register: 'ops_register',
    notes: [a.notes, a.purchase_cost == null && a.purchase_cost_raw ? `Cost column says "${a.purchase_cost_raw}".` : null].filter(Boolean).join(' ') || null, _src: a._src
  });
  const TYPE = s => (/repair/i.test(s) ? 'repair' : /clean/i.test(s) ? 'cleaning' : /inspect/i.test(s) ? 'inspection' : /blade/i.test(s) ? 'blades' : 'service');
  for (const m of S.asset_maintenance) {
    out.asset_maintenance.push({ id: ctx.id('amt', m.maintenance_id), asset_id: ctx.id('ast', 'ops', m.asset_id), asset_name: m.asset_name, type: TYPE(m.maintenance_type), description: title(m.description), reported_date: m.date_reported, completed_date: m.date_completed,
      performed_by: title(m.performed_by), cost: m.cost ?? null, next_due: m.next_service_due, status: /closed/i.test(m.status) ? 'closed' : /progress/i.test(m.status) ? 'in_progress' : 'open', notes: [m.notes, m.cost_blank ? 'Cost left blank on the register.' : null].filter(Boolean).join(' ') || null, _src: m._src });
    ctx.patch('assets', ctx.id('ast', 'ops', m.asset_id), { next_service_date: m.next_service_due });
  }

  /* ---------- weekly ops KPIs ---------- */
  const DEF = [
    ['ops_completion_rate', 'Completion rate', 'percent', 'completion_rate', 100, 'higher', v => Math.round(v * 1000) / 10],
    ['ops_quality_score', 'Quality score', 'score', 'quality_score', 100, 'higher', v => v],
    ['ops_client_complaints', 'Client complaints', 'count', 'client_complaints', 0, 'lower', v => v],
    ['ops_staff_attendance', 'Staff attendance', 'percent', 'staff_attendance', 100, 'higher', v => Math.round(v * 1000) / 10],
    ['ops_safety_incidents', 'Safety incidents', 'count', 'safety_incidents', 0, 'lower', v => v],
    ['ops_vehicle_breakdowns', 'Vehicle breakdowns', 'count', 'vehicle_breakdowns', 0, 'lower', v => v],
    ['ops_equipment_breakdowns', 'Equipment breakdowns', 'count', 'equipment_breakdowns', 0, 'lower', v => v],
    ['ops_jobs_scheduled', 'Jobs scheduled', 'count', 'jobs_scheduled', null, 'higher', v => v],
    ['ops_jobs_completed', 'Jobs completed', 'count', 'jobs_completed', null, 'higher', v => v]
  ];
  for (const [key, name, unit, field, target, dir, conv] of DEF) {
    out.kpi_definitions.push({ id: `kpi-${key}`, key, name, owner_role: 'operations', tracker: 'Weekly ops KPI tracker', unit, target, target_period: 'week', direction: dir, description: `From the operations workbook WEEKLY KPI TRACKER. Target row interpreted from the unlabelled ideal-values row.`, _src: (S.kpi_targets[0] || {})._src });
    for (const w of S.kpi_entries) if (w[field] != null) out.kpi_entries.push({ id: ctx.id('kpie', key, w.week_ending), kpi_key: key, kpi_name: name, date: w.week_ending, period: 'week', value: conv(w[field]), target, _src: w._src });
  }
  return out;
}
