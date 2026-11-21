# Operations

## Web hosting

The website is Next.js 16 with a standalone build. Supply the public Supabase URL/key at build and runtime. Configure HTTPS, your public origin and the matching Supabase OAuth callbacks. For a direct Node deployment run `npm ci`, `npm run build`, and `npm start` inside `paceclub-web`.

The Docker build has `web` and `worker` targets. Public build variables are not secrets. The `.dockerignore` excludes environment files, native signing files and generated artifacts. For Compose, from the package root:

```bat
docker compose --env-file paceclub-web/.env.local up --build -d web
```

The example listens on port 3000. Put it behind your HTTPS host/reverse proxy for public access. A local Docker launch is not an Internet deployment.

## Optional progress-summary AI

Set `OPENAI_API_KEY` and an available structured-output-capable `OPENAI_MODEL` on the **web server only**. Do not prefix either with `NEXT_PUBLIC_` or `EXPO_PUBLIC_`. Only computed, anonymous progress statements are sent to the model. Its output is validated against allowed fact IDs; errors, missing configuration, invalid output or timeouts fall back to a deterministic summary. There is a five-request/hour/account budget. No GPS points, names, email, chat, or safety events enter the AI request.

For mobile access, set `EXPO_PUBLIC_WEB_URL` to your deployed HTTPS website before building/updating the app. Without a URL the phone gives a simple local calculated summary. Without AI credentials the shared endpoint still gives calculated summaries.

## Trusted worker

Copy `backend/.env.example` to `backend/.env`. Supply your project URL and server-only service-role key. This key bypasses RLS and must remain on a trusted host. The worker does not use the mobile or web public key.

From the root:

```bat
npm run worker
```

Or run one scheduled batch from `backend`:

```bat
npm run once
```

The worker calls `pc_finalize_due_challenges`, then handles up to 50 push jobs when `PUSH_ENABLED=true`. It leases jobs, stores Expo tickets, checks receipts, retries transient failures and removes invalid device tokens. Tokens and private notification bodies are not printed or included in external logs; push text simply asks the user to open the app. Device receipt success is platform handoff, not delivery/read confirmation.

For Docker, create `backend/.env` first, then:

```bat
docker compose --env-file paceclub-web/.env.local --profile worker up --build -d
```

Without a worker, in-app notifications still work and creators/moderators can finalize ended challenges manually after 48 hours. Do not run multiple ad-hoc processes with different environments against the wrong project. Use your host’s process supervision and logging.

Failed/exhausted jobs remain in the private job table for an administrator to investigate. Correct provider credentials first; inspect only on the trusted server. Do not expose private tables or service keys to add a public retry button.

## CI and monitoring

`.github/workflows/ci.yml` runs clean installs, typechecks, mobile lint, unit/SQL/worker tests, the web production build and Android JavaScript export. It does not upload, publish, sign, run EAS builds, or deploy.

`GET /api/health` returns application liveness without credentials or account data. It does not certify Supabase, OAuth, push or AI health. Set `PACECLUB_HEALTH_URL` to your HTTPS health URL and schedule `node tools/uptime.mjs` with your host’s scheduler; the process returns nonzero on failure. Connect exit failures to your own monitoring service. This package does not create a remote monitoring subscription.

The web error boundary logs a sanitized event/digest. API and worker failures use structured JSON event codes and request/job IDs, avoiding GPS and tokens. Route server logs to your host’s log service, set retention appropriate for your project, and configure alerts there. No Sentry or external logging account is assumed.

## Data and fairness

Back up the project before migration, validate in a staging Supabase project, then roll out the web/native versions together. A restored previous source bundle is not a database rollback; the migrations intentionally retain data. Protect administrator role assignment and the Supabase dashboard.

Server checks reduce common recording errors and simple input inflation. They do not attest device hardware, defeat every spoofing method, or replace moderation. Production-scale abuse controls, background recording and large-community load testing are separate engineering work.
