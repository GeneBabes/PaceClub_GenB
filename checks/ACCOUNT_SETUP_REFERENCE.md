# Account and storage reference

For the current full-package upgrade, follow `START_HERE.md`. Your working Google login, Supabase connection, app identity and signing setup should be retained. This page explains the configuration used by the included source; it does not ask you to recreate a working account.

## Connection values

| Value | Location |
| --- | --- |
| Supabase project URL and publishable/legacy anon key | Both apps, using their `.env.example` variable names |
| Google/Facebook client secret | Supabase provider settings only |
| Supabase service-role key | Optional trusted worker only |
| OpenAI key and model | Optional web-server configuration only |

Both apps must use the same Supabase project. Keep RLS enabled. Copy the web example to `.env.local` and the mobile example to `.env`, then replace the placeholders. Restart development servers after changing variables; native builds also need the corresponding EAS environment values.

## OAuth return paths

| Destination | Where to configure it |
| --- | --- |
| Exact Supabase callback shown by its provider configuration | Google/Meta OAuth redirect settings |
| `http://localhost:3000/auth/callback` | Supabase redirect allowlist for local web development |
| `paceclub://auth/callback` | Supabase redirect allowlist for the example mobile scheme |
| Your deployed HTTPS domain followed by `/auth/callback` | Supabase redirect allowlist for production web |

The mobile app constructs its callback from its configured native scheme. If your old app uses another scheme, keep it and allow its corresponding `your-scheme://auth/callback` URL. The configuration merge helper preserves that scheme. Use the rebuilt development/preview app for OAuth, not Expo Go. Login exchanges the returned code once and checks the return destination before accepting it.

Enable Google in your Supabase project and configure provider credentials there. Enable Facebook only after configuring its provider and permitted test/live accounts; set both public Facebook flags to `true` to show that button. This implementation uses browser-based OAuth rather than a native Google Sign-In SDK.

New authenticated users get a profile through the database trigger, then finish the goal/clan quiz and tutorial. Existing clan selections and completed onboarding are preserved.

## Private storage

| Bucket | Object path | Purpose |
| --- | --- | --- |
| `avatars` | `<user-id>/<unique-name>.<extension>` | Profile photo, up to 2 MiB |
| `activity-photos` | `<user-id>/<activity-id>/<unique-name>.jpg` | Verified activity feed photo, up to 5 MiB |
| `gpx-imports` | `<user-id>/<unique-name>.gpx` | Private GPX file retained alongside parsed activity |

All buckets remain private. Clients request short-lived signed image links; anyone who receives one can use it until it expires. Store object paths in database rows rather than public URLs. Replacing an avatar retains previously successful uploads; orphan cleanup is an operator maintenance task.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing environment value | Correct file location, actual values, server restart and EAS environment |
| Google redirect mismatch | Exact Supabase provider callback in Google settings |
| Access denied during provider testing | The account is permitted by that provider's testing configuration |
| Phone login returns to the website | Mobile scheme callback is allowed and the matching native app is installed |
| Login cannot finish | Start a fresh login in the same app; do not reuse an old PKCE callback |
| Profile missing after signup | Inspect the original database trigger/setup error; do not add duplicate profile creation |
| Storage denied | Signed-in owner, correct object path, original storage setup applied, RLS retained |
| Old app cannot load new native module | Install the newly rebuilt app with the same package and keystore |

References: [Supabase Google login](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [private storage](https://supabase.com/docs/guides/storage/buckets/fundamentals), and [Expo SDK 58 callback construction](https://docs.expo.dev/versions/v58.0.0/sdk/linking/).
