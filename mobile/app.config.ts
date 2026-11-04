import { type ConfigContext, type ExpoConfig } from 'expo/config';

/** The brand's dark navy, behind the adaptive icon. */
const ICON_BACKGROUND = '#030711';

// @koushikdotdev/splitpro on expo.dev. Push tokens and EAS builds are tied to it.
const EAS_PROJECT_ID = '82694b46-ca71-4652-a8cf-2674a5ced9e4';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'SplitPro',
  slug: 'splitpro',
  owner: 'koushikdotdev',
  scheme: 'splitpro',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  // Follows the system appearance; colors come from semantic tokens (src/theme/tokens.ts).
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'app.splitpro',
    supportsTablet: true,
    usesAppleSignIn: true,
    // Only standard HTTPS, which is exempt from export compliance paperwork.
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
    // TODO: enable universal links once https://splitpro.app/.well-known/apple-app-site-association
    // is served: associatedDomains: ['applinks:splitpro.app'],
  },
  android: {
    package: 'app.splitpro',
    adaptiveIcon: {
      foregroundImage: './assets/icon.png',
      backgroundColor: ICON_BACKGROUND,
    },
    // TODO: add App Links once https://splitpro.app/.well-known/assetlinks.json is served:
    // intentFilters: [{ action: 'VIEW', autoVerify: true, category: ['BROWSABLE', 'DEFAULT'],
    //   data: [{ scheme: 'https', host: 'splitpro.app' }] }],
  },
  plugins: [
    'expo-router',
    'expo-status-bar',
    // No biometrics, so no Face ID usage text.
    ['expo-secure-store', { faceIDPermission: false }],
    'expo-localization',
    'expo-font',
    'expo-image',
    'expo-apple-authentication',
    'expo-web-browser',
    [
      'expo-image-picker',
      {
        photosPermission: 'SplitPro uses your photos to attach receipts to expenses.',
        cameraPermission: 'SplitPro uses the camera to take photos of receipts.',
        // Photos only, never video.
        microphonePermission: false,
      },
    ],
    // TODO: add `icon`, a 96x96 white-on-transparent PNG, or Android shows a white square.
    ['expo-notifications', { color: '#06b6d4', defaultChannel: 'default' }],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 160,
        backgroundColor: '#ffffff',
        dark: { backgroundColor: '#000000' },
      },
    ],
  ],
  extra: {
    ...config.extra,
    eas: { ...config.extra?.eas, projectId: EAS_PROJECT_ID },
  },
  experiments: {
    typedRoutes: true,
  },
});
