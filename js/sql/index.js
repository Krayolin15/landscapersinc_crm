/* =============================================================================
   The go-live SQL, step by step. Every step is a function that returns the SQL
   text (js/sql/*.js) — nothing is kept as .sql files. Admin → Go live shows,
   copies and downloads them; tools/gen-sql.js writes them to build/sql/ for psql;
   tools/test-sql.js runs them all in a real Postgres.
   ========================================================================== */
import { schemaSql, rlsSql, triggersSql, storageSql, realtimeSql } from './schema.js';
import { seedSql } from './seed.js';
import { cronSql, PROJECT_REF } from './cron.js';
import { linkAccountsSql, loginPeople, EMAIL } from './link-accounts.js';

export { schemaSql, rlsSql, triggersSql, storageSql, realtimeSql, seedSql, cronSql, linkAccountsSql, loginPeople, PROJECT_REF, EMAIL };

/**
 * In order. needs: what the step must be given — null (nothing), 'pack' (the data pack: seedSql(pack)),
 * 'ref' (cronSql({ projectRef })), 'emails' (linkAccountsSql({ people, emails })). private: holds company data.
 */
export const STEPS = [
  { id: '01', file: '01_schema.sql', title: 'Tables', text: 'Every table (all record types), their checks and indexes, and the role helper functions.', sql: schemaSql, needs: null },
  { id: '02', file: '02_rls.sql', title: 'Security rules', text: 'Row Level Security on every table: who can read and change what. Sensitive columns only for the roles allowed.', sql: rlsSql, needs: null },
  { id: '03', file: '03_triggers.sql', title: 'Who and when', text: 'Every change stamped with who made it (cannot be faked), the audit log, profile protection, form-response categories.', sql: triggersSql, needs: null },
  { id: '04', file: '04_storage.sql', title: 'File storage', text: 'The private drive and avatars storage buckets and their access rules.', sql: storageSql, needs: null },
  { id: '05', file: '05_realtime.sql', title: 'Live updates', text: 'Changes appear on every phone and PC straight away.', sql: realtimeSql, needs: null },
  { id: '06', file: '06_seed.sql', title: 'Company data', text: 'Every record of the data pack, in one transaction. About 4 MB: run it with psql (too big for the dashboard editor).', sql: seedSql, needs: 'pack', private: true },
  { id: '07', file: '07_cron.sql', title: 'The 24/7 schedule', text: 'The agent at 05:00 and 05:30 every day and hourly in working hours, even when nobody has the app open.', sql: cronSql, needs: 'ref' },
  { id: '08', file: '08_link_accounts.sql', title: 'Link staff logins', text: 'Moves each imported staff profile onto its new Supabase login, so their history stays theirs.', sql: linkAccountsSql, needs: 'emails' }
];
