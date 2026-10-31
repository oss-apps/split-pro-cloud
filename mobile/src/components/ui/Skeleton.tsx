import React, { useEffect, useState } from 'react';
import { Animated, type DimensionValue, StyleSheet } from 'react-native';

import { colors, radii } from '@/theme/tokens';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
}

/** Pulsing placeholder for content that's loading. Use sparingly; a `Spinner` is often enough. */
export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 16,
  radius = radii.md,
}) => {
  const [opacity] = useState(() => new Animated.Value(0.5));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    animation.start();

    return () => animation.stop();
  }, [opacity]);

  return <Animated.View style={[styles.base, { width, height, borderRadius: radius, opacity }]} />;
};

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.fill,
  },
});
