/* =============================================================================
   Dispatch planner — builds tomorrow's (or today's) crew run-sheet.

   PURE & DETERMINISTIC MODULE: no DOM, no Deno APIs, no npm imports, no
   Math.random(), no reliance on "now". Every input it needs (which day, which
   dates are holidays, which suburbs have bad weather) is passed in, so the
   same input always produces the same plan — required for both the browser
   runner and the Edge Function, and for unit testing.
   ========================================================================== */

import { round2, formatMoney } from '../../../../js/core/money.js';
import { optimiseRoute, haversineKm } from './geo.js';

export const WEATHER_SENSITIVE_KEYWORDS = ['mow', 'lawn cut', 'lawn dress', 'lawn lay', 'spray', 'fertilis', 'fertiliz'];
export const SUBSTITUTE_TASKS = ['Pruning', 'Hardscaping', 'Clearance', 'Nursery potting', 'Equipment servicing'];
const ACCEPTABLE_RISKS = new Set(['dry', 'showers', 'windy']);

function dow(dateIso) { const [y, m, d] = dateIso.split('-').map(Number); return new Date(y, m - 1, d).getDay(); }
const isWeekendDate = dateIso => { const d = dow(dateIso); return d === 0 || d === 6; };

/** Deterministic pick from a fixed list using the record's id (no Math.random). */
function pickDeterministic(list, seedStr) {
  let h = 0;
  for (const ch of String(seedStr || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

/** True when a visit is rain/wind sensitive (explicit flag, then the service's flag, then a keyword match). */
export function isWeatherSensitive(visit, servicesById = {}, keywords = WEATHER_SENSITIVE_KEYWORDS) {
  if (typeof visit.weather_sensitive === 'boolean') return visit.weather_sensitive;
  const svc = visit.service_id ? servicesById[visit.service_id] : null;
  if (svc && typeof svc.weather_sensitive === 'boolean') return svc.weather_sensitive;
  const hay = `${visit.instructions || ''} ${visit.site_name || ''} ${visit.kind || ''} ${(svc && svc.name) || ''} ${(svc && svc.category) || ''}`.toLowerCase();
  return keywords.some(k => hay.includes(k));
}

function hasFixedTime(v) { return !!(v.start_time || v.finish_by); }

function crewHasDriver(crew, employeesById) {
  if (crew.leader_id && employeesById[crew.leader_id] && employeesById[crew.leader_id].is_driver) return true;
  return (crew.members || []).some(id => employeesById[id] && employeesById[id].is_driver);
}

/**
 * planDay({
 *   date, isHoliday, isWeekend, visits, crews, employees, vehicles, services, depot,
 *   weatherBySuburb: { [suburb]: { [date]: {risk,...} } }, candidateDates: [date,...] (next working days, in order),
 *   settings: { fuelPriceRandPerLitre, defaultFuelL100km, weatherKeywords }
 * }) -> { assignments, decisions }
 */
export function planDay(o) {
  const date = o.date;
  const isWeekend = o.isWeekend != null ? o.isWeekend : isWeekendDate(date);
  const decisions = [];

  if (o.isHoliday || isWeekend) {
    decisions.push({ kind: 'other', title: `No dispatch on ${date}`, detail: o.isHoliday ? 'Public holiday — the depot is closed.' : 'Weekend — no scheduled maintenance rounds.', requires_approval: false, status: 'applied', affected: { date } });
    return { assignments: [], decisions };
  }

  const depot = o.depot || { lat: null, lng: null, name: 'Depot' };
  const servicesById = Object.fromEntries((o.services || []).map(s => [s.id, s]));
  const employeesById = Object.fromEntries((o.employees || []).map(e => [e.id, e]));
  const weatherBySuburb = o.weatherBySuburb || {};
  const candidateDates = (o.candidateDates || []).filter(d => d !== date);
  const keywords = (o.settings && o.settings.weatherKeywords) || WEATHER_SENSITIVE_KEYWORDS;
  const fuelPrice = (o.settings && o.settings.fuelPriceRandPerLitre) || 23;
  const defaultFuel100 = (o.settings && o.settings.defaultFuelL100km) || 12;

  const activeCrews = (o.crews || []).filter(c => c.active !== false);

  // 1. Weather-sensitive visits in a wet/stormy suburb are postponed to the next
  //    working day with acceptable weather for that suburb.
  const kept = [];
  for (const v of o.visits || []) {
    const weatherSensitive = isWeatherSensitive(v, servicesById, keywords);
    const suburbForecast = v.suburb && weatherBySuburb[v.suburb] ? weatherBySuburb[v.suburb][date] : null;
    if (weatherSensitive && suburbForecast && !ACCEPTABLE_RISKS.has(suburbForecast.risk)) {
      let targetDate = null;
      for (const cand of candidateDates) {
        const f = v.suburb && weatherBySuburb[v.suburb] ? weatherBySuburb[v.suburb][cand] : null;
        if (f && ACCEPTABLE_RISKS.has(f.risk)) { targetDate = cand; break; }
      }
      const fixed = hasFixedTime(v);
      const substitute = pickDeterministic(SUBSTITUTE_TASKS, v.id);
      decisions.push({
        kind: 'weather_reschedule',
        title: `Postponed ${v.site_name || 'visit'} (${v.suburb || 'unknown suburb'}) — ${suburbForecast.risk} weather`,
        detail: `${suburbForecast.summary || suburbForecast.risk}. ${targetDate ? `Moved to ${targetDate}.` : 'No acceptable day found in the lookahead window — left on the plan for review.'} Suggested sheltered substitute: ${substitute}.`,
        affected: { visit_id: v.id, site_name: v.site_name, suburb: v.suburb, from_date: date, to_date: targetDate, substitute_task: substitute },
        requires_approval: fixed,
        status: fixed ? 'pending' : (targetDate ? 'applied' : 'suggested')
      });
      continue; // not scheduled today
    }
    kept.push(v);
  }

  if (!activeCrews.length) {
    if (kept.length) decisions.push({ kind: 'other', title: 'No crews configured', detail: `${kept.length} visit(s) are due today but no active crew exists yet — add crews in Fleet/Operations.`, requires_approval: false, status: 'suggested' });
    return { assignments: [], decisions };
  }

  for (const c of activeCrews) {
    if (!crewHasDriver(c, employeesById)) decisions.push({ kind: 'crew_assignment', title: `${c.name} has no driver / team leader assigned`, detail: 'Set a team leader (crews.leader_id) or mark a member as a driver (employees.is_driver) so this crew can take a vehicle out.', affected: { crew_id: c.id }, requires_approval: false, status: 'suggested' });
  }

  // 2. Balance visits across crews by capacity — fixed-time visits are placed first
  //    so they get first claim on a crew, everything else fills remaining capacity.
  const fixed = kept.filter(hasFixedTime).sort((a, b) => String(a.start_time || a.finish_by).localeCompare(String(b.start_time || b.finish_by)));
  const flexible = kept.filter(v => !hasFixedTime(v));
  const load = new Map(activeCrews.map(c => [c.id, []]));

  function assign(v) {
    const preferred = v.preferred_crew_id || v.crew_id;
    let crew = preferred && activeCrews.find(c => c.id === preferred);
    if (crew && load.get(crew.id).length >= (crew.capacity_per_day || Infinity)) crew = null;
    if (!crew) {
      crew = activeCrews.reduce((best, c) => {
        const cap = c.capacity_per_day || Infinity;
        const ratio = load.get(c.id).length / cap;
        if (ratio >= 1 && cap !== Infinity && best) return best;
        if (!best) return c;
        const bestRatio = load.get(best.id).length / (best.capacity_per_day || Infinity);
        return ratio < bestRatio ? c : best;
      }, null);
    }
    if (crew) load.get(crew.id).push(v);
    return crew;
  }
  for (const v of [...fixed, ...flexible]) assign(v);

  // 3. Order each crew's route (fixed-time stops first, in time order; the rest
  //    nearest-neighbour + 2-opt from wherever the fixed run left off).
  const assignments = activeCrews.map(crew => {
    const visits = load.get(crew.id);
    const crewFixed = visits.filter(hasFixedTime).sort((a, b) => String(a.start_time || a.finish_by).localeCompare(String(b.start_time || b.finish_by)));
    const crewFlexible = visits.filter(v => !hasFixedTime(v));
    const startPoint = (crewFixed.length && crewFixed[crewFixed.length - 1].lat != null) ? crewFixed[crewFixed.length - 1] : depot;
    const orderedFlexible = optimiseRoute(startPoint, crewFlexible);
    const orderedVisits = [...crewFixed, ...orderedFlexible];

    let from = depot, km = 0;
    const stops = orderedVisits.map(v => {
      const legKm = v.lat != null && v.lng != null && from.lat != null ? haversineKm(from, v) : 0;
      km += legKm;
      if (v.lat != null) from = v;
      return { ...v, leg_km: round2(legKm) };
    });
    const vehicle = (o.vehicles || []).find(x => x.id === crew.vehicle_id);
    const l100 = (vehicle && vehicle.fuel_l_per_100km) || defaultFuel100;
    const fuel_litres = round2((km * l100) / 100);
    const fuel_cost = round2(fuel_litres * fuelPrice);

    return { crew: { id: crew.id, name: crew.name }, visits: stops, departure: '07:00', km: round2(km), fuel_litres, fuel_cost };
  });

  const totalKm = round2(assignments.reduce((a, x) => a + x.km, 0));
  const totalVisits = assignments.reduce((a, x) => a + x.visits.length, 0);
  const totalFuelCost = round2(assignments.reduce((a, x) => a + x.fuel_cost, 0));
  decisions.push({ kind: 'route_plan', title: `Dispatch plan for ${date}: ${totalVisits} visit(s), ${assignments.length} crew(s)`, detail: `${totalKm} km planned, ${formatMoney(totalFuelCost)} in fuel.`, affected: { date, totalKm, totalVisits, totalFuelCost }, requires_approval: false, status: 'applied' });

  return { assignments, decisions };
}
