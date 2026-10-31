import React, { useImperativeHandle, useMemo, useState } from 'react';
import { Animated, type LayoutRectangle, Platform, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isLiquidGlassEra } from '@/theme/tokens';

type StickyHeaderProps = Parameters<NonNullable<ScrollViewProps['StickyHeaderComponent']>>[0];

/** Height of the collapsed (small title) navigation bar below the status bar. */
const COLLAPSED_BAR_HEIGHT = isLiquidGlassEra ? 54 : 44;

/**
 * A `StickyHeaderComponent` for lists that scroll under a transparent iOS header
 * (`contentInsetAdjustmentBehavior="automatic"`). React Native's default pins headers at the top
 * of the scroll view, which is behind the navigation bar there; this one pins them right below
 * the collapsed bar, like Mail's day headers. Android headers aren't transparent: no offset.
 */
export const InsetStickyHeader = ({
  children,
  nextHeaderLayoutY,
  onLayout,
  scrollAnimatedValue,
  nativeID,
  ref,
}: StickyHeaderProps) => {
  const safeTop = useSafeAreaInsets().top;
  const top = 'ios' === Platform.OS ? safeTop + COLLAPSED_BAR_HEIGHT : 0;
  const [layout, setLayout] = useState<LayoutRectangle | null>(null);
  const [nextY, setNextY] = useState<number | undefined>(undefined);
  const nextHeaderY = nextY ?? nextHeaderLayoutY;

  useImperativeHandle(ref, () => ({ setNextHeaderY: setNextY }), []);

  const translateY = useMemo(() => {
    if (!layout) {
      return 0;
    }

    // Scrolls normally until it reaches the bar, then moves with the scroll, until the next
    // header pushes it out.
    const start = layout.y - top;
    const inputRange = [start - 1, start];
    const outputRange = [0, 0];
    const collision = (nextHeaderY ?? 0) - layout.height - top;

    if (collision >= start) {
      inputRange.push(collision, collision + 1);
      outputRange.push(collision - start, collision - start);
    } else {
      inputRange.push(start + 1);
      outputRange.push(1);
    }

    return scrollAnimatedValue.interpolate({ inputRange, outputRange });
  }, [layout, nextHeaderY, scrollAnimatedValue, top]);

  return (
    <Animated.View
      collapsable={false}
      nativeID={nativeID}
      onLayout={(event) => {
        setLayout(event.nativeEvent.layout);
        onLayout(event);
      }}
      style={{ zIndex: 10, transform: [{ translateY }] }}
    >
      {children}
    </Animated.View>
  );
};
