/* =============================================================================
   Geo — browser entry point. This is a thin re-export of the pure shared
   module in supabase/functions/_shared/agent/geo.js so the web app and the
   Supabase Edge Function agent use exactly the same suburb coordinates and
   the same distance / routing math (one source of truth, no drift).
   See that file for SUBURBS, DEPOT, resolveLocation, haversineKm,
   nearestNeighbourRoute, twoOptImprove, optimiseRoute and clusterByDistance.
   ========================================================================== */
export * from '../../supabase/functions/_shared/agent/geo.js';
