-- PACECLUB: STORAGE + SOCIAL SIGN-IN PROFILE ADD-ON
-- Run the ENTIRE file once, AFTER paceclub_supabase_setup.sql succeeded.
-- Use Supabase > SQL Editor > New query. Do not rerun the original setup.
-- This creates three PRIVATE buckets, their policies, a GPX path column, and
-- updates the existing signup trigger function to recognize social-login names.
-- Google/Facebook still require their own developer-console credentials and
-- Supabase Auth provider settings. This file does NOT enable those providers.

begin;

do $$
begin
  if to_regclass('public.profiles') is null or to_regclass('public.activity_posts') is null
    or to_regprocedure('paceclub_private.active_user()') is null
    or to_regprocedure('paceclub_private.post_access(uuid)') is null then
    raise exception 'Run the original PaceClub database setup successfully first.';
  end if;
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception 'Supabase Storage must be available in this project.';
  end if;
  if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then
    raise exception 'Storage objects must have RLS enabled before applying this add-on.';
  end if;
  if exists(select 1 from storage.buckets where id in ('avatars','activity-photos','gpx-imports')) then
    raise exception 'One of the target buckets already exists. Stop and review it; nothing was replaced.';
  end if;
end;
$$;

-- Limits are bytes: 2 MiB for avatars, 5 MiB for activity photos, 10 MiB for GPX.
-- File extension and MIME checks do not validate actual GPX contents.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('avatars','avatars',false,2097152,array['image/jpeg','image/png','image/webp']),
  ('activity-photos','activity-photos',false,5242880,array['image/jpeg','image/png','image/webp']),
  ('gpx-imports','gpx-imports',false,10485760,
    array['application/gpx+xml','application/xml','text/xml','application/octet-stream']);

-- File paths are object keys inside a bucket, not full URLs or signed URLs.
-- avatars:         <auth-user-uuid>/<unique-file>.jpg
-- activity-photos: <auth-user-uuid>/<activity-uuid>/<unique-file>.jpg
-- gpx-imports:     <auth-user-uuid>/<unique-file>.gpx
alter table public.activities add column gpx_file_path text;
alter table public.activities add constraint pc_gpx_path_owned check (
  gpx_file_path is null or
  (source='gpx' and split_part(gpx_file_path,'/',1)=user_id::text
    and array_length(string_to_array(gpx_file_path,'/'),1)=2
    and gpx_file_path ~* '[.]gpx$')
);
grant insert(gpx_file_path),update(gpx_file_path) on public.activities to authenticated;

-- Private helpers also guard these buckets against unrelated broad Storage
-- policies. Anonymous callers always get false; no table access is granted.
create function paceclub_private.storage_can_write(p_bucket text,p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select paceclub_private.active_user()
    and split_part(p_name,'/',1)=auth.uid()::text
    and case p_bucket
      when 'avatars' then
        array_length(string_to_array(p_name,'/'),1)=2 and p_name ~* '[.](jpg|jpeg|png|webp)$'
      when 'activity-photos' then
        array_length(string_to_array(p_name,'/'),1)=3 and p_name ~* '[.](jpg|jpeg|png|webp)$'
        and exists(select 1 from public.activities a
          where a.id::text=split_part(p_name,'/',2) and a.user_id=auth.uid())
      when 'gpx-imports' then
        array_length(string_to_array(p_name,'/'),1)=2 and p_name ~* '[.]gpx$'
      else false end;
$$;
create function paceclub_private.storage_can_read(p_bucket text,p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select paceclub_private.active_user() and case p_bucket
    -- Avatars are visible to signed-in, active app users; not to the public.
    when 'avatars' then true
    when 'gpx-imports' then paceclub_private.storage_can_write(p_bucket,p_name)
    when 'activity-photos' then paceclub_private.storage_can_write(p_bucket,p_name)
      or exists(select 1 from public.activity_posts p
        where p.photo_path=p_name
          and p.author_id::text=split_part(p_name,'/',1)
          and p.activity_id::text=split_part(p_name,'/',2)
          and paceclub_private.post_access(p.id))
    else false end;
$$;
revoke all on function paceclub_private.storage_can_write(text,text),
  paceclub_private.storage_can_read(text,text) from public,anon,authenticated;
grant usage on schema paceclub_private to anon;
grant execute on function paceclub_private.storage_can_write(text,text),
  paceclub_private.storage_can_read(text,text) to anon,authenticated;

-- Permissive policies grant access only for the three PaceClub buckets.
create policy pc_files_read on storage.objects for select to authenticated
  using (bucket_id in ('avatars','activity-photos','gpx-imports')
    and paceclub_private.storage_can_read(bucket_id,name));
create policy pc_files_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars','activity-photos','gpx-imports')
    and paceclub_private.storage_can_write(bucket_id,name));
create policy pc_files_update on storage.objects for update to authenticated
  using (bucket_id in ('avatars','activity-photos','gpx-imports')
    and paceclub_private.storage_can_write(bucket_id,name))
  with check (bucket_id in ('avatars','activity-photos','gpx-imports')
    and paceclub_private.storage_can_write(bucket_id,name));
create policy pc_files_delete on storage.objects for delete to authenticated
  using (bucket_id in ('avatars','activity-photos','gpx-imports')
    and paceclub_private.storage_can_write(bucket_id,name));

-- Restrictive guards stop a separate "allow everyone" policy from bypassing
-- these permissions. They leave policies for other buckets unchanged.
create policy pc_files_read_guard on storage.objects as restrictive for select to public
  using (case when bucket_id in ('avatars','activity-photos','gpx-imports')
    then paceclub_private.storage_can_read(bucket_id,name) else true end);
create policy pc_files_insert_guard on storage.objects as restrictive for insert to public
  with check (case when bucket_id in ('avatars','activity-photos','gpx-imports')
    then paceclub_private.storage_can_write(bucket_id,name) else true end);
create policy pc_files_update_guard on storage.objects as restrictive for update to public
  using (case when bucket_id in ('avatars','activity-photos','gpx-imports')
    then paceclub_private.storage_can_write(bucket_id,name) else true end)
  with check (case when bucket_id in ('avatars','activity-photos','gpx-imports')
    then paceclub_private.storage_can_write(bucket_id,name) else true end);
create policy pc_files_delete_guard on storage.objects as restrictive for delete to public
  using (case when bucket_id in ('avatars','activity-photos','gpx-imports')
    then paceclub_private.storage_can_write(bucket_id,name) else true end);

-- The original trigger remains attached to this function. Only new signups
-- are affected; existing profiles and chosen display names are preserved.
create or replace function paceclub_private.handle_signup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,display_name) values
    (new.id,left(coalesce(
      nullif(btrim(new.raw_user_meta_data->>'display_name'),''),
      nullif(btrim(new.raw_user_meta_data->>'full_name'),''),
      nullif(btrim(new.raw_user_meta_data->>'name'),''),'Runner'),80));
  insert into public.safety_settings(user_id) values(new.id);
  insert into public.onboarding_answers(user_id) values(new.id);
  return new;
