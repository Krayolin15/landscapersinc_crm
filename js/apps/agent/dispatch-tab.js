/* =============================================================================
   Autonomous Core — "Dispatch plan" and "Weather" tabs.

   The dispatch preview recomputes the SAME planDay() the morning_dispatch job
   applies (supabase/functions/_shared/agent/dispatch.js) against live data —
   it is read-only (nothing here writes to the database); the "Run now"
   buttons on the Overview tab are what actually apply a plan. This lets
   someone check tomorrow's weather-postponements before they happen.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { btn, badge, card, emptyState, skeleton, callout, kpiTile } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { today, addDays } from '../../core/dates.js';
import { isWorkingDay } from '../../core/holidays.js';
import * as fmt from '../../core/format.js';
import { DEPOT, resolveLocation } from '../../core/geo.js';
import { assessDay, weatherCodeLabel } from '../../core/weather.js';
import { agentSettings, enrichedVisits, nextWorkingDates } from '../../agent/adapters.js';
import { planDay, WEATHER_SENSITIVE_KEYWORDS } from '../../../supabase/functions/_shared/agent/dispatch.js';
import { ensureLib } from '../../core/lazy.js';

const RISK_BADGE = { dry: 'green', showers: 'blue', wet: 'gold', storm: 'red', windy: 'violet' };
const RISK_ICON = { dry: 'sun', showers: 'cloud-drizzle', wet: 'cloud-rain', storm: 'cloud-lightning', windy: 'wind' };
const KEY_SUBURBS = ['Mount Edgecombe', 'Sienna Estate', 'Umhlanga', 'La Lucia', 'Durban North', 'Cornubia', 'Westville', 'Kloof', 'Hillcrest', 'Pinetown', 'Verulam', 'Ballito'];

function isWeatherSensitiveText(v) { return /mow|lawn cut|lawn dress|lawn lay|spray|fertilis|fertiliz/i.test(`${v.instructions || ''} ${v.kind || ''}`); }

/** Recompute (read-only) the plan planDay() would produce for `date` from live data. */
export async function computePlanPreview(date) {
  const settings = agentSettings();
  const visits = enrichedVisits(date);
  const candidateDates = nextWorkingDates(date, 5);
  const sensitive = visits.filter(v => v.suburb && isWeatherSensitiveText(v));
  const suburbs = [...new Set(sensitive.map(v => v.suburb))];
  const weatherBySuburb = {};
  for (const suburb of suburbs) {
    const loc = resolveLocation(suburb);
    if (!loc) continue;
    weatherBySuburb[suburb] = {};
    for (const d of [date, ...candidateDates]) {
      try { weatherBySuburb[suburb][d] = await assessDay(loc.lat, loc.lng, d, settings.workWindow); } catch { /* offline */ }
    }
  }
  const crews = db.filter('crews', c => c.active !== false);
  const employees = db.all('employees');
  const vehicles = db.all('vehicles');
  const services = db.all('services');
  const isWeekendOnly = [0, 6].includes(new Date(date + 'T00:00:00').getDay());
  return planDay({
    date, isHoliday: !isWorkingDay(date) && !isWeekendOnly, isWeekend: isWeekendOnly,
    visits, crews, employees, vehicles, services, depot: settings.depot || DEPOT, weatherBySuburb, candidateDates,
    settings: { fuelPriceRandPerLitre: settings.fuelPriceRandPerLitre, defaultFuelL100km: settings.defaultFuelL100km, weatherKeywords: settings.weatherKeywords || WEATHER_SENSITIVE_KEYWORDS }
  });
}

