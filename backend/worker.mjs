import { pathToFileURL } from "node:url";
// Dependency-free server process. Never bundle this file or its env in the clients.
export function createWorker(env, fetcher = fetch, log = console.log) {
  const base = env.SUPABASE_URL?.replace(/\/$/, ""),
    secret = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !secret)
    throw Error(
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.",
    );
  const headers = {
    "Content-Type": "application/json",
    apikey: secret,
    Authorization: "Bearer " + secret,
  };
  async function rpc(name, args = {}) {
    const response = await fetcher(base + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers,
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw Error(
        "Database RPC failed: " + name + " (" + response.status + ")",
      );
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  async function expo(path, payload) {
    const res = await fetcher("https://exp.host/--/api/v2/push/" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.EXPO_ACCESS_TOKEN
          ? { Authorization: "Bearer " + env.EXPO_ACCESS_TOKEN }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw Error("Push transport HTTP " + res.status);
    return res.json();
  }
  return {
    async tick() {
      await rpc("pc_finalize_due_challenges");
      if (env.PUSH_ENABLED !== "true") return { processed: 0 };
      const jobs = await rpc("pc_push_take");
      let processed = 0;
      for (const job of jobs) {
        try {
          let ticket = null,
            receipt;
          if (job.ticket) {
            const body = await expo("getReceipts", { ids: [job.ticket] });
            receipt = body.data?.[job.ticket];
            if (!receipt) {
              await rpc("pc_push_finish", {
                p_id: job.id,
                p_error: "Receipt not ready",
              });
              continue;
            }
          } else {
            const body = await expo("send", {
              to: job.token,
              title: String(job.title).slice(0, 80),
              body: "Open PaceClub to read your update.",
              channelId: "default",
              data: { notificationId: job.notification_id },
            });
            receipt = Array.isArray(body.data) ? body.data[0] : body.data;
            if (receipt?.status === "ok") ticket = receipt.id;
          }
          if (receipt?.status === "ok") {
            if (!job.ticket && !ticket) throw Error("Push ticket missing");
            await rpc("pc_push_finish", {
              p_id: job.id,
              ...(ticket ? { p_ticket: ticket } : { p_delivered: true }),
            });
          } else {
            const code = String(
              receipt?.details?.error || "Push delivery error",
            ).slice(0, 80);
            await rpc("pc_push_finish", {
              p_id: job.id,
              p_error: code,
              p_invalid: code === "DeviceNotRegistered",
            });
          }
          processed++;
        } catch (error) {
          await rpc("pc_push_finish", {
            p_id: job.id,
            p_error: "Transport failed; will retry",
          });
          log(JSON.stringify({ event: "push_retry", jobId: job.id }));
        }
      }
      return { processed };
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const worker = createWorker(process.env);
  let running = true;
  process.on("SIGTERM", () => {
    running = false;
  });
  process.on("SIGINT", () => {
    running = false;
  });
  do {
    try {
      const result = await worker.tick();
      console.log(
        JSON.stringify({
          event: "worker_tick",
          ...result,
          time: new Date().toISOString(),
        }),
      );
    } catch {
      console.error(
        JSON.stringify({
          event: "worker_tick_failed",
          time: new Date().toISOString(),
        }),
      );
      if (process.argv.includes("--once")) process.exitCode = 1;
    }
    if (process.argv.includes("--once") || !running) break;
    await new Promise((resolve) => setTimeout(resolve, 30000));
  } while (running);
}
