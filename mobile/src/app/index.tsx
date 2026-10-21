import { Redirect } from 'expo-router';
import React from 'react';

import { useAuthStore } from '@/store/authStore';

const Index = () => {
  const isSignedIn = useAuthStore((state) => 'signedIn' === state.status);

  return <Redirect href={isSignedIn ? '/balances' : '/sign-in'} />;
};

export default Index;
