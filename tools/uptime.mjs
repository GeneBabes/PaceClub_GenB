// Run from your monitoring scheduler. This probe does not expose credentials.
const url = process.env.PACECLUB_HEALTH_URL;
if (!url) {
  console.error("Set PACECLUB_HEALTH_URL to your HTTPS /api/health URL.");
  process.exitCode = 1;
} else {
  try {
    const started = Date.now();
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok || body.status !== "ok") throw Error("Unhealthy");
    console.log(
      JSON.stringify({
        event: "health_probe",
        status: "ok",
        latencyMs: Date.now() - started,
      }),
    );
  } catch {
    console.error(JSON.stringify({ event: "health_probe", status: "failed" }));
    process.exitCode = 1;
  }
}
