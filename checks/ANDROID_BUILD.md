# Android builds

This update includes Expo SDK 58 sensor and notification modules and camera permissions. Build a **new native app**; restarting Metro alone cannot add native modules to your old APK.

1. Preserve your old Android package, scheme, EAS project ID and signing key using the configuration merge described in `START_HERE.md`.
2. Keep existing phone recordings until submitted. Install an update signed with the same keystore instead of uninstalling the app.
3. Set your public Supabase URL/key and Facebook flag in EAS’s matching environment. Do not set service-role or OpenAI secrets in the mobile project.
4. From `paceclub-mobile`, run:

```bat
npx eas-cli@latest build --platform android --profile development
```

After the build succeeds, install its APK and start Metro:

```bat
npx expo start --dev-client
```

A development build needs Metro. To make an APK that opens without your computer, use the supplied preview profile (preserving your existing EAS identity):

```bat
npx eas-cli@latest build --platform android --profile preview
```

Set the same public variables in EAS’s **preview** environment too. A production profile produces a store bundle; store submission is a separate operator step.

## Push setup

Configure Android FCM V1 credentials in your EAS project before testing device push. iOS requires its APNs credentials and a signed iOS build. Follow the official Expo setup guide: https://docs.expo.dev/push-notifications/push-notifications-setup/

Launch the rebuilt native app, open Inbox, and tap Enable push. Grant permission. The app registers a device token for your signed-in account. The trusted backend worker must run with `PUSH_ENABLED=true` for queued updates to be delivered. Inbox works without push.

## If a build fails

Open the EAS build URL and inspect the **first failing phase**, especially Install dependencies. A generic “Unknown error” does not identify a cause. Preserve the included lockfile and matching React/React DOM versions. Run locally:

```bat
npm ci
npx expo install --check
npm run typecheck
npm run lint
```

If new native modules are reported missing on the phone, install the new development build. Check you launched that build rather than Expo Go or the previous APK. Review permissions in phone settings if camera, location or notifications were denied. No location permission is requested until recording starts.

Official development-build guidance: https://docs.expo.dev/develop/development-builds/introduction/
