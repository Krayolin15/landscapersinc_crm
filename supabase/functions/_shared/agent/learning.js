/* =============================================================================
   Learning — small, explainable helpers the agent uses to get smarter about
   the business over time: job velocity (planned vs actual minutes), equipment
   wear (usage estimate -> service-due prediction) and seasonal client-care
   outreach opportunities. Every number here is derived from the records
   passed in — nothing is invented.

   PURE MODULE: no DOM, no Deno APIs, no npm imports.
   ========================================================================== */

const round2 = v => Math.round(v * 100) / 100;
const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

/**
 * jobVelocity({ visits, services }) -> [{ key, site_id, service_id, samples,
 *   avgPlannedMinutes, avgActualMinutes, productivityFactor }]
 * productivityFactor = actual / planned averaged over completed visits with
 * both figures recorded, grouped by site + service (or kind when no
 * service_id is set). > 1 means the crew is taking longer than planned there;
 * < 1 means faster.
 */
export function jobVelocity({ visits = [], services = [] } = {}) {
  const servicesById = Object.fromEntries(services.map(s => [s.id, s]));
  const groups = new Map();
  for (const v of visits) {
    if (v.status !== 'completed' || !v.planned_minutes || !v.actual_minutes) continue;
    const svcKey = v.service_id || v.kind || 'general';
    const key = `${v.site_id || v.site_name || 'unknown-site'}|${svcKey}`;
    if (!groups.has(key)) groups.set(key, { site_id: v.site_id || null, site_name: v.site_name || null, service_id: v.service_id || null, service_name: (servicesById[v.service_id] && servicesById[v.service_id].name) || v.kind || null, rows: [] });
    groups.get(key).rows.push(v);
  }
  return Array.from(groups.entries()).map(([key, g]) => {
    const planned = g.rows.map(v => v.planned_minutes), actual = g.rows.map(v => v.actual_minutes);
    const factor = avg(g.rows.map(v => v.actual_minutes / v.planned_minutes));
    return { key, site_id: g.site_id, site_name: g.site_name, service_id: g.service_id, service_name: g.service_name, samples: g.rows.length, avgPlannedMinutes: round2(avg(planned)), avgActualMinutes: round2(avg(actual)), productivityFactor: round2(factor) };
  }).sort((a, b) => b.samples - a.samples);
}

/**
 * equipmentWear({ visits, services, assets, machinesPerService }) ->
 *   { usageByCategory: {category: hours}, predictions: [{asset_id,name,hoursUsed,dueInHours,dueSoon}] }
 * Usage is estimated as (visit minutes / 60) × the number of machines that
 * service typically uses (settings-configurable, default 1). Assets with a
 * declared service_interval_hours get a due-in-hours prediction from their
 * recorded hours_used.
 */
export function equipmentWear({ visits = [], services = [], assets = [], machinesPerService = {} } = {}) {
  const servicesById = Object.fromEntries(services.map(s => [s.id, s]));
  const usage = new Map();
  for (const v of visits) {
    if (v.status !== 'completed') continue;
    const minutes = v.actual_minutes ?? v.planned_minutes;
    if (!minutes) continue;
    const svc = v.service_id ? servicesById[v.service_id] : null;
    const cat = (svc && svc.category) || v.kind || 'general';
    const machines = machinesPerService[cat] ?? machinesPerService[v.kind] ?? 1;
    usage.set(cat, (usage.get(cat) || 0) + (minutes / 60) * machines);
  }
  const predictions = assets.filter(a => a.service_interval_hours).map(a => {
    const hoursUsed = a.hours_used || 0;
    const dueInHours = round2(a.service_interval_hours - (hoursUsed % a.service_interval_hours));
    return { asset_id: a.id, name: a.name, hoursUsed, dueInHours, dueSoon: dueInHours <= 10 };
  }).sort((a, b) => a.dueInHours - b.dueInHours);
  const usageByCategory = Object.fromEntries(Array.from(usage.entries()).map(([k, v]) => [k, round2(v)]));
  return { usageByCategory, predictions };
}

/** KZN seasonal service windows (month = 1..12) driving outreach suggestions. */
export const SEASONAL_WINDOWS = [
  { months: [9, 10, 11], label: 'Spring (KZN)', suggestion: 'Fertilising, scarifying and top-dressing' },
  { months: [10, 11, 12], label: 'Pre-summer', suggestion: 'Weed treatment before the growing season' },
  { months: [3, 4, 5], label: 'Autumn', suggestion: 'Pruning' },
  { months: [6, 7, 8], label: 'Winter', suggestion: 'Lawn dormancy care and hardscape projects' },
  { months: [8, 9, 10], label: 'Pre-storm season', suggestion: 'Gutter cleaning before summer storms' }
];

/**
 * careOpportunities({ clients, contracts }, month) -> [{ client_id, client_name,
 *   suggestion, reason }] — one row per active client with an active
 * maintenance contract, per matching seasonal window this month (1..12).
 */
export function careOpportunities({ clients = [], contracts = [] } = {}, month) {
  const windows = SEASONAL_WINDOWS.filter(w => w.months.includes(month));
  if (!windows.length) return [];
  const activeClientIds = new Set(contracts.filter(c => c.status === 'active').map(c => c.client_id));
  const out = [];
  for (const c of clients) {
    if (c.status !== 'active' || !activeClientIds.has(c.id)) continue;
    for (const w of windows) out.push({ client_id: c.id, client_name: c.name, suggestion: w.suggestion, reason: `${w.label} — seasonal service window` });
  }
  return out;
}
