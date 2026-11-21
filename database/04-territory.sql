-- Full territory mode. PostGIS is installed in extensions, matching this file.
-- Run after 03-full-app.sql. Raw activity points remain private.
begin;
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
do $$ begin
 if (select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='postgis')<>'extensions' then
  raise exception 'PostGIS is already installed in a different schema. Adapt the extensions qualifiers to that schema; do not drop an existing PostGIS installation.';
 end if;
end $$;
alter table public.play_zones add column if not exists season_key text not null default 'Season 1';
alter table public.territory_claims add column if not exists accepted_order bigint;
alter table public.territory_claims add column if not exists decision_note text;
create sequence if not exists paceclub_private.claim_order;
revoke all on sequence paceclub_private.claim_order from public,anon,authenticated;
revoke insert(activity_id,user_id,zone_id) on public.territory_claims from authenticated;
create or replace function paceclub_private.replay_zone(p_zone uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c record;t record;claim extensions.geometry;remaining extensions.geometry;area numeric;
begin
 perform 1 from public.play_zones where id=p_zone for update;
 delete from public.territories where zone_id=p_zone;
 for c in select * from public.territory_claims where zone_id=p_zone and status='accepted' order by accepted_order,id loop
  claim:=extensions.st_setsrid(extensions.st_geomfromgeojson(c.boundary_geojson::text),4326);
  for t in select * from public.territories where zone_id=p_zone loop
   remaining:=extensions.st_collectionextract(extensions.st_difference(extensions.st_setsrid(extensions.st_geomfromgeojson(t.boundary_geojson::text),4326),claim),3);
   if extensions.st_isempty(remaining) then delete from public.territories where id=t.id;
   else
    area:=extensions.st_area(remaining::extensions.geography);
    if area<1 then delete from public.territories where id=t.id;
    else update public.territories set boundary_geojson=extensions.st_asgeojson(remaining)::jsonb,area_m2=area,updated_at=now() where id=t.id;end if;
   end if;
  end loop;
  insert into public.territories(claim_id,owner_id,zone_id,boundary_geojson,area_m2)
   values(c.id,c.user_id,p_zone,c.boundary_geojson,extensions.st_area(claim::extensions.geography));
 end loop;
end $$;
create or replace function public.pc_create_zone(p_name text,p_boundary jsonb,p_season text default 'Season 1') returns uuid
language plpgsql security definer set search_path='' as $$
declare g extensions.geometry;area double precision;id uuid;
begin
 if public.pc_my_role()<>'admin' then raise exception 'An administrator must approve play zones';end if;
 if length(btrim(p_name)) not between 3 and 100 or length(btrim(p_season)) not between 1 and 40 or length(p_boundary::text)>100000 then raise exception 'Invalid zone name or boundary';end if;
 g:=extensions.st_setsrid(extensions.st_geomfromgeojson(p_boundary::text),4326);
 if extensions.geometrytype(g)<>'POLYGON' or not extensions.st_isvalid(g) or extensions.st_numinteriorrings(g)>0 or extensions.st_npoints(g)>2000
 or extensions.st_xmin(g)<-180 or extensions.st_xmax(g)>180 or extensions.st_ymin(g)<-85 or extensions.st_ymax(g)>85 then raise exception 'Use a valid simple zone polygon with longitude/latitude coordinates';end if;
 area:=extensions.st_area(g::extensions.geography);
 if area<100 or area>10000000 then raise exception 'Play-zone area must be between 100 square metres and 10 square kilometres';end if;
 insert into public.play_zones(name,boundary_geojson,season_key) values(btrim(p_name),extensions.st_asgeojson(g)::jsonb,btrim(p_season)) returning public.play_zones.id into id;return id;
end $$;
create or replace function public.pc_claim_territory(p_activity uuid,p_zone uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.activities;z public.play_zones;existing public.territory_claims;line extensions.geometry;poly extensions.geometry;zone extensions.geometry;
 count_points integer;bad boolean;reason text;cid uuid;area numeric;other record;
begin
 if not paceclub_private.owns_activity(p_activity) then raise exception 'Activity unavailable';end if;
 select * into strict a from public.activities where id=p_activity for update;
 select * into z from public.play_zones where id=p_zone and is_active for update;
 if not found then raise exception 'Choose an active approved play zone';end if;
 select * into existing from public.territory_claims where activity_id=p_activity;
 if found then return existing.id;end if;
 if a.status<>'verified' or a.source<>'gps' or a.activity_type not in ('walk','run') or not paceclub_private.competitive_ready(auth.uid()) then raise exception 'An unlocked, verified GPS walk or run is required';end if;
 if (select count(*) from public.territory_claims where zone_id=p_zone and status='accepted')>=500 then raise exception 'This zone reached its season claim limit. Ask an administrator to start a new season';end if;
 select count(*),extensions.st_makeline(extensions.st_setsrid(extensions.st_makepoint(longitude,latitude),4326) order by sample_number)
  into count_points,line from public.activity_points where activity_id=p_activity;
 select exists(select 1 from(select *,lag(recorded_at) over(order by sample_number) t,
 lag(latitude) over(order by sample_number) lat,lag(longitude) over(order by sample_number) lon from public.activity_points where activity_id=p_activity) p
 where accuracy_m is null or accuracy_m>15 or (t is not null and (extract(epoch from(recorded_at-t)) not between 0.01 and 20
 or paceclub_private.haversine(lat,lon,latitude,longitude)/greatest(.01,extract(epoch from(recorded_at-t)))>case when a.activity_type='walk' then 7 else 12 end))) into bad;
 if count_points<4 or count_points>2000 then reason:='A territory route needs 4–2,000 reliable samples.';
 elsif bad then reason:='GPS gaps, accuracy or speeds make this boundary unreliable.';
 elsif jsonb_typeof(coalesce(a.sensor_summary->'segment_starts','[0]'))<>'array' then reason:='Pause metadata is invalid.';
 elsif jsonb_array_length(coalesce(a.sensor_summary->'segment_starts','[0]'))>1 then reason:='Use one continuous loop without paused or missing segments.';
 elsif extensions.st_distance(extensions.st_startpoint(line)::extensions.geography,extensions.st_endpoint(line)::extensions.geography)>15 then reason:='Finish within 15 metres of the start to close the loop.';
 else
  if not extensions.st_isclosed(line) then line:=extensions.st_addpoint(line,extensions.st_startpoint(line));end if;
  if not extensions.st_issimple(line) then reason:='The route crosses itself. Use a simple loop.';
  else
   poly:=extensions.st_makepolygon(line);zone:=extensions.st_setsrid(extensions.st_geomfromgeojson(z.boundary_geojson::text),4326);
   area:=extensions.st_area(poly::extensions.geography);
   if not extensions.st_isvalid(poly) or area<100 then reason:='The enclosed area is too small or invalid.';
   elsif not extensions.st_covers(zone,poly) then reason:='The entire loop must stay within the approved play zone.';end if;
  end if;
 end if;
 insert into public.territory_claims(activity_id,user_id,zone_id,status,boundary_geojson,area_m2,accepted_order,decision_note)
 values(a.id,auth.uid(),z.id,case when reason is null then 'accepted' else 'rejected' end,
 case when reason is null then extensions.st_asgeojson(poly)::jsonb end,case when reason is null then area end,
 case when reason is null then nextval('paceclub_private.claim_order') end,coalesce(reason,'Verified continuous loop accepted. Later accepted claims own any overlap.')) returning id into cid;
 if reason is null then
  for other in select distinct owner_id from public.territories where zone_id=z.id and owner_id<>auth.uid()
   and extensions.st_intersects(extensions.st_setsrid(extensions.st_geomfromgeojson(boundary_geojson::text),4326),poly) loop
   perform paceclub_private.notify(other.owner_id,'territory-overlap:'||cid,'Territory updated','A verified claim changed ownership in '||z.name||'.');
  end loop;
  perform paceclub_private.replay_zone(z.id);
 end if;
 perform paceclub_private.notify(auth.uid(),'claim:'||cid,case when reason is null then 'Territory captured' else 'Territory not captured' end,coalesce(reason,'Your loop in '||z.name||' was accepted.'));
 return cid;
end $$;
create or replace function public.pc_reverse_claim(p_id uuid,p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare c public.territory_claims;
begin
 if not paceclub_private.staff() or length(btrim(p_note)) not between 3 and 2000 then raise exception 'Moderator and explanation required';end if;
 select * into strict c from public.territory_claims where id=p_id;
 if c.user_id=auth.uid() then raise exception 'Another moderator must review your claim';end if;
 perform 1 from public.play_zones where id=c.zone_id for update;
 if c.status<>'accepted' then return;end if;
 update public.territory_claims set status='reversed',decision_note=btrim(p_note) where id=p_id;
 perform paceclub_private.replay_zone(c.zone_id);
 perform paceclub_private.notify(c.user_id,'claim-reversed:'||c.id,'Territory review',p_note);
end $$;
create or replace function public.pc_new_zone_season(p_id uuid,p_season text) returns uuid
language plpgsql security definer set search_path='' as $$
declare z public.play_zones;new_id uuid;
begin
 if public.pc_my_role()<>'admin' then raise exception 'Administrator required';end if;
 select * into strict z from public.play_zones where id=p_id and is_active for update;
 new_id:=public.pc_create_zone(z.name,z.boundary_geojson,p_season);
 update public.play_zones set is_active=false where id=p_id;return new_id;
end $$;
create or replace function public.pc_territory_board(p_zone uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(row),'[]') from(select t.owner_id,p.display_name,sum(t.area_m2) area_m2,dense_rank() over(order by sum(t.area_m2) desc) position
 from public.territories t join public.profiles p on p.id=t.owner_id where t.zone_id=p_zone and paceclub_private.active_user()
 group by t.owner_id,p.display_name order by area_m2 desc) row
$$;
-- A verified activity can be revoked only by a different moderator. All credit
-- is reconciled in the same transaction, including previously finalized results.
create or replace function public.pc_revoke_activity(p_id uuid,p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare a public.activities;z record;
begin
 if not paceclub_private.staff() or length(btrim(p_note)) not between 3 and 2000 then raise exception 'Moderator and explanation required';end if;
 select * into strict a from public.activities where id=p_id for update;
 if a.user_id=auth.uid() then raise exception 'Another moderator must review your activity';end if;
 if a.status='rejected' then return;end if;
 if a.status<>'verified' then raise exception 'This activity is not verified';end if;
 perform paceclub_private.apply_verification(p_id,'rejected',p_note,paceclub_private.measure_activity(p_id),auth.uid());
 for z in select distinct zone_id from public.territory_claims where activity_id=p_id and status='accepted' order by zone_id loop
  perform 1 from public.play_zones where id=z.zone_id for update;
  update public.territory_claims set status='reversed',decision_note='Activity revoked: '||p_note where activity_id=p_id and zone_id=z.zone_id and status='accepted';
  perform paceclub_private.replay_zone(z.zone_id);
 end loop;
 update public.activity_posts set removed_at=now() where activity_id=p_id;
end $$;
revoke all on function paceclub_private.replay_zone(uuid) from public,anon,authenticated;
do $$ declare f record;begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('pc_create_zone','pc_claim_territory','pc_reverse_claim','pc_new_zone_season','pc_territory_board','pc_revoke_activity') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to authenticated,service_role',f.sig);
 end loop;
end $$;
insert into paceclub_private.migrations(version) values('territory-v1') on conflict do nothing;
commit;
