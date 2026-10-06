/* =============================================================================
   Landscapers Inc. HQ — configuration.
   -----------------------------------------------------------------------------
   To go live you edit js/settings.js, not this file: mode ('local' or
   'supabase'), the Supabase URL and the anon key come from there (a plain
   script index.html loads first, so the change works without rebuilding the
   double-click version). Everything else here is fixed for the company.
   ========================================================================== */

const SETTINGS = (typeof globalThis !== 'undefined' && globalThis.LSI_SETTINGS) || {};

export const CONFIG = {
  mode: SETTINGS.mode === 'supabase' ? 'supabase' : 'local',
  SUPABASE_URL: String(SETTINGS.SUPABASE_URL || '').trim(),
  SUPABASE_ANON_KEY: String(SETTINGS.SUPABASE_ANON_KEY || '').trim(),

  appName: 'Landscapers Inc. HQ',
  shortName: 'LSI HQ',
  tagline: 'Transforming your outdoor space, one garden at a time.',
  timezone: 'Africa/Johannesburg',
  locale: 'en-ZA',
  currency: 'ZAR',

  // Money display: 'R9,000.00' (default, matches company invoices) or 'R 9 000,00' (SANS style)
  moneyStyle: 'business',
  vatRate: 0.15,                 // South African VAT rate. Only applied when the company is VAT registered (Admin → Company).

  // Session security
  idleTimeoutMinutes: 45,
  rememberDeviceDays: 14,

  // Local-mode storage
  dbName: 'landscapers-hq',
  dbVersion: 1,
  storagePrefix: 'lsihq.',

  // Supabase Edge Functions (deployed from /supabase/functions). Leave as-is.
  functions: {
    sendEmail: 'send-email',
    assistant: 'ai-assistant',
    adminUsers: 'admin-users'
  },

  // Storage buckets (created by step 04 of the go-live SQL, js/sql/schema.js)
  buckets: { drive: 'drive', avatars: 'avatars' },

  // Video meetings (Meet app). Jitsi is free and needs no account.
  meetBaseUrl: 'https://meet.jit.si/',

  // Reminder engine
  reminderTickSeconds: 30,
  defaultEventReminders: [30, 1440], // minutes before: 30 min and 1 day

  // Machine learning
  ml: { seed: 20260923, testSize: 0.25, retrainAfterNewRecords: 10, retrainEveryDays: 7 }
};

export const IS_SUPABASE = () => CONFIG.mode === 'supabase' && !!CONFIG.SUPABASE_URL && !!CONFIG.SUPABASE_ANON_KEY;