end;
$$;
revoke all on function paceclub_private.handle_signup() from public,anon,authenticated;

commit;

-- Expected result: 3 rows, each public=false.
select id,public,file_size_limit,allowed_mime_types from storage.buckets
where id in ('avatars','activity-photos','gpx-imports') order by id;

-- HOW TO USE
-- 1. Sign in with Supabase Auth; upload using the user's session.
-- 2. Use the exact folder layouts above. Do not put the bucket ID in the key.
-- 3. Store keys in profiles.avatar_path, activity_posts.photo_path, or activities.gpx_file_path.
-- 4. Use authenticated downloads or short-lived signed URLs to display private files.
--    Example: client.storage.from('avatars').createSignedUrl(path,300)
--    A signed URL is a temporary bearer link: anyone holding it can use it until
--    expiry. Refresh it as needed, and never store the expiring URL in the table.
-- 5. For FlutterFlow, use Upload/Save Media (Supabase) with the correct Bucket
--    Name and Uploaded Folder Path. If only a public URL is returned, use a
--    Custom Action to upload/return the object key and request a signed URL.
-- 6. Use unique file names. Upload first; update the database reference only
--    after the upload succeeds. Remove unused files through the Storage API,
--    not by deleting storage.objects rows with SQL.
-- 7. Activity photos are owner-only until referenced by an accessible feed post.
--    The original database allows creating a feed post after activity verification.
-- 8. GPX files are owner-only. A backend parser must validate imported data,
--    reject unsafe XML/excessive input, and create activity_points. Keep source='gpx'.
--    Imported files do not become trusted GPS evidence for ranked play.
-- 9. Keep avatar files in avatars; do not place private documents or routes there.
--    Clan logos/theme artwork can be bundled as FlutterFlow app assets for now.
-- 10. Text chat already exists. Chat attachments require their own metadata and
--     conversation-based file policies; they are not enabled by this add-on.
--
-- SOCIAL LOGIN
-- Configure Google/Meta credentials in Supabase Auth > Sign In / Providers.
-- Use the callback URL COPIED from Supabase in the provider's developer console.
-- Separately add your app web URL/mobile deep link in Supabase Auth > URL Configuration.
-- Never paste provider secrets or a Supabase secret/service_role key into FlutterFlow.
-- Do not add a second Insert Profile action after OAuth: the Auth trigger creates it.
--
-- References:
-- https://supabase.com/docs/guides/storage/buckets/creating-buckets
-- https://supabase.com/docs/guides/storage/security/access-control
-- https://supabase.com/docs/guides/storage/buckets/fundamentals
