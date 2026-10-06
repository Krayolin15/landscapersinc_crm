/* =============================================================================
   Step 08 — link the staff who had logins in the old CRM (their imported
   profiles) to their new Supabase logins, so their history stays theirs.
   Hand-written SQL (not generated from the schema). The people come from the
   data pack (their profiles), so no names live in the code; Admin → Go live
   asks for each person's email and writes the lines that link them.
   ========================================================================== */

const RANK = ['owner', 'admin', 'manager'];
const byRank = (a, b) => ((RANK.indexOf(a.role) + 1 || 99) - (RANK.indexOf(b.role) + 1 || 99)) || String(a.name).localeCompare(String(b.name));
export const EMAIL = /^[^@\s'"\\]+@[^@\s'"\\]+\.[a-z]{2,}$/i;

/** The imported staff who need a login (the data pack's profiles that came with an old-CRM password), owner first. */
export function loginPeople(profiles) {
  return (profiles || []).filter(p => p && p.password_hash && !p.deleted_at).map(p => ({ id: p.id, name: p.name, role: p.role })).sort(byRank);
}
const sqlText = s => `'${String(s).replace(/'/g, "''")}'`;

/**
 * The step 08 SQL. people: loginPeople(<the data pack's profiles>). emails: { <profile id>: 'their email' }.
 * Each person with an email gets a line that links them; everyone else gets a commented-out line with an example
 * address to fill in. With no emails at all, the first person (the owner) has an active example line, as before.
 */
export function linkAccountsSql({ people = [], emails = {} } = {}) {
  const given = id => String(emails[id] || '').trim().toLowerCase();
  for (const p of people) if (given(p.id) && !EMAIL.test(given(p.id))) throw new Error(`"${emails[p.id]}" is not an email address (${p.name})`);
  const anyGiven = people.some(p => given(p.id));
  const idW = Math.max(0, ...people.map(p => sqlText(p.id).length + 1)) + 1;
  const rows = people.map((p, i) => {
    const email = given(p.id) || `${String(p.name).split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'staff'}@example.co.za`;
    return { p, active: anyGiven ? !!given(p.id) : i === 0, call: `select public.link_seed_profile(${(sqlText(p.id) + ',').padEnd(idW)}`, arg: `${sqlText(email)});` };
  });
  const argW = Math.max(0, ...rows.map(r => r.arg.length)) + 3;
  const lines = rows.map(r => `${r.active ? '' : '-- '}${r.call}${r.arg.padEnd(argW)}-- ${r.p.name} · ${r.p.role}`);
  return `-- =============================================================================
-- Landscapers Inc. HQ — link the imported staff accounts to real Supabase logins
-- HAND-WRITTEN (not generated). Run AFTER 01–05 and the private 06_seed.sql.
--
-- Why: the company data pack creates the four staff profiles with ids
-- prof-jared / prof-anthony / prof-renesh / prof-wayne and everything they did
-- (events, tasks, meetings, audit history) points at those ids. A Supabase
-- login has its own id (auth.users.id) and the app finds your profile by that
-- id. This script moves each imported profile onto its login id and updates
-- every reference to it, so history and attribution stay intact.
--
-- ── STEPS ──────────────────────────────────────────────────────────────────
-- 1) Supabase dashboard → Authentication → Users → "Add user" for each person:
--    their email, a temporary password (they must change it on first sign-in),
--    and tick "Auto Confirm User".
-- 2) Admin → Go live writes the lines at the bottom with the emails you type
--    there (or fill them in by hand; leave a line commented out for anyone who
--    does not need a login yet).
-- 3) Run this whole file once in the SQL editor. Each line reports what it did.
--    Re-running is safe: an already-linked person is reported and skipped.
-- 4) Sign in to the app with the owner's email and temporary password and set a
--    new one. Everyone else can then be managed from Admin → Users.
--
-- Safety: the function runs in ONE transaction — if anything fails nothing is
-- changed. User triggers (attribution stamping + audit) are suspended only for
-- the tables it touches and only until the transaction ends, because the
-- attribution trigger would otherwise put the old created_by values straight
-- back. One audit_log row records each link. Only the database owner (SQL
-- editor) can run it — it is revoked from every API role.
-- =============================================================================

create or replace function public.link_seed_profile(p_seed_id text, p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_uid   text;
  v_name  text;
  r       record;
  v_rows  bigint;
  v_total bigint := 0;
  v_tables text[] := '{}';
  v_tbl   text;
begin
  if v_email is null or v_email = '' or v_email like '%@example.%' then
    raise exception 'link_seed_profile(%): fill in the real email address first', p_seed_id;
  end if;

  select id::text into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then
    raise exception 'No Supabase login with email % — create it first (Authentication → Users → Add user)', v_email;
  end if;

  if not exists (select 1 from public.profiles where id = p_seed_id) then
    if exists (select 1 from public.profiles where id = v_uid) then
      return format('%s: already linked to %s — nothing to do', p_seed_id, v_email);
    end if;
    raise exception 'There is no imported profile with id % (has 06_seed.sql been run?)', p_seed_id;
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'The login % already has its own profile (%). Remove that profile first or link a different login.', v_email, v_uid;
  end if;

  select name into v_name from public.profiles where id = p_seed_id;

  -- every column in a public base table that can hold the old id: text, text[] and jsonb
  for r in
    select c.table_name, c.column_name, c.data_type, c.udt_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and (c.data_type in ('text', 'jsonb') or c.udt_name = '_text')
      and c.table_name <> 'audit_log'          -- history is kept as it was written
    order by c.table_name, c.column_name
  loop
    if not (r.table_name = any (v_tables)) then
      execute format('alter table public.%I disable trigger user', r.table_name);
      v_tables := v_tables || r.table_name;
    end if;

    if r.data_type = 'text' then
      execute format('update public.%I set %I = %L where %I = %L', r.table_name, r.column_name, v_uid, r.column_name, p_seed_id);
    elsif r.data_type = 'jsonb' then
      -- only whole JSON string values ("prof-jared"), never a part of a longer string
      execute format('update public.%I set %I = replace(%I::text, %L, %L)::jsonb where %I::text like %L',
        r.table_name, r.column_name, r.column_name, '"' || p_seed_id || '"', '"' || v_uid || '"', r.column_name, '%"' || p_seed_id || '"%');
    else
      execute format('update public.%I set %I = array_replace(%I, %L, %L) where %L = any (%I)',
        r.table_name, r.column_name, r.column_name, p_seed_id, v_uid, p_seed_id, r.column_name);
    end if;
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
  end loop;

  update public.profiles
     set email = v_email, must_change_password = true, status = coalesce(nullif(status, 'invited'), 'active')
   where id = v_uid;

  foreach v_tbl in array v_tables loop
    execute format('alter table public.%I enable trigger user', v_tbl);
  end loop;

  insert into public.audit_log (id, at, user_id, user_name, action, collection, record_id, label, changes, created_by, created_by_name)
  values (gen_random_uuid()::text, now(), v_uid, 'System', 'link_login', 'profiles', v_uid, v_name,
          jsonb_build_object('id', jsonb_build_array(p_seed_id, v_uid), 'email', jsonb_build_array(null, v_email), 'references_updated', v_total),
          null, 'System');

  return format('%s (%s) linked to %s — %s references updated', v_name, p_seed_id, v_email, v_total);
end
$$;

revoke all on function public.link_seed_profile(text, text) from public, anon, authenticated;

-- ── Fill in the real email addresses, then run the file ──────────────────────
` + lines.map(l => l + '\n').join('');
}