function routeMap(depot, assignments, dispose) {
  const el = h('div.agent-map', { role: 'img', 'aria-label': "Today's crew routes" });
  const located = assignments.some(a => a.visits.some(v => v.lat != null));
  if (!located) { el.replaceChildren(h('div.empty', { style: 'padding:24px' }, h('p.small.muted', 'No mapped stops for this plan yet — site suburbs are not recognised.'))); return el; }
  requestAnimationFrame(async () => {
    try { await ensureLib('leaflet'); } catch { if (el.isConnected) el.replaceChildren(h('div.empty', { style: 'padding:24px' }, h('p.small.muted', 'The map could not load — check your connection.'))); return; }
    if (!window.L || !el.isConnected || !depot || depot.lat == null) return;
    const map = window.L.map(el, { attributionControl: true, scrollWheelZoom: false }).setView([depot.lat, depot.lng], 11);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
    const colors = ['#1f7440', '#1e9bc4', '#c8733a', '#7b61ff', '#e0525e', '#d99a12', '#3ab6d9'];
    const bounds = [[depot.lat, depot.lng]];
    window.L.marker([depot.lat, depot.lng], { title: depot.name || 'Depot' }).addTo(map).bindTooltip(depot.name || 'Depot');
    assignments.forEach((a, i) => {
      const color = colors[i % colors.length];
      const pts = [[depot.lat, depot.lng], ...a.visits.filter(v => v.lat != null).map(v => [v.lat, v.lng])];
      if (pts.length > 1) window.L.polyline(pts, { color, weight: 3, opacity: 0.85 }).addTo(map);
      a.visits.forEach((v, j) => {
        if (v.lat == null) return;
        bounds.push([v.lat, v.lng]);
        window.L.circleMarker([v.lat, v.lng], { radius: 7, color, fillColor: color, fillOpacity: 0.9, weight: 2 }).addTo(map)
          .bindTooltip(`${j + 1}. ${v.site_name || 'Visit'} — ${a.crew.name}`);
      });
    });
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [28, 28] });
    if (dispose) dispose.add(() => map.remove());
  });
  return el;
}

function decisionRow(d) {
  const sevColor = d.status === 'pending' ? 'gold' : d.kind === 'weather_reschedule' ? 'blue' : 'gray';
  return h('div.agent-decision-row',
    badge(d.kind.replace(/_/g, ' '), sevColor),
    h('div', { style: 'flex:1;min-width:0' }, h('div.small', { style: 'font-weight:600' }, d.title), d.detail ? h('div.xs.muted', d.detail) : null),
    d.requires_approval ? badge('needs approval', 'sun') : null);
}

