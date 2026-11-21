import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
export async function database() {
  const db = new PGlite({ extensions: { postgis } });
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
 create publication supabase_realtime;create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text not null,owner_id text,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;
 grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;`);
  for (const file of [
    "01-new-project-schema.sql",
    "02-storage-and-oauth.sql",
    "03-full-app.sql",
    "04-territory.sql",
  ]) {
    const path = new URL("../database/" + file, import.meta.url);
    if (!fs.existsSync(path)) continue;
    const sql = fs.readFileSync(path, "utf8");
    try {
      await db.exec(sql);
    } catch (e) {
      console.error(
        file,
        e.message,
        e.where || "",
        e.position
          ? sql.slice(Number(e.position) - 100, Number(e.position) + 150)
          : "",
      );
      await db.close();
      throw Error("Migration failed: " + file + " " + e.message);
    }
  }
  return db;
}
export const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  M = "33333333-3333-4333-8333-333333333333";
export async function user(db, id) {
  await db.exec(
    `reset role;set request.jwt.claim.sub='${id || ""}';${id ? "set role authenticated;" : ""}`,
  );
}
export async function scalar(db, sql, args = []) {
  return Object.values((await db.query(sql, args)).rows[0] || {})[0];
}
export async function activity(
  db,
  {
    owner = A,
    source = "gps",
    type = "walk",
    start = Date.now() - 600000,
    points = 8,
    challenge = null,
    club = null,
    coords = null,
  } = {},
) {
  await user(db, owner);
  const id = await scalar(
    db,
    "insert into activities(user_id,activity_type,source,started_at,selected_challenge_id,selected_club_id) values($1,$2,$3,$4,$5,$6) returning id",
    [owner, type, source, new Date(start).toISOString(), challenge, club],
  );
  for (let i = 0; i < points; i++)
    await db.query(
      "insert into activity_points(activity_id,sample_number,recorded_at,latitude,longitude,accuracy_m) values($1,$2,$3,$4,$5,5)",
      [
        id,
        i,
        new Date(start + i * 10000).toISOString(),
        coords ? coords[i][1] : 16 + i * 0.0001,
        coords ? coords[i][0] : 120,
      ],
    );
  await db.query(
    "update activities set ended_at=$2,sensor_summary='{}' where id=$1",
    [id, new Date(start + (points - 1) * 10000).toISOString()],
  );
  await db.query("select pc_set_activity_status($1,'completed')", [id]);
  await db.query("select pc_set_activity_status($1,'submitted')", [id]);
  return id;
}
