# Database installation

| Your database | Run, in this order |
| --- | --- |
| Existing working PaceClub recorder project | `03-full-app.sql`, then `04-territory.sql` |
| New, empty Supabase project | `01-new-project-schema.sql`, `02-storage-and-oauth.sql`, `03-full-app.sql`, `04-territory.sql` |

Run each complete file in SQL Editor as the project administrator. Files 01 and 02 are the original bootstrap; do not rerun them over an existing project. Files 03 and 04 add the full feature behavior without dropping existing account/activity tables.

Keep RLS enabled. Client writes are limited to owner input fields. Verification, credit, purchases, winner adjustments and territory use authenticated RPCs with explicit role checks. Raw routes are readable only by their owner and staff. Feed RPCs expose selected summaries, not raw coordinates.

## PostGIS location

04 expects the extension in `extensions`. Check an existing installation with:

```sql
select e.extname, n.nspname
from pg_extension e join pg_namespace n on n.oid=e.extnamespace
where e.extname='postgis';
```

If already installed elsewhere, keep that installation. Adapt `extensions.` type/function references in a copy of 04 and its schema check to the returned schema name. Do not drop the extension or dependent tables. Supabase’s SQL Editor is needed; a public frontend key cannot install extensions.

## Admin role

Use the trusted account UUID from Supabase Authentication → Users:

```sql
insert into paceclub_private.user_roles(user_id,role)
values ('REPLACE_WITH_USER_UUID'::uuid,'admin')
on conflict(user_id) do update set role=excluded.role;
```

Only a database administrator should run this. Use `moderator` for review-only staff. Athletes cannot grant themselves roles through the public API.

## Existing activity and membership data

The migrations leave existing submitted recordings pending until the owner/staff requests verification. New submissions verify automatically. Measurements are recalculated from reliable saved samples. A suspicious signal yields an explanation and an appeal path; sensor signals are not proof of cheating.

Active club memberships receive an initial history interval from their saved join time. Membership changes after this migration are recorded as intervals. Historic periods for already-left members cannot be reconstructed from the old schema and are not invented. New challenges require joining before the activity starts and explicitly selecting the challenge in the recorder.

## Operational rules

- Competition unlock: tutorial + 3 verified GPS activities across 2 Philippine dates.
- GPS-only rewards and competitive entries; GPX/practice are excluded.
- Daily caps use `Asia/Manila`; club goals aggregate member contributions, retaining earned credit after leaving.
- Time trials use elapsed time to a fixed distance in the first uninterrupted GPS segment. Pauses cannot improve a result.
- Finalization waits 48 hours after the end. Equal first-place scores share the prize. Moderator revocations reconcile activity, goal and finalized winner ledgers.
- Accepted territory is replayed by server acceptance order. Reversals restore earlier valid ownership. Reinstating an activity does not automatically reinstate its reversed land claim; that requires a new eligible loop under the one-claim-per-activity rule.
- Push device tokens and jobs remain private. Only the server service role can use worker RPCs.

The test harness runs PostgreSQL-compatible PGlite with PostGIS and Supabase auth/storage stubs. It never connects to your live project. Use a staging Supabase project for final service-level validation and backup your project before deployment.
