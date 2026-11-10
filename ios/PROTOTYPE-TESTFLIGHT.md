# Internal comparison build

The default bundle remains `app.splitpro.proto`. For the production-data comparison only, archive
with these overrides (never change the default bundle or backend):

```sh
xcodegen generate
xcodebuild archive -scheme SplitPro -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/prototype.xcarchive \
  PRODUCT_BUNDLE_IDENTIFIER=app.splitpro DEVELOPMENT_TEAM=G5MR932BV5 \
  CODE_SIGN_STYLE=Automatic MARKETING_VERSION=1.0.0 CURRENT_PROJECT_VERSION=8 \
  SPLITPRO_API_URL=https://splitpro.app SWIFT_ACTIVE_COMPILATION_CONDITIONS=PROTOTYPE_READONLY \
  -allowProvisioningUpdates
xcodebuild -exportArchive -archivePath build/prototype.xcarchive \
  -exportPath build/prototype-export -exportOptionsPlist ExportOptions.prototype.plist \
  -allowProvisioningUpdates
```

Supply App Store Connect authentication flags using the owner's local release credentials.
The export options prohibit external TestFlight and App Store distribution and preserve build numbers.
Only upload after the simulator confirms the Add alert. The request layer also blocks every
non-authentication POST before it leaves the device. Sign-in and sign-out remain available.

The opt-in `PrototypeTests/testSwiftUIReadOnlyProduction` UI test uses an existing review account,
with `SPLITPRO_PROTOTYPE_TEST=1` and `SPLITPRO_REVIEW_CODE_FILE` pointing to the local credential.
Keep test logs private; never commit credentials or test results.

Only the internal Team group may receive this build. Do not use the Friends release helper,
submit beta review, or edit App Store metadata.

## Apple sign-in

The native AuthenticationServices button requests name/email and sends `identityToken` plus an
optional formatted `fullName` to the existing `/api/mobile/auth/apple` endpoint, exactly as supported
by the Expo app's backend. The endpoint does not consume an authorization code for sign-in.
Its `{token, user}` result uses the same Keychain/session setup as email verification.
The project declares the Sign in with Apple capability and entitlement. No server changes are needed.
Simulator checks cover the Apple button, email sign-in, and read-only guards; real Apple account
authorization must be verified on a signed physical-device build.
