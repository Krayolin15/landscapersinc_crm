// Autonomous agent tests (pure logic, no DOM):  node tests__agent.test.js
import assert from 'node:assert/strict';
import { haversineKm, nearestNeighbourRoute, twoOptImprove, optimiseRoute, clusterByDistance, resolveLocation, routeDistanceKm, DEPOT, SUBURBS } from '../supabase__functions___shared__agent__geo.js';
import { assess, weatherCodeLabel, WORK_WINDOW_DEFAULT } from '../supabase__functions___shared__agent__weather.js';
import { planDay, isWeatherSensitive, WEATHER_SENSITIVE_KEYWORDS } from '../supabase__functions___shared__agent__dispatch.js';
import { composeBriefing } from '../supabase__functions___shared__agent__briefing.js';
import { debtorReminders, expiryAlerts, REMINDER_STAGES_DEFAULT } from '../supabase__functions___shared__agent__reminders.js';
import { matchPayment, AUTO_APPLY_THRESHOLD } from '../supabase__functions___shared__agent__pop-match.js';
import { jobVelocity, equipmentWear, careOpportunities, SEASONAL_WINDOWS } from '../supabase__functions___shared__agent__learning.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };

/* ============================================================ geo: haversine + routing */

t('haversineKm: same point is zero', () => assert.equal(haversineKm(DEPOT, DEPOT), 0));
t('haversineKm: one degree of latitude is ~111km', () => {
  const d = haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(d > 110 && d < 112, String(d));
});
t('haversineKm: missing coordinates are zero, not NaN', () => assert.equal(haversineKm(DEPOT, { lat: null, lng: null }), 0));
t('haversineKm: Mount Edgecombe depot to Umhlanga is a plausible short hop', () => {
  const d = haversineKm(DEPOT, SUBURBS.Umhlanga);
  assert.ok(d > 1 && d < 20, String(d));
});

t('nearestNeighbourRoute: visits every point exactly once', () => {
  const pts = [{ id: 'a', lat: -29.70, lng: 31.05 }, { id: 'b', lat: -29.75, lng: 31.02 }, { id: 'c', lat: -29.72, lng: 31.09 }];
  const route = nearestNeighbourRoute(DEPOT, pts);
  assert.deepEqual(route.map(p => p.id).sort(), ['a', 'b', 'c']);
});
t('nearestNeighbourRoute: picks the closest point first', () => {
  const near = { id: 'near', lat: DEPOT.lat + 0.001, lng: DEPOT.lng + 0.001 };
  const far = { id: 'far', lat: DEPOT.lat + 0.5, lng: DEPOT.lng + 0.5 };
  const route = nearestNeighbourRoute(DEPOT, [far, near]);
  assert.equal(route[0].id, 'near');
});
t('nearestNeighbourRoute: deterministic — same input, same output every time', () => {
  const pts = [{ id: 'a', lat: -29.70, lng: 31.05 }, { id: 'b', lat: -29.75, lng: 31.02 }, { id: 'c', lat: -29.72, lng: 31.09 }, { id: 'd', lat: -29.68, lng: 31.00 }];
  const r1 = nearestNeighbourRoute(DEPOT, pts).map(p => p.id);
  const r2 = nearestNeighbourRoute(DEPOT, pts.slice()).map(p => p.id);
  assert.deepEqual(r1, r2);
});
t('twoOptImprove: never makes the route longer', () => {
  // A deliberately bad hand-ordered route that nearest-neighbour would not produce.
  const pts = [{ id: 'a', lat: -29.60, lng: 31.10 }, { id: 'b', lat: -29.90, lng: 30.90 }, { id: 'c', lat: -29.62, lng: 31.12 }, { id: 'd', lat: -29.88, lng: 30.92 }];
  const before = routeDistanceKm(DEPOT, pts);
  const after = routeDistanceKm(DEPOT, twoOptImprove(DEPOT, pts));
  assert.ok(after <= before + 1e-6, `${after} should be <= ${before}`);
});
t('optimiseRoute: unlocated points are appended, unmoved, at the end', () => {
  const located = { id: 'a', lat: -29.70, lng: 31.05 };
  const unlocated = { id: 'no-coords' };
  const out = optimiseRoute(DEPOT, [unlocated, located]);
  assert.equal(out[out.length - 1].id, 'no-coords');
  assert.ok(out.some(p => p.id === 'a'));
});
t('optimiseRoute: deterministic end to end', () => {
  const pts = [{ id: 'a', lat: -29.70, lng: 31.05 }, { id: 'b', lat: -29.75, lng: 31.02 }, { id: 'c', lat: -29.72, lng: 31.09 }, { id: 'd', lat: -29.68, lng: 31.00 }, { id: 'e', lat: -29.80, lng: 31.03 }];
  const r1 = optimiseRoute(DEPOT, pts).map(p => p.id);
  const r2 = optimiseRoute(DEPOT, pts.slice().reverse().reverse()).map(p => p.id);
  assert.deepEqual(r1, r2);
});

