-- Delulu Spectrum — definitive backend (all access via SECURITY DEFINER functions).
-- Writes AND reads go through these functions, which bypass RLS, so the
-- publishable-key role mapping can't block anything. Safe to run repeatedly.

-- Remove any existing versions of these functions (every signature) to avoid conflicts.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_session','add_rating','get_rater_session',
                        'get_owner_session','get_public_session','publish_result')
  loop
    execute 'drop function ' || r.sig::text;
  end loop;
end $$;

-- SCHEMA --------------------------------------------------------------------
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

-- WRITES --------------------------------------------------------------------
create function public.create_session(
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

create function public.add_rating(p_id text, p_session_id text, p_scores jsonb)
returns void language sql security definer set search_path = public as $fn$
  insert into public.ratings (id, session_id, scores)
  values (p_id, p_session_id, p_scores);
$fn$;

-- READS ---------------------------------------------------------------------
create function public.get_rater_session(p_session_id text)
returns jsonb language sql security definer set search_path = public as $fn$
  select jsonb_build_object('id', s.id, 'name', s.name)
  from public.sessions s where s.id = p_session_id;
$fn$;

create function public.get_owner_session(p_session_id text, p_owner_token text)
returns jsonb language sql security definer set search_path = public as $fn$
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', s.id, 'owner_token', s.owner_token, 'public_token', s.public_token,
      'name', s.name, 'owner_email', s.owner_email, 'self_scores', s.self_scores,
      'minimum_ratings', s.minimum_ratings,
      'strong_signal_ratings', s.strong_signal_ratings,
      'ready_notified_at', s.ready_notified_at,
      'created_at', s.created_at),
    'ratings', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'scores', r.scores, 'created_at', r.created_at) order by r.created_at)
      from public.ratings r where r.session_id = s.id), '[]'::jsonb))
  from public.sessions s
  where s.id = p_session_id and s.owner_token = p_owner_token;
$fn$;

create function public.get_public_session(p_session_id text, p_public_token text)
returns jsonb language sql security definer set search_path = public as $fn$
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', s.id, 'public_token', s.public_token,
      'name', s.name, 'self_scores', s.self_scores,
      'minimum_ratings', s.minimum_ratings,
      'strong_signal_ratings', s.strong_signal_ratings,
      'created_at', s.created_at),
    'ratings', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'scores', r.scores, 'created_at', r.created_at) order by r.created_at)
      from public.ratings r where r.session_id = s.id), '[]'::jsonb))
  from public.sessions s
  where s.id = p_session_id and s.public_token = p_public_token;
$fn$;

create function public.publish_result(p_session_id text, p_owner_token text, p_public_token text)
returns jsonb language sql security definer set search_path = public as $fn$
  update public.sessions
  set public_token = coalesce(public_token, p_public_token)
  where id = p_session_id and owner_token = p_owner_token
  returning jsonb_build_object('public_token', public_token);
$fn$;

-- Let the public key call them (each function enforces its own token checks).
grant execute on function public.create_session(text, text, text, jsonb, text, integer, integer) to anon, authenticated;
grant execute on function public.add_rating(text, text, jsonb)                                  to anon, authenticated;
grant execute on function public.get_rater_session(text)                                        to anon, authenticated;
grant execute on function public.get_owner_session(text, text)                                  to anon, authenticated;
grant execute on function public.get_public_session(text, text)                                 to anon, authenticated;
grant execute on function public.publish_result(text, text, text)                               to anon, authenticated;
