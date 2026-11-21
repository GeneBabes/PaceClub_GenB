-- PACECLUB: INITIAL SUPABASE DATABASE
-- Run this ENTIRE file once in SQL Editor > New query, using the postgres role.
-- Intended for a new PaceClub project. No existing table is dropped or replaced.
-- A name collision aborts the transaction rather than modifying an older schema.
-- PostgreSQL 15+. Supabase supplies auth.users, auth.uid(), anon/authenticated/
-- service_role and the supabase_realtime publication.
--
-- This creates data structures, access rules and the RPCs listed at the end.
-- Mobile sensing, emergency prompts/calls, push delivery, AI, GPS verification,
-- challenge scoring and territory geometry require application/server code.
-- Safety timers must record no_response, never assume that silence means safe.
-- Never put a service_role/secret key in the mobile or web client.
-- Private chat here means membership access control, not end-to-end encryption.

begin;

create schema paceclub_private;
revoke all on schema paceclub_private from public, anon, authenticated;
grant usage on schema paceclub_private to authenticated, service_role;

-- 1. ACCOUNTS, CLANS AND CLUBS
create table public.clans (
  id smallint primary key, name text not null unique
    check (name in ('Virtus','Sapientia','Constantia','Libertas'))
);
insert into public.clans values
  (1,'Virtus'),(2,'Sapientia'),(3,'Constantia'),(4,'Libertas');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Runner' check (char_length(btrim(display_name)) between 1 and 80),
  avatar_path text,
  clan_id smallint references public.clans(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table paceclub_private.user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('moderator','admin'))
);
alter table paceclub_private.user_roles enable row level security;
grant all on paceclub_private.user_roles to service_role;

create table public.onboarding_answers (
  user_id uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object'),
  tutorial_completed_at timestamptz
);
create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 2000),
  created_by uuid not null references public.profiles(id),
  is_open boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.club_members (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  status text not null default 'active' check (status in ('active','left','removed')),
  joined_at timestamptz not null default now(),
  primary key (club_id,user_id)
);
create unique index one_club_owner on public.club_members(club_id) where role = 'owner';
create index memberships_by_user on public.club_members(user_id,club_id);

-- 2. PRIVATE ACTIVITY RECORDS
-- Reported measurements are untrusted; verified measurements are server-only.
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  activity_type text not null check (activity_type in ('walk','run','ride')),
  source text not null default 'gps' check (source in ('gps','gpx','simulation')),
  status text not null default 'recording' check (status in
    ('recording','paused','completed','submitted','verified','flagged','rejected')),
  started_at timestamptz not null default now(), ended_at timestamptz,
  reported_distance_m numeric(12,2) check (reported_distance_m >= 0),
  reported_moving_seconds integer check (reported_moving_seconds >= 0),
  reported_elapsed_seconds integer check (reported_elapsed_seconds >= 0),
  distance_m numeric(12,2) check (distance_m >= 0),
  moving_seconds integer check (moving_seconds >= 0),
  elapsed_seconds integer check (elapsed_seconds >= 0),
  sensor_summary jsonb not null default '{}' check (jsonb_typeof(sensor_summary) = 'object'),
  verification_note text, verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id,user_id),
  check (ended_at is null or ended_at >= started_at),
  check (reported_moving_seconds <= reported_elapsed_seconds),
  check (moving_seconds <= elapsed_seconds),
  check (status <> 'verified' or
    (distance_m is not null and moving_seconds is not null and elapsed_seconds is not null
     and verified_at is not null and ended_at is not null))
);
create index activities_by_user on public.activities(user_id,started_at desc);
create table public.activity_points (
  activity_id uuid not null references public.activities(id) on delete cascade,
  sample_number integer not null check (sample_number >= 0),
  recorded_at timestamptz not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision check (accuracy_m >= 0 and accuracy_m < 100000),
  primary key (activity_id,sample_number)
);

-- 3. SAFETY CHECK-INS: OWNER-ONLY DATA
create table public.safety_settings (
  user_id uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  prompt_timeout_seconds integer not null default 30 check (prompt_timeout_seconds between 15 and 120)
);
create table public.safety_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  activity_id uuid not null,
  event_type text not null check (event_type in ('sudden_stop','unusual_motion','manual_sos')),
  detected_at timestamptz not null default now(),
  status text not null default 'detected' check (status in
    ('detected','prompted','confirmed_ok','no_response','call_requested')),
  responded_at timestamptz,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  foreign key (activity_id,user_id) references public.activities(id,user_id) on delete cascade
);
create index safety_events_by_owner on public.safety_events(user_id,detected_at desc);