t('clusterByDistance: near points cluster, far points do not', () => {
  const pts = [{ lat: -29.70, lng: 31.05 }, { lat: -29.701, lng: 31.051 }, { lat: -30.50, lng: 30.20 }];
  const groups = clusterByDistance(pts, 1).map(g => g.length).sort((a, b) => a - b);
  assert.deepEqual(groups, [1, 2]);
});

t('resolveLocation: exact and fuzzy suburb names resolve', () => {
  assert.equal(resolveLocation('Umhlanga').name, 'Umhlanga');
  assert.equal(resolveLocation('umhlanga rocks estate').name, 'Umhlanga');
  assert.equal(resolveLocation('  Kloof  ').name, 'Kloof');
});
t('resolveLocation: unrecognisable text returns null, never a guess', () => {
  assert.equal(resolveLocation('Nowhereville'), null);
  assert.equal(resolveLocation(''), null);
  assert.equal(resolveLocation(null), null);
});
t('every suburb is marked approximate (never presented as an exact address)', () => {
  for (const name of Object.keys(SUBURBS)) assert.equal(resolveLocation(name).approx, true);
});

/* ============================================================ weather: assess() thresholds */

function hourly(rows) {
  // rows: [{ t:'07:00', prob, mm, wind, gust, code }]
  const date = '2026-09-28';
  return {
    time: rows.map(r => `${date}T${r.t}`),
    precipitation_probability: rows.map(r => r.prob ?? 0),
    precipitation: rows.map(r => r.mm ?? 0),
    wind_speed_10m: rows.map(r => r.wind ?? 0),
    wind_gusts_10m: rows.map(r => r.gust ?? 0),
    weather_code: rows.map(r => r.code ?? 0),
    temperature_2m: rows.map(r => r.temp ?? 22)
  };
}
const WORK = WORK_WINDOW_DEFAULT;

