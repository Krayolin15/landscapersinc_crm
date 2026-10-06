/* =============================================================================
   Live Dispatch — pure scheduling logic (no DOM, no db): generating visits from
   maintenance contracts, ordering a crew's run-sheet, crew load. Unit tested in
   tests__schedule.test.js.
   ========================================================================== */

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const d0 = s => new Date(`${s}T12:00:00`);
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDaysIso = (s, n) => { const d = d0(s); d.setDate(d.getDate() + n); return isoOf(d); };
export const weekday = s => DAYS[d0(s).getDay()];
const mondayOf = s => { const d = d0(s); const diff = (d.getDay() + 6) % 7; d.setDate(d.getDate() - diff); return isoOf(d); };
export const weeksBetween = (a, b) => Math.round((d0(mondayOf(b)) - d0(mondayOf(a))) / (7 * 864e5));
const nthWeekdayOfMonth = s => Math.ceil(d0(s).getDate() / 7);

/** Dates a contract is due in [from, to] BEFORE holiday handling. Returns { dates, reason? }. */
export function contractDates(c, from, to) {
  const days = Array.isArray(c.preferred_days) ? c.preferred_days : [];
  const freq = c.frequency;
  if (freq === 'daily') days.length || days.push('Mon', 'Tue', 'Wed', 'Thu', 'Fri');
  if (!days.length) return { dates: [], reason: 'No visit days set on the contract' };
  const anchor = c.schedule_anchor || c.start_date || from;
  const out = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    const wd = weekday(d);
    if (freq === 'daily' ? !['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(wd) : !days.includes(wd)) continue;
    if (c.start_date && d < c.start_date) continue;
    if (c.end_date && d > c.end_date) continue;
    if (c.pause_from && d >= c.pause_from && (!c.pause_until || d <= c.pause_until)) continue;
    if (freq === 'fortnightly' && Math.abs(weeksBetween(anchor, d)) % 2 !== 0) continue;
    if (freq === 'monthly' && nthWeekdayOfMonth(d) !== Math.min(nthWeekdayOfMonth(anchor), 4)) continue;
    out.push(d);
  }
  return { dates: out };
}

/**
 * generateVisits({ contracts, sites, clients, from, to, existing, isHoliday })
 *   -> { create: [visit drafts], skipped: [{ contract, reason }] }
 * Idempotent: a contract never gets two visits on the same date (existing visits, or visits moved from that date).
 * Public holidays move to the next working day (Mon–Fri, not a holiday) and say so.
 */
export function generateVisits({ contracts = [], sites = [], clients = [], from, to, existing = [], isHoliday = () => false }) {
  const create = [], skipped = [];
  const taken = new Set(existing.filter(v => v.contract_id).flatMap(v => [`${v.contract_id}|${v.date}`, v.rescheduled_from ? `${v.contract_id}|${v.rescheduled_from}` : null]).filter(Boolean));
  for (const c of contracts) {
    if (c.status !== 'active') continue;
    const { dates, reason } = contractDates(c, from, to);
    if (reason) { skipped.push({ contract: c, reason }); continue; }
    const site = sites.find(s => s.id === c.site_id) || null;
    const client = clients.find(x => x.id === c.client_id) || null;
    for (const planned of dates) {
      if (taken.has(`${c.id}|${planned}`)) continue;
      let date = planned, moved = null;
      if (isHoliday(planned)) {
        do { date = addDaysIso(date, 1); } while (['Sat', 'Sun'].includes(weekday(date)) || isHoliday(date));
        moved = planned;
        if (taken.has(`${c.id}|${date}`)) continue;
      }
      taken.add(`${c.id}|${planned}`); taken.add(`${c.id}|${date}`);
      create.push({
        date, contract_id: c.id, client_id: c.client_id, site_id: c.site_id || null, site_name: (site && site.name) || c.site_name || c.name,
        client_name: (client && (client.contact_name || client.name)) || null, kind: 'maintenance', crew_id: c.crew_id || null,
        start_time: c.preferred_time || (site && site.start_at) || null, finish_by: c.finish_by || (site && site.finish_by) || null,
        instructions: (site && site.instructions) || (client && client.standing_instructions) || null, status: 'scheduled',
        rescheduled_from: moved, reschedule_reason: moved ? `Public holiday on ${moved}` : null
      });
    }
  }
  create.sort((a, b) => (a.date + (a.start_time || '99')).localeCompare(b.date + (b.start_time || '99')));
  return { create, skipped };
}

/** Run-sheet order: fixed start times first (earliest), then finish-by deadlines, then the saved sequence, then name. */
export function orderRun(visits) {
  return visits.slice().sort((a, b) =>
    (a.start_time || '99:99').localeCompare(b.start_time || '99:99') ||
    (a.finish_by || '99:99').localeCompare(b.finish_by || '99:99') ||
    (a.sequence ?? 999) - (b.sequence ?? 999) ||
    String(a.site_name || '').localeCompare(String(b.site_name || '')));
}

/** Planned minutes vs a crew's daily capacity (8 working hours unless the crew says otherwise). */
export function crewLoad(visits, crew = {}) {
  const planned = visits.reduce((s, v) => s + (Number(v.planned_minutes) || 60), 0);
  const capacityMin = (crew.capacity_minutes || 8 * 60);
  return { visits: visits.length, planned, capacityMin, pct: Math.round((planned / capacityMin) * 100), over: visits.length > (crew.capacity_per_day || 99) || planned > capacityMin };
}

/** Minutes between two ISO datetimes (for actual time on site). */
export const minutesBetween = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : null);
