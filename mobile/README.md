# SplitPro mobile

The iOS and Android app for [SplitPro](https://splitpro.app), built with Expo (SDK 58) and Expo Router. It
talks to the same tRPC API as the web app and reuses the web's pure logic from `../src`.

## Run it

```sh
cd mobile
pnpm install
pnpm start          # then press i / a, or scan with a development build
pnpm ios            # same as `expo start --ios`
```

The app uses native modules (Apple sign-in, secure store, SF Symbols, `@expo/ui`, haptics, glass
effect), so build a development client with `npx expo run:ios` / `npx expo run:android` (or
`eas build --profile development`), and rebuild it whenever a native dependency is added. Expo Go
can't run it.

Point it at a local server with `EXPO_PUBLIC_API_URL=http://<your-lan-ip>:3000 pnpm start`. The
default is `https://splitpro.app`.

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`.

`pnpm test` runs the pure-logic tests (`src/**/*.test.ts` with Node's test runner through the
root's `tsx`, plus `node --test src/lib/pkce.test.mjs`). Run some with
`../node_modules/.bin/tsx --tsconfig tsconfig.json --test <files>`. Tests can only import modules
that don't pull in React Native or Expo, so keep logic you want to test in plain `.ts` files.

## Layout

```
src/
  app/                    Expo Router routes (file = screen)
    _layout.tsx           splash, providers, navigation theme, auth guard (Stack.Protected)
    (auth)/               sign-in, verify (email code)
    (app)/_layout.tsx     signed-in stack: tabs + detail screens + modals
    (app)/(tabs)/         native tab bar; each tab is a group with its own stack:
                          (balances)/balances, (groups)/groups, (activity)/activity,
                          (account)/account
    (app)/new.tsx         old /new link, redirects to /add
    (app)/balances/[friendId].tsx, groups/[groupId].tsx, expenses/[expenseId].tsx
    (app)/add.tsx         add/edit expense modal
    (app)/settle-up.tsx   settle-up form sheet
  components/ui/          primitives, see "Native UI conventions"
  i18n/                   i18next setup + locales/en.json
  lib/
    api.ts                tRPC client: `api`, RouterInputs/RouterOutputs
    authApi.ts            all native-auth HTTP calls (/api/mobile/auth/*)
    appConfig.ts          useAppConfig(): server settings (invites on, receipt storage URL)
    socialAuth.ts         Apple (native) and Google (browser + PKCE) sign-in
    storage.ts            key-value storage: SecureStore on devices, localStorage on web
    dialogs.ts            confirmAction / showMessage (native Alert, browser dialogs on web)
    navigation.ts         goBackOr(fallback)
    pendingLink.ts        the link opened while signed out, opened after sign-in
    push.ts               push notifications
    money.ts              formatMoney / parseMoneyInput
    config.ts             API_URL
  providers/ApiProvider.tsx   React Query + tRPC, 401 handling, refetch on foreground
  providers/usePendingLink.ts, usePushNotifications.ts
  shims/prisma-client.ts  Prisma enums for the shared code (see below)
  store/authStore.ts      session token (zustand over lib/storage)
  store/recentCurrencies.ts   recently used currencies, persisted
  theme/tokens.ts         semantic colors (light/dark), text styles, spacing, radii, layout
  theme/navigation.ts     native stack screen options shared by the layouts
  lib/haptics.ts          haptics.success / warning / error / selection / light
```

## Conventions

- **Code style** follows the root `AGENTS.md`: arrow functions, Yoda comparisons
  (`'signedIn' === status`, enforced by lint), early returns, `type` imports.
- **Imports**: `@/…` is `mobile/src`, `~/…` is the web's `../src`. Only import _pure_ modules from
  `~/` (`~/utils/*`, `~/lib/currency`), plus `import type` from anywhere (e.g.
  `~/server/api/root`). Never value-import server code: it would end up in the bundle.
- **Data**: use the typed hooks, e.g. `api.user.getBalances.useQuery()` and
  `RouterOutputs['user']['getBalances']`. Don't call `fetch` for app data. A 401 anywhere signs the
  user out automatically.
- **Money**: amounts are integer cents (the API's `number`), never floats. Display with `<Money>` or
  `formatMoney`, parse user input with `parseMoneyInput`, split with `~/utils/splits`.
- **Styling**: `StyleSheet.create` + `@/theme/tokens`. No raw hex values or font names in
  screens. Build on `components/ui`; see "Native UI conventions" below.
- **Strings**: every user-facing string goes through `t('…')`. Add English keys to
  `src/i18n/locales/en.json` only; keys are type-checked.
- **Routes**: add a file under `src/app/(app)/`. Give it a title in `(app)/_layout.tsx`. Use
  `presentation: 'modal' | 'fullScreenModal' | 'formSheet'` for flows, `<Sheet>` for quick picks.
- **Toasts**: `toast.success(…)` / `toast.error(…)` from `@/components/ui` (they also play the
  success/error haptic). Log handled failures with `console.warn`: in development
  `console.error` opens Expo's error overlay.
- **Storage**: use `storage` from `@/lib/storage` (never `expo-secure-store` directly, it does
  nothing on web). For zustand, `persist` with `createJSONStorage(() => storage)`. Keys look like
  `splitpro.somePref` (letters, digits, `.`, `-`, `_` only).
- **Server settings** the web reads in `getServerSideProps` (e.g. `ENABLE_SENDING_INVITES`) come
  from `useAppConfig()`, backed by `user.getAppConfig`. Add fields there, not `EXPO_PUBLIC_*` vars.
- **Dialogs and back**: `confirmAction` / `showMessage` from `@/lib/dialogs`; close a screen with
  `goBackOr()` from `@/lib/navigation`, which also works when the screen was opened from a link.

## Native UI conventions

The app should feel like it was built with UIKit / SwiftUI on iOS and Jetpack Compose on Android, not
like the website in a web view. Match what the system apps (Settings, Contacts, Wallet, Mail, Gmail,
Google Contacts) do; only reach for custom UI when there is no system equivalent. The reference
screens are sign-in / verify (`app/(auth)`), the Balances tab
(`app/(app)/(tabs)/(balances)/balances.tsx`) and the friend screen
(`app/(app)/balances/[friendId].tsx`). Copy them.

### Theme: colors

`colors` in `@/theme/tokens` are **semantic roles**, never brand hex values. On iOS they are system
colors (`PlatformColor`), so light/dark mode and Increased Contrast just work; on Android they are
Material 3 dynamic colors from the wallpaper; on web they are the iOS values for the scheme at
launch. The app follows the system appearance (`userInterfaceStyle: 'automatic'`).

| Role                                                      | Use for                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `background` / `secondaryBackground`                      | plain lists and free-form screens / tiles on them                   |
| `groupedBackground` / `secondaryGroupedBackground`        | inset-grouped screens (forms, settings, detail) / the cells on them |
| `label`, `secondaryLabel`, `tertiaryLabel`, `placeholder` | text, in decreasing importance                                      |
| `separator`                                               | hairlines between rows                                              |
| `fill`, `secondaryFill`, `tertiaryFill`                   | behind controls: search fields, gray buttons, code cells, skeletons |
| `highlight`                                               | pressed row (iOS) / ripple (Android)                                |
| `tint`                                                    | brand cyan for text and icons: links, plain buttons, active tab     |
| `tintFill`, `onTint`                                      | brand cyan behind white: filled buttons, prominent header buttons   |
| `tintStrong`                                              | tint text on a tint wash (tinted buttons)                           |
| `positive`, `negative`                                    | money you get back / money you owe                                  |
| `destructive`                                             | delete, remove, errors                                              |

Brand cyan is **only** the tint. Don't paint backgrounds, cards or headers with it.

The tint is split because iOS always draws white on prominent bar buttons: white needs cyan-700
(`tintFill`) for 4.5:1, which is too dark to read as text on black, so dark mode uses the bright
cyan for `tint`. The hex values live in `theme/palette.ts`, and `palette.test.ts` fails if a pair
drops below WCAG AA. Never put `onTint` on `tint`.

### Theme: type

`<Text variant>` uses the iOS text styles: `largeTitle`, `title1`–`title3`, `headline`, `body`
(default), `callout`, `subheadline`, `footnote`, `caption1`, `caption2`. Android gets the matching
Material 3 sizes. The font is the system font (SF Pro / Roboto); there is no custom font. Text scales
with Dynamic Type / font size, so never hardcode `fontSize` in screens; pick a variant. Use
`weight` for emphasis (`headline` is already semibold) and `tabular` for amounts that line up.
`footnote` and the captions default to `secondaryLabel`.

```tsx
<Text variant="title1" accessibilityRole="header">{name}</Text>
<Text variant="footnote">{t('auth.code_sent', { email })}</Text>
<Money amount={balance} currency="USD" mode="balance" variant="headline" />
```

Other tokens: `spacing` (4pt grid), `radii.section` (26 on iOS 26 Liquid Glass, 10 before, 16 on
Android), `layout.rowMinHeight` (44 iOS / 56 Android), `layout.rowAvatar`, `layout.sectionMargin`.

### Navigation and headers

- **Tabs** are the system tab bar (`NativeTabs` from `expo-router/native-tabs`): `UITabBar` with
  Liquid Glass on iOS 26, the Material navigation bar on Android. Each tab is a route group with
  its own `Stack` (`(tabs)/(balances)/_layout.tsx` …), so detail screens push inside the native stack
  with the system back button and swipe-back.
- **Every screen has a native header.** Never draw a title or a back button in JS. Tab roots use
  `tabRootOptions` (large title that collapses on scroll); detail screens use a normal title.
  Set the title with `<Stack.Screen options={{ title }} />` or in the layout.
- **iOS 26 headers are transparent**: the root scroll view must have
  `contentInsetAdjustmentBehavior="automatic"` and no top safe-area padding (`Screen edges={[]}`),
  so content scrolls under the glass and the large title collapses. Every screen does this now.
  `opaqueHeaderOptions` is only for page-sheet modals whose content starts with a large picture
  (edit profile, feedback): a transparent header in a sheet covers the top of the content.
- Inset-grouped screens take `groupedScreenOptions` in their layout (the grouped background).
- **The large title only follows the list if the list is the screen's first view.** UIKit walks
  the first-subview chain when the screen appears. So: no wrapping `<View>` (return a fragment with
  the list first, then `HeaderActions` / `AddExpenseAction`; put the background on the list's
  `style`), and keep the list mounted while loading or failing: show the spinner or error through
  `ListEmptyComponent`, not an early `return`. See `(tabs)/(balances)/balances.tsx`.
- **Back buttons are a chevron only** (`headerBackButtonDisplayMode: 'minimal'` in
  `stackScreenOptions`), like iOS 26 system apps. Titles use `label`; the tint only colors buttons.
- **Header buttons**: `<HeaderActions actions={[…]} />` anywhere in the screen. It renders
  `Stack.Toolbar` items on iOS (glass buttons, SF Symbols, native `UIMenu`) and Material icon
  buttons with a dropdown menu on Android. Use one icon button per action, an `icons.more` menu
  for the rest; destructive items go in the menu, never as a bare header button, in their own
  section at the end (`{ items: [...] }`), which draws a divider above them. An action without
  `icon` is a text button.
- **Menu items must be direct children of `Stack.Toolbar.Menu`.** It filters its children by type,
  so wrapping a `Stack.Toolbar.MenuAction` in your own component makes the menu silently not open.
  `HeaderActions` renders items with a plain function for this reason.
- **Add expense** on tab roots: `<AddExpenseAction actions={…otherHeaderButtons} />`. It is the
  prominent "+" in the iOS navigation bar and an extended FAB on Android. Render one per screen.
- **Modals**: flows with their own route (add expense, new group, add members, default split,
  edit profile, feedback, settle up) use `<ModalHeader onCancel confirm={{ label, onPress }} />`:
  glass ✕ / tinted ✓ on iOS 26, "Cancel" / bold "Done"-style text before iOS 26, ✕ and a text button
  (Material full-screen dialog) on Android. `onBack` swaps Cancel for a back chevron for a later
  step (settle up's amount step). `presentation: 'modal'` for flows, `'formSheet'` +
  `sheetAllowedDetents` for quick tasks with a few fields.
- **Sheets with a confirm button** (`Sheet` content, e.g. the split editor) use `SheetHeader`, drawn
  to match `ModalHeader`. Sheets with `size="medium" | "large"` don't pad the bottom; give the list a
  bottom content inset of `useSafeAreaInsets().bottom` so it scrolls to the sheet's edge.

```tsx
<Stack.Screen options={{ title: friendName }} />
<HeaderActions
  actions={[
    {
      label: t('common.more'),
      icon: icons.more,
      menu: [{ label: t('balances.friend.remove'), icon: icons.trash, destructive: true, onPress: confirmRemove }],
    },
  ]}
/>
```

### Which component

| Need                                  | Use                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Plain list (balances, activity)       | `FlatList`/`SectionList` + `ListRow`, `ItemSeparatorComponent={() => <Separator inset={rowInset(size)} />}` |
| Settings-style / form / detail screen | `Screen background="grouped"` + `Section header footer` containing `ListRow`s or `Input inline`             |
| Long grouped list                     | `SectionList` + `SectionHeader` + `SectionCell first last` (see the friend screen)                          |
| Row that opens a screen               | `ListRow accessory="chevron"` (chevron shows on iOS only, as on Material)                                   |
| Pick one of a few options             | `ListRow accessory="checkmark"` in a `Section`, or a menu (`HeaderActions` `menu`)                          |
| Pick from a long list (currency)      | `Sheet size="large"` + `SearchField` + list (see `CurrencySheet`)                                           |
| 2–4 mutually exclusive views          | `SegmentedControl` from `@expo/ui/community/segmented-control` (+ `haptics.selection()`)                    |
| Dropdown-style picker                 | `Picker` from `@expo/ui/community/picker`                                                                   |
| Date / time                           | `@expo/ui/community/datetime-picker` (inline or compact on iOS, Material dialog on Android)                 |
| On/off                                | RN `Switch` with `trackColor={{ true: colors.tint }}`, nothing else                                         |
| Menu from a button                    | `HeaderActions` `menu` in the header, `MenuView` from `@expo/ui/community/menu` elsewhere                   |
| Pick a value from a menu in a row     | `PopUpButton` (iOS pop-up button: value + ⌃⌄, opens a `MenuView`)                                           |
| Row actions on swipe                  | `SwipeActions` around the row (UIKit-style buttons from the trailing edge); keep a menu too                 |
| Settings-style row icon               | `SettingsIcon` (white symbol on a colored tile on iOS, plain Material symbol on Android)                    |
| Sticky section headers under a header | `StickyHeaderComponent={InsetStickyHeader}`; turn sticky headers off while a search bar is active           |
| Long-press menu + peek on a row (iOS) | `Link` with `Link.Trigger` / `Link.Preview` / `Link.Menu` (see `FriendBalanceRow`)                          |
| Confirm a destructive action          | `confirmAction({ destructive: true, … })` from `@/lib/dialogs` (native alert)                               |
| Quick in-screen task                  | `Sheet` (`@expo/ui` bottom sheet: SwiftUI sheet / Material modal sheet)                                     |
| Buttons in content                    | `Button` `filled` (one primary per screen), `tinted`, `gray`, `plain`, `destructive`                        |
| Actions under a profile header        | `QuickActions` (Contacts-card tiles)                                                                        |
| Summary numbers                       | tiles like `BalanceTotals`, or a `Card` on a grouped screen                                                 |
| Search on a screen with a header      | `Stack.SearchBar` / `headerSearchBarOptions`; `SearchField` only inside sheets                              |
| Empty / error state                   | `EmptyState` with an `icons.*` symbol (ContentUnavailableView)                                              |
| Loading                               | `FullScreenSpinner` (system `ActivityIndicator`); `RefreshControl` without a custom tint                    |
| Feedback after an action              | `toast.success/error` (glass capsule above modals, plays the haptic)                                        |
| Text field                            | `Input` (filled field on iOS, outlined on Android); `Input inline` inside a `Section`                       |
| A date shown to the user              | `formatDate` from `@/lib/dates` (device locale, medium style, like the date picker)                         |

### Icons

`<Icon name={icons.trash} />` renders an SF Symbol on iOS and a Material Symbol on Android via
`expo-symbols`. Add every new icon to the `icons` map in `components/ui/Icon.tsx` with both names, so
the platforms stay paired (SF Symbols app / fonts.google.com/icons). Header and tab icons take the
same names (`icon.ios` for `sf`, `icon.android` for `md`). There is no icon font or Lucide; brand
marks (Google "G", X logo) are SVGs (`react-native-svg`).

Don't keep local icon maps in feature folders; `icons` is the only table (settings tiles, form rows,
menus all use it). Common pairs: add `plus`/`add`, more `ellipsis`/`more_vert`, share `square.and.arrow.up`/`share`,
delete `trash`/`delete`, edit `pencil`/`edit`, settle `arrow.left.arrow.right`/`handshake`, receipt
`list.bullet.rectangle`/`receipt_long`, error `exclamationmark.triangle`/`error`.

### Haptics

`haptics` from `@/lib/haptics`: `selection()` when a picker/segment/checkmark value changes,
`light()` for a long press, `warning()` before a destructive confirmation, `success()`/`error()`
only when there's no toast (`toast.success/error` already play them). Don't add haptics to plain
taps or navigation.

### Gotchas learned in the conversion

- `MenuView` (`@expo/ui/community/menu`) sizes itself to its child: give the child an explicit size
  or `alignSelf`, or the tap target collapses.
- `ActionSheetIOS` crashes when given the app's dynamic tint (`tintColor: colors.tint`, a
  `DynamicColorIOS`). Leave `tintColor` out; the sheet takes the window tint (see `ReceiptRow`).
- `@expo/ui`'s `DateTimePicker` types `accentColor` as a string; the dynamic `colors.tint` needs a
  cast (`colors.tint as string`). It still resolves per mode at runtime.
- In dark mode the date picker's selected day is drawn by iOS in white on `accentColor` (the bright
  `tint`), about 2.4:1. Passing `tintFill` instead would fix the day but make the month heading
  and arrows fail on the dark popover, and no single cyan passes both. Left as the system draws it.
- Changing the simulator's appearance closes open menus; when screenshotting a menu in both modes,
  switch the mode first, then open it.

### Platform differences worth keeping

- iOS: chevrons on push rows, highlight on press, primary action in the navigation bar, inset-grouped
  sections with continuous corners, swipe-back.
- Android: ripples (`android_ripple`), no chevrons, extended FAB for the primary action, overflow
  menu `more_vert`, 56dp rows, outlined text fields, system back.
- Branch with `Platform.OS` / `Platform.select` inside components in `components/ui`; screens should
  rarely need to.

### Do / don't

- Do use system controls (`Switch`, `ActivityIndicator`, `Alert`, menus, sheets, pickers) instead of
  drawing look-alikes.
- Do let lists fill the screen edge to edge; use `Section` for grouped content instead of bordered
  web cards.
- Do give icon-only buttons an `accessibilityLabel` and mark titles with `accessibilityRole="header"`.
- Don't hardcode hex colors, font families, font sizes or `keyboardAppearance`.
- Don't put a JS title above content, a custom back arrow, or a custom tab bar.
- Don't use borders around inputs or cards on iOS, or cyan backgrounds anywhere but `filled` buttons.
- Don't wrap rows in pressable "cards" with shadows; that's the web look this replaced.

### Native dependencies

Added for the native UI: `expo-symbols` (SF / Material Symbols), `expo-haptics`, `@expo/ui` (sheets,
menus, pickers, segmented control), `expo-glass-effect` (Liquid Glass toast and sheet buttons),
`react-native-gesture-handler` + `react-native-reanimated` + `react-native-worklets` (swipe actions;
the app root is a `GestureHandlerRootView`). Removed:
`@expo-google-fonts/poppins`. These need a **new development build** (`npx expo run:ios` /
`run:android`, or EAS) — an old dev client will crash on the missing native modules. After changing
`app.config.ts` (e.g. `userInterfaceStyle`), regenerate native projects with
`npx expo prebuild --clean`.

Building for the simulator with `xcodebuild` directly: keep ad-hoc signing (`CODE_SIGN_IDENTITY=-`).
`CODE_SIGNING_ALLOWED=NO` drops the entitlements, the keychain stops working, and you are signed
out on every launch.

## Sharing code with the web

`metro.config.js` watches only `../src`, and resolves bare imports from shared files (`zod`,
`date-fns`, …) from `mobile/node_modules`, so the web's `node_modules` is never bundled. It is
on the blocklist, so a mistake fails the build instead of shipping silently.

The shared utils import enums from `@prisma/client`, which can't run in React Native. Metro serves
`src/shims/prisma-client.ts` for that import instead. TypeScript still sees the real Prisma types,
and the shim uses `satisfies` so `pnpm typecheck` fails if the schema's enums change without it.
If you add an enum to `schema.prisma` that shared code uses, add it to the shim.

Mobile is excluded from the root `tsconfig.json`, ESLint, Prettier and Docker build. It has its own
`package.json`, lockfile and configs.

## Auth

Email code: `POST /api/mobile/auth/email` → `POST /api/mobile/auth/email/verify` returns
`{ token, user }`. Apple: `POST /api/mobile/auth/apple` with the identity token. The token is kept
in `lib/storage` and sent as `Authorization: Bearer <token>` on every tRPC call. Sign-out calls
`POST /api/mobile/auth/signout` with the device's push token, so the server forgets both at once.
Google: browser sign-in, then `POST /api/mobile/auth/exchange`
with a PKCE verifier (`lib/socialAuth.ts`).

The guard in `app/_layout.tsx` sends signed-out users to sign-in, whatever link opened the app.
`useSaveLinkWhileSignedOut` remembers that link (e.g. `splitpro://join-group?groupId=…`) and
`useOpenPendingLink` in `(app)/_layout.tsx` opens it once the user signs in, however they sign in.
Notification taps are read when the signed-in layout mounts, so they also survive sign-in.

## Not done yet

Universal links / App Links are commented
out in `app.config.ts` until splitpro.app serves the `.well-known` files.