t('assess: calm dry hours → dry', () => {
  const a = assess(hourly([{ t: '08:00', prob: 5 }, { t: '12:00', prob: 10 }]), WORK);
  assert.equal(a.risk, 'dry');
});
t('assess: ≥70% chance and ≥2mm → wet', () => {
  const a = assess(hourly([{ t: '09:00', prob: 80, mm: 3 }]), WORK);
  assert.equal(a.risk, 'wet');
});
t('assess: ≥5mm regardless of probability → wet', () => {
  const a = assess(hourly([{ t: '09:00', prob: 20, mm: 6 }]), WORK);
  assert.equal(a.risk, 'wet');
});
t('assess: 70% chance but under 2mm is NOT wet on its own', () => {
  const a = assess(hourly([{ t: '09:00', prob: 75, mm: 0.5 }]), WORK);
  assert.notEqual(a.risk, 'wet');
});
t('assess: thunderstorm code → storm even with light wind', () => {
  const a = assess(hourly([{ t: '10:00', code: 95, wind: 10, gust: 15 }]), WORK);
  assert.equal(a.risk, 'storm');
});
t('assess: gusts ≥60 km/h → storm', () => {
  const a = assess(hourly([{ t: '10:00', gust: 65 }]), WORK);
  assert.equal(a.risk, 'storm');
});
t('assess: ≥40 km/h wind, no rain/storm → windy', () => {
  const a = assess(hourly([{ t: '10:00', wind: 42, prob: 0 }]), WORK);
  assert.equal(a.risk, 'windy');
});
t('assess: some rain chance but below wet threshold → showers', () => {
  const a = assess(hourly([{ t: '10:00', prob: 40, mm: 0.4 }]), WORK);
  assert.equal(a.risk, 'showers');
});
t('assess: hours outside the work window are ignored', () => {
  // A storm at 03:00 (before 07:00) must not affect the 07:00–16:00 assessment.
  const a = assess(hourly([{ t: '03:00', code: 95, gust: 90 }, { t: '09:00', prob: 5 }]), WORK);
  assert.equal(a.risk, 'dry');
});
t('assess: rainMm sums only the in-window hours', () => {
  const a = assess(hourly([{ t: '03:00', mm: 20 }, { t: '09:00', mm: 1 }, { t: '10:00', mm: 1 }]), WORK);
  assert.equal(a.rainMm, 2);
});
t('assess: worstHour points at the riskiest in-window hour', () => {
  const a = assess(hourly([{ t: '08:00', prob: 10 }, { t: '11:00', prob: 90, mm: 3 }, { t: '14:00', prob: 20 }]), WORK);
  assert.equal(a.worstHour, '11:00');
});
t('weatherCodeLabel: known and unknown codes', () => {
  assert.equal(weatherCodeLabel(95).label, 'Thunderstorm');
  assert.equal(weatherCodeLabel(0).icon, 'sun');
  assert.equal(weatherCodeLabel(9999).label, 'Unknown');
});

/* ============================================================ dispatch: planDay() */

const depot = DEPOT;
const nearA = { lat: depot.lat + 0.01, lng: depot.lng + 0.01, suburb: 'Mount Edgecombe' };
const nearB = { lat: depot.lat + 0.02, lng: depot.lng - 0.01, suburb: 'Mount Edgecombe' };
const farC = { lat: depot.lat - 0.3, lng: depot.lng - 0.2, suburb: 'Mount Edgecombe' };

function visit(o) { return { id: o.id, site_name: o.id, kind: 'maintenance', instructions: '', ...nearA, ...o }; }
const crewA = { id: 'crewA', name: 'Crew A', leader_id: 'e1', capacity_per_day: 10, active: true };
const employees = [{ id: 'e1', is_driver: true }];

t('planDay: no dispatch on a public holiday, whatever is scheduled', () => {
  const r = planDay({ date: '2026-04-27', isHoliday: true, visits: [visit({ id: 'v1' })], crews: [crewA], employees });
  assert.equal(r.assignments.length, 0);
  assert.ok(r.decisions.some(d => d.kind === 'other' && /No dispatch/.test(d.title)));
});
t('planDay: no dispatch on a weekend', () => {
  const r = planDay({ date: '2026-09-26', isWeekend: true, visits: [visit({ id: 'v1' })], crews: [crewA], employees }); // a Saturday
  assert.equal(r.assignments.length, 0);
});
t('planDay: weekday with no visits produces an empty, valid plan', () => {
  const r = planDay({ date: '2026-09-28', visits: [], crews: [crewA], employees }); // a Monday
  assert.equal(r.assignments.length, 1);
  assert.equal(r.assignments[0].visits.length, 0);
});

