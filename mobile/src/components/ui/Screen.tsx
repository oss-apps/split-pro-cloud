import React from 'react';
import {
  KeyboardAvoidingView,
  type RefreshControlProps,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/tokens';

import { Text } from './Text';

export interface ScreenProps {
  children: React.ReactNode;
  /**
   * @deprecated In-content title for screens without a native header. Give the screen a native
   * header with a (large) title instead (see README, "Native UI conventions").
   */
  title?: string;
  /** @deprecated Buttons right of `title`. Use `HeaderActions` in the native header. */
  actions?: React.ReactNode;
  /** Wraps content in a ScrollView. Leave off for screens that render their own FlatList. */
  scroll?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /** Horizontal padding for the content. Defaults to true. */
  padded?: boolean;
  /**
   * `grouped` (systemGroupedBackground) for screens of inset-grouped `Section`s, `plain`
   * (systemBackground, default) for plain lists and free-form content.
   */
  background?: 'plain' | 'grouped';
  /**
   * Safe-area edges to pad. Use `[]` under a native header: a scrolling screen then insets its
   * content under the (transparent) header itself. `['top', 'bottom']` for screens without a
   * header, like sign-in.
   */
  edges?: Edge[];
  /** Pushes content up when the keyboard opens. */
  keyboard?: boolean;
}

export const Screen: React.FC<ScreenProps> = ({
  children,
  title,
  actions,
  scroll,
  refreshControl,
  padded = true,
  background = 'plain',
  edges = ['top'],
  keyboard,
}) => {
  const header = title ? (
    <View style={styles.header}>
      <Text variant="largeTitle" style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {actions}
    </View>
  ) : null;
  const underHeader = !edges.includes('top');

  const content = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[padded ? styles.padded : null, styles.scrollContent]}
      // Under a native header, scroll under it and let large titles collapse.
      contentInsetAdjustmentBehavior={underHeader ? 'automatic' : 'never'}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      refreshControl={refreshControl}
    >
      {header}
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, padded ? styles.padded : null]}>
      {header}
      {children}
    </View>
  );

  return (
    <SafeAreaView
      style={[
        styles.fill,
        {
          backgroundColor: 'grouped' === background ? colors.groupedBackground : colors.background,
        },
      ]}
      edges={[...edges, 'left', 'right']}
    >
      {keyboard ? (
        // Also on Android: edge to edge, the window may not resize for the keyboard. Padding only
        // covers the part of the keyboard that overlaps, so it adds nothing when it does.
        <KeyboardAvoidingView style={styles.fill} behavior="padding">
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: spacing[4],
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing[8],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingVertical: spacing[4],
  },
  title: {
    flexShrink: 1,
  },
});
