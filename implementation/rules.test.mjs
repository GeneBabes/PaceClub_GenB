import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { database, user, scalar, activity, A, B, M } from "./setup.mjs";
let db, capped, clubChallenge, clubId, claimA, claimB, zone, loopA;
before(async () => {
  db = await database();
  await db.query("insert into auth.users(id) values($1),($2),($3)", [A, B, M]);
  await db.query("insert into paceclub_private.user_roles values($1,'admin')", [
    M,
  ]);
});
after(async () => {
  await db?.close();
});
async function unlock(owner) {
  await user(db, owner);
  await db.query(
    "update onboarding_answers set tutorial_completed_at=now() where user_id=$1",
    [owner],
  );
  for (let day = 1; day <= 3; day++)
    await activity(db, { owner, start: Date.now() - day * 86400000 });
  await user(db, owner);
  assert.equal(await scalar(db, "select pc_competitive_ready()"), true);
}
test("daily caps and goal rewards are enforced and retry-safe", async () => {
  await user(db, A);
  capped = await scalar(
    db,
    "select pc_create_challenge('Small steps','walk','casual',now()-interval '1 minute',now()+interval '1 day',100,100)",
  );
  await db.query("select pc_join_challenge($1)", [capped]);
  const first = await activity(db, {
    challenge: capped,
    start: Date.now() + 1000,
  });
  await activity(db, { challenge: capped, start: Date.now() + 120000 });
  assert.equal(
    Number(
      await scalar(
        db,
        "select total_points from pc_challenge_leaderboard where challenge_id=$1",
        [capped],
      ),
    ),
    100,
  );
  assert.equal(
    await scalar(
      db,
      "select sum(amount)::int from reward_ledger where reason='Challenge goal '||$1::text",
      [capped],
    ),
    50,
  );
  await db.query("select pc_verify_activity($1)", [first]);
  assert.equal(
    await scalar(
      db,
      "select sum(amount)::int from reward_ledger where reason='Challenge goal '||$1::text",
      [capped],
    ),
    50,
  );
});
test("activities begun before joining cannot gain retroactive credit", async () => {
  await user(db, A);
  const c = await scalar(
    db,
    "select pc_create_challenge('No retroactive credit','walk','casual',now()-interval '5 minutes',now()+interval '1 day',100,1000)",
  );
  await db.query("select pc_join_challenge($1)", [c]);
  await activity(db, { challenge: c, start: Date.now() - 180000 });
  assert.equal(
    await scalar(
      db,
      "select count(*)::int from challenge_entries where challenge_id=$1",
      [c],
    ),
    0,
  );
});
test("club goals use shared progress and preserve credit after leaving", async () => {
  await unlock(A);
  await unlock(B);
  await user(db, A);
  clubId = await scalar(
    db,
    "select pc_create_club('Trail friends','Shared test goal')",
  );
  clubChallenge = await scalar(
    db,
    "select pc_create_challenge('Together','walk','club',now()-interval '3 minutes',now()+interval '1 day',100,1000,$1)",
    [clubId],
  );
  await db.query("select pc_join_challenge($1)", [clubChallenge]);
  await user(db, B);
  await db.query("select pc_join_club($1)", [clubId]);
  await db.query("select pc_join_club($1)", [clubId]);
  await db.query("select pc_join_challenge($1)", [clubChallenge]);
  await user(db, "");
  await db.query(
    "update challenge_participants set joined_at=now()-interval '3 minutes' where challenge_id=$1",
    [clubChallenge],
  );
  await db.query(
    "update paceclub_private.club_membership_periods set started_at=now()-interval '3 minutes' where club_id=$1",
    [clubId],
  );
  await activity(db, {
    owner: A,
    club: clubId,
    challenge: clubChallenge,
    start: Date.now() - 120000,
  });
  await activity(db, {
    owner: B,
    club: clubId,
    challenge: clubChallenge,
    start: Date.now() - 120000,
  });
  await user(db, "");
  assert.equal(
    await scalar(
      db,
      "select sum(amount)::int from reward_ledger where reason='Challenge goal '||$1::text",
      [clubChallenge],
    ),
    100,
  );
  await user(db, B);
  await db.query("select pc_leave_club($1)", [clubId]);
  await activity(db, { owner: B });
  assert.equal(
    await scalar(
      db,
      "select count(*)::int from challenge_entries where challenge_id=$1",
      [clubChallenge],
    ),
    0,
  );
  await user(db, "");
  assert.ok(
    Number(
      await scalar(
        db,
        "select sum(points) from challenge_entries where challenge_id=$1 and user_id=$2",
        [clubChallenge, B],
      ),
    ) > 70,
  );
  await user(db, B);
  await db.query("select pc_join_club($1)", [clubId]);
});
test("only admins approve zones; later loops take only their overlap", async () => {
  const boundary = {
    type: "Polygon",
    coordinates: [
      [
        [119.999, 15.999],
        [120.002, 15.999],
        [120.002, 16.002],
        [119.999, 16.002],
        [119.999, 15.999],
      ],
    ],
  };
  await user(db, A);
  await assert.rejects(
    db.query("select pc_create_zone($1,$2::jsonb)", [
      "Approved zone",
      JSON.stringify(boundary),
    ]),
  );
  await user(db, M);
  zone = await scalar(db, "select pc_create_zone($1,$2::jsonb)", [
    "Approved zone",
    JSON.stringify(boundary),
  ]);
  loopA = await activity(db, {
    owner: A,
    points: 5,
    coords: [
      [120, 16],
      [120.0002, 16],
      [120.0002, 16.0002],
      [120, 16.0002],
      [120, 16],
    ],
  });
  claimA = await scalar(db, "select pc_claim_territory($1,$2)", [loopA, zone]);
  assert.equal(
    await scalar(db, "select status from territory_claims where id=$1", [
      claimA,
    ]),
    "accepted",
  );
  const original = Number(
    await scalar(db, "select area_m2 from territories where claim_id=$1", [
      claimA,
    ]),
  );
  const loopB = await activity(db, {
    owner: B,
    points: 5,
    coords: [
      [120.0001, 16],
      [120.0003, 16],
      [120.0003, 16.0002],
      [120.0001, 16.0002],
      [120.0001, 16],
    ],
  });
  claimB = await scalar(db, "select pc_claim_territory($1,$2)", [loopB, zone]);
  const remaining = Number(
    await scalar(db, "select area_m2 from territories where claim_id=$1", [
      claimA,
    ]),
  );
  assert.ok(Math.abs(remaining / original - 0.5) < 0.01);
  assert.equal(
    await scalar(db, "select pc_claim_territory($1,$2)", [loopB, zone]),
    claimB,
  );
  await user(db, M);
  await db.query("select pc_reverse_claim($1,$2)", [
    claimB,
    "Review confirmed invalid boundary",
  ]);
  assert.ok(
    Math.abs(
      Number(
        await scalar(db, "select area_m2 from territories where claim_id=$1", [
          claimA,
        ]),
      ) - original,
    ) < 1,
  );
});
test("open loops, imports, and direct geometry writes cannot capture territory", async () => {
  const open = await activity(db, {
    owner: A,
    points: 4,
    coords: [
      [120, 16],
      [120.0002, 16],
      [120.0002, 16.0002],
      [120, 16.0002],
    ],
  });
  const rejected = await scalar(db, "select pc_claim_territory($1,$2)", [
    open,
    zone,
  ]);
  assert.equal(
    await scalar(db, "select status from territory_claims where id=$1", [
      rejected,
    ]),
    "rejected",
  );
  const gpx = await activity(db, { source: "gpx" });
  await assert.rejects(
    db.query("select pc_claim_territory($1,$2)", [gpx, zone]),
  );
  await assert.rejects(
    db.query(
      "insert into territory_claims(activity_id,user_id,zone_id) values($1,$2,$3)",
      [gpx, A, zone],
    ),
  );
});
test("verified activity revocation removes rewards and territory exactly once", async () => {
  await user(db, M);
  await db.query("select pc_revoke_activity($1,$2)", [
    loopA,
    "Reliable evidence shows this activity is invalid",
  ]);
  await db.query("select pc_revoke_activity($1,$2)", [
    loopA,
    "Repeat after a lost response",
  ]);
  await user(db, A);
  assert.equal(
    await scalar(
      db,
      "select count(*)::int from territories where claim_id=$1",
      [claimA],
    ),
    0,
  );
  assert.equal(
    await scalar(
      db,
      "select coalesce(sum(amount),0)::int from reward_ledger where activity_id=$1 and kind='coins'",
      [loopA],
    ),
    0,
  );
  assert.equal(
    await scalar(db, "select status from activities where id=$1", [loopA]),
    "rejected",
  );
});
test("finalized winners are idempotent and revocations reconcile their ledger", async () => {
  await user(db, "");
  await db.query(
    "update challenges set ends_at=now()-interval '3 days',starts_at=now()-interval '4 days' where id=$1",
    [clubChallenge],
  );
  await db.query(
    "update challenge_participants set joined_at=now()-interval '4 days' where challenge_id=$1",
    [clubChallenge],
  );
  await db.query(
    "update paceclub_private.club_membership_periods set started_at=now()-interval '4 days' where club_id=$1 and user_id=$2 and ended_at is null",
    [clubId, B],
  );
  const valid = await activity(db, {
    owner: B,
    club: clubId,
    challenge: clubChallenge,
    start: Date.now() - 3.5 * 86400000,
  });
  await user(db, M);
  await db.query("select pc_finalize_challenge($1)", [clubChallenge]);
  await db.query("select pc_finalize_challenge($1)", [clubChallenge]);
  await user(db, B);
  assert.equal(
    await scalar(
      db,
      "select sum(amount)::int from reward_ledger where season_key=$1 and kind='rank'",
      [clubChallenge],
    ),
    100,
  );
  await user(db, M);
  await db.query("select pc_revoke_activity($1,$2)", [
    valid,
    "Activity disqualified after review",
  ]);
  await user(db, B);
  assert.equal(
    await scalar(
      db,
      "select sum(amount)::int from reward_ledger where season_key=$1 and kind='rank'",
      [clubChallenge],
    ),
    0,
  );
});
test("imports cannot be relabelled as GPS", async () => {
  await user(db, A);
  const draft = await scalar(
    db,
    "insert into activities(user_id,activity_type,source,started_at) values($1,'walk','gpx',now()) returning id",
    [A],
  );
  await assert.rejects(
    db.query("update activities set source='gps' where id=$1", [draft]),
  );
});