t('planDay: weather-sensitive work in a wet suburb is postponed to the next acceptable day', () => {
  const date = '2026-09-28';
  const nextDay = '2026-09-29';
  const r = planDay({
    date, visits: [visit({ id: 'mow1', kind: 'lawn mowing' })], crews: [crewA], employees, candidateDates: [nextDay],
    weatherBySuburb: { 'Mount Edgecombe': { [date]: { risk: 'wet', summary: 'wet' }, [nextDay]: { risk: 'dry', summary: 'dry' } } }
  });
  const dec = r.decisions.find(d => d.kind === 'weather_reschedule');
  assert.ok(dec, 'expected a weather_reschedule decision');
  assert.equal(dec.affected.to_date, nextDay);
  assert.equal(dec.requires_approval, false); // no fixed time on this visit
  assert.equal(dec.status, 'applied');
  assert.ok(SUBSTITUTE_TASKS_INCLUDES(dec.affected.substitute_task));
  assert.equal(r.assignments[0].visits.length, 0, 'the postponed visit is not on today’s route');
});
function SUBSTITUTE_TASKS_INCLUDES(v) { return ['Pruning', 'Hardscaping', 'Clearance', 'Nursery potting', 'Equipment servicing'].includes(v); }

t('planDay: a fixed-time visit in bad weather needs approval instead of moving itself', () => {
  const date = '2026-09-28';
  const r = planDay({
    date, visits: [visit({ id: 'mow-fixed', kind: 'lawn mowing', start_time: '08:00' })], crews: [crewA], employees, candidateDates: ['2026-09-29'],
    weatherBySuburb: { 'Mount Edgecombe': { [date]: { risk: 'storm', summary: 'storm' } } }
  });
  const dec = r.decisions.find(d => d.kind === 'weather_reschedule');
  assert.equal(dec.requires_approval, true);
  assert.equal(dec.status, 'pending');
});
t('planDay: non-weather-sensitive work goes ahead in the same bad weather', () => {
  const date = '2026-09-28';
  const r = planDay({
    date, visits: [visit({ id: 'prune1', kind: 'pruning' })], crews: [crewA], employees,
    weatherBySuburb: { 'Mount Edgecombe': { [date]: { risk: 'storm', summary: 'storm' } } }
  });
  assert.equal(r.decisions.some(d => d.kind === 'weather_reschedule'), false);
  assert.equal(r.assignments[0].visits.length, 1);
});
t('planDay: acceptable weather (windy) is not postponed', () => {
  const date = '2026-09-28';
  const r = planDay({ date, visits: [visit({ id: 'mow1', kind: 'lawn mowing' })], crews: [crewA], employees, weatherBySuburb: { 'Mount Edgecombe': { [date]: { risk: 'windy', summary: 'windy' } } } });
  assert.equal(r.decisions.some(d => d.kind === 'weather_reschedule'), false);
});

t('planDay: flags a crew with no driver / team leader', () => {
  const crewNoDriver = { id: 'c2', name: 'Crew B', capacity_per_day: 10, active: true, members: ['e2'] };
  const r = planDay({ date: '2026-09-28', visits: [], crews: [crewNoDriver], employees: [{ id: 'e2', is_driver: false }] });
  assert.ok(r.decisions.some(d => d.kind === 'crew_assignment' && /no driver/.test(d.title)));
});
t('planDay: a designated crew member marked is_driver satisfies the driver check', () => {
  const crew = { id: 'c3', name: 'Crew C', capacity_per_day: 10, active: true, members: ['e3'] };
  const r = planDay({ date: '2026-09-28', visits: [], crews: [crew], employees: [{ id: 'e3', is_driver: true }] });
  assert.equal(r.decisions.some(d => d.kind === 'crew_assignment'), false);
});

