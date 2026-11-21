-- PaceClub full application migration. Apply AFTER 01 and 02, including on an
-- existing recorder database. No tables/data are dropped. Run as postgres.
begin;
create table if not exists paceclub_private.migrations(version text primary key, installed_at timestamptz default now());
alter table public.activities add column if not exists selected_club_id uuid references public.clubs(id);
alter table public.activities add column if not exists selected_challenge_id uuid references public.challenges(id);
alter table public.activities add column if not exists verification_version integer not null default 0;
alter table public.activities add column if not exists first_verified_at timestamptz;
update public.activities set first_verified_at=verified_at where first_verified_at is null and verified_at is not null;
alter table public.challenges add column if not exists personal boolean not null default false;
alter table public.challenges add column if not exists finalized_at timestamptz;
alter table public.reward_ledger add column if not exists activity_id uuid references public.activities(id);
alter table public.activity_posts add column if not exists removed_at timestamptz;
alter table public.post_comments add column if not exists removed_at timestamptz;
alter table public.notifications add column if not exists event_key text;
create unique index if not exists pc_notification_event on public.notifications(user_id,event_key);
create table if not exists public.verification_audit (
 id bigint generated always as identity primary key, activity_id uuid not null references public.activities(id),
 actor_id uuid references public.profiles(id), action text not null, note text not null,
 metrics jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists public.content_reports (
 id uuid primary key default gen_random_uuid(), reporter_id uuid not null default auth.uid() references public.profiles(id),
 post_id uuid references public.activity_posts(id), comment_id uuid references public.post_comments(id),
 reason text not null check(length(btrim(reason)) between 3 and 1000), snapshot jsonb not null default '{}',
 status text not null default 'pending' check(status in ('pending','reviewed','dismissed')),
 created_at timestamptz default now(), check(num_nonnulls(post_id,comment_id)=1)
);
create unique index if not exists pc_report_post_unique on public.content_reports(reporter_id,post_id);
create unique index if not exists pc_report_comment_unique on public.content_reports(reporter_id,comment_id);
create table if not exists paceclub_private.push_devices (
 token text primary key, user_id uuid not null references public.profiles(id) on delete cascade,
 updated_at timestamptz not null default now()
);
create table if not exists paceclub_private.push_jobs (
 id bigint generated always as identity primary key, notification_id uuid not null references public.notifications(id) on delete cascade,
 token text not null, status text not null default 'pending', attempts integer not null default 0,
 available_at timestamptz not null default now(), ticket text, error text, unique(notification_id,token)
);
alter table public.verification_audit enable row level security;
alter table public.content_reports enable row level security;
alter table paceclub_private.push_devices enable row level security;
alter table paceclub_private.push_jobs enable row level security;
revoke all on public.verification_audit,public.content_reports from public,anon,authenticated;
revoke all on paceclub_private.push_devices,paceclub_private.push_jobs from public,anon,authenticated;
grant select on public.verification_audit,public.content_reports to authenticated;
grant all on public.verification_audit,public.content_reports,paceclub_private.push_devices,paceclub_private.push_jobs to service_role;
drop policy if exists pc_audit_read on public.verification_audit;
create policy pc_audit_read on public.verification_audit for select to authenticated using
 (paceclub_private.owns_activity(activity_id) or paceclub_private.staff());
drop policy if exists pc_content_reports_read on public.content_reports;
create policy pc_content_reports_read on public.content_reports for select to authenticated using
 (paceclub_private.active_user() and (reporter_id=auth.uid() or paceclub_private.staff()));
grant insert(selected_club_id,selected_challenge_id),update(selected_club_id,selected_challenge_id) on public.activities to authenticated;

-- Offline check-ins can arrive after the athlete disables future prompts.
-- Their private history is still owner-only and grants no competition credit.
drop policy if exists safety_event_create on public.safety_events;
create policy safety_event_create on public.safety_events for insert to authenticated
 with check (user_id=(select auth.uid()) and paceclub_private.owns_activity(activity_id));

-- Protected result columns have no client write grant. Even trusted result RPCs
-- cannot change uploaded input once submission has locked it.
create or replace function paceclub_private.freeze_activity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.source is distinct from new.source then raise exception 'Activity source cannot be changed';end if;
 if old.status in ('submitted','verified','flagged','rejected') and
  (to_jsonb(new)-array['status','distance_m','moving_seconds','elapsed_seconds','verified_at','verification_note','verification_version','first_verified_at'])
  is distinct from
  (to_jsonb(old)-array['status','distance_m','moving_seconds','elapsed_seconds','verified_at','verification_note','verification_version','first_verified_at']) then
  raise exception 'Submitted activity input is immutable';
 end if;
 return new;
end $$;
create or replace function paceclub_private.read_activity(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select paceclub_private.active_user() and exists(select 1 from public.activities where id=p_id
 and (user_id=auth.uid() or paceclub_private.staff()))
$$;
drop policy if exists activities_read on public.activities;
create policy activities_read on public.activities for select to authenticated using(paceclub_private.active_user() and (user_id=auth.uid() or paceclub_private.staff()));
create or replace function public.pc_my_role() returns text
language sql stable security definer set search_path='' as $$
 select case when paceclub_private.active_user() then coalesce((select role from paceclub_private.user_roles where user_id=auth.uid()),'athlete') else 'inactive' end
$$;
create or replace function paceclub_private.notify(p_user uuid,p_key text,p_title text,p_body text) returns void
language sql security definer set search_path='' as $$
 insert into public.notifications(user_id,event_key,title,body) values(p_user,p_key,left(p_title,120),left(p_body,1000))
 on conflict(user_id,event_key) do nothing
$$;
create or replace function paceclub_private.haversine(a double precision,b double precision,c double precision,d double precision)
returns double precision language sql immutable set search_path='' as $$
 select 12742000*asin(sqrt(least(1.0,greatest(0.0,power(sin(radians(c-a)/2),2)+cos(radians(a))*cos(radians(c))*power(sin(radians(d-b)/2),2)))))
$$;
create or replace function paceclub_private.measure_activity(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.activities; p record; prev record; n integer; expected integer:=0;
 d double precision:=0; dt double precision; total double precision:=0; moving double precision:=0;
 elapsed integer; speed_limit double precision; flags text[]:='{}'; starts jsonb;
 has_prev boolean:=false; first_segment boolean:=true; first_time timestamptz; pb jsonb:='{}'; target integer;
begin
 select * into strict a from public.activities where id=p_id;
 select count(*) into n from public.activity_points where activity_id=p_id;
 elapsed:=floor(extract(epoch from (a.ended_at-a.started_at)));
 if n<2 or n>25000 or elapsed is null or elapsed<10 or elapsed>43200 or a.ended_at>now()+interval '5 minutes' then
  return jsonb_build_object('valid',false,'flags',jsonb_build_array('Missing samples, invalid duration, or a device clock outside the allowed range.'),'distance',0,'moving',0,'elapsed',greatest(0,coalesce(elapsed,0)),'bests','{}'::jsonb);
 end if;
 starts:=coalesce(a.sensor_summary->'segment_starts','[0]'::jsonb);
 if jsonb_typeof(starts)<>'array' then starts:='[0]'; flags:=array_append(flags,'Invalid pause metadata.'); end if;
 speed_limit:=case a.activity_type when 'walk' then 7 when 'run' then 12 else 40 end;
 for p in select * from public.activity_points where activity_id=p_id order by sample_number loop
  if p.sample_number<>expected then flags:=array_append(flags,'Missing route samples.'); end if;
  expected:=p.sample_number+1;
  if p.recorded_at<a.started_at-interval '2 seconds' or p.recorded_at>a.ended_at+interval '2 seconds' then
   flags:=array_append(flags,'Samples fall outside the recording time.'); has_prev:=false; first_segment:=false; continue;
  end if;
  if a.source='gps' and (p.accuracy_m is null or p.accuracy_m>35) then
   flags:=array_append(flags,'GPS accuracy needs review.'); has_prev:=false; first_segment:=false; continue;
  end if;
  if not has_prev then first_time:=coalesce(first_time,p.recorded_at);
  else
   dt:=extract(epoch from (p.recorded_at-prev.recorded_at));
   if dt<=0 then flags:=array_append(flags,'Timestamps are not increasing.');
   elsif starts @> jsonb_build_array(p.sample_number) or dt>(case when a.source='gpx' then 60 else 20 end) then first_segment:=false;
   else
    d:=paceclub_private.haversine(prev.latitude,prev.longitude,p.latitude,p.longitude);
    if d/dt>speed_limit then flags:=array_append(flags,'A speed or GPS jump exceeds the review threshold.'); first_segment:=false;
    else
     total:=total+d;
     if d/dt>=0.3 then moving:=moving+dt; end if;
     if first_segment and a.source='gps' then
      foreach target in array array[1000,5000,10000,21097,42195] loop
       if total>=target and not(pb ? target::text) and d>0 then
        pb:=pb||jsonb_build_object(target::text,ceil(extract(epoch from(prev.recorded_at-first_time))+(target-(total-d))/d*dt));
       end if;
      end loop;
     end if;
    end if;
   end if;
  end if;
  prev:=p; has_prev:=true;
 end loop;
 if total<10 or moving<1 then flags:=array_append(flags,'Not enough reliable movement to verify.'); end if;
 if a.reported_distance_m is not null and abs(a.reported_distance_m-total)>greatest(100,total*.3) then
  flags:=array_append(flags,'Reported distance differs substantially from the saved route.');
 end if;
 select coalesce(array_agg(distinct x),'{}') into flags from unnest(flags) x;
 return jsonb_build_object('valid',total>=10 and moving>=1,'flags',to_jsonb(flags),'distance',round(total::numeric,2),
 'moving',least(elapsed,floor(moving)::integer),'elapsed',elapsed,'bests',pb);
end $$;

create or replace function paceclub_private.competitive_ready(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.onboarding_answers where user_id=p_user and tutorial_completed_at is not null)
 and (select count(*)>=3 and count(distinct (started_at at time zone 'Asia/Manila')::date)>=2
 from public.activities where user_id=p_user and status='verified' and source='gps')
$$;
create or replace function public.pc_competitive_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select paceclub_private.active_user() and paceclub_private.competitive_ready(auth.uid())
$$;
create or replace function paceclub_private.sync_activity_rewards(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.activities; k text; target integer; balance integer;
begin
 select * into a from public.activities where id=p_id;
 perform 1 from public.profiles where id=a.user_id for update;
 foreach k in array array['xp','coins'] loop
  target:=case when a.status='verified' and a.source='gps' then
   case k when 'xp' then least(200,10+floor(a.distance_m/100)::integer) else least(20,1+floor(a.distance_m/1000)::integer) end else 0 end;
  select coalesce(sum(amount),0) into balance from public.reward_ledger where activity_id=p_id and kind=k;
  if target<>balance then insert into public.reward_ledger(user_id,kind,amount,reason,idempotency_key,activity_id)
   values(a.user_id,k,target-balance,'Activity verification adjustment','activity:'||p_id||':v'||a.verification_version,p_id)
   on conflict(user_id,kind,idempotency_key) do nothing;
  end if;
 end loop;
end $$;

-- Shared rules for personal quests and competition. Server-generated join dates
-- and locked activity selections prevent joining after a recording has begun.
create or replace function paceclub_private.challenge_access(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select paceclub_private.active_user() and exists(select 1 from public.challenges c where c.id=p_id
 and (not c.personal or c.created_by=auth.uid()) and (c.club_id is null or paceclub_private.club_member(c.club_id)))
$$;
drop policy if exists challenges_read on public.challenges;
create policy challenges_read on public.challenges for select to authenticated using(paceclub_private.challenge_access(id));
revoke insert on public.challenges,public.challenge_participants from authenticated;
revoke insert(club_id,title,activity_type,mode,rules,starts_at,ends_at,created_by) on public.challenges from authenticated;
revoke insert(challenge_id,user_id) on public.challenge_participants from authenticated;
create or replace function public.pc_create_challenge(p_title text,p_type text,p_mode text,p_start timestamptz,p_end timestamptz,
 p_goal integer default 5000,p_cap integer default 20000,p_club uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare cid uuid; personal boolean;
begin
 if not paceclub_private.active_user() then raise exception 'Sign in first'; end if;
 personal:=p_mode='casual' and p_club is null and not paceclub_private.staff();
 if not personal and not paceclub_private.staff() and (p_club is null or not paceclub_private.club_owner(p_club)) then raise exception 'Club owner or moderator required'; end if;
 if p_type not in ('walk','run','ride') or p_mode not in ('casual','weekly','club','time_trial') or
  p_start<now()-interval '10 minutes' or p_end<=p_start or p_end>p_start+interval '90 days' or
  p_goal not between 100 and 1000000 or p_cap not between 100 and 100000 or
  (p_mode='club' and p_club is null) or (p_mode='time_trial' and p_goal not in (1000,5000,10000,21097,42195)) then raise exception 'Invalid dates, type, goal or cap'; end if;
 if (select count(*) from public.challenges where created_by=auth.uid() and status='open' and ends_at>now())>=20 then raise exception 'Close an existing challenge before creating another'; end if;
 insert into public.challenges(title,activity_type,mode,starts_at,ends_at,rules,club_id,created_by,personal)
 values(btrim(p_title),p_type,p_mode,p_start,p_end,jsonb_build_object('version',1,'goal_m',p_goal,'daily_cap_m',p_cap,
 'timezone','Asia/Manila','join_before_start',true,'review_hours',48,'goal_coins',50,'winner_coins',100,
 'tie_rule','Equal scores share first place; time trials use the best eligible elapsed effort.'),p_club,auth.uid(),personal) returning id into cid;
 return cid;
end $$;
create or replace function public.pc_join_challenge(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c public.challenges;
begin
 select * into c from public.challenges where id=p_id for update;
 if not found or not paceclub_private.challenge_access(p_id) or c.status<>'open' or c.ends_at<=now() then raise exception 'Challenge is not open'; end if;
 if c.mode<>'casual' and not paceclub_private.competitive_ready(auth.uid()) then raise exception 'Finish the tutorial and three verified GPS activities across two days to unlock competition'; end if;
 insert into public.challenge_participants(challenge_id,user_id) values(p_id,auth.uid()) on conflict do nothing;
end $$;
-- Preserve membership intervals: leaving cannot retroactively erase earned credit.
create table if not exists paceclub_private.club_membership_periods(
 id bigint generated always as identity primary key, club_id uuid references public.clubs(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete cascade, started_at timestamptz not null, ended_at timestamptz);
create unique index if not exists pc_one_open_membership on paceclub_private.club_membership_periods(club_id,user_id) where ended_at is null;
revoke all on paceclub_private.club_membership_periods from public,anon,authenticated;
insert into paceclub_private.club_membership_periods(club_id,user_id,started_at)
 select club_id,user_id,joined_at from public.club_members where status='active' on conflict do nothing;
create or replace function paceclub_private.membership_history() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.status='active' then insert into paceclub_private.club_membership_periods(club_id,user_id,started_at) values(new.club_id,new.user_id,new.joined_at);end if;
 elsif old.status is distinct from new.status then
  if old.status='active' then update paceclub_private.club_membership_periods set ended_at=now() where club_id=old.club_id and user_id=old.user_id and ended_at is null;end if;
  if new.status='active' then insert into paceclub_private.club_membership_periods(club_id,user_id,started_at) values(new.club_id,new.user_id,new.joined_at);end if;
 end if;
 return new;
end $$;
drop trigger if exists pc_membership_history on public.club_members;
create trigger pc_membership_history after insert or update of status on public.club_members for each row execute function paceclub_private.membership_history();

create or replace function public.pc_join_club(p_club_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not paceclub_private.active_user() then raise exception 'Sign in first';end if;
 perform 1 from public.clubs where id=p_club_id and is_open for update;
 if not found then raise exception 'Club is not open for joining';end if;
 if exists(select 1 from public.club_members where club_id=p_club_id and user_id=auth.uid() and status='removed') then raise exception 'Membership removed';end if;
 insert into public.club_members(club_id,user_id) values(p_club_id,auth.uid()) on conflict(club_id,user_id) do update set
 joined_at=case when club_members.status='active' then club_members.joined_at else now() end,status='active';
end $$;
create or replace function paceclub_private.score_user(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c record; a record; day_key date; current_day date; used numeric; credit numeric; score numeric; kind text; target integer; previous integer;
begin
 perform pg_advisory_xact_lock(68420402); -- common lock order for scoring, purchases and finalization
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,402));
 for c in select ch.*,cp.joined_at from public.challenges ch join public.challenge_participants cp on cp.challenge_id=ch.id
  where cp.user_id=p_user and ch.status in ('open','closed') order by ch.id loop
  delete from public.challenge_entries where challenge_id=c.id and user_id=p_user;
  current_day:=null; used:=0; score:=0;
  for a in select act.* from public.activities act where act.user_id=p_user and act.status='verified' and act.source='gps'
   and act.selected_challenge_id=c.id and act.activity_type=c.activity_type
   and (c.finalized_at is null or act.first_verified_at<=c.finalized_at)
   and act.started_at>=greatest(c.starts_at,c.joined_at) and act.ended_at<=c.ends_at
   and (c.club_id is null or (act.selected_club_id=c.club_id and exists(select 1 from paceclub_private.club_membership_periods cm where cm.club_id=c.club_id and cm.user_id=p_user and cm.started_at<=act.started_at and (cm.ended_at is null or cm.ended_at>=act.ended_at))))
   order by act.started_at,act.id loop
   day_key:=(a.started_at at time zone 'Asia/Manila')::date;
   if current_day is distinct from day_key then used:=0;current_day:=day_key;end if;
   if c.mode='time_trial' then
    select 1000000.0/elapsed_seconds into credit from public.personal_best_efforts where activity_id=a.id and distance_m=(c.rules->>'goal_m')::integer;
    credit:=coalesce(credit,0);score:=greatest(score,credit);
   else
    credit:=greatest(0,least(a.distance_m,(c.rules->>'daily_cap_m')::numeric-used));used:=used+credit;score:=score+credit;
   end if;
   if credit>0 then insert into public.challenge_entries(challenge_id,user_id,activity_id,points) values(c.id,p_user,a.id,credit);end if;
  end loop;
  -- Club mode has a shared goal; other distance goals are personal.
  perform paceclub_private.sync_challenge_goals(c.id);
  if c.finalized_at is not null then perform paceclub_private.sync_challenge_winners(c.id);end if;
 end loop;
end $$;

create or replace function paceclub_private.apply_verification(p_id uuid,p_status text,p_note text,p_metrics jsonb,p_actor uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare a public.activities; b record;
begin
 select * into strict a from public.activities where id=p_id for update;
 update public.activities set status=p_status,verification_note=left(p_note,2000),verification_version=verification_version+1,
  distance_m=case when p_status='verified' then (p_metrics->>'distance')::numeric else null end,
  moving_seconds=case when p_status='verified' then (p_metrics->>'moving')::integer else null end,
  elapsed_seconds=case when p_status='verified' then (p_metrics->>'elapsed')::integer else null end,
  verified_at=case when p_status='verified' then now() else null end,
  first_verified_at=case when p_status='verified' then coalesce(first_verified_at,now()) else first_verified_at end where id=p_id;
 delete from public.personal_best_efforts where activity_id=p_id;
 if p_status='verified' and a.source='gps' then
  for b in select * from jsonb_each_text(coalesce(p_metrics->'bests','{}')) loop
   if b.value::numeric>0 then insert into public.personal_best_efforts(activity_id,user_id,distance_m,elapsed_seconds) values(p_id,a.user_id,b.key::integer,b.value::integer);end if;
  end loop;
 end if;
 insert into public.verification_audit(activity_id,actor_id,action,note,metrics) values(p_id,p_actor,p_status,left(p_note,2000),p_metrics);
 perform paceclub_private.sync_activity_rewards(p_id);
 perform paceclub_private.score_user(a.user_id);
 perform paceclub_private.notify(a.user_id,'verification:'||p_id||':'||(a.verification_version+1),'Activity '||p_status,p_note);
end $$;
create or replace function paceclub_private.verify(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare a public.activities; m jsonb; result text; note text;
begin
 select * into strict a from public.activities where id=p_id for update;
 if a.status<>'submitted' then return a.status;end if;
 m:=paceclub_private.measure_activity(p_id);
 result:=case when (m->>'valid')::boolean and jsonb_array_length(m->'flags')=0 then 'verified' else 'flagged' end;
 select string_agg(value,' ') into note from jsonb_array_elements_text(m->'flags');
 note:=coalesce(note,'Route and timestamp checks passed. Measurements were recalculated from saved samples.');
 if a.source<>'gps' then note:=note||' '||upper(a.source)||' activity: excluded from ranked points, rewards and territory.';end if;
 perform paceclub_private.apply_verification(p_id,result,note,m);
 return result;
end $$;
create or replace function public.pc_verify_activity(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
begin
 if not paceclub_private.owns_activity(p_id) and not paceclub_private.staff() then raise exception 'Activity unavailable';end if;
 return paceclub_private.verify(p_id);
end $$;
create or replace function paceclub_private.after_submit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='submitted' and old.status is distinct from new.status then perform paceclub_private.verify(new.id);end if;
 return new;
end $$;
drop trigger if exists pc_auto_verify on public.activities;
create trigger pc_auto_verify after update of status on public.activities for each row execute function paceclub_private.after_submit();
create or replace function public.pc_review_activity(p_id uuid,p_accept boolean,p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare a public.activities; m jsonb;
begin
 if not paceclub_private.staff() or p_accept is null or length(btrim(p_note)) not between 3 and 2000 then raise exception 'Moderator and review explanation required';end if;
 select * into strict a from public.activities where id=p_id for update;
 if a.user_id=auth.uid() then raise exception 'Another moderator must review your own activity';end if;
 if a.status not in ('flagged','rejected','submitted') then raise exception 'Only pending or disputed activities can be reviewed';end if;
 m:=paceclub_private.measure_activity(p_id);
 if p_accept and not (m->>'valid')::boolean then raise exception 'There is insufficient reliable route data to approve';end if;
 perform paceclub_private.apply_verification(p_id,case when p_accept then 'verified' else 'rejected' end,btrim(p_note),m,auth.uid());
 update public.activity_appeals set status=case when p_accept then 'accepted' else 'rejected' end,review_note=btrim(p_note) where activity_id=p_id and status='pending';
end $$;
create or replace function public.pc_submit_appeal(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not paceclub_private.owns_activity(p_id) or not exists(select 1 from public.activities where id=p_id and status in ('flagged','rejected')) then raise exception 'This activity cannot be appealed';end if;
 insert into public.activity_appeals(activity_id,user_id,reason) values(p_id,auth.uid(),btrim(p_reason)) on conflict(activity_id) do nothing;
end $$;

drop policy if exists post_create on public.activity_posts;
create policy post_create on public.activity_posts for insert to authenticated with check(author_id=auth.uid() and paceclub_private.active_user() and exists(select 1 from public.activities a where a.id=activity_id and a.status='verified' and a.source<>'simulation' and a.user_id=auth.uid()) and (club_id is null or paceclub_private.club_member(club_id)));

-- Cosmetic purchases use a profile-row lock, authoritative price, and a unique
-- inventory row. A retried purchase never charges a second time.
insert into public.reward_items(id,name,type,price_coins) values
 ('50000000-0000-4000-8000-000000000001','Forest theme','theme',10),
 ('50000000-0000-4000-8000-000000000002','Sunrise theme','theme',20),
 ('50000000-0000-4000-8000-000000000003','Gold circle','avatar_frame',30),
 ('50000000-0000-4000-8000-000000000004','Trail explorer','badge',40),
 ('50000000-0000-4000-8000-000000000005','Sage chat bubble','chat_bubble',15)
 on conflict(id) do nothing;
create or replace function public.pc_buy_item(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare item public.reward_items; balance integer;
begin
 if not paceclub_private.active_user() then raise exception 'Sign in first';end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 select * into item from public.reward_items where id=p_id and is_active;
 if not found then raise exception 'Item unavailable';end if;
 if exists(select 1 from public.user_inventory where user_id=auth.uid() and item_id=p_id) then return;end if;
 select coalesce(sum(amount),0) into balance from public.reward_ledger where user_id=auth.uid() and kind='coins';
 if balance<item.price_coins then raise exception 'Not enough cosmetic tokens';end if;
 if item.price_coins>0 then insert into public.reward_ledger(user_id,kind,amount,reason,idempotency_key)
  values(auth.uid(),'coins',-item.price_coins,'Cosmetic purchase: '||item.name,'purchase:'||p_id);end if;
 insert into public.user_inventory(user_id,item_id) values(auth.uid(),p_id);
end $$;
create or replace function public.pc_equip_item(p_id uuid,p_equipped boolean default true) returns void
language plpgsql security definer set search_path='' as $$
declare kind text;
begin
 if not paceclub_private.active_user() then raise exception 'Sign in first';end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 select r.type into kind from public.reward_items r join public.user_inventory i on i.item_id=r.id where i.user_id=auth.uid() and r.id=p_id;
 if kind is null then raise exception 'Buy this cosmetic first';end if;
 update public.user_inventory set equipped=false where user_id=auth.uid() and item_id in(select id from public.reward_items where type=kind);
 update public.user_inventory set equipped=coalesce(p_equipped,false) where user_id=auth.uid() and item_id=p_id;
end $$;

create or replace view public.pc_challenge_leaderboard with(security_invoker=true) as
 select challenge_id,user_id,
 case when c.mode='time_trial' then max(e.points) else sum(e.points) end as total_points,
 dense_rank() over(partition by challenge_id order by case when c.mode='time_trial' then max(e.points) else sum(e.points) end desc) as position
 from public.challenge_entries e join public.challenges c on c.id=e.challenge_id group by challenge_id,user_id,c.mode;
revoke all on public.pc_challenge_leaderboard from public,anon,authenticated;
grant select on public.pc_challenge_leaderboard to authenticated,service_role;
create or replace function paceclub_private.sync_challenge_goals(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c public.challenges; r record;shared numeric;score numeric;target integer;previous integer;
begin
 select * into strict c from public.challenges where id=p_id;
 select coalesce(sum(points),0) into shared from public.challenge_entries where challenge_id=p_id;
 for r in select user_id from public.challenge_participants where challenge_id=p_id order by user_id loop
  select coalesce(sum(points),0) into score from public.challenge_entries where challenge_id=p_id and user_id=r.user_id;
  target:=case when c.mode<>'time_trial' and score>0 and (case when c.mode='club' then shared else score end)>=(c.rules->>'goal_m')::numeric then 50 else 0 end;
  select coalesce(sum(amount),0) into previous from public.reward_ledger where user_id=r.user_id and kind='coins' and reason='Challenge goal '||p_id;
  if target<>previous then insert into public.reward_ledger(user_id,kind,amount,reason,idempotency_key)
   values(r.user_id,'coins',target-previous,'Challenge goal '||p_id,'challenge-goal:'||p_id||':'||gen_random_uuid());end if;
 end loop;
end $$;
create or replace function paceclub_private.sync_challenge_winners(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c public.challenges;r record;k text;target integer;previous integer;
begin
 select * into strict c from public.challenges where id=p_id;
 if c.mode='casual' then return;end if;
 for r in select cp.user_id,coalesce(lb.position=1 and lb.total_points>0,false) winner from public.challenge_participants cp
 left join public.pc_challenge_leaderboard lb on lb.challenge_id=cp.challenge_id and lb.user_id=cp.user_id where cp.challenge_id=p_id order by cp.user_id loop
  target:=case when r.winner then 100 else 0 end;
  foreach k in array array['coins','rank'] loop
   select coalesce(sum(amount),0) into previous from public.reward_ledger where user_id=r.user_id and kind=k and season_key=p_id::text and reason='Challenge winner';
   if target<>previous then
    insert into public.reward_ledger(user_id,kind,amount,season_key,reason,idempotency_key) values(r.user_id,k,target-previous,p_id::text,'Challenge winner','winner:'||p_id||':'||gen_random_uuid());
    if k='coins' then perform paceclub_private.notify(r.user_id,'result:'||p_id||':'||gen_random_uuid(),'Challenge result',c.title||case when target>0 then ': first place confirmed. Ties share the prize.' else ': results were corrected after moderator review.' end);end if;
   end if;
  end loop;
 end loop;
end $$;
create or replace function paceclub_private.finalize_challenge(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c public.challenges; r record;
begin
 perform pg_advisory_xact_lock(68420402);
 select * into strict c from public.challenges where id=p_id for update;
 if c.finalized_at is not null then return;end if;
 if c.ends_at+interval '48 hours'>now() then raise exception 'The 48-hour review window has not closed';end if;
 for r in select user_id from public.challenge_participants where challenge_id=p_id order by user_id loop perform paceclub_private.score_user(r.user_id);end loop;
 perform paceclub_private.sync_challenge_winners(p_id);
 update public.challenges set status='closed',finalized_at=now() where id=p_id;
end $$;
create or replace function public.pc_finalize_challenge(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not paceclub_private.staff() and not exists(select 1 from public.challenges where id=p_id and created_by=auth.uid() and paceclub_private.active_user()) then raise exception 'Challenge administrator required';end if;
 perform paceclub_private.finalize_challenge(p_id);
end $$;
create or replace function public.pc_finalize_due_challenges() returns integer
language plpgsql security definer set search_path='' as $$
declare c record;n integer:=0;
begin
 for c in select id from public.challenges where status='open' and finalized_at is null and ends_at<now()-interval '48 hours' order by id limit 20 loop
  perform paceclub_private.finalize_challenge(c.id);n:=n+1;
 end loop;return n;
end $$;
create or replace function public.pc_transfer_club(p_id uuid,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.clubs where id=p_id for update;
 if not paceclub_private.club_owner(p_id) or p_user=auth.uid() or not exists(select 1 from public.club_members where club_id=p_id and user_id=p_user and status='active') then raise exception 'Select another active club member';end if;
 update public.club_members set role='member' where club_id=p_id and role='owner';
 update public.club_members set role='owner' where club_id=p_id and user_id=p_user;
 update public.clubs set created_by=p_user where id=p_id;
end $$;

create or replace function paceclub_private.post_access(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select paceclub_private.active_user() and exists(select 1 from public.activity_posts p join public.activities a on a.id=p.activity_id
 where p.id=p_id and p.removed_at is null and not paceclub_private.blocked(p.author_id)
 and (p.author_id=auth.uid() or (a.status='verified' and (p.visibility='members' or (p.visibility='club' and paceclub_private.club_member(p.club_id))))))
$$;
create or replace function public.pc_feed(p_offset integer default 0) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(row),'[]') from (
 select p.id,p.activity_id,p.author_id,p.caption,p.photo_path,p.visibility,p.club_id,p.created_at,
  pr.display_name,pr.avatar_path,a.activity_type,a.source,a.distance_m,a.moving_seconds,
  (select count(*) from public.post_kudos where post_id=p.id) as kudos,
  exists(select 1 from public.post_kudos where post_id=p.id and user_id=auth.uid()) as liked,
  (select count(*) from public.post_comments where post_id=p.id and removed_at is null and not paceclub_private.blocked(user_id)) as comments
 from public.activity_posts p join public.profiles pr on pr.id=p.author_id join public.activities a on a.id=p.activity_id
 where paceclub_private.post_access(p.id) order by p.created_at desc,p.id limit 20 offset greatest(0,least(p_offset,10000))
 ) row
$$;
create or replace function public.pc_publish_activity(p_id uuid,p_caption text,p_visibility text,p_club uuid default null,p_photo text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not paceclub_private.owns_activity(p_id) or not exists(select 1 from public.activities where id=p_id and status='verified' and source<>'simulation') then raise exception 'Only your verified real/imported activities can be posted';end if;
 if p_visibility not in ('private','members','club') or (p_visibility='club' and (p_club is null or not paceclub_private.club_member(p_club))) then raise exception 'Invalid visibility or club';end if;
 if p_photo is not null and (split_part(p_photo,'/',1)<>auth.uid()::text or split_part(p_photo,'/',2)<>p_id::text or array_length(string_to_array(p_photo,'/'),1)<>3) then raise exception 'Photo path does not belong to this activity';end if;
 insert into public.activity_posts(activity_id,author_id,caption,visibility,club_id,photo_path)
 values(p_id,auth.uid(),p_caption,p_visibility,case when p_visibility='club' then p_club else null end,p_photo)
 on conflict(activity_id) do update set caption=excluded.caption,visibility=excluded.visibility,club_id=excluded.club_id,photo_path=excluded.photo_path
 returning id into result;return result;
end $$;
create or replace function public.pc_report_content(p_id uuid,p_comment boolean,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare pid uuid; body text;
begin
 if p_comment then select c.post_id,c.body into pid,body from public.post_comments c where c.id=p_id and c.removed_at is null;
 else select p.id,p.caption into pid,body from public.activity_posts p where p.id=p_id;end if;
 if pid is null or not paceclub_private.post_access(pid) then raise exception 'Content unavailable';end if;
 insert into public.content_reports(reporter_id,post_id,comment_id,reason,snapshot)
 values(auth.uid(),case when not p_comment then p_id end,case when p_comment then p_id end,btrim(p_reason),jsonb_build_object('body',body)) on conflict do nothing;
end $$;
create or replace function public.pc_review_content(p_id uuid,p_remove boolean) returns void
language plpgsql security definer set search_path='' as $$
declare r public.content_reports;
begin
 if not paceclub_private.staff() then raise exception 'Moderator required';end if;
 select * into strict r from public.content_reports where id=p_id for update;
 if r.status<>'pending' then return;end if;
 if p_remove then
  if r.post_id is not null then update public.activity_posts set removed_at=now() where id=r.post_id;
  else update public.post_comments set body='[Comment removed]',removed_at=now() where id=r.comment_id;end if;
 end if;
 update public.content_reports set status=case when p_remove then 'reviewed' else 'dismissed' end where id=p_id;
end $$;
create or replace function public.pc_club_directory() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(row),'[]') from(select c.*,
 (select count(*) from public.club_members where club_id=c.id and status='active') as member_count,
 (select role from public.club_members where club_id=c.id and user_id=auth.uid() and status='active') as my_role
 from public.clubs c where paceclub_private.active_user() order by c.created_at desc limit 100) row
$$;

create or replace function public.pc_dashboard(p_type text default 'all') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; uid uuid:=auth.uid();
begin
 if not paceclub_private.active_user() then raise exception 'Sign in first';end if;
 if p_type not in ('all','walk','run','ride') then raise exception 'Invalid activity type';end if;
 select jsonb_build_object(
 'totals',(select jsonb_build_object('distance_m',coalesce(sum(distance_m),0),'moving_seconds',coalesce(sum(moving_seconds),0),'activities',count(*)) from public.activities where user_id=uid and status='verified' and source<>'simulation' and (p_type='all' or activity_type=p_type)),
 'pending',(select count(*) from public.activities where user_id=uid and status in ('submitted','flagged')),
 'weeks',(select coalesce(jsonb_agg(x order by x.week_start),'[]') from (select activity_type,date_trunc('week',started_at at time zone 'Asia/Manila')::date week_start,sum(distance_m)/1000 distance_km,sum(moving_seconds)/60.0 active_minutes,sum(moving_seconds)/60.0/nullif(sum(distance_m)/1000,0) pace_min_per_km,count(*) activities from public.activities where user_id=uid and status='verified' and source<>'simulation' and started_at>=now()-interval '12 weeks' and (p_type='all' or activity_type=p_type) group by activity_type,week_start) x),
 'bests',(select coalesce(jsonb_agg(x),'[]') from(select e.activity_id,a.activity_type,e.distance_m,a.started_at,e.elapsed_seconds,min(e.elapsed_seconds) over(partition by a.activity_type,e.distance_m order by a.started_at,e.activity_id) best_seconds from public.personal_best_efforts e join public.activities a on a.id=e.activity_id where e.user_id=uid and a.status='verified' and a.source='gps' and (p_type='all' or a.activity_type=p_type) order by a.started_at desc limit 200) x),
 'balances',(select jsonb_build_object('xp',coalesce(sum(amount) filter(where kind='xp'),0),'coins',coalesce(sum(amount) filter(where kind='coins'),0)) from public.reward_ledger where user_id=uid),
 'competitive_ready',paceclub_private.competitive_ready(uid)) into result;
 return result;
end $$;

-- Device tokens are never readable by app users. Only this account may register
-- or remove its token. Signing out unregisters it before the session is removed.
create or replace function public.pc_register_push(p_token text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not paceclub_private.active_user() or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then raise exception 'Invalid push token';end if;
 if exists(select 1 from paceclub_private.push_devices where token=p_token and user_id<>auth.uid()) then raise exception 'Sign out of the previous account on this device first';end if;
 if (select count(*) from paceclub_private.push_devices where user_id=auth.uid())>=10 and not exists(select 1 from paceclub_private.push_devices where token=p_token) then raise exception 'Device limit reached';end if;
 insert into paceclub_private.push_devices(token,user_id) values(p_token,auth.uid()) on conflict(token) do update set updated_at=now();
end $$;
create or replace function public.pc_unregister_push(p_token text) returns void
language sql security definer set search_path='' as $$ delete from paceclub_private.push_devices where token=p_token and user_id=auth.uid() $$;
create or replace function paceclub_private.queue_push() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into paceclub_private.push_jobs(notification_id,token) select new.id,token from paceclub_private.push_devices where user_id=new.user_id on conflict do nothing;
 return new;
end $$;
drop trigger if exists pc_notification_push on public.notifications;
create trigger pc_notification_push after insert on public.notifications for each row execute function paceclub_private.queue_push();
create or replace function public.pc_push_take() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 with picked as(select j.id from paceclub_private.push_jobs j join public.notifications n on n.id=j.notification_id
  join paceclub_private.push_devices d on d.token=j.token and d.user_id=n.user_id
  where j.status in ('pending','processing','sent') and j.available_at<=now() and j.attempts<8 order by j.id limit 50 for update of j skip locked),
 updated as(update paceclub_private.push_jobs j set status='processing',attempts=attempts+1,available_at=now()+interval '3 minutes' from picked where j.id=picked.id returning j.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'token',j.token,'ticket',j.ticket,'notification_id',n.id,'title',n.title,'body',n.body)),'[]') into result
 from updated j join public.notifications n on n.id=j.notification_id;
 return result;
end $$;
create or replace function public.pc_push_finish(p_id bigint,p_ticket text default null,p_error text default null,p_delivered boolean default false,p_invalid boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_invalid then delete from paceclub_private.push_devices where token=(select token from paceclub_private.push_jobs where id=p_id);end if;
 update paceclub_private.push_jobs set ticket=coalesce(p_ticket,ticket),error=left(p_error,500),
 status=case when p_delivered then 'delivered' when p_invalid or attempts>=8 then 'failed' when p_ticket is not null or ticket is not null then 'sent' else 'pending' end,
 available_at=now()+interval '5 minutes' where id=p_id;
end $$;

create table if not exists paceclub_private.ai_budget(user_id uuid primary key references public.profiles(id),window_at timestamptz not null default now(),requests integer not null default 0);
revoke all on paceclub_private.ai_budget from public,anon,authenticated;
alter table paceclub_private.ai_budget enable row level security;
create or replace function public.pc_reserve_insight() returns boolean
language plpgsql security definer set search_path='' as $$
declare used integer;
begin
 if not paceclub_private.active_user() then return false;end if;
 insert into paceclub_private.ai_budget(user_id,requests) values(auth.uid(),1) on conflict(user_id) do update
 set requests=case when paceclub_private.ai_budget.window_at<now()-interval '1 hour' then 1 else paceclub_private.ai_budget.requests+1 end,
 window_at=case when paceclub_private.ai_budget.window_at<now()-interval '1 hour' then now() else paceclub_private.ai_budget.window_at end
 returning requests into used;return used<=5;
end $$;

-- A migration-version probe is authenticated and exposes no account data.
create or replace function public.pc_app_version() returns text language sql stable as $$ select 'full-v1'::text $$;

-- All newly public functions are explicitly granted; workers are service-only.
do $$ declare f record; begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('pc_my_role','pc_competitive_ready','pc_create_challenge','pc_join_challenge','pc_verify_activity','pc_review_activity','pc_submit_appeal','pc_buy_item','pc_equip_item','pc_finalize_challenge','pc_transfer_club','pc_feed','pc_publish_activity','pc_report_content','pc_review_content','pc_club_directory','pc_dashboard','pc_register_push','pc_unregister_push','pc_reserve_insight','pc_app_version') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  execute format('grant execute on function %s to authenticated,service_role',f.sig);
 end loop;
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('pc_push_take','pc_push_finish','pc_finalize_due_challenges') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);
 end loop;
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='paceclub_private' and p.proname in
 ('notify','haversine','measure_activity','competitive_ready','sync_activity_rewards','score_user','apply_verification','verify','after_submit','finalize_challenge','queue_push','membership_history','sync_challenge_goals','sync_challenge_winners') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 end loop;
end $$;
do $$ declare t text; begin
 foreach t in array array['activities','activity_appeals','challenges','club_members','reward_ledger','user_inventory','territories'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t);end if;
 end loop;
end $$;
insert into paceclub_private.migrations(version) values('full-v1') on conflict do nothing;
commit;
