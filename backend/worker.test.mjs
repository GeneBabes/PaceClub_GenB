import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorker } from "./worker.mjs";
const env = {
  SUPABASE_URL: "https://test.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "test-only",
  PUSH_ENABLED: "true",
};
function fake(jobs, expoResult) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      if (url.endsWith("pc_push_take"))
        return new Response(JSON.stringify(jobs));
      if (url.includes("exp.host"))
        return new Response(JSON.stringify(expoResult));
      return new Response("null");
    },
  };
}
test("disabled push never fetches jobs or calls Expo", async () => {
  const f = fake([], {});
  await createWorker({ ...env, PUSH_ENABLED: "false" }, f.fetch).tick();
  assert.deepEqual(
    f.calls.map((c) => c.url.split("/").at(-1)),
    ["pc_finalize_due_challenges"],
  );
});
test("tickets are persisted without claiming device delivery", async () => {
  const f = fake(
    [
      {
        id: 1,
        token: "ExpoPushToken[test]",
        notification_id: "n",
        title: "Update",
        body: "PRIVATE REASON",
      },
    ],
    { data: { status: "ok", id: "ticket" } },
  );
  await createWorker(env, f.fetch).tick();
  assert.ok(
    !JSON.stringify(f.calls.find((c) => c.url.endsWith("/send")).body).includes(
      "PRIVATE REASON",
    ),
  );
  assert.equal(f.calls.at(-1).body.p_ticket, "ticket");
  assert.equal(f.calls.at(-1).body.p_delivered, undefined);
});
test("receipts are checked without sending the notification again", async () => {
  const f = fake([{ id: 1, ticket: "ticket" }], {
    data: { ticket: { status: "ok" } },
  });
  await createWorker(env, f.fetch).tick();
  assert.equal(
    f.calls.some((c) => c.url.endsWith("/send")),
    false,
  );
  assert.equal(f.calls.at(-1).body.p_delivered, true);
});
test("invalid devices are removed; missing receipts remain retryable", async () => {
  for (const ready of [true, false]) {
    const f = fake([{ id: 1, ticket: "ticket" }], {
      data: ready
        ? {
            ticket: {
              status: "error",
              details: { error: "DeviceNotRegistered" },
            },
          }
        : {},
    });
    await createWorker(env, f.fetch).tick();
    assert.equal(f.calls.at(-1).body.p_invalid, ready ? true : undefined);
  }
});
test("network failure queues a retry without logging credentials", async () => {
  const lines = [],
    f = fake([{ id: 4, token: "private-token" }], {});
  const fetch = async (url, options) => {
    if (url.includes("exp.host")) throw Error("Network down");
    return f.fetch(url, options);
  };
  await createWorker(env, fetch, (x) => lines.push(x)).tick();
  assert.equal(f.calls.at(-1).body.p_error, "Transport failed; will retry");
  assert.ok(!lines.join().includes("private-token"));
});