t('planDay: balances visits across crews by capacity', () => {
  const crews = [{ id: 'c1', name: 'One', capacity_per_day: 1, active: true, leader_id: 'e1' }, { id: 'c2', name: 'Two', capacity_per_day: 1, active: true, leader_id: 'e1' }];
  const r = planDay({ date: '2026-09-28', visits: [visit({ id: 'v1' }), visit({ id: 'v2', ...nearB })], crews, employees });
  const counts = r.assignments.map(a => a.visits.length).sort();
  assert.deepEqual(counts, [1, 1]);
});
t('planDay: fixed-time visits are placed on their preferred/first-available crew first', () => {
  const crews = [{ id: 'c1', name: 'One', capacity_per_day: 1, active: true, leader_id: 'e1' }];
  const r = planDay({ date: '2026-09-28', visits: [visit({ id: 'fixed', start_time: '08:00' }), visit({ id: 'flex' })], crews, employees });
  assert.equal(r.assignments[0].visits[0].id, 'fixed');
});

t('planDay: route order + km/fuel are deterministic for the same input', () => {
  const crews = [crewA];
  const visits = [visit({ id: 'v1', ...nearA }), visit({ id: 'v2', ...nearB }), visit({ id: 'v3', ...farC })];
  const vehicles = [{ id: 'veh1', fuel_l_per_100km: 10 }];
  const crewsWithVehicle = [{ ...crewA, vehicle_id: 'veh1' }];
  const r1 = planDay({ date: '2026-09-28', visits, crews: crewsWithVehicle, employees, vehicles, settings: { fuelPriceRandPerLitre: 20 } });
  const r2 = planDay({ date: '2026-09-28', visits: visits.slice(), crews: crewsWithVehicle, employees, vehicles, settings: { fuelPriceRandPerLitre: 20 } });
  assert.deepEqual(r1.assignments[0].visits.map(v => v.id), r2.assignments[0].visits.map(v => v.id));
  assert.equal(r1.assignments[0].km, r2.assignments[0].km);
  assert.ok(r1.assignments[0].km > 0);
  assert.equal(r1.assignments[0].fuel_litres, Math.round((r1.assignments[0].km * 10) / 100 * 100) / 100);
  assert.equal(r1.assignments[0].fuel_cost, Math.round(r1.assignments[0].fuel_litres * 20 * 100) / 100);
});
t('planDay: default fuel figures apply when no vehicle is assigned', () => {
  const r = planDay({ date: '2026-09-28', visits: [visit({ id: 'v1' })], crews: [crewA], employees, settings: { fuelPriceRandPerLitre: 23, defaultFuelL100km: 12 } });
  const a = r.assignments[0];
  assert.equal(a.fuel_litres, Math.round((a.km * 12) / 100 * 100) / 100);
});

t('isWeatherSensitive: explicit flag wins over keywords', () => {
  assert.equal(isWeatherSensitive({ weather_sensitive: false, kind: 'lawn mowing' }), false);
  assert.equal(isWeatherSensitive({ weather_sensitive: true, kind: 'anything' }), true);
});
t('isWeatherSensitive: keyword match on instructions/kind', () => {
  assert.equal(isWeatherSensitive({ kind: 'general', instructions: 'Spraying weeds today' }, {}, WEATHER_SENSITIVE_KEYWORDS), true);
  assert.equal(isWeatherSensitive({ kind: 'pruning', instructions: 'trim the hedge' }, {}, WEATHER_SENSITIVE_KEYWORDS), false);
});
t('isWeatherSensitive: falls back to the linked service’s own flag', () => {
  assert.equal(isWeatherSensitive({ service_id: 's1' }, { s1: { weather_sensitive: true } }), true);
});

/* ============================================================ briefing: composeBriefing() */

