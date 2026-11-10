# Releasing the SplitPro apps

How the iOS and Android apps get built, tested and shipped, and where things stand. Keep the status
section up to date when it changes.

Keys, account emails and other private details are not in this repo. They live on the maintainer's
machine in `~/.appstore/` (see `~/.appstore/README.md` there).

## Status (2026-11-10)

Both apps are in public beta. The web app links to both betas: the landing hero has "iOS (beta)" and
"Android (beta)" buttons, the Balances page has a dismissible card, and the "Download App" drawer
lists both. The links live in `src/components/Site/constants.ts`.

**iOS**

- TestFlight build 1.0.0 (4) is in external testing.
- Public link: https://testflight.apple.com/join/FURvpmbH (no cap). 12 testers have installed it,
  with 0 crashes so far.
- Apple has no tester minimum, so the App Store submission can go in whenever the app is ready.

**Android**

- The first Play review is approved. versionCode 3 (1.0.0) is on internal and closed testing.
- The closed test uses the Google Group `splitpro-beta@googlegroups.com`
  (https://groups.google.com/g/splitpro-beta, open to anyone).
- To join:
  1. Join the group.
  2. Open https://play.google.com/apps/testing/app.splitpro and tap "Become a tester", with the
     same Google account.
  3. Install from Play.
- **Production access needs 12 opted-in testers for 14 days in a row.** 5 had opted in on
  2026-11-09. The count only shows on the Play Console dashboard; the API doesn't return it.

## Next

1. Get Android to 12 opted-in testers. The 14 days only start counting once there are 12.
2. Android push notifications need a Firebase project with an Android app `app.splitpro`. Then:
   - add `google-services.json` (`android.googleServicesFile` in `app.config.ts`);
   - upload the FCM V1 key to EAS;
   - add a 96×96 notification icon;
   - rebuild and release.
3. Before the public launch:
   - retake the store screenshots with realistic demo data;
   - use native Android confirm dialogs;
   - fix the split selector wrapping at font scale 1.3.
4. Submit iOS to the App Store.
5. Later: in-app purchases. This needs a Play merchant profile and Apple's Paid Apps agreement,
   with billing through something like RevenueCat.

## Accounts

- Expo: owner `koushikdotdev`, project `@koushikdotdev/splitpro`. The project ID is in
  `app.config.ts`.
- Bundle ID and package name: `app.splitpro`.
- App Store Connect app: "SplitPro: Split Expenses" (`ascAppId` in `eas.json`). TestFlight external
  group: "Friends".
- Google Play: the Free app `app.splitpro`, rated 18+, category Finance, with no ads and no
  advertising ID.
- Store reviewers sign in as `review@splitpro.app` with a fixed code. The server reads it from
  `REVIEW_LOGIN_EMAIL` / `REVIEW_LOGIN_CODE`, and no email is sent.

## Building and shipping

### Native prototype comparison (internal only)

`eas build -p ios --profile prototype` inherits production signing/version auto-increment and
uses `https://splitpro.app` with `EXPO_PUBLIC_PROTOTYPE_READONLY=1`. This flag enables the Add
alert and blocks all tRPC POSTs before transport (including settlement, deletion, profile,
group and receipt mutations). Push registration is disabled. Authentication stays available.
Verify the alert in the simulator before submitting manually with the production submit profile
and `--no-auto-testflight-setup` (the existing Team group already has access to all builds).
Build 5 is reserved for Prototype A; build 6 is the separate SwiftUI comparison. After both are
uploaded, set the EAS remote iOS build number to at least 6 to prevent the next real build colliding.

**Never run `testflight-friends.sh` or `ship-builds.sh` for prototypes.** Set only their TestFlight
build notes and export compliance, and confirm internal Team access and absence from Friends.
Do not submit beta app review or touch App Store metadata.

Run from `mobile/`, with the EAS env vars loaded (`set -a; . ~/.appstore/splitpro.env; set +a`).

**iOS**

```sh
npx eas-cli@latest build -p ios --profile production --non-interactive
npx eas-cli@latest submit -p ios --id <buildId> --profile production --non-interactive
~/.appstore/scripts/asc/testflight-friends.sh <buildNumber> "<what to test>"
```

- EAS's `--auto-submit` has failed before, so submit by hand.
- `testflight-friends.sh` waits for Apple to process the build. Then it sets the "What to test"
  note, adds the build to the Friends group and submits it for beta review.

**Android**

```sh
npx eas-cli@latest build -p android --profile production --non-interactive
node ~/.appstore/scripts/asc/play-release.mjs <file.aab> "<release notes>"
```

- `play-release.mjs` uploads the bundle once and releases it to internal and closed testing.
- versionCode is incremented remotely by EAS.

**Both at once**

```sh
npx eas-cli@latest build --platform all --profile production --non-interactive --no-wait
~/.appstore/scripts/asc/ship-builds.sh <iosBuildId> <androidBuildId>
```

`ship-builds.sh` waits for both builds, then submits iOS and releases Android.

## Play API limits

The Play publishing API can upload and release builds, but some things only work in Play Console in
a browser:

- store listing edits return 403;
- the closed test's testers return 403 ("upgraded to closed testing");
- the opted-in tester count isn't exposed.

`~/.appstore/scripts/play-driver/` drives the maintainer's Chrome over CDP for these.

- Chrome needs "Allow remote debugging" turned on at `chrome://inspect/#remote-debugging`.
- Chrome asks to Allow every new connection, so someone has to click it within about 2 minutes.
- Changes to tester settings go to Google for review, which usually takes a few hours.

## Server side

- The mobile auth endpoints live in `src/server/mobileAuth.ts` and `src/pages/api/mobile/auth/*`.
  Account deletion lives in `src/server/api/services/accountDeletion.ts`.
- Production runs on Railway and deploys from `main`, which takes about 7 minutes.
- `/api/mobile/auth/start` intentionally has no cross-site check. Android Custom Tabs arrive as a
  cross-site navigation with no Referer, so a check blocked every Android Google sign-in. The
  trade-off: another site can sign someone out of the web app.
