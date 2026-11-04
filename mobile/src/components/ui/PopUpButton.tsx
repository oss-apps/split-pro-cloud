import { type MenuAction, MenuView } from '@expo/ui/community/menu';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { haptics } from '@/lib/haptics';
import { colors, spacing } from '@/theme/tokens';

import { Icon, icons } from './Icon';
import { Text } from './Text';

export type PopUpAction = MenuAction;

/**
 * A row's value that opens a menu to change it, like the pop-up buttons in iOS forms ("Repeat
 * Never ⌃⌄"): a native menu (UIMenu / Material dropdown) with a checkmark on the current value.
 * Items' `id`s come back through `onSelect`.
 */
export const PopUpButton: React.FC<{
  value: React.ReactNode;
  actions: PopUpAction[];
  onSelect: (id: string) => void;
  title?: string;
  leading?: React.ReactNode;
}> = ({ value, actions, onSelect, title, leading }) => (
  <MenuView
    title={title}
    actions={actions}
    onPressAction={({ nativeEvent }) => {
      haptics.selection();
      onSelect(nativeEvent.event);
    }}
  >
    <View style={styles.trigger}>
      {leading}
      {'string' === typeof value ? (
        <Text color="secondaryLabel" numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : (
        value
      )}
      <Icon name={icons.popUp} size={12} weight="semibold" color={colors.secondaryLabel} />
    </View>
  </MenuView>
);

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    minHeight: 32,
  },
  value: {
    maxWidth: 200,
  },
});