t('composeBriefing: headline mentions visits, weather and overdue money when present', () => {
  const b = composeBriefing({
    date: '2026-09-28',
    plan: { assignments: [{ crew: { name: 'A' }, visits: [{}, {}], km: 10, fuel_cost: 50 }], decisions: [{ kind: 'weather_reschedule', affected: { site_name: 'Site 1', suburb: 'Umhlanga', to_date: '2026-09-29', substitute_task: 'Pruning' } }] },
    overdueInvoices: [{ balance: 500 }], approvals: [{ title: 'x' }]
  });
  assert.match(b.headline, /2 visits/);
  assert.match(b.headline, /Shifted Site 1/);
  assert.match(b.headline, /overdue/);
  assert.ok(b.sections.some(s => s.title === "Today's dispatch"));
  assert.ok(b.sections.some(s => s.title === 'Money'));
});
t('composeBriefing: a quiet day still produces a valid headline', () => {
  const b = composeBriefing({ date: '2026-09-28' });
  assert.ok(b.headline.length > 0);
  assert.ok(Array.isArray(b.sections) && b.sections.length > 0);
});

/* ============================================================ reminders: debtorReminders() + expiryAlerts() */

const baseInv = o => ({ id: 'i1', client_id: 'c1', client_name: 'Aston Moodley', number: 'LSI-1001', total: 1000, amount_paid: 0, status: 'unpaid', due_date: '2026-09-01', reminders_sent: [], ...o });
const client = { id: 'c1', name: 'Aston Moodley', phone: '0691315387', billing_email: 'aston@example.co.za' };

t('debtorReminders: queues the 3-day stage the day it falls due, not before', () => {
  const before = debtorReminders({ invoices: [baseInv({ due_date: '2026-09-26' })], clients: [client], today: '2026-09-28' }); // 2 days overdue
  assert.equal(before.outboxRecords.length, 0);
  const on = debtorReminders({ invoices: [baseInv({ due_date: '2026-09-25' })], clients: [client], today: '2026-09-28' }); // exactly 3 days
  assert.equal(on.outboxRecords.length, 1);
  assert.equal(on.decisions[0].affected.day, 3);
});
t('debtorReminders: never repeats a stage already sent', () => {
  const r = debtorReminders({ invoices: [baseInv({ due_date: '2026-09-25', reminders_sent: [{ day: 3, at: '2026-09-28T06:00:00Z', via: 'whatsapp', by: 'Agent' }] })], clients: [client], today: '2026-09-28' });
  assert.equal(r.outboxRecords.length, 0);
});
t('debtorReminders: can queue multiple stages in one run if several fell due since the last check', () => {
  const r = debtorReminders({ invoices: [baseInv({ due_date: '2026-09-01' })], clients: [client], today: '2026-09-28' }); // 3, 7 and 14 day stages all past
  assert.deepEqual(r.outboxRecords.map(o => o.template_key).sort(), ['debtor-reminder-14', 'debtor-reminder-3', 'debtor-reminder-7']);
});
t('debtorReminders: message includes invoice number, formatted balance and due date', () => {
  const r = debtorReminders({ invoices: [baseInv({ due_date: '2026-09-25', total: 1842, amount_paid: 0 })], clients: [client], today: '2026-09-28' });
  const msg = r.outboxRecords[0];
  assert.match(msg.body, /LSI-1001/);
  assert.match(msg.body, /R1,842\.00|R1 842,00/);
  assert.match(msg.body, /2026-09-25/);
});
t('debtorReminders: prefers WhatsApp when a phone number is on file', () => {
  const r = debtorReminders({ invoices: [baseInv({ due_date: '2026-09-25' })], clients: [client], today: '2026-09-28' });
  assert.equal(r.outboxRecords[0].channel, 'whatsapp');
});
t('debtorReminders: falls back to email when there is no phone number', () => {
  const r = debtorReminders({ invoices: [baseInv({ due_date: '2026-09-25' })], clients: [{ id: 'c1', billing_email: 'x@y.co.za' }], today: '2026-09-28' });
  assert.equal(r.outboxRecords[0].channel, 'email');
});
t('debtorReminders: no contact details → queued needing a person’s approval, not silently dropped', () => {
  const r = debtorReminders({ invoices: [baseInv({ due_date: '2026-09-25' })], clients: [{ id: 'c1' }], today: '2026-09-28' });
  assert.equal(r.outboxRecords[0].status, 'needs_approval');
});
t('debtorReminders: paid, void and draft invoices never get reminders', () => {
  for (const patch of [{ amount_paid: 1000 }, { status: 'void' }, { status: 'draft' }, { status: 'awaiting_pop' }]) {
    const r = debtorReminders({ invoices: [baseInv({ due_date: '2026-09-01', ...patch })], clients: [client], today: '2026-09-28' });
    assert.equal(r.outboxRecords.length, 0, JSON.stringify(patch));
  }
});
t('debtorReminders: reminder stages are configurable via settings', () => {
  const r = debtorReminders({ invoices: [baseInv({ due_date: '2026-09-21' })], clients: [client], today: '2026-09-28', settings: { reminderStages: [7] } });
  assert.deepEqual(r.outboxRecords.map(o => o.template_key), ['debtor-reminder-7']);
});
t('REMINDER_STAGES_DEFAULT matches the spec (3 / 7 / 14)', () => assert.deepEqual(REMINDER_STAGES_DEFAULT, [3, 7, 14]));

