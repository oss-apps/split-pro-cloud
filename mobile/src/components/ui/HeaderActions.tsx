import { type MenuAction, MenuView } from '@expo/ui/community/menu';
import { Stack } from 'expo-router';
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { colors, fontWeights, spacing } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';
import { Text } from './Text';

export interface HeaderMenuItem {
  label: string;
  icon?: IconName;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * A group of menu items, set apart by a divider like system menus (e.g. the destructive items at
 * the end). `title` is shown above the group on iOS.
 */
export interface HeaderMenuSection {
  title?: string;
  items: HeaderMenuItem[];
}

export type HeaderMenuEntry = HeaderMenuItem | HeaderMenuSection;

export interface HeaderAction {
  /** Spoken by screen readers. Shown as the button's text when there is no `icon`. */
  label: string;
  /** Icon-only button. Without it the button shows `label` (e.g. "Cancel" before iOS 26). */
  icon?: IconName;
  onPress?: () => void;
  /** Opens a menu of these items (or sections of items) instead of calling `onPress`. */
  menu?: HeaderMenuEntry[];
  disabled?: boolean;
  /** Shows a spinner instead of the button and disables it. */
  loading?: boolean;
  /** iOS: `prominent` fills the button with `tintFill`, for the screen's main action ("Save"). */
  variant?: 'plain' | 'prominent';
}

export interface HeaderActionsProps {
  actions: HeaderAction[];
  placement?: 'left' | 'right';
}

const isSection = (entry: HeaderMenuEntry): entry is HeaderMenuSection => 'items' in entry;

const allItems = (menu: HeaderMenuEntry[]) =>
  menu.flatMap((entry) => (isSection(entry) ? entry.items : [entry]));

// A function, not a component: Stack.Toolbar.Menu only keeps children that are MenuActions.
const renderIOSMenuItem = (item: HeaderMenuItem) => (
  <Stack.Toolbar.MenuAction
    key={item.label}
    icon={item.icon?.ios}
    destructive={item.destructive}
    disabled={item.disabled}
    onPress={item.onPress}
  >
    {item.label}
  </Stack.Toolbar.MenuAction>
);

const IOSActions: React.FC<HeaderActionsProps> = ({ actions, placement = 'right' }) => (
  <Stack.Toolbar placement={placement}>
    {actions.map((action) => {
      if (action.loading) {
        return (
          <Stack.Toolbar.View key={action.label}>
            <View style={styles.iosSpinner}>
              <Spinner />
            </View>
          </Stack.Toolbar.View>
        );
      }

      if (action.menu) {
        return (
          <Stack.Toolbar.Menu
            key={action.label}
            icon={action.icon?.ios}
            title={action.icon ? undefined : action.label}
            accessibilityLabel={action.label}
            disabled={action.disabled}
          >
            {action.menu.map((entry, index) =>
              isSection(entry) ? (
                <Stack.Toolbar.Menu key={`section-${index}`} inline title={entry.title}>
                  {entry.items.map(renderIOSMenuItem)}
                </Stack.Toolbar.Menu>
              ) : (
                renderIOSMenuItem(entry)
              ),
            )}
          </Stack.Toolbar.Menu>
        );
      }

      return (
        <Stack.Toolbar.Button
          key={action.label}
          icon={action.icon?.ios}
          accessibilityLabel={action.label}
          disabled={action.disabled}
          variant={action.variant}
          // UIKit draws prominent buttons' content white; the deeper fill keeps it readable.
          tintColor={'prominent' === action.variant ? colors.tintFill : undefined}
          onPress={action.onPress}
          // Text buttons: the confirm action is semibold, like UIKit's `.done` style.
          style={!action.icon && 'prominent' === action.variant ? styles.iosDone : undefined}
        >
          {action.icon ? undefined : action.label}
        </Stack.Toolbar.Button>
      );
    })}
  </Stack.Toolbar>
);

/**
 * A Material top app bar button: a 48dp icon button with a borderless ripple, or a text button
 * when the action has no icon. Without `onPress` it's only the content, for a menu trigger that
 * handles the press itself.
 */
const AndroidButton: React.FC<{ action: HeaderAction; onPress?: () => void }> = ({
  action,
  onPress,
}) => {
  const content = action.loading ? (
    <Spinner />
  ) : action.icon ? (
    <Icon name={action.icon} size={24} color={colors.secondaryLabel} />
  ) : (
    <Text variant="subheadline" weight="medium" color="tint">
      {action.label}
    </Text>
  );
  const style = [
    action.icon ? styles.androidIconButton : styles.androidTextButton,
    action.disabled ? styles.disabled : null,
  ];

  return !onPress ? (
    <View style={style}>{content}</View>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      accessibilityState={{ disabled: !!action.disabled, busy: !!action.loading }}
      disabled={action.disabled || action.loading}
      onPress={onPress}
      android_ripple={{ color: colors.highlight, borderless: true, radius: 24 }}
      style={style}
    >
      {content}
    </Pressable>
  );
};

const toMenuAction = (item: HeaderMenuItem): MenuAction => ({
  id: item.label,
  title: item.label,
  attributes: { destructive: item.destructive, disabled: item.disabled },
});

const AndroidActions: React.FC<HeaderActionsProps> = ({ actions }) => (
  <View style={styles.androidRow}>
    {actions.map((action) =>
      action.menu ? (
        <MenuView
          key={action.label}
          actions={action.menu.map((entry, index) =>
            isSection(entry)
              ? {
                  id: `section-${index}`,
                  title: entry.title ?? '',
                  displayInline: true,
                  subactions: entry.items.map(toMenuAction),
                }
              : toMenuAction(entry),
          )}
          onPressAction={({ nativeEvent }) =>
            allItems(action.menu ?? [])
              .find((item) => item.label === nativeEvent.event)
              ?.onPress()
          }
        >
          <AndroidButton action={action} />
        </MenuView>
      ) : (
        <AndroidButton key={action.label} action={action} onPress={action.onPress} />
      ),
    )}
  </View>
);

/**
 * Buttons in the screen's native header, rendered from the screen itself. iOS gets bar button
 * items (SF Symbols or text, Liquid Glass, native menus); Android gets Material icon or text
 * buttons and a dropdown menu. Keep it to one or two actions; put more in a `menu` (icon
 * `icons.more`), with destructive items in their own section at the end.
 *
 * @example
 * <HeaderActions actions={[{ label: t('share'), icon: icons.share, onPress: share }]} />
 */
export const HeaderActions: React.FC<HeaderActionsProps> = (props) => {
  if ('ios' === Platform.OS) {
    return <IOSActions {...props} />;
  }

  const render = () => <AndroidActions {...props} />;

  return (
    <Stack.Screen
      options={'left' === props.placement ? { headerLeft: render } : { headerRight: render }}
    />
  );
};

const styles = StyleSheet.create({
  iosSpinner: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iosDone: {
    fontWeight: fontWeights.semibold,
  },
  androidRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  androidIconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  androidTextButton: {
    height: 48,
    minWidth: 48,
    paddingHorizontal: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.38,
  },
});
