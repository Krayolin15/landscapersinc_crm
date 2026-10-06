/* =============================================================================
   Landscapers Inc. HQ — settings. The ONLY file you edit to go live.
   -----------------------------------------------------------------------------
   mode: 'local'     Everything runs in this browser (IndexedDB). The full company
                     dataset is loaded on first run. Perfect for trying the system,
                     training staff, or a single office PC. Nothing leaves the device.

   mode: 'supabase'  Production. Shared Postgres database, real per-person logins,
                     Row Level Security, file storage, realtime chat and live updates
                     across every phone and PC. See docs/SETUP-SUPABASE.html.

   The anon key is safe in the browser ONLY because every table has RLS.
   NEVER paste the service_role key anywhere in this project.

   A plain script that index.html loads before the app, so a change here works
   straight away — whether index.html is double-clicked or the app is hosted.
   ========================================================================== */
globalThis.LSI_SETTINGS = {
  mode: 'local',                 // 'local' | 'supabase'
  SUPABASE_URL: '',              // your live project URL, e.g. 'https://abcdefghijklmnopqrst.supabase.co'
  SUPABASE_ANON_KEY: ''          // your public anon/publishable key — never service_role
};
