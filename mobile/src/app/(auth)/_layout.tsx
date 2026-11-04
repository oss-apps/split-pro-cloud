import { Stack } from 'expo-router';
import React from 'react';

import { stackScreenOptions } from '@/theme/navigation';

const AuthLayout = () => (
  <Stack screenOptions={{ ...stackScreenOptions, headerShown: false }}>
    <Stack.Screen name="sign-in" />
    {/* A bare native header: only the back button, which goes back to change the email */}
    <Stack.Screen name="verify" options={{ headerShown: true, title: '' }} />
    <Stack.Screen name="oauth-callback" options={{ animation: 'none' }} />
  </Stack>
);

export default AuthLayout;
