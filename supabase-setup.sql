-- Delulu Spectrum — Supabase setup / repair
-- Safe to run multiple times (idempotent).
-- Paste the whole thing into Supabase → SQL Editor → New query → Run.

-- 1) Tables (no-op if they already exist) ----------------------------------
create table if not exists public.sessions (
  id           text primary key,
  owner_token  text not null,
  public_token text,
  name         text not null default 'you',
  owner_email  text,
  self_scores  jsonb not null,
  minimum_ratings integer not null default 3,
  strong_signal_ratings integer not null default 5,
  ready_notified_at timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.ratings (
  id          text primary key,
  session_id  text not null references public.sessions(id) on delete cascade,
  scores      jsonb not null,
  created_at  timestamptz not null default now()
);

alter table public.sessions
  add column if not exists owner_email text,
  add column if not exists minimum_ratings integer not null default 3,
  add column if not exists strong_signal_ratings integer not null default 5,
  add column if not exists ready_notified_at timestamptz;

update public.sessions
set
  minimum_ratings = coalesce(minimum_ratings, 3),
  strong_signal_ratings = greatest(coalesce(strong_signal_ratings, 5), coalesce(minimum_ratings, 3));

alter table public.sessions
  alter column minimum_ratings set default 3,
  alter column minimum_ratings set not null,
  alter column strong_signal_ratings set default 5,
  alter column strong_signal_ratings set not null;

-- 2) Row-level security ON (private by default) ----------------------------
alter table public.sessions enable row level security;
alter table public.ratings  enable row level security;

-- 3) Table privileges for the public (anon) key ----------------------------
grant usage on schema public to anon, authenticated;
grant insert on public.sessions to anon, authenticated;
grant insert on public.ratings  to anon, authenticated;

-- 4) THE MISSING PIECE: allow anonymous INSERTs (create session + ratings).
--    We deliberately add NO select policy, so no one can read rows directly.
--    All reads go through the secured functions in section 5.
drop policy if exists "delulu insert sessions" on public.sessions;
create policy "delulu insert sessions" on public.sessions
  for insert to anon, authenticated with check (true);

drop policy if exists "delulu insert ratings" on public.ratings;
create policy "delulu insert ratings" on public.ratings
  for insert to anon, authenticated with check (true);

-- 5) Secured read functions (run as owner, bypass RLS, enforce tokens) ------
drop function if exists public.create_session(text, text, text, jsonb);
drop function if exists public.create_session(text, text, text, jsonb, text, integer, integer);
drop function if exists public.add_rating(text, text, jsonb);
drop function if exists public.get_rater_session(text);
drop function if exists public.get_owner_session(text, text);
drop function if exists public.get_public_session(text, text);
drop function if exists public.publish_result(text, text, text);

-- Writes: keep writes behind functions, matching the frontend RPC calls.
create or replace function public.create_session(
  p_id text,
  p_owner_token text,
  p_name text,
  p_self_scores jsonb,
  p_owner_email text default null,
  p_minimum_ratings integer default 3,
  p_strong_signal_ratings integer default 5
)
returns void language sql security definer set search_path = public as $fn$
  insert into public.sessions (
    id,
    owner_token,
    public_token,
    name,
    owner_email,
    self_scores,
    minimum_ratings,
    strong_signal_ratings
  )
  values (
    p_id,
    p_owner_token,
    null,
    coalesce(nullif(p_name, ''), 'you'),
    nullif(lower(trim(p_owner_email)), ''),
    p_self_scores,
    greatest(coalesce(p_minimum_ratings, 3), 1),
    greatest(coalesce(p_strong_signal_ratings, 5), greatest(coalesce(p_minimum_ratings, 3), 1))
  );
$fn$;

create or replace function public.add_rating(p_id text, p_session_id text, p_scores jsonb)
returns void language sql security definer set search_path = public as $fn$
  insert into public.ratings (id, session_id, scores)
  values (p_id, p_session_id, p_scores);
$fn$;

-- Rater view: only the name, never the self-scores.
create or replace function public.get_rater_session(p_session_id text)
returns jsonb language sql security definer set search_path = public as $fn$
  select jsonb_build_object('id', s.id, 'name', s.name)
  from public.sessions s
  where s.id = p_session_id;
$fn$;

-- Owner view: full session + all ratings, gated by the owner token.
create or replace function public.get_owner_session(p_session_id text, p_owner_token text)
returns jsonb language sql security definer set search_path = public as $fn$
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', s.id,
      'owner_token', s.owner_token,
      'public_token', s.public_token,
      'name', s.name,
      'owner_email', s.owner_email,
      'self_scores', s.self_scores,
      'minimum_ratings', s.minimum_ratings,
      'strong_signal_ratings', s.strong_signal_ratings,
      'ready_notified_at', s.ready_notified_at,
      'created_at', s.created_at
    ),
    'ratings', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', r.id, 'scores', r.scores, 'created_at', r.created_at)
        order by r.created_at
      )
      from public.ratings r where r.session_id = s.id
    ), '[]'::jsonb)
  )
  from public.sessions s
  where s.id = p_session_id and s.owner_token = p_owner_token;
$fn$;

-- Shared view: result + ratings, gated by the public token. No owner token exposed.
create or replace function public.get_public_session(p_session_id text, p_public_token text)
returns jsonb language sql security definer set search_path = public as $fn$
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', s.id,
      'public_token', s.public_token,
      'name', s.name,
      'self_scores', s.self_scores,
      'minimum_ratings', s.minimum_ratings,
      'strong_signal_ratings', s.strong_signal_ratings,
      'created_at', s.created_at
    ),
    'ratings', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', r.id, 'scores', r.scores, 'created_at', r.created_at)
        order by r.created_at
      )
      from public.ratings r where r.session_id = s.id
    ), '[]'::jsonb)
  )
  from public.sessions s
  where s.id = p_session_id and s.public_token = p_public_token;
$fn$;

-- Publish: set the public token once, gated by owner token. Returns { public_token }.
create or replace function public.publish_result(p_session_id text, p_owner_token text, p_public_token text)
returns jsonb language sql security definer set search_path = public as $fn$
  update public.sessions
  set public_token = coalesce(public_token, p_public_token)
  where id = p_session_id and owner_token = p_owner_token
  returning jsonb_build_object('public_token', public_token);
$fn$;

-- 6) Let the public (anon) key call the functions --------------------------
grant execute on function public.create_session(text, text, text, jsonb, text, integer, integer) to anon, authenticated;
grant execute on function public.add_rating(text, text, jsonb)                                  to anon, authenticated;
grant execute on function public.get_rater_session(text)                                        to anon, authenticated;
grant execute on function public.get_owner_session(text, text)                                  to anon, authenticated;
grant execute on function public.get_public_session(text, text)                                 to anon, authenticated;
grant execute on function public.publish_result(text, text, text)                               to anon, authenticated;
