/* =============================================================================
   Weather — free, no-key Open-Meteo forecast, assessed for landscaping work.

   PURE MODULE: no DOM, no Deno APIs, no npm imports. IO (the network fetch) is
   injected via a parameter so this file runs identically in the browser
   (js/core/weather.js wraps it with IndexedDB caching) and in the Supabase
   Edge Function (agent-run) which calls fetchForecast() with Deno's own fetch.
   ========================================================================== */

export const WORK_WINDOW_DEFAULT = { start: '07:00', end: '16:00' };

const HOURLY_FIELDS = 'precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,temperature_2m,weather_code';
const DAILY_FIELDS = 'precipitation_sum,precipitation_probability_max,wind_speed_10m_max,temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset';

/** Build the Open-Meteo forecast URL for a point (no API key required). */
export function buildForecastUrl(lat, lng, days = 3) {
  const params = new URLSearchParams({
    latitude: String(lat), longitude: String(lng),
    hourly: HOURLY_FIELDS, daily: DAILY_FIELDS,
    timezone: 'Africa/Johannesburg', forecast_days: String(days)
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

/**
 * fetchForecast({ lat, lng, days, fetchImpl }) -> Open-Meteo JSON.
 * `fetchImpl` is injectable (tests pass a stub); defaults to the runtime's
 * global fetch, which exists natively in both the browser and Deno.
 */
export async function fetchForecast({ lat, lng, days = 3, fetchImpl } = {}) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) throw new Error('No fetch implementation available for weather — pass { fetchImpl }');
  const res = await f(buildForecastUrl(lat, lng, days));
  if (!res || !res.ok) throw new Error(`Open-Meteo request failed${res ? `: ${res.status}` : ''}`);
  return res.json();
}

const WMO_LABELS = {
  0: ['Clear sky', 'sun'], 1: ['Mainly clear', 'sun'], 2: ['Partly cloudy', 'cloud-sun'], 3: ['Overcast', 'cloud'],
  45: ['Fog', 'cloud-fog'], 48: ['Rime fog', 'cloud-fog'],
  51: ['Light drizzle', 'cloud-drizzle'], 53: ['Drizzle', 'cloud-drizzle'], 55: ['Dense drizzle', 'cloud-drizzle'],
  56: ['Freezing drizzle', 'cloud-drizzle'], 57: ['Freezing drizzle', 'cloud-drizzle'],
  61: ['Light rain', 'cloud-rain'], 63: ['Rain', 'cloud-rain'], 65: ['Heavy rain', 'cloud-rain-wind'],
  66: ['Freezing rain', 'cloud-rain'], 67: ['Freezing rain', 'cloud-rain'],
  71: ['Light snow', 'snowflake'], 73: ['Snow', 'snowflake'], 75: ['Heavy snow', 'snowflake'], 77: ['Snow grains', 'snowflake'],
  80: ['Light showers', 'cloud-drizzle'], 81: ['Showers', 'cloud-rain'], 82: ['Violent showers', 'cloud-rain-wind'],
  85: ['Snow showers', 'snowflake'], 86: ['Heavy snow showers', 'snowflake'],
  95: ['Thunderstorm', 'cloud-lightning'], 96: ['Thunderstorm, hail', 'cloud-lightning'], 99: ['Severe thunderstorm', 'cloud-lightning']
};
const THUNDER_CODES = new Set([95, 96, 99]);

/** WMO weather code -> { label, icon (a Lucide icon name) }. */
export function weatherCodeLabel(code) {
  const hit = WMO_LABELS[code];
  return hit ? { label: hit[0], icon: hit[1] } : { label: 'Unknown', icon: 'cloud' };
}

const round1 = v => Math.round(v * 10) / 10;

/**
 * assess(hourly, workWindow, { date }) -> { risk, rainProbMax, rainMm, windMax, worstHour, summary }
 * hourly: Open-Meteo's `hourly` block ({ time:[...ISO], precipitation_probability:[...], ... }).
 * workWindow: { start:'07:00', end:'16:00' } — only hours in this range (on `date`, or the
 * first date present in `hourly.time` when `date` is omitted) are considered.
 *
 * Thresholds (spec): storm = thunderstorm code or gusts >= 60 km/h; wet = rain
 * probability >= 70% AND >= 2mm in the window, OR >= 5mm regardless of probability;
 * windy = sustained/gust wind >= 40 km/h; otherwise showers (some rain chance) or dry.
 */
export function assess(hourly, workWindow = WORK_WINDOW_DEFAULT, opts = {}) {
  const times = (hourly && hourly.time) || [];
  const date = opts.date || (times[0] || '').slice(0, 10);
  const idxs = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (!t || !t.startsWith(date)) continue;
    const hhmm = t.slice(11, 16);
    if (hhmm >= workWindow.start && hhmm < workWindow.end) idxs.push(i);
  }
  const col = key => idxs.map(i => (hourly[key] && hourly[key][i] != null ? hourly[key][i] : null));
  const probs = col('precipitation_probability'), rains = col('precipitation'), winds = col('wind_speed_10m'), gusts = col('wind_gusts_10m'), codes = col('weather_code'), temps = col('temperature_2m');

  const rainProbMax = probs.some(v => v != null) ? Math.max(...probs.filter(v => v != null)) : 0;
  const rainMm = round1(rains.filter(v => v != null).reduce((a, b) => a + b, 0));
  const windSustainedMax = winds.some(v => v != null) ? Math.max(...winds.filter(v => v != null)) : 0;
  const gustMax = gusts.some(v => v != null) ? Math.max(...gusts.filter(v => v != null)) : 0;
  const windMax = Math.round(Math.max(windSustainedMax, gustMax));
  const isThunder = codes.some(c => c != null && THUNDER_CODES.has(c));
  const maxTemp = temps.some(v => v != null) ? Math.round(Math.max(...temps.filter(v => v != null))) : null;

  let risk;
  if (isThunder || gustMax >= 60) risk = 'storm';
  else if ((rainProbMax >= 70 && rainMm >= 2) || rainMm >= 5) risk = 'wet';
  else if (windMax >= 40) risk = 'windy';
  else if (rainProbMax >= 30 || rainMm > 0) risk = 'showers';
  else risk = 'dry';

  let worstHour = null, bestScore = -Infinity;
  idxs.forEach((globalI, k) => {
    const score = (probs[k] || 0) + (gusts[k] || 0) / 2 + (rains[k] || 0) * 5;
    if (score > bestScore) { bestScore = score; worstHour = times[globalI].slice(11, 16); }
  });

  const summary = summarise({ risk, rainProbMax, rainMm, windMax, worstHour, maxTemp });
  return { risk, rainProbMax, rainMm, windMax, worstHour, summary };
}

function summarise({ risk, rainProbMax, rainMm, windMax, worstHour, maxTemp }) {
  const parts = [];
  if (risk === 'dry') parts.push('Dry — good working conditions');
  else if (risk === 'showers') parts.push(`Chance of showers (${rainProbMax}%${rainMm ? `, ${rainMm}mm` : ''})`);
  else if (risk === 'wet') parts.push(`Wet — ${rainProbMax}% chance of rain, ${rainMm}mm expected`);
  else if (risk === 'storm') parts.push('Thunderstorm risk');
  else if (risk === 'windy') parts.push(`Windy — gusts to ${windMax} km/h`);
  if (worstHour && risk !== 'dry') parts.push(`worst around ${worstHour}`);
  if (windMax >= 30 && risk !== 'windy' && risk !== 'storm') parts.push(`wind to ${windMax} km/h`);
  if (maxTemp != null) parts.push(`${maxTemp}°C max`);
  return parts.join(' · ');
}
