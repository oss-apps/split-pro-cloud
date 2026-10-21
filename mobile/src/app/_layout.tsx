import '@/i18n';

import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { LogBox, StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Toaster } from '@/components/ui';
import { ApiProvider } from '@/providers/ApiProvider';
import { useSaveLinkWhileSignedOut } from '@/providers/usePendingLink';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync();

// React Native's own dev warning when a native-driven animation (pull to refresh, the large title)
// ends with no JS listener. Nothing to fix in the app.
LogBox.ignoreLogs(['Sending `onAnimatedValueUpdate` with no listeners registered']);

/** Native headers, tab bars and back buttons take their colors from the semantic tokens. */
const navigationColors = {
  primary: colors.tint,
  background: colors.background,
  card: colors.background,
  text: colors.label,
  border: colors.separator,
};

const RootLayout = () => {
  const scheme = useColorScheme();
  const status = useAuthStore((state) => state.status);
  const hydrate = useAuthStore((state) => state.hydrate);
  const isReady = 'loading' !== status;
  const baseTheme = 'dark' === scheme ? DarkTheme : DefaultTheme;
  const navigationTheme = { ...baseTheme, colors: { ...baseTheme.colors, ...navigationColors } };

  useSaveLinkWhileSignedOut();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (isReady) {
      void SplashScreen.hideAsync();
    }
  }, [isReady]);

  if (!isReady) {
    return null;
  }

  const isSignedIn = 'signedIn' === status;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider value={navigationTheme}>
          <ApiProvider>
            <StatusBar style="auto" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Protected guard={isSignedIn}>
                <Stack.Screen name="(app)" />
              </Stack.Protected>
              <Stack.Protected guard={!isSignedIn}>
                <Stack.Screen name="(auth)" />
              </Stack.Protected>
            </Stack>
            <Toaster />
          </ApiProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

export default RootLayout;
