-- Voice Notes database setup. Safe to run more than once; run it again to pick up later fixes.
-- Run in the Supabase SQL editor of the project that belongs to this app.
-- Paste this whole file (its last line ends "order by u.created_at;") and run it with nothing
-- highlighted. A complete run ends with a table of users; your account shows is_owner = true
-- once the app has been opened (or straight away, when it is the only account).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------- tables
create table if not exists public.recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  started_at timestamptz not null,
  time_zone text not null,
  duration_ms integer,
  storage_path text,
  mime_type text,
  bytes bigint,
  part integer not null default 1,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'transcribing', 'transcribed', 'extracting', 'ready', 'failed')),
  failed_step text check (failed_step in ('transcribing', 'extracting')),
  attempts integer not null default 0,
  locked_until timestamptz,
  last_error text,
  aai_transcript_id text,
  speakers integer,
  model_override text check (model_override in ('best')),
  model_used text,
  input_tokens integer,
  output_tokens integer,
  llm_cost_usd numeric(10, 5),
  stt_cost_usd numeric(10, 5),
  title text,
  summary text,
  confidence text,
  ready_at timestamptz,
  audio_deleted_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fts tsvector generated always as (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, ''))) stored
);
-- Trash: a deleted recording is kept for 30 days so it can be restored.
alter table public.recordings add column if not exists deleted_at timestamptz;
-- Folders: a conversation can be filed in one folder. Deleting a folder leaves its conversations unfiled.
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now()
);
alter table public.recordings add column if not exists folder_id uuid references public.folders (id) on delete set null;
create index if not exists recordings_folder on public.recordings (folder_id);
create index if not exists recordings_user_started on public.recordings (user_id, started_at desc);
create index if not exists recordings_status on public.recordings (status);
create index if not exists recordings_fts on public.recordings using gin (fts);

create table if not exists public.utterances (
  id bigint generated always as identity primary key,
  recording_id uuid not null references public.recordings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  idx integer not null,
  speaker text not null,
  start_ms integer not null,
  end_ms integer not null,
  text text not null,
  fts tsvector generated always as (to_tsvector('english', text)) stored,
  unique (recording_id, idx)
);
create index if not exists utterances_fts on public.utterances using gin (fts);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid references public.recordings (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null check (type in ('todo', 'reminder')),
  text text not null,
  due_at timestamptz,
  due_local text,
  said text,
  quote text,
  at_ms integer,
  state text not null default 'active' check (state in ('suggested', 'active', 'done', 'dismissed')),
  needs_review boolean not null default false,
  notified_at timestamptz,
  notified_via text,
  apple_sent_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  fts tsvector generated always as (to_tsvector('english', text)) stored
);
create index if not exists items_user_state on public.items (user_id, state);
create index if not exists items_due on public.items (due_at) where type = 'reminder' and state = 'active' and notified_at is null;
create index if not exists items_fts on public.items using gin (fts);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  model_mode text not null default 'auto' check (model_mode in ('auto', 'best', 'cheapest')),
  apple_reminders boolean not null default false,
  time_zone text,
  updated_at timestamptz not null default now()
);

create table if not exists public.llm_runs (
  id bigint generated always as identity primary key,
  recording_id uuid not null references public.recordings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  model text not null,
  reason text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  cost_usd numeric(10, 5) not null,
  confidence text,
  created_at timestamptz not null default now()
);

-- Server-only: no policies, so only the service role can read or write.
create table if not exists public.selftest_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  done boolean not null default false,
  report jsonb not null default '{}'::jsonb
);

create schema if not exists private;
create table if not exists private.app_config (
  id boolean primary key default true check (id),
  tick_secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  app_url text,
  scheduler_last_run_at timestamptz,
  last_tick_at timestamptz,
  last_tick_source text
);
insert into private.app_config (id) values (true) on conflict do nothing;
-- The one account this app serves. The server saves it from OWNER_USER_ID each time the app opens
-- (set_owner, below). When the project has exactly one account, it is filled in here straight away.
alter table private.app_config add column if not exists owner_id uuid;
update private.app_config set owner_id = (select id from auth.users limit 1)
 where id and owner_id is null and (select count(*) from auth.users) = 1;

-- True only for the owner's account. Every rule below requires it, so any other account
-- (one created if sign-ups were ever switched on, say) can read and write nothing.
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.app_config where id and owner_id = (select auth.uid()));
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- ---------------------------------------------------------------- row-level security
alter table public.recordings enable row level security;
alter table public.utterances enable row level security;
alter table public.items enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.settings enable row level security;
alter table public.llm_runs enable row level security;
alter table public.selftest_runs enable row level security;
alter table public.folders enable row level security;

do $$
declare t text;
begin
  foreach t in array array['recordings', 'items', 'push_subscriptions', 'settings', 'folders'] loop
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format(
      'create policy own_rows on public.%I for all to authenticated using (user_id = (select auth.uid()) and (select public.is_owner())) with check (user_id = (select auth.uid()) and (select public.is_owner()))', t);
  end loop;
  foreach t in array array['utterances', 'llm_runs'] loop
    execute format('drop policy if exists own_rows_read on public.%I', t);
    execute format(
      'create policy own_rows_read on public.%I for select to authenticated using (user_id = (select auth.uid()) and (select public.is_owner()))', t);
  end loop;