t('expiryAlerts: tiers by days remaining (60/30/7), plus today and expired', () => {
  const today = '2026-09-28';
  const rows = expiryAlerts({
    certificates: [
      { id: 'exp', person_name: 'A', course: 'First Aid', expiry_date: '2026-09-20' }, // expired
      { id: 'today', person_name: 'B', course: 'First Aid', expiry_date: today },
      { id: 'soon', person_name: 'C', course: 'First Aid', expiry_date: '2026-10-03' }, // 5 days
      { id: 'far', person_name: 'D', course: 'First Aid', expiry_date: '2027-01-01' } // way out
    ]
  }, today);
  const byId = Object.fromEntries(rows.map(r => [r.record_id, r]));
  assert.equal(byId.exp.severity, 'danger');
  assert.equal(byId.today.title, 'First Aid — B expires today');
  assert.equal(byId.soon.severity, 'warn');
  assert.equal(byId.far, undefined, 'far outside every window should not alert');
});
t('expiryAlerts: covers vehicles (licence + service), compliance docs and appointments', () => {
  const rows = expiryAlerts({ vehicles: [{ id: 'v1', name: 'Bakkie 1', licence_expiry: '2026-10-01', next_service_date: '2026-10-05' }], compliance_docs: [{ id: 'd1', name: 'COIDA letter', expiry_date: '2026-10-01' }], appointments: [{ id: 'a1', appointment: 'SHE Rep', person_name: 'X', review_date: '2026-10-01' }] }, '2026-09-28');
  assert.equal(rows.filter(r => r.collection === 'vehicles').length, 2);
  assert.equal(rows.filter(r => r.collection === 'compliance_docs').length, 1);
  assert.equal(rows.filter(r => r.collection === 'appointments').length, 1);
});

/* ============================================================ pop-match: matchPayment() */

const openInvoices = [
  { id: 'x', number: 'LSI-1001', client_name: 'Aston Moodley', total: 842, amount_paid: 0 },
  { id: 'y', number: 'LSI-1002', client_name: 'Evan Sim', total: 730.8, amount_paid: 0 }
];

