require("./register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const m = require("../src/activity/model.ts");
const { routeGeometry } = require("../src/activity/route.ts");
const start = () => m.createActivity("activity", "alice", "walk", 100_000);
const fix = (timestamp, latitude = 0, longitude = 0, accuracy = 5) => ({
  timestamp,
  latitude,
  longitude,
  accuracy,
});

test("known GPS separation is about 111.2 metres", () =>
  assert.ok(
    Math.abs(m.distanceBetween(fix(0), fix(0, 0.001)) - 111.195) < 0.1,
  ));
test("only accepted movement adds distance; stationary noise is ignored", () => {
  let a = m.addFix(start(), fix(101_000), 101_000).activity;
  assert.equal(a.distanceM, 0);
  const noisy = m.addFix(a, fix(103_000, 0.00001), 103_000);
  assert.equal(noisy.point, undefined);
  a = m.addFix(a, fix(106_000, 0.0001), 106_000).activity;
  assert.equal(a.pointCount, 2);
  assert.ok(a.distanceM > 11 && a.distanceM < 12);
});
test("weak, stale, future, mocked, invalid and duplicate fixes cannot add route points", () => {
  const a = m.addFix(start(), fix(101_000), 101_000).activity;
  for (const bad of [
    fix(102_000, 0, 0, 60),
    fix(80_000),
    fix(130_000),
    { ...fix(102_000), mocked: true },
    fix(102_000, 91),
    fix(102_000, 0, NaN),
    fix(102_000, 0, 0, null),
    fix(101_000),
  ]) {
    const result = m.addFix(a, bad, 103_000);
    assert.equal(result.point, undefined);
    assert.equal(result.activity.distanceM, 0);
  }
});
test("a GPS gap starts a new segment without bridging missing distance", () => {
  const a = m.addFix(start(), fix(101_000), 101_000).activity;
  const result = m.addFix(a, fix(140_000, 0.01), 140_000);
  assert.equal(result.point.segment, 1);
  assert.equal(result.activity.distanceM, 0);
});
test("implausible jump is rejected and the next fix starts a separate segment", () => {
  let a = m.addFix(start(), fix(101_000), 101_000).activity;
  a = m.addFix(a, fix(103_000, 0.01), 103_000).activity;
  assert.equal(a.pointCount, 1);
  assert.equal(a.lastPoint, null);
  const result = m.addFix(a, fix(105_000, 0.01), 105_000);
  assert.equal(result.point.segment, 1);
  assert.equal(result.activity.distanceM, 0);
});
test("pause and resume exclude paused time and never join the paused route", () => {
  let a = m.addFix(start(), fix(101_000), 101_000).activity;
  a = m.pauseActivity(a, 110_000, "manual");
  assert.equal(m.activeMs(a, 140_000), 10_000);
  assert.equal(m.addFix(a, fix(115_000), 115_000).point, undefined);
  a = m.resumeActivity(a, 140_000);
  a = m.addFix(a, fix(141_000, 0.01), 141_000).activity;
  a = m.finishActivity(a, 150_000);
  assert.equal(a.activeMs, 20_000);
  assert.equal(a.endedAt - a.startedAt, 50_000);
  assert.equal(a.distanceM, 0);
});
test("recovery stops at the durable checkpoint, not the current wall clock", () => {
  const a = m.recoverActivity({ ...start(), updatedAt: 112_000 });
  assert.equal(a.phase, "paused");
  assert.equal(a.activeMs, 12_000);
  assert.equal(m.activeMs(a, 300_000), 12_000);
});
test("clock reversal and overlong activities cannot be resumed", () => {
  const a = m.pauseActivity(start(), 112_000, "");
  assert.throws(() => m.resumeActivity(a, 111_000));
  assert.throws(() => m.resumeActivity(a, a.startedAt + m.MAX_SESSION_MS));
});
test("empty or too-short activity cannot be submitted", () => {
  assert.ok(m.submissionProblem(start()));
  assert.ok(m.submissionProblem(m.finishActivity(start(), 110_000)));
  assert.equal(
    m.submissionProblem({
      ...m.finishActivity(start(), 120_000),
      distanceM: 20,
      pointCount: 2,
    }),
    "",
  );
});
test("route trace preserves independent segments and handles the date line", () => {
  const geometry = routeGeometry([
    { latitude: 10, longitude: 179.999, segment: 0 },
    { latitude: 10, longitude: -179.999, segment: 0 },
    { latitude: 10.001, longitude: -179.999, segment: 1 },
  ]);
  assert.equal(geometry.paths.length, 2);
  assert.ok(geometry.paths[0].includes(" L"));
  assert.ok(!geometry.paths[1].includes(" L"));
  assert.ok(Number.isFinite(geometry.first.x));
  assert.ok(Number.isFinite(geometry.last.x));
});

test("interrupted prompts become no-response and queue a correction without implying safety", () => {
  const base = {
    ...start(),
    phase: "finished",
    sync: "synced",
    safetyEvents: [
      { id: "prompt", status: "prompted", respondedAt: null },
      { id: "done", status: "confirmed_ok", respondedAt: 110000 },
    ],
  };
  const next = m.recoverCheckIns(base);
  assert.equal(next.safetyEvents[0].status, "no_response");
  assert.equal(next.safetyEvents[0].respondedAt, null);
  assert.equal(next.safetyEvents[1].status, "confirmed_ok");
  assert.equal(next.sync, "queued");
  assert.equal(base.safetyEvents[0].status, "prompted");
});
