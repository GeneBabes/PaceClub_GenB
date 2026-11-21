// Isolated UI smoke test. All API responses are fixtures; no live account is used.
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const root = path.resolve(__dirname, ".."),
  out = process.env.PACECLUB_QA_OUTPUT || path.resolve(root, "qa-output");
fs.mkdirSync(out, { recursive: true });
const mock = spawn(
  process.execPath,
  [path.join(__dirname, "mock-supabase.mjs")],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const web = spawn(
  process.execPath,
  [
    path.join(root, "paceclub-web/node_modules/next/dist/bin/next"),
    "dev",
    "--port",
    "34522",
    "--hostname",
    "127.0.0.1",
  ],
  {
    cwd: path.join(root, "paceclub-web"),
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54440",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "ui-fixture-public",
      NEXT_TELEMETRY_DISABLED: "1",
      PACECLUB_BUILD_DIR: ".next-ui-smoke",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
for (const child of [mock, web]) {
  child.stdout.on("data", (x) => {
    logs += x;
    fs.writeFileSync(path.join(out, "server.log"), logs);
  });
  child.stderr.on("data", (x) => {
    logs += x;
    fs.writeFileSync(path.join(out, "server.log"), logs);
  });
}
let browser;
(async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("http://127.0.0.1:34522/api/health", {
        signal: AbortSignal.timeout(2000),
      });
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url"),
    payload = Buffer.from(
      JSON.stringify({
        sub: "11111111-1111-4111-8111-111111111111",
        aud: "authenticated",
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
  const token = header + "." + payload + ".fixture";
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    aud: "authenticated",
    role: "authenticated",
    email: "alex@example.invalid",
    app_metadata: { provider: "google" },
    user_metadata: { full_name: "Alex Rivera" },
  };
  const session = {
    access_token: token,
    refresh_token: "fixture-refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: "bearer",
    user,
  };
  await context.addCookies([
    {
      name: "sb-127-auth-token",
      value:
        "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"),
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const results = [];
  for (const route of [
    "home",
    "play",
    "clubs",
    "community",
    "chat",
    "analytics",
    "rewards",
    "notifications",
    "territory",
    "moderation",
    "import",
    "practice",
    "activities",
    "profile",
  ]) {
    const response = await page.goto("http://127.0.0.1:34522/" + route, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.locator("h1").first().waitFor();
    await page.waitForTimeout(250);
    const h1 = await page.locator("h1").first().innerText(),
      body = await page.locator("body").innerText();
    if (
      page.url().endsWith("/onboarding") ||
      page.url() === "http://127.0.0.1:34522/"
    )
      throw Error("Fixture login was not accepted on " + route);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    results.push({
      route,
      status: response.status(),
      heading: h1,
      overflow,
      errorBanner:
        /could not load|Unable to load|migration is not available/i.test(body),
    });
    if (["home", "community", "analytics", "territory"].includes(route))
      await page.screenshot({
        path: path.join(out, route + ".png"),
        fullPage: true,
      });
    console.log("Checked " + route + ": " + h1.replace(/\n/g, " "));
  }
  await page.goto("http://127.0.0.1:34522/chat", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Everyone", exact: true }).click();
  await page
    .getByText("A good morning for a gentle walk.", { exact: false })
    .waitFor();
  await page.goto("http://127.0.0.1:34522/analytics", {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: "Explain my progress" }).click();
  await page
    .getByText("Calculated directly from your activity data.", { exact: false })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "home",
    "play",
    "community",
    "chat",
    "territory",
    "profile",
  ]) {
    await page.goto("http://127.0.0.1:34522/" + route, {
      waitUntil: "networkidle",
    });
    results.push({
      route: route + "-mobile",
      overflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
    });
    if (route === "home")
      await page.screenshot({
        path: path.join(out, "home-mobile.png"),
        fullPage: true,
      });
  }
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify({ results, errors }, null, 2),
  );
  if (
    errors.length ||
    results.some((r) => r.overflow || r.errorBanner || r.status >= 400)
  )
    throw Error("UI checks reported errors; see results.json");
  console.log("UI smoke checks passed.");
})()
  .catch((error) => {
    console.error(error);
    fs.writeFileSync(path.join(out, "server.log"), logs);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    web.kill("SIGTERM");
    mock.kill("SIGTERM");
  });