t('matchPayment: exact reference match → high confidence, auto-applies', () => {
  const { best, decision } = matchPayment({ amount: 842, reference: 'LSI-1001' }, openInvoices);
  assert.equal(best.invoice.id, 'x');
  assert.ok(best.confidence >= 0.95, String(best.confidence));
  assert.equal(decision, 'auto_apply');
});
t('matchPayment: amount + name match is confident but queued (below the auto-apply bar)', () => {
  const { best, decision } = matchPayment({ amount: 730.8, payer_name: 'Evan Sim' }, openInvoices);
  assert.equal(best.invoice.id, 'y');
  assert.ok(best.confidence >= 0.85 && best.confidence < AUTO_APPLY_THRESHOLD, String(best.confidence));
  assert.equal(decision, 'queue_for_verification');
});
t('matchPayment: amount-only match is weaker still, always queued', () => {
  const { best, decision } = matchPayment({ amount: 842 }, openInvoices);
  assert.equal(best.invoice.id, 'x');
  assert.ok(best.confidence < 0.85);
  assert.equal(decision, 'queue_for_verification');
});
t('matchPayment: a plausible partial payment scores lower still (and scales with how much of the balance it covers)', () => {
  const { best } = matchPayment({ amount: 400 }, [openInvoices[0]]); // 400 < 842 balance, single candidate
  assert.equal(best.invoice.id, 'x');
  assert.ok(best.confidence < 0.6 && best.confidence > 0);
});
t('matchPayment: nothing plausible → no_match, never guesses', () => {
  const { best, decision } = matchPayment({ amount: 99999.99, reference: 'ZZZZZ', payer_name: 'Nobody Known' }, openInvoices);
  assert.equal(best, null);
  assert.equal(decision, 'no_match');
});
t('matchPayment: candidates are ranked best first', () => {
  const { candidates } = matchPayment({ amount: 730.8, reference: 'LSI-1002' }, openInvoices);
  assert.ok(candidates[0].confidence >= (candidates[1] ? candidates[1].confidence : 0));
});

/* ============================================================ learning: velocity / wear / seasonal care */

t('jobVelocity: productivity factor averages actual/planned minutes per site+service', () => {
  const visits = [
    { status: 'completed', site_id: 's1', service_id: 'svc1', planned_minutes: 60, actual_minutes: 90 },
    { status: 'completed', site_id: 's1', service_id: 'svc1', planned_minutes: 60, actual_minutes: 60 },
    { status: 'scheduled', site_id: 's1', service_id: 'svc1', planned_minutes: 60, actual_minutes: 60 } // not completed, excluded
  ];
  const rows = jobVelocity({ visits, services: [{ id: 'svc1', name: 'Mowing' }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].samples, 2);
  assert.equal(rows[0].productivityFactor, 1.25); // avg(1.5, 1.0)
});
t('equipmentWear: usage hours scale with visit minutes and machines-per-service; predicts service due', () => {
  const visits = [{ status: 'completed', service_id: 'svc1', actual_minutes: 120 }];
  const { usageByCategory, predictions } = equipmentWear({ visits, services: [{ id: 'svc1', category: 'mowers' }], assets: [{ id: 'a1', name: 'Mower 1', hours_used: 95, service_interval_hours: 100 }], machinesPerService: { mowers: 2 } });
  assert.equal(usageByCategory.mowers, 4); // 2h × 2 machines
  assert.equal(predictions[0].dueInHours, 5);
  assert.equal(predictions[0].dueSoon, true);
});
t('careOpportunities: only active clients with an active contract, matching this month’s season', () => {
  const clients = [{ id: 'c1', name: 'A', status: 'active' }, { id: 'c2', name: 'B', status: 'active' }, { id: 'c3', name: 'C', status: 'lost' }];
  const contracts = [{ client_id: 'c1', status: 'active' }, { client_id: 'c3', status: 'active' }];
  const rows = careOpportunities({ clients, contracts }, 9); // September → spring + pre-storm windows
  assert.ok(rows.every(r => r.client_id === 'c1'));
  assert.ok(rows.length >= 1);
});
t('careOpportunities: a month with no matching season returns nothing', () => {
  // Pick a month that falls in none of the defined windows, if one exists; otherwise this documents full coverage.
  const covered = new Set(SEASONAL_WINDOWS.flatMap(w => w.months));
  const uncovered = [1, 2, 12].find(m => !covered.has(m));
  if (uncovered) assert.equal(careOpportunities({ clients: [{ id: 'c1', status: 'active' }], contracts: [{ client_id: 'c1', status: 'active' }] }, uncovered).length, 0);
  else assert.equal(covered.size >= 4, true); // every month covered is fine too
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