end $$;

revoke all on all tables in schema public from anon;
revoke all on schema private from anon, authenticated;

-- The phone may set only these columns of a recording. Status, transcript ids, costs, dates and the
-- rest are the server's: the background worker trusts them, so a client must not be able to change them.
revoke insert, update on public.recordings from authenticated;
grant insert (id, user_id, started_at, time_zone, duration_ms, storage_path, mime_type, bytes, part, folder_id)
  on public.recordings to authenticated;
grant update (folder_id, deleted_at) on public.recordings to authenticated;
-- A new recording can only point at a file in the owner's own folder.
drop policy if exists own_audio_path on public.recordings;
create policy own_audio_path on public.recordings as restrictive for insert to authenticated
  with check (storage_path is null or storage_path like (select auth.uid())::text || '/%');

-- ---------------------------------------------------------------- private audio bucket
insert into storage.buckets (id, name, public, file_size_limit)
values ('audio', 'audio', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists audio_own_files on storage.objects;
create policy audio_own_files on storage.objects for all to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.is_owner()))
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.is_owner()));

-- ---------------------------------------------------------------- worker functions (service role only)
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists recordings_touch on public.recordings;
create trigger recordings_touch before update on public.recordings
  for each row execute function public.touch_updated_at();

-- One worker gets the row. A second caller at the same moment gets nothing.
create or replace function public.claim_recording() returns setof public.recordings
language sql security definer set search_path = '' as $$
  update public.recordings r
     set status = case r.status when 'uploaded' then 'transcribing' when 'transcribed' then 'extracting' else r.status end,
         attempts = r.attempts + 1,
         locked_until = now() + interval '6 minutes'
   where r.id = (
     select id from public.recordings
      where attempts < 3
        and (status in ('uploaded', 'transcribed')
             or (status = 'extracting' and locked_until < now())
             or (status = 'transcribing' and aai_transcript_id is null and locked_until < now()))
      order by created_at
      for update skip locked
      limit 1)
  returning r.*;
$$;

-- Recordings waiting on the speech service: take a short lock so two ticks do not poll the same one.
create or replace function public.claim_poll() returns setof public.recordings
language sql security definer set search_path = '' as $$
  update public.recordings r
     set locked_until = now() + interval '2 minutes'
   where r.id in (
     select id from public.recordings
      where status = 'transcribing' and aai_transcript_id is not null
        and (locked_until is null or locked_until < now())
      order by created_at
      for update skip locked
      limit 5)
  returning r.*;
$$;

-- A step that crashed three times stops here and shows Retry.
create or replace function public.sweep_stuck() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.recordings
     set failed_step = status, status = 'failed', locked_until = null,
         last_error = coalesce(last_error, 'The step timed out three times.')
   where attempts >= 3 and locked_until < now()
     and (status = 'extracting' or (status = 'transcribing' and aai_transcript_id is null));
  get diagnostics n = row_count;
  return n;
end $$;

-- Marks due reminders as notified and returns them, so each is sent once.
create or replace function public.claim_due_reminders() returns setof public.items
language sql security definer set search_path = '' as $$
  update public.items i
     set notified_at = now()
   where i.id in (
     select id from public.items
      where type = 'reminder' and state = 'active' and due_at <= now()
        and notified_at is null and apple_sent_at is null
        and not exists (select 1 from public.recordings r where r.id = items.recording_id and r.deleted_at is not null)
      for update skip locked
      limit 20)
  returning i.*;
$$;

create or replace function public.verify_tick_secret(p_secret text) returns boolean
language sql security definer set search_path = '' as $$
  select exists (select 1 from private.app_config where tick_secret = p_secret);
$$;

create or replace function public.set_app_url(p_url text) returns void
language sql security definer set search_path = '' as $$
  update private.app_config set app_url = p_url where app_url is distinct from p_url;
$$;

create or replace function public.set_owner(p_owner uuid) returns void
language sql security definer set search_path = '' as $$
  update private.app_config set owner_id = p_owner where id and owner_id is distinct from p_owner;
$$;

create or replace function public.note_tick(p_source text) returns void
language sql security definer set search_path = '' as $$
  update private.app_config set last_tick_at = now(), last_tick_source = p_source where id;
$$;

create or replace function public.scheduler_state() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'app_url', c.app_url,
    'scheduler_last_run_at', c.scheduler_last_run_at,
    'last_tick_at', c.last_tick_at,
    'last_tick_source', c.last_tick_source,
    'cron_job', (select jsonb_build_object('schedule', j.schedule, 'active', j.active)
                   from cron.job j where j.jobname = 'voice-notes-tick'))
  from private.app_config c;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'claim_recording()', 'claim_poll()', 'sweep_stuck()', 'claim_due_reminders()',
    'verify_tick_secret(text)', 'set_app_url(text)', 'set_owner(uuid)', 'note_tick(text)', 'scheduler_state()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- functions the signed-in app may call
