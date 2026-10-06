/* =============================================================================
   Step 07 — the 24/7 schedule: pg_cron calls the agent-run Edge Function at
   05:00 and 05:30 SAST and hourly through the working day. Hand-written SQL
   (not generated from the schema); Admin → Go live fills in the project ref.
   ========================================================================== */

/** A Supabase project ref: the 20 lowercase letters in https://<ref>.supabase.co */
export const PROJECT_REF = /^[a-z]{20}$/;

/** The step 07 SQL. projectRef: your project's ref — left as the <PROJECT_REF> placeholder when not given. */
export function cronSql({ projectRef = '' } = {}) {
  const ref = String(projectRef || '').trim();
  if (ref && !PROJECT_REF.test(ref)) throw new Error(`"${ref}" is not a Supabase project ref — it is the 20 lowercase letters in your project address (https://<ref>.supabase.co).`);
  const refLine = ref
    ? `  v_project_ref text := '${ref}';  -- your Supabase project ref\n`
    : "  v_project_ref text := '<PROJECT_REF>';           -- ← replace with your Supabase project ref\n";
  return `-- =============================================================================
-- Landscapers Inc. HQ — 24/7 autonomous agent scheduling (pg_cron + pg_net)
-- HAND-WRITTEN in js__sql__cron.js (not generated from the schema). Admin → Go live, step 07.
--
-- What this does: every scheduled job below is just an HTTP POST, from inside
-- Postgres, to the agent-run Edge Function (supabase/functions/agent-run).
-- The Edge Function does the real work (weather-aware dispatch, briefings,
-- debtor reminders, expiry watch) and writes agent_runs / agent_decisions /
-- briefings / outbox — exactly the same shared logic
-- (supabase/functions/_shared/agent/*.js) the in-browser agent runs when the
-- app is open. This is what makes the agent run 24/7 even when nobody is
-- logged in — see js__apps__agent__index.js "How the agent runs" card.
--
-- ── ONE-TIME SETUP (run this file's statements in the Supabase SQL editor,
--    or via \`supabase db push\` / the CLI, against your project) ─────────────
--
-- 1) Enable the two extensions used to schedule + call HTTP from SQL.
--    (Supabase projects can also enable these from Database → Extensions.)
--
-- 2) Store the shared secret the function checks (\`x-cron-secret\`) in
--    Supabase Vault rather than pasting it into this file:
--      select vault.create_secret('<a long random string>', 'agent_cron_secret');
--    Generate the random string yourself, e.g. \`openssl rand -hex 32\`.
--    The SAME value must be set as the Edge Function's CRON_SECRET env var:
--      supabase secrets set CRON_SECRET=<the same long random string>
--
-- 3) Your project's ref goes in v_project_ref below: Admin → Go live fills
--    it in when you type it there (it is the 20 letters in your project
--    address https://<ref>.supabase.co, also under Project Settings → General).
--    Otherwise replace <PROJECT_REF> below by hand.
--
-- 4) Run this whole file once. Re-running it is safe — cron.schedule() with
--    an existing job name updates that job in place.
--
-- Times are given in UTC (pg_cron always runs in UTC) with the matching SAST
-- (UTC+2, no daylight saving) time noted alongside — South Africa has no DST
-- so this offset never changes.
-- =============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Small helper so every scheduled call shares one place to get the URL +
-- secret right — edit PROJECT_REF here once instead of four times below.
create or replace function public.agent_cron_call(job_name text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
` + refLine + `  v_url text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'agent_cron_secret';
  if v_secret is null then
    raise warning 'agent_cron_call(%): no agent_cron_secret in Vault — run select vault.create_secret(...) first (see step 07 in Admin → Go live).', job_name;
    return;
  end if;
  v_url := 'https://' || v_project_ref || '.supabase.co/functions/v1/agent-run';
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('job', job_name),
    timeout_milliseconds := 60000
  ) into v_request_id;
end;
$$;
-- Only pg_cron (running as the database owner) may fire the agent. Without this, anyone holding the public
-- anon key could call /rest/v1/rpc/agent_cron_call and trigger debtor reminders over and over.
revoke all on function public.agent_cron_call(text) from public, anon, authenticated;

-- Remove any previous versions of these jobs before (re)scheduling — makes
-- this file safe to re-run after changing a time or adding a job.
select cron.unschedule(jobid) from cron.job where jobname in
  ('agent-morning-dispatch', 'agent-executive-briefing', 'agent-payment-reminders', 'agent-expiry-watch');

-- 05:00 SAST (03:00 UTC) — plan today's crew routes, apply weather postponements.
select cron.schedule('agent-morning-dispatch', '0 3 * * *', $$ select public.agent_cron_call('morning_dispatch'); $$);

-- 05:30 SAST (03:30 UTC) — compose the executive briefing (after dispatch has run).
select cron.schedule('agent-executive-briefing', '30 3 * * *', $$ select public.agent_cron_call('executive_briefing'); $$);

-- Hourly, 07:00–18:00 SAST (05:00–16:00 UTC) — debtor reminders (3/7/14 days
-- overdue) and expiry watch (certificates, medicals, licences, compliance
-- docs). Both are idempotent — see js__apps__agent__index.js — so an hourly
-- re-check just keeps them current rather than repeating anything already sent.
select cron.schedule('agent-payment-reminders', '0 5-16 * * *', $$ select public.agent_cron_call('payment_reminders'); $$);
select cron.schedule('agent-expiry-watch', '15 5-16 * * *', $$ select public.agent_cron_call('expiry_watch'); $$);

-- To check what's scheduled:      select jobname, schedule, active from cron.job;
-- To see recent run results:      select * from cron.job_run_details order by start_time desc limit 20;
-- To pause a job without deleting it: select cron.alter_job(job_id, active => false) from cron.job where jobname = '...';
`;
}
