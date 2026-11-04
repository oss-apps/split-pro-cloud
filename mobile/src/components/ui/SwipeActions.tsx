import React, { useRef } from 'react';
import { type ColorValue, Platform, Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  Extrapolation,
  type SharedValue,
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { type TileColor, colors, spacing, tileColors } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

const ACTION_WIDTH = 76;

export interface SwipeAction {
  label: string;
  icon?: IconName;
  /** A system color, or `destructive` (red) for delete / stop. */
  color: TileColor | 'destructive';
  onPress: () => void;
}

export interface SwipeActionsProps {
  /** Revealed by swiping the row to the left, first action leftmost (like Mail's More, Trash). */
  actions: SwipeAction[];
  /** Behind the row while it slides: the row's own background. */
  background?: ColorValue;
  enabled?: boolean;
  children: React.ReactNode;
}

const ActionButton: React.FC<{
  action: SwipeAction;
  index: number;
  count: number;
  translation: SharedValue<number>;
  onPress: () => void;
}> = ({ action, index, count, translation, onPress }) => {
  const width = count * ACTION_WIDTH;
  // The buttons come out from under the row's trailing edge and spread out, like UIKit's.
  const style = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          translation.value,
          [-width, 0],
          [0, width - index * ACTION_WIDTH],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));
  const color = 'destructive' === action.color ? colors.destructive : tileColors[action.color];

  return (
    <Animated.View
      style={[styles.action, { backgroundColor: color, zIndex: count - index }, style]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action.label}
        onPress={onPress}
        style={styles.actionButton}
      >
        {action.icon ? <Icon name={action.icon} size={20} color={colors.white} /> : null}
        <Text
          variant="footnote"
          weight="medium"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={styles.actionLabel}
        >
          {action.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
};

/**
 * Swipe a row left to reveal buttons, like Mail and Reminders (UITableView swipe actions). iOS
 * only: Material lists don't have them, so on Android the row is returned as is; always offer the
 * same actions another way too (a menu on tap or long press), as swipe actions are hidden.
 */
export const SwipeActions: React.FC<SwipeActionsProps> = ({
  actions,
  background = colors.secondaryGroupedBackground,
  enabled = true,
  children,
}) => {
  const swipeable = useRef<SwipeableMethods>(null);

  if ('ios' !== Platform.OS || !actions.length || !enabled) {
    return <>{children}</>;
  }

  return (
    <ReanimatedSwipeable
      ref={swipeable}
      friction={1}
      rightThreshold={ACTION_WIDTH / 2}
      overshootRight={false}
      childrenContainerStyle={{ backgroundColor: background }}
      renderRightActions={(_progress, translation) => (
        <View style={[styles.actions, { width: actions.length * ACTION_WIDTH }]}>
          {actions.map((action, index) => (
            <ActionButton
              key={action.label}
              action={action}
              index={index}
              count={actions.length}
              translation={translation}
              onPress={() => {
                swipeable.current?.close();
                action.onPress();
              }}
            />
          ))}
        </View>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
};

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
  },
  action: {
    width: ACTION_WIDTH,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[1],
  },
  actionLabel: {
    color: colors.white,
  },
});