-- 4. ONE CHAT MODEL FOR FOUR SCOPES
-- conversation_members holds the TWO direct-chat participants and their consent.
-- Clan/club access is derived from CURRENT clan/club membership, not cached here.
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('global','clan','club','direct')),
  clan_id smallint references public.clans(id),
  club_id uuid references public.clubs(id) on delete cascade,
  direct_user_a uuid references public.profiles(id),
  direct_user_b uuid references public.profiles(id),
  requested_by uuid references public.profiles(id),
  direct_status text check (direct_status in ('pending','active','declined')),
  created_at timestamptz not null default now(),
  check (
    (type='global' and clan_id is null and club_id is null and direct_user_a is null
      and direct_user_b is null and requested_by is null and direct_status is null)
    or (type='clan' and clan_id is not null and club_id is null and direct_user_a is null
      and direct_user_b is null and requested_by is null and direct_status is null)
    or (type='club' and club_id is not null and clan_id is null and direct_user_a is null
      and direct_user_b is null and requested_by is null and direct_status is null)
    or (type='direct' and clan_id is null and club_id is null and direct_user_a is not null
      and direct_user_b is not null and direct_user_a < direct_user_b
      and requested_by is not null and requested_by in (direct_user_a,direct_user_b)
      and direct_status is not null)
  )
);
create unique index one_global_chat on public.conversations(type) where type='global';
create unique index one_clan_chat on public.conversations(clan_id) where type='clan';
create unique index one_club_chat on public.conversations(club_id) where type='club';
create unique index one_direct_chat on public.conversations(direct_user_a,direct_user_b) where type='direct';
create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  accepted_at timestamptz,
  primary key (conversation_id,user_id)
);
create index direct_members_by_user on public.conversation_members(user_id,conversation_id);
create table public.user_blocks (
  blocker_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id,blocked_id), check (blocker_id <> blocked_id)
);
create index blocks_reverse on public.user_blocks(blocked_id,blocker_id);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  client_message_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(), removed_at timestamptz,
  unique (sender_id,client_message_id)
);
create index messages_by_conversation on public.messages(conversation_id,created_at desc,id);
create index message_rate_limit on public.messages(sender_id,created_at desc);
create table public.message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id),
  reporter_id uuid not null references public.profiles(id),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  message_snapshot jsonb not null,
  status text not null default 'pending' check (status in ('pending','reviewed','dismissed')),
  created_at timestamptz not null default now(),
  unique (message_id,reporter_id)
);
insert into public.conversations(type) values ('global');
insert into public.conversations(type,clan_id) select 'clan',id from public.clans;

-- 5. CHALLENGES, FEED, APPEALS, REWARDS AND TERRITORY DATA
-- The trusted backend writes scoring, verification, purchases and map ownership.
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  activity_type text not null check (activity_type in ('walk','run','ride')),
  mode text not null check (mode in ('casual','weekly','club','time_trial','territory')),
  rules jsonb not null default '{}' check (jsonb_typeof(rules)='object'),
  starts_at timestamptz not null, ends_at timestamptz not null,
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  check (ends_at > starts_at)
);
create table public.challenge_participants (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(), primary key (challenge_id,user_id)
);
create table public.challenge_entries (
  challenge_id uuid not null, user_id uuid not null, activity_id uuid not null,
  points numeric(14,2) not null check (points >= 0),
  primary key (challenge_id,activity_id),
  foreign key (challenge_id,user_id) references public.challenge_participants(challenge_id,user_id),
  foreign key (activity_id,user_id) references public.activities(id,user_id)
);
create table public.activity_posts (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null unique, author_id uuid not null default auth.uid(),
  caption text not null default '' check (char_length(caption) <= 2000),
  photo_path text,
  visibility text not null default 'private' check (visibility in ('private','members','club')),
  club_id uuid references public.clubs(id), created_at timestamptz not null default now(),
  foreign key (activity_id,author_id) references public.activities(id,user_id) on delete cascade,
  check ((visibility='club') = (club_id is not null))
);
create table public.post_kudos (
  post_id uuid not null references public.activity_posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  primary key (post_id,user_id)
);
create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.activity_posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create table public.activity_appeals (
  id uuid primary key default gen_random_uuid(), activity_id uuid not null unique,
  user_id uuid not null default auth.uid(),
  reason text not null check (char_length(btrim(reason)) between 3 and 2000),
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  review_note text, created_at timestamptz not null default now(),
  foreign key (activity_id,user_id) references public.activities(id,user_id) on delete cascade
);
create table public.reward_items (
  id uuid primary key default gen_random_uuid(), name text not null,
  type text not null check (type in ('theme','avatar_frame','badge','chat_bubble')),
  price_coins integer not null default 0 check (price_coins >= 0),
  is_active boolean not null default true
);
create table public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('xp','coins','rank')),
  amount integer not null check (amount <> 0),
  season_key text not null default 'overall',
  reason text not null, idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id,kind,idempotency_key)
);
create index rewards_by_user on public.reward_ledger(user_id,kind);
create table public.user_inventory (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.reward_items(id),
  equipped boolean not null default false, acquired_at timestamptz not null default now(),
  primary key (user_id,item_id)
);
create table public.play_zones (
  id uuid primary key default gen_random_uuid(), name text not null,
  boundary_geojson jsonb not null check (jsonb_typeof(boundary_geojson)='object'),
  is_active boolean not null default true
);
create table public.territory_claims (
  id uuid primary key default gen_random_uuid(), activity_id uuid not null unique,
  user_id uuid not null default auth.uid(),
  zone_id uuid not null references public.play_zones(id),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','reversed')),
  boundary_geojson jsonb, area_m2 numeric(16,2) check (area_m2 >= 0),
  created_at timestamptz not null default now(),
  foreign key (activity_id,user_id) references public.activities(id,user_id),
  unique (id,user_id)
);
create table public.territories (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null, owner_id uuid not null,
  zone_id uuid not null references public.play_zones(id),
  boundary_geojson jsonb not null check (jsonb_typeof(boundary_geojson)='object'),
  area_m2 numeric(16,2) not null check (area_m2 > 0),
  updated_at timestamptz not null default now(),
  foreign key (claim_id,owner_id) references public.territory_claims(id,user_id)
);
-- JSON is an interchange format, NOT geometry validation. The server must check
-- closure/overlap and update ownership in one transaction; PostGIS can be added.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, body text not null,
  created_at timestamptz not null default now(), read_at timestamptz
);
create index notifications_by_user on public.notifications(user_id,created_at desc);

