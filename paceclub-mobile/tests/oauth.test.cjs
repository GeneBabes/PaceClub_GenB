require("./register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { matchesCallback } = require("../lib/oauth-callback.ts");
test("OAuth accepts the preserved app scheme and rejects different callback destinations", () => {
  assert.equal(
    matchesCallback(
      "my-paceclub://auth/callback?code=one",
      "my-paceclub://auth/callback",
    ),
    true,
  );
  for (const url of [
    "paceclub://auth/callback?code=one",
    "my-paceclub://other/callback?code=one",
    "my-paceclub://auth/callback/extra?code=one",
    "my-paceclub://user@auth/callback?code=one",
    "not a URL",
  ]) {
    assert.equal(matchesCallback(url, "my-paceclub://auth/callback"), false);
  }
});
