/* =============================================================================
   Geo — approximate coordinates for the Durban-area suburbs/estates Landscapers
   Inc. services, plus pure distance & routing math (haversine, nearest-neighbour
   + 2-opt, simple distance clustering).

   PURE MODULE: no DOM, no Deno APIs, no npm imports. Runs unchanged in the
   browser (imported by js/core/geo.js) and in the Supabase Edge Function
   (supabase/functions/agent-run) so both sides plan routes identically.

   Coordinates are hand-estimated town/estate centres (not surveyed GPS points)
   — every entry carries approx:true and they exist only to support weather
   look-ups and rough route ordering. Never present them as exact addresses.
   ========================================================================== */

/** The company depot — Landscapers Inc., Block 1B Kingfisher Office Park, Mount Edgecombe. */
export const DEPOT = { name: 'Depot — Kingfisher Office Park, Mount Edgecombe', lat: -29.6975, lng: 31.0433, approx: true };

/**
 * Approximate centre points for suburbs / estates mentioned in the company's
 * client and site records. Grouped roughly north (uMhlanga/North Coast) to
 * south/west (Pinetown/Hillcrest/Kloof corridor).
 */
export const SUBURBS = {
  'Mount Edgecombe': { lat: -29.6975, lng: 31.0433 },
  'Sienna Estate': { lat: -29.6829, lng: 31.0089 },
  'Carron Glen Estate': { lat: -29.6774, lng: 31.0012 },
  'The Kindlewood Estate': { lat: -29.7195, lng: 31.0631 },
  'The Kindles': { lat: -29.7195, lng: 31.0631 },
  Forestclay: { lat: -29.6706, lng: 30.9958 },
  'Campbells Town': { lat: -29.6591, lng: 30.9814 },
  Umhlanga: { lat: -29.7273, lng: 31.0854 },
  'La Lucia': { lat: -29.7658, lng: 31.0503 },
  'Durban North': { lat: -29.7955, lng: 31.0257 },
  'Glen Anil': { lat: -29.7616, lng: 31.0271 },
  'Somerset Park': { lat: -29.7737, lng: 31.0169 },
  Sparks: { lat: -29.8464, lng: 31.0025 },
  Berea: { lat: -29.8393, lng: 31.0018 },
  'Durban Central': { lat: -29.8587, lng: 31.0218 },
  Verulam: { lat: -29.6392, lng: 31.0561 },
  Ballito: { lat: -29.5389, lng: 31.2141 },
  Zimbali: { lat: -29.4917, lng: 31.2214 },
  Umdloti: { lat: -29.6167, lng: 31.1167 },
  Westville: { lat: -29.8318, lng: 30.9247 },
  Kloof: { lat: -29.7853, lng: 30.8508 },
  Hillcrest: { lat: -29.7833, lng: 30.7667 },
  Pinetown: { lat: -29.8149, lng: 30.8707 },
  Broadlands: { lat: -29.7559, lng: 30.7459 },
  Cornubia: { lat: -29.6764, lng: 31.0206 },
  Izinga: { lat: -29.7423, lng: 31.0578 },
  'Merrick Hills': { lat: -29.7512, lng: 31.0452 }
};

const normKey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const SUBURB_LOOKUP = new Map(Object.keys(SUBURBS).map(k => [normKey(k), k]));

/**
 * Fuzzy-resolve free text (a site's suburb / estate / address / region field)
 * to a known suburb centre. Exact name match first, then "text contains
 * suburb name" / "suburb name contains text", longest match wins.
 * Returns { name, lat, lng, approx:true } or null if nothing recognisable.
 */
export function resolveLocation(text) {
  const q = normKey(text);
  if (!q) return null;
  const exact = SUBURB_LOOKUP.get(q);
  if (exact) return { name: exact, ...SUBURBS[exact], approx: true };
  let best = null, bestLen = 0;
  for (const [key, name] of SUBURB_LOOKUP) {
    if (q.includes(key) || key.includes(q)) {
      const len = key.length;
      if (len > bestLen) { bestLen = len; best = name; }
    }
  }
  return best ? { name: best, ...SUBURBS[best], approx: true } : null;
}

/** Great-circle distance in km between two {lat,lng} points. */
export function haversineKm(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return 0;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s1), Math.sqrt(1 - s1));
}

/** Total distance of start -> points[0] -> points[1] -> ... (km). */
export function routeDistanceKm(start, points) {
  let d = 0, from = start;
  for (const p of points) { d += haversineKm(from, p); from = p; }
  return d;
}

/**
 * Greedy nearest-neighbour route from `start` through `points` (each needs
 * .lat/.lng — points without both are left out; append them separately).
 * Deterministic: ties broken by original array order. Returns a NEW array
 * (the points, reordered) — `start` itself is not included in the result.
 */
export function nearestNeighbourRoute(start, points) {
  const remaining = points.slice();
  const order = [];
  let from = start;
  while (remaining.length) {
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(from, remaining[i]);
      if (d < bestD - 1e-9) { bestD = d; bestI = i; }
    }
    const [next] = remaining.splice(bestI, 1);
    order.push(next);
    from = next;
  }
  return order;
}

/**
 * 2-opt local-search improvement over a nearest-neighbour route: repeatedly
 * reverses a segment when doing so shortens the total start->...->end path.
 * Deterministic and bounded (stops when no improving swap is found).
 */
export function twoOptImprove(start, points, { maxPasses = 25 } = {}) {
  let route = points.slice();
  if (route.length < 3) return route;
  let improved = true, passes = 0;
  while (improved && passes < maxPasses) {
    improved = false; passes++;
    for (let i = 0; i < route.length - 1; i++) {
      for (let k = i + 1; k < route.length; k++) {
        const before = routeDistanceKm(start, route);
        const next = route.slice(0, i).concat(route.slice(i, k + 1).reverse(), route.slice(k + 1));
        const after = routeDistanceKm(start, next);
        if (after + 1e-9 < before) { route = next; improved = true; }
      }
    }
  }
  return route;
}

/** Nearest-neighbour route, then 2-opt polish. Points without coords are appended, unmoved, at the end. */
export function optimiseRoute(start, points) {
  const located = points.filter(p => p && p.lat != null && p.lng != null);
  const unlocated = points.filter(p => !(p && p.lat != null && p.lng != null));
  const nn = nearestNeighbourRoute(start, located);
  return twoOptImprove(start, nn).concat(unlocated);
}

/**
 * Group points into clusters where every point is within `maxKm` of at least
 * one other point already in its cluster (connected-components on a
 * distance graph). Deterministic order (first-seen order of `points`).
 */
export function clusterByDistance(points, maxKm) {
  const n = points.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (points[i] && points[j] && points[i].lat != null && points[j].lat != null && haversineKm(points[i], points[j]) <= maxKm) union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(points[i]);
  }
  return Array.from(groups.values());
}