-- 6. POLICY HELPERS (not in the API-exposed public schema)
create function paceclub_private.active_user() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=auth.uid() and is_active);
$$;
create function paceclub_private.staff() returns boolean
language sql stable security definer set search_path='' as $$
  select paceclub_private.active_user() and exists
    (select 1 from paceclub_private.user_roles where user_id=auth.uid());
$$;
create function paceclub_private.club_member(p_club uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select paceclub_private.active_user() and exists(select 1 from public.club_members
    where club_id=p_club and user_id=auth.uid() and status='active');
$$;
create function paceclub_private.club_owner(p_club uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select paceclub_private.active_user() and exists(select 1 from public.clubs
    where id=p_club and created_by=auth.uid());
$$;
create function paceclub_private.blocked(p_other uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.user_blocks where
    (blocker_id=auth.uid() and blocked_id=p_other) or
    (blocked_id=auth.uid() and blocker_id=p_other));
$$;
create function paceclub_private.owns_activity(p_id uuid, p_mutable boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select paceclub_private.active_user() and exists(select 1 from public.activities
    where id=p_id and user_id=auth.uid()
    and (not p_mutable or status in ('recording','paused','completed')));
$$;
create function paceclub_private.read_activity(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select paceclub_private.active_user() and exists(select 1 from public.activities
    where id=p_id and (user_id=auth.uid() or
      (status='flagged' and paceclub_private.staff())));
$$;
create function paceclub_private.chat_access(p_id uuid, p_messages boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select paceclub_private.active_user() and exists(select 1 from public.conversations c
    where c.id=p_id and case c.type
      when 'global' then true
      when 'clan' then c.clan_id=(select clan_id from public.profiles where id=auth.uid())
      when 'club' then paceclub_private.club_member(c.club_id)
      when 'direct' then auth.uid() in (c.direct_user_a,c.direct_user_b)
        and not paceclub_private.blocked(case when c.direct_user_a=auth.uid()
          then c.direct_user_b else c.direct_user_a end)
        and (not p_messages or (c.direct_status='active' and
          (select count(*) from public.conversation_members m
           where m.conversation_id=c.id and m.accepted_at is not null)=2))
      else false end);
$$;
create function paceclub_private.challenge_access(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select paceclub_private.active_user() and exists(select 1 from public.challenges
    where id=p_id and (club_id is null or paceclub_private.club_member(club_id)));
$$;
create function paceclub_private.post_access(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select paceclub_private.active_user() and exists(select 1
    from public.activity_posts p join public.activities a on a.id=p.activity_id
    where p.id=p_id and not paceclub_private.blocked(p.author_id) and
      (p.author_id=auth.uid() or (a.status='verified' and
        (p.visibility='members' or (p.visibility='club' and paceclub_private.club_member(p.club_id))))));
$$;

-- 7. SIGNUP AND IMMUTABILITY TRIGGERS
create function paceclub_private.handle_signup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,display_name) values
    (new.id,left(coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'),''),'Runner'),80));
  insert into public.safety_settings(user_id) values(new.id);
  insert into public.onboarding_answers(user_id) values(new.id);
  return new;
end;
$$;
create trigger pc_auth_signup after insert on auth.users
for each row execute function paceclub_private.handle_signup();
-- Also supports accounts created before this initial migration.
insert into public.profiles(id,display_name)
select id,left(coalesce(nullif(btrim(raw_user_meta_data->>'display_name'),''),'Runner'),80)
from auth.users;
insert into public.safety_settings(user_id) select id from public.profiles;
insert into public.onboarding_answers(user_id) select id from public.profiles;

create function paceclub_private.lock_activity_input() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.activities; aid uuid;
begin
  if auth.uid() is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  aid := case when tg_op='DELETE' then old.activity_id else new.activity_id end;
  select * into a from public.activities where id=aid for update;
  if not found or a.user_id<>auth.uid() or not paceclub_private.active_user()
    or a.status not in ('recording','paused','completed') then
    raise exception 'Activity input is not editable';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger pc_lock_points before insert or update or delete on public.activity_points
for each row execute function paceclub_private.lock_activity_input();
create function paceclub_private.freeze_activity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and (old.user_id<>auth.uid()
    or not paceclub_private.active_user()
    or old.status not in ('recording','paused','completed')) then
    raise exception 'Submitted activities are locked for verification';
  end if;
  return new;
end;
$$;
create trigger pc_freeze_activity before update on public.activities
for each row execute function paceclub_private.freeze_activity();

create function paceclub_private.check_direct_member() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.conversations c where c.id=new.conversation_id
    and c.type='direct' and new.user_id in (c.direct_user_a,c.direct_user_b)) then
    raise exception 'Only the two direct-chat participants can be members';
  end if;
  return new;
end;
$$;
create trigger pc_direct_member before insert or update on public.conversation_members
for each row execute function paceclub_private.check_direct_member();

-- 8. CLIENT RPCs: created_by/sender/role values come from the authenticated user.
create function public.pc_create_club(p_name text, p_description text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
  if not paceclub_private.active_user() then raise exception 'Sign in first'; end if;
  insert into public.clubs(name,description,created_by)
    values(btrim(p_name),p_description,auth.uid()) returning id into cid;
  insert into public.club_members(club_id,user_id,role) values(cid,auth.uid(),'owner');
  insert into public.conversations(type,club_id) values('club',cid);
  return cid;
end;
$$;
create function public.pc_join_club(p_club_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not paceclub_private.active_user() then raise exception 'Sign in first'; end if;
  perform 1 from public.clubs where id=p_club_id and is_open for update;
  if not found then raise exception 'Club is not open for joining'; end if;
  if exists(select 1 from public.club_members where club_id=p_club_id
    and user_id=auth.uid() and status='removed') then raise exception 'Membership removed'; end if;
  insert into public.club_members(club_id,user_id) values(p_club_id,auth.uid())
    on conflict(club_id,user_id) do update set status='active';
end;
$$;
create function public.pc_leave_club(p_club_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not paceclub_private.active_user() then raise exception 'Sign in first'; end if;
  perform 1 from public.clubs where id=p_club_id for update;
  if paceclub_private.club_owner(p_club_id) then
    raise exception 'The owner must transfer ownership through the server before leaving';
  end if;
  update public.club_members set status='left' where club_id=p_club_id and user_id=auth.uid();
end;
$$;
create function public.pc_remove_club_member(p_club_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.clubs where id=p_club_id for update;
  if not paceclub_private.club_owner(p_club_id) or p_user_id=auth.uid() then
    raise exception 'Only the owner may remove another member';
  end if;
  update public.club_members set status='removed'
    where club_id=p_club_id and user_id=p_user_id and role='member';
end;
$$;
create function public.pc_set_activity_status(p_activity_id uuid,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare a public.activities;
begin
  select * into a from public.activities where id=p_activity_id for update;
  if not found or a.user_id<>auth.uid() or not paceclub_private.active_user() then
    raise exception 'Activity not available';
  end if;
  if a.status=p_status then return; end if;
  if not ((a.status='recording' and p_status in ('paused','completed'))
    or (a.status='paused' and p_status in ('recording','completed'))
    or (a.status='completed' and p_status='submitted')) then
    raise exception 'Invalid activity state change';
  end if;
  update public.activities set status=p_status,
    ended_at=case when p_status='completed' then coalesce(ended_at,now()) else ended_at end
    where id=p_activity_id;
end;
$$;
create function public.pc_request_direct_chat(p_other_user uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare cid uuid; ds text; a uuid; b uuid;
begin
  if not paceclub_private.active_user() or p_other_user is null or p_other_user=auth.uid()
    or paceclub_private.blocked(p_other_user)
    or not exists(select 1 from public.profiles where id=p_other_user and is_active) then
    raise exception 'Direct chat is not available';
  end if;
  a:=least(auth.uid(),p_other_user); b:=greatest(auth.uid(),p_other_user);
  perform pg_advisory_xact_lock(hashtextextended(a::text||b::text,0));
  select id,direct_status into cid,ds from public.conversations
    where type='direct' and direct_user_a=a and direct_user_b=b;
  if cid is not null then
    if ds='declined' then raise exception 'This chat request was declined'; end if;
    return cid;
  end if;
  insert into public.conversations(type,direct_user_a,direct_user_b,requested_by,direct_status)
    values('direct',a,b,auth.uid(),'pending') returning id into cid;
  insert into public.conversation_members(conversation_id,user_id,accepted_at)
    values(cid,auth.uid(),now()),(cid,p_other_user,null);
  return cid;
end;
$$;
create function public.pc_respond_direct_chat(p_conversation_id uuid,p_accept boolean) returns void
language plpgsql security definer set search_path='' as $$
declare c public.conversations;
begin
  select * into c from public.conversations where id=p_conversation_id for update;
  if not found or c.type<>'direct' or not paceclub_private.chat_access(c.id)
    or c.requested_by=auth.uid() or c.direct_status<>'pending' or p_accept is null then
    raise exception 'No pending invitation for this user';
  end if;
  if p_accept then
    update public.conversation_members set accepted_at=now()
      where conversation_id=c.id and user_id=auth.uid();
  end if;
  update public.conversations set direct_status=case when p_accept then 'active' else 'declined' end
    where id=c.id;
end;
$$;
create function public.pc_send_message(p_conversation_id uuid,p_body text,
  p_client_message_id uuid default gen_random_uuid()) returns uuid
language plpgsql security definer set search_path='' as $$
declare m public.messages; mid uuid;
begin
  if not paceclub_private.chat_access(p_conversation_id,true) then
    raise exception 'Not allowed to send to this conversation';
  end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000
    or p_client_message_id is null then raise exception 'Invalid message'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
  select * into m from public.messages where sender_id=auth.uid()
    and client_message_id=p_client_message_id;
  if found then
    if m.conversation_id<>p_conversation_id or m.body<>btrim(p_body) then
      raise exception 'Message retry ID was reused with different content';
    end if;
    return m.id;
  end if;
  if (select count(*) from public.messages where sender_id=auth.uid()
      and created_at > now()-interval '1 minute') >= 20 then
    raise exception 'Message limit reached. Try again shortly.';
  end if;
  insert into public.messages(conversation_id,sender_id,client_message_id,body)
    values(p_conversation_id,auth.uid(),p_client_message_id,btrim(p_body)) returning id into mid;
  return mid;
end;
$$;
create function public.pc_report_message(p_message_id uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare m public.messages; rid uuid;
begin
  select * into m from public.messages where id=p_message_id;
  if not found or not paceclub_private.chat_access(m.conversation_id,true)
    or paceclub_private.blocked(m.sender_id) then raise exception 'Message not available'; end if;
  insert into public.message_reports(message_id,reporter_id,reason,message_snapshot)
    values(m.id,auth.uid(),btrim(p_reason),jsonb_build_object('body',m.body,'sender_id',m.sender_id,
      'conversation_id',m.conversation_id,'created_at',m.created_at))
    on conflict(message_id,reporter_id) do nothing returning id into rid;
  if rid is null then select id into rid from public.message_reports
    where message_id=m.id and reporter_id=auth.uid(); end if;
  return rid;
end;
$$;
create function public.pc_review_message_report(p_report_id uuid,p_remove boolean) returns void
language plpgsql security definer set search_path='' as $$
declare mid uuid;
begin
  if not paceclub_private.staff() or p_remove is null then raise exception 'Moderator required'; end if;
  select message_id into mid from public.message_reports where id=p_report_id for update;
  if not found then raise exception 'Report not found'; end if;
  if p_remove then update public.messages set body='[Message removed]',removed_at=now() where id=mid; end if;
  update public.message_reports set status=case when p_remove then 'reviewed' else 'dismissed' end
    where id=p_report_id;
end;
$$;

create table public.personal_best_efforts (
  activity_id uuid not null, user_id uuid not null,
  distance_m integer not null check (distance_m in (1000,5000,10000,21097,42195)),
  elapsed_seconds integer not null check (elapsed_seconds > 0),
  primary key (activity_id,distance_m),
  foreign key (activity_id,user_id) references public.activities(id,user_id) on delete cascade
);

-- 9. ENABLE RLS AND RESET DEFAULT CLIENT GRANTS ON ONLY THESE NEW TABLES.
do $$
declare t text;
begin
  foreach t in array array[
    'clans','profiles','onboarding_answers','clubs','club_members','activities','activity_points',
    'safety_settings','safety_events','conversations','conversation_members','user_blocks',
    'messages','message_reports','challenges','challenge_participants','challenge_entries',
    'activity_posts','post_kudos','post_comments','activity_appeals','reward_items','reward_ledger',
    'user_inventory','play_zones','territory_claims','territories','notifications','personal_best_efforts'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated',t);
    execute format('grant select on table public.%I to authenticated',t);
    execute format('grant all on table public.%I to service_role',t);
  end loop;
end;
$$;
revoke all on paceclub_private.user_roles from public,anon,authenticated;
revoke all on all functions in schema paceclub_private from public,anon,authenticated;
grant execute on function paceclub_private.active_user(),paceclub_private.staff(),
  paceclub_private.club_member(uuid),paceclub_private.club_owner(uuid),paceclub_private.blocked(uuid),
  paceclub_private.owns_activity(uuid,boolean),paceclub_private.read_activity(uuid),
  paceclub_private.chat_access(uuid,boolean),paceclub_private.challenge_access(uuid),
  paceclub_private.post_access(uuid) to authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
    ('pc_create_club','pc_join_club','pc_leave_club','pc_remove_club_member','pc_set_activity_status',
     'pc_request_direct_chat','pc_respond_direct_chat','pc_send_message','pc_report_message','pc_review_message_report')
  loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end;
$$;

-- READ POLICIES
create policy clans_read on public.clans for select to authenticated using (paceclub_private.active_user());
create policy profiles_read on public.profiles for select to authenticated
  using (id=(select auth.uid()) or paceclub_private.active_user());
create policy onboarding_read on public.onboarding_answers for select to authenticated
  using (user_id=(select auth.uid()) and paceclub_private.active_user());
create policy clubs_read on public.clubs for select to authenticated using (paceclub_private.active_user());
create policy club_members_read on public.club_members for select to authenticated
  using (paceclub_private.active_user() and (user_id=(select auth.uid()) or paceclub_private.club_member(club_id)));
create policy activities_read on public.activities for select to authenticated
  using (paceclub_private.active_user() and
    (user_id=(select auth.uid()) or (status='flagged' and paceclub_private.staff())));
create policy points_read on public.activity_points for select to authenticated using (paceclub_private.read_activity(activity_id));
create policy safety_settings_read on public.safety_settings for select to authenticated
  using (user_id=(select auth.uid()) and paceclub_private.active_user());
create policy safety_events_read on public.safety_events for select to authenticated
  using (user_id=(select auth.uid()) and paceclub_private.active_user());
create policy conversations_read on public.conversations for select to authenticated using (paceclub_private.chat_access(id));
create policy direct_members_read on public.conversation_members for select to authenticated
  using (paceclub_private.chat_access(conversation_id));
create policy blocks_read on public.user_blocks for select to authenticated
  using (blocker_id=(select auth.uid()) and paceclub_private.active_user());
create policy messages_read on public.messages for select to authenticated
  using (paceclub_private.chat_access(conversation_id,true) and not paceclub_private.blocked(sender_id));
create policy reports_read on public.message_reports for select to authenticated
  using (paceclub_private.active_user() and (reporter_id=(select auth.uid()) or paceclub_private.staff()));
create policy challenges_read on public.challenges for select to authenticated
  using (paceclub_private.active_user() and (club_id is null or paceclub_private.club_member(club_id)));
create policy participants_read on public.challenge_participants for select to authenticated
  using (paceclub_private.challenge_access(challenge_id));
create policy entries_read on public.challenge_entries for select to authenticated
  using (paceclub_private.challenge_access(challenge_id));
create policy posts_read on public.activity_posts for select to authenticated
  using ((author_id=(select auth.uid()) and paceclub_private.active_user()) or paceclub_private.post_access(id));
create policy kudos_read on public.post_kudos for select to authenticated using (paceclub_private.post_access(post_id));
create policy comments_read on public.post_comments for select to authenticated
  using (paceclub_private.post_access(post_id) and not paceclub_private.blocked(user_id));
create policy appeals_read on public.activity_appeals for select to authenticated
  using (paceclub_private.active_user() and (user_id=(select auth.uid()) or paceclub_private.staff()));
create policy items_read on public.reward_items for select to authenticated using (paceclub_private.active_user() and is_active);
create policy rewards_read on public.reward_ledger for select to authenticated
  using (user_id=(select auth.uid()) and paceclub_private.active_user());
create policy inventory_read on public.user_inventory for select to authenticated
  using (user_id=(select auth.uid()) and paceclub_private.active_user());
create policy zones_read on public.play_zones for select to authenticated using (paceclub_private.active_user() and is_active);
create policy claims_read on public.territory_claims for select to authenticated
  using (paceclub_private.active_user() and (user_id=(select auth.uid()) or paceclub_private.staff()));
create policy territories_read on public.territories for select to authenticated using (paceclub_private.active_user());
create policy notifications_read on public.notifications for select to authenticated
  using (user_id=(select auth.uid()) and paceclub_private.active_user());
create policy bests_read on public.personal_best_efforts for select to authenticated
  using (user_id=(select auth.uid()) and paceclub_private.active_user());

-- WRITE POLICIES + COLUMN GRANTS: clients cannot write scores, roles or verification.
grant update(display_name,avatar_path,clan_id) on public.profiles to authenticated;
create policy profile_edit on public.profiles for update to authenticated
  using (id=(select auth.uid()) and paceclub_private.active_user()) with check (id=(select auth.uid()));
grant update(answers,tutorial_completed_at) on public.onboarding_answers to authenticated;
create policy onboarding_edit on public.onboarding_answers for update to authenticated
  using (user_id=(select auth.uid()) and paceclub_private.active_user()) with check (user_id=(select auth.uid()));
grant update(name,description,is_open) on public.clubs to authenticated;
create policy club_edit on public.clubs for update to authenticated
  using (paceclub_private.club_owner(id)) with check (created_by=(select auth.uid()));
grant insert(id,user_id,activity_type,source,started_at),
  update(activity_type,source,started_at,ended_at,reported_distance_m,reported_moving_seconds,
    reported_elapsed_seconds,sensor_summary) on public.activities to authenticated;
create policy activity_create on public.activities for insert to authenticated
  with check (user_id=(select auth.uid()) and paceclub_private.active_user() and status='recording');
create policy activity_edit on public.activities for update to authenticated
  using (paceclub_private.owns_activity(id,true)) with check (user_id=(select auth.uid()));
grant insert on public.activity_points to authenticated;
create policy points_create on public.activity_points for insert to authenticated
  with check (paceclub_private.owns_activity(activity_id,true));
grant update(enabled,prompt_timeout_seconds) on public.safety_settings to authenticated;
create policy safety_settings_edit on public.safety_settings for update to authenticated
  using (user_id=(select auth.uid()) and paceclub_private.active_user()) with check (user_id=(select auth.uid()));
grant insert(id,user_id,activity_id,event_type,detected_at,latitude,longitude),
  update(status,responded_at) on public.safety_events to authenticated;
create policy safety_event_create on public.safety_events for insert to authenticated
  with check (user_id=(select auth.uid()) and paceclub_private.owns_activity(activity_id)
    and (event_type='manual_sos' or exists(select 1 from public.safety_settings s
      where s.user_id=auth.uid() and s.enabled)));
create policy safety_event_edit on public.safety_events for update to authenticated
  using (user_id=(select auth.uid()) and paceclub_private.active_user()) with check (user_id=(select auth.uid()));
grant insert(blocker_id,blocked_id),delete on public.user_blocks to authenticated;
create policy block_create on public.user_blocks for insert to authenticated
  with check (blocker_id=(select auth.uid()) and paceclub_private.active_user());
create policy block_remove on public.user_blocks for delete to authenticated
  using (blocker_id=(select auth.uid()) and paceclub_private.active_user());
grant insert(club_id,title,activity_type,mode,rules,starts_at,ends_at,created_by) on public.challenges to authenticated;
create policy challenge_create on public.challenges for insert to authenticated
  with check (created_by=(select auth.uid()) and paceclub_private.active_user()
    and (paceclub_private.staff() or (club_id is not null and paceclub_private.club_owner(club_id))));
grant insert(challenge_id,user_id) on public.challenge_participants to authenticated;
create policy challenge_join on public.challenge_participants for insert to authenticated
  with check (user_id=(select auth.uid()) and paceclub_private.challenge_access(challenge_id)
    and exists(select 1 from public.challenges c where c.id=challenge_id and c.status='open' and c.ends_at>now()));
grant insert(activity_id,author_id,caption,photo_path,visibility,club_id),
  update(caption,photo_path,visibility,club_id) on public.activity_posts to authenticated;
create policy post_create on public.activity_posts for insert to authenticated
  with check (author_id=(select auth.uid()) and paceclub_private.active_user()
    and exists(select 1 from public.activities a where a.id=activity_id and a.status='verified')
    and (club_id is null or paceclub_private.club_member(club_id)));
create policy post_edit on public.activity_posts for update to authenticated
  using (author_id=(select auth.uid()) and paceclub_private.active_user())
  with check (author_id=(select auth.uid()) and (club_id is null or paceclub_private.club_member(club_id)));
grant insert(post_id,user_id),delete on public.post_kudos to authenticated;
create policy kudos_create on public.post_kudos for insert to authenticated
  with check (user_id=(select auth.uid()) and paceclub_private.post_access(post_id));
create policy kudos_remove on public.post_kudos for delete to authenticated
  using (user_id=(select auth.uid()) and paceclub_private.active_user());
grant insert(post_id,user_id,body),update(body),delete on public.post_comments to authenticated;
create policy comment_create on public.post_comments for insert to authenticated
  with check (user_id=(select auth.uid()) and paceclub_private.post_access(post_id));
create policy comment_edit on public.post_comments for update to authenticated
  using (user_id=(select auth.uid()) and paceclub_private.post_access(post_id)) with check (user_id=(select auth.uid()));
create policy comment_remove on public.post_comments for delete to authenticated
  using (user_id=(select auth.uid()) and paceclub_private.active_user());
grant insert(activity_id,user_id,reason) on public.activity_appeals to authenticated;
create policy appeal_create on public.activity_appeals for insert to authenticated
  with check (user_id=(select auth.uid()) and paceclub_private.active_user()
    and exists(select 1 from public.activities a where a.id=activity_id and a.user_id=auth.uid()
      and a.status in ('flagged','rejected')));
grant insert(activity_id,user_id,zone_id) on public.territory_claims to authenticated;
create policy claim_create on public.territory_claims for insert to authenticated
  with check (user_id=(select auth.uid()) and paceclub_private.active_user()
    and exists(select 1 from public.activities a where a.id=activity_id and a.user_id=auth.uid()
      and a.status='verified' and a.source='gps' and a.activity_type in ('walk','run'))
    and exists(select 1 from public.play_zones z where z.id=zone_id and z.is_active));
grant update(read_at) on public.notifications to authenticated;
create policy notification_seen on public.notifications for update to authenticated
  using (user_id=(select auth.uid()) and paceclub_private.active_user()) with check (user_id=(select auth.uid()));

-- 10. DASHBOARD QUERIES. All views obey the base-table RLS policies.
create view public.pc_weekly_activity_stats with(security_invoker=true) as
select user_id,activity_type,date_trunc('week',started_at at time zone 'Asia/Manila')::date as week_start,
  count(*) as activities,sum(distance_m)/1000.0 as distance_km,
  sum(moving_seconds)/60.0 as active_minutes,
  (sum(moving_seconds)/60.0)/nullif(sum(distance_m)/1000.0,0) as pace_min_per_km
from public.activities where user_id=auth.uid() and status='verified' and source<>'simulation'
group by user_id,activity_type,week_start;
create view public.pc_pace_history with(security_invoker=true) as
select id as activity_id,user_id,activity_type,started_at,distance_m/1000.0 as distance_km,
  (moving_seconds/60.0)/(distance_m/1000.0) as pace_min_per_km
from public.activities where user_id=auth.uid() and status='verified' and source<>'simulation' and distance_m>0;
create view public.pc_activity_totals with(security_invoker=true) as
select user_id,activity_type,count(*) as activity_count,sum(moving_seconds)/60.0 as active_minutes,
  sum(distance_m)/1000.0 as distance_km
from public.activities where user_id=auth.uid() and status='verified' and source<>'simulation'
group by user_id,activity_type;
create view public.pc_personal_best_progress with(security_invoker=true) as
select e.user_id,a.activity_type,e.distance_m,a.started_at,e.elapsed_seconds,
  min(e.elapsed_seconds) over(partition by e.user_id,a.activity_type,e.distance_m
    order by a.started_at,e.activity_id rows between unbounded preceding and current row) as best_seconds_so_far
from public.personal_best_efforts e join public.activities a on a.id=e.activity_id
where e.user_id=auth.uid() and a.status='verified' and a.source='gps';
create view public.pc_challenge_leaderboard with(security_invoker=true) as
select challenge_id,user_id,sum(points) as total_points,
  dense_rank() over(partition by challenge_id order by sum(points) desc) as position
from public.challenge_entries group by challenge_id,user_id;
create view public.pc_reward_balances with(security_invoker=true) as
select user_id,kind,season_key,sum(amount) as balance from public.reward_ledger
where user_id=auth.uid() group by user_id,kind,season_key;
revoke all on public.pc_weekly_activity_stats,public.pc_pace_history,public.pc_activity_totals,
  public.pc_personal_best_progress,public.pc_challenge_leaderboard,public.pc_reward_balances from public,anon,authenticated;
grant select on public.pc_weekly_activity_stats,public.pc_pace_history,public.pc_activity_totals,
  public.pc_personal_best_progress,public.pc_challenge_leaderboard,public.pc_reward_balances to authenticated,service_role;

-- 11. POSTGRES CHANGES FOR CHAT, FEED, CHALLENGES AND PERSONAL NOTIFICATIONS.
-- The app still needs subscriptions. Row access uses the RLS policies above.
-- Raw GPS points and safety records are deliberately not added to this publication.
do $$
declare t text;
begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['conversations','conversation_members','messages','activity_posts',
    'post_comments','post_kudos','challenge_entries','notifications'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end;
$$;

commit;

-- SHOULD RETURN: Virtus, Sapientia, Constantia, Libertas.
select id,name from public.clans order by id;

-- APP INTEGRATION NOTES (these are comments, not additional executable SQL):
-- Sign up with Supabase Auth. profiles/safety_settings/onboarding_answers are created automatically.
-- Set a clan: update the signed-in user's profiles.clan_id to 1, 2, 3 or 4.
-- Create a club: supabase.rpc('pc_create_club',{p_name:'Campus Runners',p_description:'Our club'})
-- Join/leave a club: pc_join_club / pc_leave_club with p_club_id.
-- Start a session: insert activities; upload activity_points in batches. Reuse offline IDs.
-- Set state: pc_set_activity_status({p_activity_id, p_status:'paused'|'recording'|'completed'|'submitted'})
-- Submit only AFTER all GPS/sensor uploads are acknowledged; submitted input is locked.
-- Sender IDs and roles cannot be supplied to chat RPCs:
--   pc_request_direct_chat({p_other_user}) returns conversation ID.
--   Invited user calls pc_respond_direct_chat({p_conversation_id,p_accept:true}).
--   pc_send_message({p_conversation_id,p_body,p_client_message_id}) returns message ID.
--   Reuse p_client_message_id when retrying the SAME message after a network failure.
--   pc_report_message({p_message_id,p_reason}) records the reported text for moderation.
--   pc_review_message_report({p_report_id,p_remove:true}) requires a moderator/admin.
-- Insert user_blocks to block someone; delete your own block to unblock.
-- Declined direct requests cannot be re-requested in this starter version.
-- Text chat is included. Image uploads need a private Storage bucket and its own policies.
-- Analytics are empty until a trusted backend verifies activities and records measurements.
-- The backend must enforce challenge rules/unlocks, reverse invalid awards, validate map
-- geometry, serialize overlapping claims, and keep purchases/inventory/balances atomic.
-- challenge_entries and reward_ledger provide uniqueness keys for retry-safe scoring.
-- Clients have NO write access to scores, roles, ranks, inventory or territory ownership.
-- More extensive abuse controls for signup, invites, clubs and comments belong in the backend.
-- SQL stores safety events; it does not detect an accident, send push alerts or call 911.
-- Test emergency actions with a simulation, never a real emergency call.
--
-- OPTIONAL FIRST ADMIN, after creating your own Auth account:
-- Run separately in the SQL Editor, replacing the placeholder with that account's UUID:
-- insert into paceclub_private.user_roles(user_id,role)
-- values ('YOUR_AUTH_USER_UUID'::uuid,'admin');
-- Club ownership is separate from this application-wide moderator/admin role.
--
-- Official implementation references:
-- https://supabase.com/docs/guides/auth/managing-user-data
-- https://supabase.com/docs/guides/database/postgres/row-level-security
-- https://supabase.com/docs/guides/database/functions
-- https://supabase.com/docs/guides/realtime/postgres-changes
