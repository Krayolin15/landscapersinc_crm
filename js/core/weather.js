/* =============================================================================
   Weather — browser entry point. Wraps the pure Open-Meteo core (shared with
   the Edge Function agent, see supabase/functions/_shared/agent/weather.js)
   with a 30-minute IndexedDB cache so a busy schedule page or telemetry chip
   doesn't refetch on every render. Free API, no key required.
   ========================================================================== */

import { idb } from './idb.js';
import { fetchForecast, assess, weatherCodeLabel, WORK_WINDOW_DEFAULT, buildForecastUrl } from '../../supabase/functions/_shared/agent/weather.js';

export { assess, weatherCodeLabel, WORK_WINDOW_DEFAULT, buildForecastUrl };

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const cacheKey = (lat, lng) => `weather:${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;

/**
 * getForecast(lat, lng, { days, force }) -> Open-Meteo JSON, cached 30 min in
 * IndexedDB (per point) so repeated calls (telemetry bar, schedule page,
 * dispatch planning for several suburbs) don't hammer the API.
 */
export async function getForecast(lat, lng, { days = 3, force = false } = {}) {
  const key = cacheKey(lat, lng);
  if (!force) {
    const cached = await idb.kvGet(key).catch(() => null);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  }
  const data = await fetchForecast({ lat, lng, days, fetchImpl: (...a) => fetch(...a) });
  await idb.kvSet(key, { at: Date.now(), data }).catch(() => {});
  return data;
}

/** assess() for a specific calendar date, straight from a cached/fetched forecast. */
export async function assessDay(lat, lng, date, workWindow = WORK_WINDOW_DEFAULT) {
  const data = await getForecast(lat, lng);
  return assess(data.hourly, workWindow, { date });
}

/** Today's assessment plus the next `days-1` days, keyed by ISO date. */
export async function assessDays(lat, lng, days = 3, workWindow = WORK_WINDOW_DEFAULT) {
  const data = await getForecast(lat, lng, { days });
  const dates = [...new Set((data.hourly.time || []).map(t => t.slice(0, 10)))].slice(0, days);
  return Object.fromEntries(dates.map(d => [d, assess(data.hourly, workWindow, { date: d })]));
}