create or replace function public.server_status() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'scheduler_last_run_at', c.scheduler_last_run_at,
    'last_tick_at', c.last_tick_at,
    'connected', c.app_url is not null)
  from private.app_config c;
$$;
revoke all on function public.server_status() from public, anon;
grant execute on function public.server_status() to authenticated;

-- Search. Given a folder, only that folder's conversations are searched; given null, everything is.
create or replace function public.search_notes(q text, folder uuid)
returns table (recording_id uuid, title text, started_at timestamptz, kind text, at_ms integer, snippet text, rank real)
language sql stable security invoker set search_path = '' as $$
  with query as (select websearch_to_tsquery('english', q) as tsq)
  select * from (
    select r.id, r.title, r.started_at, 'summary'::text, null::integer,
           ts_headline('english', coalesce(r.title, '') || '. ' || coalesce(r.summary, ''), query.tsq,
                       'MaxWords=24,MinWords=8,StartSel=[[,StopSel=]]'),
           ts_rank(r.fts, query.tsq) * 2
      from public.recordings r, query
     where r.fts @@ query.tsq and not r.is_test and r.deleted_at is null
       and (search_notes.folder is null or r.folder_id = search_notes.folder)
    union all
    select r.id, r.title, r.started_at, 'transcript'::text, u.start_ms,
           ts_headline('english', u.text, query.tsq, 'MaxWords=24,MinWords=8,StartSel=[[,StopSel=]]'),
           ts_rank(u.fts, query.tsq)
      from public.utterances u join public.recordings r on r.id = u.recording_id, query
     where u.fts @@ query.tsq and not r.is_test and r.deleted_at is null
       and (search_notes.folder is null or r.folder_id = search_notes.folder)
    union all
    select r.id, r.title, r.started_at, i.type, i.at_ms,
           ts_headline('english', i.text, query.tsq, 'MaxWords=24,MinWords=8,StartSel=[[,StopSel=]]'),
           ts_rank(i.fts, query.tsq) * 1.5
      from public.items i join public.recordings r on r.id = i.recording_id, query
     where i.fts @@ query.tsq and not i.is_test and r.deleted_at is null
       and (search_notes.folder is null or r.folder_id = search_notes.folder)
  ) hits (recording_id, title, started_at, kind, at_ms, snippet, rank)
  order by rank desc, started_at desc
  limit 50;
$$;
revoke all on function public.search_notes(text, uuid) from public, anon;
grant execute on function public.search_notes(text, uuid) to authenticated;

-- The one-argument form searches everything. Kept because the app calls it from Home.
create or replace function public.search_notes(q text)
returns table (recording_id uuid, title text, started_at timestamptz, kind text, at_ms integer, snippet text, rank real)
language sql stable security invoker set search_path = '' as $$
  select * from public.search_notes(q, null::uuid);
$$;
revoke all on function public.search_notes(text) from public, anon;
grant execute on function public.search_notes(text) to authenticated;

-- ---------------------------------------------------------------- scheduler
-- Runs every minute inside the database. Calls the app only when work is waiting.
create or replace function private.tick() returns void
language plpgsql security definer set search_path = '' as $$
declare cfg private.app_config;
begin
  update private.app_config set scheduler_last_run_at = now() where id returning * into cfg;
  if cfg.app_url is null then return; end if;
  if exists (select 1 from public.items
              where type = 'reminder' and state = 'active' and due_at <= now()
                and notified_at is null and apple_sent_at is null
                and not exists (select 1 from public.recordings r where r.id = items.recording_id and r.deleted_at is not null))
     or exists (select 1 from public.recordings
                 where status in ('uploaded', 'transcribing', 'transcribed', 'extracting'))
     or exists (select 1 from public.recordings where deleted_at < now() - interval '30 days')
     or exists (select 1 from public.recordings
                 where status = 'ready' and storage_path is not null and audio_deleted_at is null
                   and ready_at < now() - interval '30 days')
     -- A transcript the speech service still holds although its text is saved here (deleted by the worker).
     or exists (select 1 from public.recordings
                 where aai_transcript_id is not null and status in ('transcribed', 'extracting', 'ready')
                   and created_at > now() - interval '31 days')
  then
    perform net.http_post(
      url := cfg.app_url || '/api/tick',
      headers := jsonb_build_object('content-type', 'application/json', 'x-tick-secret', cfg.tick_secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000);
  end if;
end $$;

select cron.schedule('voice-notes-tick', '* * * * *', 'select private.tick()');

-- Tell the API layer to pick up the new tables and functions straight away.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------- result
-- After you create your login (Authentication > Users > Add user), the id column
-- below is the value for the OWNER_USER_ID environment variable in Vercel.
select u.id, u.email, u.created_at, (u.id = c.owner_id) as is_owner
  from auth.users u cross join private.app_config c
 order by u.created_at;
