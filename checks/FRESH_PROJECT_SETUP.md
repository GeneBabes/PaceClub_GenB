# A completely new PaceClub project

Use this only for a new, empty Supabase project. Existing users follow `START_HERE.md` and apply migrations 03 and 04 only.

1. Create a Supabase project. Run the four complete SQL files in `database/` in numeric order. Keep RLS enabled and storage buckets private.
2. Enable Google in Supabase Authentication → Providers and configure the provider credentials. Enable Facebook only if you actually configure it; otherwise keep both public Facebook flags `false`.
3. Add your development website callback (`http://localhost:3000/auth/callback`) and your actual mobile scheme callback (`paceclub://auth/callback` for the provided example) to Supabase’s allowed redirect URLs. Preserve a different scheme if your own app uses one. Configure provider redirects to the callback URL shown by Supabase.
4. Copy `.env.example` to `.env.local` in `paceclub-web` and to `.env` in `paceclub-mobile`. Set the same project URL and publishable/legacy anon key in both. Public keys are expected in clients; never use a secret/service-role key there.
5. Run `npm run setup` from the package root, then `npm run web`. Complete onboarding with your first account.
6. Give a trusted account the admin role using the SQL in `database/README.md`.
7. Link the mobile app to your own EAS project and use unique app identifiers before your first build. Follow `docs/ANDROID_BUILD.md`.
8. Create clubs/challenges through the app and approved play zones through the administrator’s Territory page. There are no invented campus boundaries or real users seeded by the package.
9. Follow the two-account acceptance checks before distributing your app.

OAuth, hosting domains, native signing, FCM/APNs and optional AI are account-specific configuration. The source package does not provision them or contain credentials.