export function dispatchTab(ctx) {
  let date = ctx.query.date && /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.date) ? ctx.query.date : today();
  const wrap = h('div.stack');
  const body = h('div');
  const dateInput = h('input.input', { type: 'date', value: date, style: 'width:auto', onChange: e => { date = e.target.value; load(); } });
  wrap.append(
    h('div.row.wrap.gap-8', { style: 'align-items:center' },
      btn({ icon: 'chevron-left', variant: 'ghost', size: 'sm', onClick: () => { date = addDays(date, -1); dateInput.value = date; load(); } }),
      dateInput,
      btn({ icon: 'chevron-right', variant: 'ghost', size: 'sm', onClick: () => { date = addDays(date, 1); dateInput.value = date; load(); } }),
      btn({ label: 'Today', variant: 'soft', size: 'sm', onClick: () => { date = today(); dateInput.value = date; load(); } }),
      h('div.spacer'),
      h('div.xs.muted', 'Preview only — use "Run now" on Overview to actually apply a plan.')),
    body);

  async function load() {
    body.replaceChildren(skeleton(6));
    try {
      const result = await computePlanPreview(date);
      const totalVisits = result.assignments.reduce((a, x) => a + x.visits.length, 0);
      const totalKm = result.assignments.reduce((a, x) => a + x.km, 0);
      const totalFuel = result.assignments.reduce((a, x) => a + x.fuel_cost, 0);
      if (!result.assignments.length && !result.decisions.length) {
        body.replaceChildren(emptyState({ icon: 'route', title: 'Nothing to plan', text: `No visits are scheduled for ${fmt.date(date, 'long')}.` }));
        return;
      }
      const holidayOrWeekend = !result.assignments.length && result.decisions.some(d => d.kind === 'other' && /No dispatch/.test(d.title));
      body.replaceChildren(h('div.stack',
        holidayOrWeekend ? callout('info', result.decisions[0].title, result.decisions[0].detail, 'calendar-off') : null,
        result.assignments.length ? h('div.grid.cols-3.stagger',
          kpiTile({ label: 'Visits', value: totalVisits, icon: 'route', tile: 't-river' }),
          kpiTile({ label: 'Kilometres', value: totalKm, format: v => v.toFixed(1), icon: 'map', tile: 't-slate' }),
          kpiTile({ label: 'Fuel cost', value: totalFuel, format: 'money', icon: 'fuel', tile: 't-clay' })) : null,
        result.assignments.length ? card({ title: 'Route map', icon: 'map', cls: 'solid' }, routeMap(agentSettings().depot || DEPOT, result.assignments, ctx.dispose)) : null,
        ...result.assignments.map(a => card({ title: a.crew.name, icon: 'users-round', cls: 'solid', sub: `${a.visits.length} visit(s) · ${a.km} km · ${fmt.money(a.fuel_cost)} fuel (${a.fuel_litres} L) · departs ${a.departure}` },
          a.visits.length ? h('div.agent-stop-list', a.visits.map((v, i) => h('div.agent-stop',
            h('span.agent-stop-n', i + 1),
            h('div', { style: 'flex:1;min-width:0' },
              h('div.small', { style: 'font-weight:600' }, v.site_name || 'Visit', v.client_name ? h('span.xs.muted', ` · ${v.client_name}`) : null),
              h('div.xs.muted', [v.suburb, v.start_time && `from ${v.start_time}`, v.finish_by && `by ${v.finish_by}`].filter(Boolean).join(' · ') || 'No fixed time')),
            h('span.xs.muted', v.leg_km ? `+${v.leg_km} km` : ''))))
            : emptyState({ icon: 'route', title: 'No visits assigned', text: 'This crew is free today.' }))),
        result.decisions.length ? card({ title: 'Decisions from this plan', icon: 'sparkles', cls: 'solid' }, h('div.stack.tight', result.decisions.map(decisionRow))) : null));
    } catch (e) {
      body.replaceChildren(callout('danger', 'Could not build the preview', String(e.message || e), 'triangle-alert'));
    }
  }
  load();
  return wrap;
}

export function weatherTab(ctx) {
  void ctx;
  const wrap = h('div.stack', skeleton(4));
  (async () => {
    const rows = [];
    for (const name of KEY_SUBURBS) {
      const loc = resolveLocation(name);
      if (!loc) continue;
      try { rows.push({ name, a: await assessDay(loc.lat, loc.lng, today()) }); }
      catch { rows.push({ name, a: null }); }
    }
    wrap.replaceChildren(
      callout('info', 'Depot forecast', `Mount Edgecombe (${DEPOT.approx ? 'approximate' : 'exact'} coordinates) — the same 3-day forecast used to plan routes and reschedule weather-sensitive work.`, 'cloud-sun'),
      h('div.grid.cols-3.stagger', rows.map(({ name, a }) => card({ title: name, icon: a ? weatherCodeLabel(a.risk === 'storm' ? 95 : a.risk === 'wet' ? 63 : a.risk === 'showers' ? 51 : 0).icon : 'cloud-off', cls: 'solid' },
        a ? h('div.stack.tight',
          h('div.row.gap-8', badge(a.risk, RISK_BADGE[a.risk] || 'gray', { icon: RISK_ICON[a.risk] }), h('span.small', `${a.rainProbMax}% rain`)),
          h('div.small.muted', a.summary),
          a.windMax ? h('div.xs.muted', `Wind to ${a.windMax} km/h`) : null)
          : h('p.small.muted', 'Forecast unavailable (offline?).')))));
  })();
  return wrap;
}
