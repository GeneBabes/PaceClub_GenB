import fs from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { database, user, scalar, activity, A, B, M } from "./setup.mjs";
let db, id;
before(async () => {
  db = await database();
  await db.query("insert into auth.users(id) values($1),($2),($3)", [A, B, M]);
  await db.query(
    "insert into paceclub_private.user_roles values($1,'moderator')",
    [M],
  );
});
after(async () => {
  await db?.close();
});
test("submission automatically verifies measurements without trusting reported distance", async () => {
  id = await activity(db);
  const row = (await db.query("select * from activities where id=$1", [id]))
    .rows[0];
  assert.equal(row.status, "verified");
  assert.ok(Number(row.distance_m) > 70 && Number(row.distance_m) < 80);
  assert.equal(row.moving_seconds, 70);
});
test("retry cannot duplicate XP or token awards", async () => {
  await user(db, A);
  const before = await scalar(db, "select count(*)::int from reward_ledger");
  await db.query("select pc_verify_activity($1)", [id]);
  assert.equal(
    await scalar(db, "select count(*)::int from reward_ledger"),
    before,
  );
});
test("submitted inputs remain frozen; server columns cannot be written by clients", async () => {
  await user(db, A);
  assert.equal(
    (
      await db.query(
        "update activities set reported_distance_m=999999 where id=$1 returning id",
        [id],
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    db.query(
      "update activities set status='verified',distance_m=999999 where id=$1",
      [id],
    ),
  );
  await assert.rejects(
    db.query("insert into activity_points values($1,8,now(),16,120,5)", [id]),
  );
});
test("another athlete cannot read or verify a private route", async () => {
  await user(db, B);
  assert.equal(
    (await db.query("select * from activities where id=$1", [id])).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from activity_points where activity_id=$1", [id]))
      .rows.length,
    0,
  );
  await assert.rejects(db.query("select pc_verify_activity($1)", [id]));
});
test("GPX and simulations receive no XP, coins, or ranked unlock", async () => {
  await activity(db, { owner: B, source: "gpx" });
  await activity(db, { owner: B, source: "simulation" });
  assert.equal(await scalar(db, "select count(*)::int from reward_ledger"), 0);
  assert.equal(await scalar(db, "select pc_competitive_ready()"), false);
});
test("invalid speed is flagged and can only be reviewed by a different moderator", async () => {
  const bad = await activity(db, {
    points: 4,
    coords: [
      [120, 16],
      [120, 16.0001],
      [120.05, 16.0002],
      [120.05, 16.0003],
    ],
  });
  assert.equal(
    await scalar(db, "select status from activities where id=$1", [bad]),
    "flagged",
  );
  await db.query("select pc_submit_appeal($1,$2)", [
    bad,
    "GPS jump while crossing an open field",
  ]);
  await assert.rejects(
    db.query("select pc_review_activity($1,true,$2)", [
      bad,
      "Approve my own route",
    ]),
  );
  await user(db, M);
  await db.query("select pc_review_activity($1,true,$2)", [
    bad,
    "Reviewed reliable segments and approved the recalculated distance",
  ]);
  assert.equal(
    await scalar(db, "select status from activities where id=$1", [bad]),
    "verified",
  );
  assert.equal(
    await scalar(
      db,
      "select status from activity_appeals where activity_id=$1",
      [bad],
    ),
    "accepted",
  );
});
test("purchases are atomic and repeat purchases never charge twice", async () => {
  await user(db, "");
  await db.query(
    "insert into reward_ledger(user_id,kind,amount,reason,idempotency_key) values($1,'coins',100,'test grant','test-only')",
    [A],
  );
  await user(db, A);
  const item = "50000000-0000-4000-8000-000000000001";
  await db.query("select pc_buy_item($1)", [item]);
  const coins = await scalar(
    db,
    "select sum(amount)::int from reward_ledger where kind='coins'",
  );
  await db.query("select pc_buy_item($1)", [item]);
  assert.equal(
    await scalar(
      db,
      "select sum(amount)::int from reward_ledger where kind='coins'",
    ),
    coins,
  );
  await db.query("select pc_equip_item($1)", [item]);
  assert.equal(
    await scalar(db, "select equipped from user_inventory where item_id=$1", [
      item,
    ]),
    true,
  );
});
test("normal users cannot create ranked challenges or invoke push worker APIs", async () => {
  await user(db, B);
  await assert.rejects(
    db.query(
      "select pc_create_challenge('Forbidden','walk','weekly',now(),now()+interval '7 days')",
    ),
  );
  await assert.rejects(db.query("select pc_push_take()"));
  await assert.rejects(db.query("select * from paceclub_private.push_devices"));
});
test("feed exposes approved summaries while raw routes remain private", async () => {
  await user(db, A);
  const post = await scalar(
    db,
    "select pc_publish_activity($1,'A morning walk','members')",
    [id],
  );
  await user(db, B);
  const feed = await scalar(db, "select pc_feed()");
  assert.ok(feed.some((x) => x.id === post));
  assert.equal(
    (await db.query("select * from activity_points where activity_id=$1", [id]))
      .rows.length,
    0,
  );
  await db.query("select pc_report_content($1,false,$2)", [
    post,
    "Test moderation report",
  ]);
  await user(db, M);
  const report = await scalar(
    db,
    "select id from content_reports where post_id=$1",
    [post],
  );
  await db.query("select pc_review_content($1,true)", [report]);
  await user(db, B);
  assert.ok(!(await scalar(db, "select pc_feed()")).some((x) => x.id === post));
});
test("dashboard excludes simulations and separates verified/pending totals", async () => {
  await user(db, B);
  const data = await scalar(db, "select pc_dashboard('all')");
  assert.equal(data.totals.activities, 1);
  assert.equal(data.balances.coins, 0);
});
test("internal scoring helpers and the worker schedule are not callable by athletes", async () => {
  await user(db, A);
  assert.equal(
    await scalar(
      db,
      "select has_function_privilege('authenticated','paceclub_private.sync_challenge_winners(uuid)','execute')",
    ),
    false,
  );
  assert.equal(
    await scalar(
      db,
      "select has_function_privilege('authenticated','paceclub_private.sync_challenge_goals(uuid)','execute')",
    ),
    false,
  );
  await assert.rejects(db.query("select pc_finalize_due_challenges()"));
});

test("offline check-ins can sync after prompts are disabled and stay private", async () => {
  await user(db, A);
  await db.query("update safety_settings set enabled=false where user_id=$1", [
    A,
  ]);
  const event = await scalar(
    db,
    "insert into safety_events(user_id,activity_id,event_type) values($1,$2,'unusual_motion') returning id",
    [A, id],
  );
  await db.query("update safety_events set status='no_response' where id=$1", [
    event,
  ]);
  assert.equal(
    await scalar(db, "select status from safety_events where id=$1", [event]),
    "no_response",
  );
  await user(db, B);
  assert.equal(
    (await db.query("select id from safety_events where id=$1", [event])).rows
      .length,
    0,
  );
  await assert.rejects(
    db.query(
      "insert into safety_events(user_id,activity_id,event_type) values($1,$2,'manual_sos')",
      [B, id],
    ),
  );
});
test("reapplying additive migrations preserves existing records and reward totals", async () => {
  await user(db, null);
  const before = await scalar(db, "select count(*)::int from activities");
  const balance = await scalar(
    db,
    "select sum(amount)::numeric from reward_ledger",
  );
  for (const file of ["03-full-app.sql", "04-territory.sql"])
    await db.exec(
      fs.readFileSync(new URL("../database/" + file, import.meta.url), "utf8"),
    );
  assert.equal(
    await scalar(db, "select count(*)::int from activities"),
    before,
  );
  assert.equal(
    await scalar(db, "select sum(amount)::numeric from reward_ledger"),
    balance,
  );
  await user(db, A);
  assert.equal(
    await scalar(db, "select status from activities where id=$1", [id]),
    "verified",
  );
});
