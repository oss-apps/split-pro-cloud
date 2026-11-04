import { type AndroidSymbol, type SFSymbol, SymbolView, type SymbolWeight } from 'expo-symbols';
import React from 'react';
import { type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme/tokens';

/** An SF Symbol on iOS and its Material Symbol on Android (and web). */
export interface IconName {
  ios: SFSymbol;
  android: AndroidSymbol;
}

export interface IconProps {
  name: IconName;
  size?: number;
  color?: ColorValue;
  /** SF Symbol weight; match the text next to it (e.g. `semibold` beside a headline). */
  weight?: SymbolWeight;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** System icon: SF Symbols on iOS, Material Symbols on Android. Decorative unless labelled. */
export const Icon: React.FC<IconProps> = ({
  name,
  size = 22,
  color = colors.label,
  weight,
  accessibilityLabel,
  style,
}) => (
  <SymbolView
    name={name}
    size={size}
    tintColor={color}
    weight={weight}
    style={style}
    accessible={!!accessibilityLabel}
    accessibilityLabel={accessibilityLabel}
    accessibilityElementsHidden={!accessibilityLabel}
    importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
  />
);

/**
 * Icons used across the app. Add new ones here so iOS and Android stay paired. Names:
 * https://developer.apple.com/sf-symbols/ and https://fonts.google.com/icons.
 */
export const icons = {
  add: { ios: 'plus', android: 'add' },
  addCircle: { ios: 'plus.circle.fill', android: 'add_circle' },
  share: { ios: 'square.and.arrow.up', android: 'share' },
  export: { ios: 'arrow.down.doc', android: 'download' },
  trash: { ios: 'trash', android: 'delete' },
  more: { ios: 'ellipsis', android: 'more_vert' },
  /** A "more" button inside content (rows, cards), not in the header. */
  moreCircle: { ios: 'ellipsis.circle', android: 'more_horiz' },
  edit: { ios: 'pencil', android: 'edit' },
  close: { ios: 'xmark', android: 'close' },
  removeCircle: { ios: 'xmark.circle.fill', android: 'cancel' },
  check: { ios: 'checkmark', android: 'check' },
  chevronLeft: { ios: 'chevron.left', android: 'arrow_back' },
  chevronRight: { ios: 'chevron.right', android: 'chevron_right' },
  arrowRight: { ios: 'arrow.right', android: 'arrow_forward' },
  /** A pop-up button's indicator, like iOS menus that pick a value. */
  popUp: { ios: 'chevron.up.chevron.down', android: 'unfold_more' },
  search: { ios: 'magnifyingglass', android: 'search' },
  settle: { ios: 'arrow.left.arrow.right', android: 'handshake' },
  receipt: { ios: 'list.bullet.rectangle', android: 'receipt_long' },
  repeat: { ios: 'repeat', android: 'repeat' },
  balances: { ios: 'chart.pie', android: 'pie_chart' },
  balancesSelected: { ios: 'chart.pie.fill', android: 'pie_chart' },
  groups: { ios: 'person.3', android: 'group' },
  groupsSelected: { ios: 'person.3.fill', android: 'group' },
  groupAdd: { ios: 'person.2.badge.plus', android: 'group_add' },
  activity: { ios: 'list.bullet', android: 'list' },
  account: { ios: 'person.crop.circle', android: 'account_circle' },
  accountSelected: { ios: 'person.crop.circle.fill', android: 'account_circle' },
  person: { ios: 'person', android: 'person' },
  personAdd: { ios: 'person.badge.plus', android: 'person_add' },
  personMissing: { ios: 'person.crop.circle.badge.questionmark', android: 'person_off' },
  /** Who paid. */
  payer: { ios: 'person.crop.circle', android: 'account_circle' },
  leave: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout' },
  scale: { ios: 'scalemass', android: 'balance' },
  split: { ios: 'divide', android: 'call_split' },
  refund: { ios: 'plus.forwardslash.minus', android: 'exposure' },
  stats: { ios: 'chart.bar', android: 'bar_chart' },
  error: { ios: 'exclamationmark.triangle', android: 'error' },
  success: { ios: 'checkmark.circle.fill', android: 'check_circle' },
  /** Filled, for status notices. */
  info: { ios: 'info.circle.fill', android: 'info' },
  /** Outline, for menu items and buttons ("Group info"). */
  infoOutline: { ios: 'info.circle', android: 'info' },
  pause: { ios: 'pause', android: 'pause' },
  play: { ios: 'play', android: 'play_arrow' },
  stop: { ios: 'stop.circle', android: 'stop_circle' },
  mail: { ios: 'envelope', android: 'mail' },
  send: { ios: 'paperplane', android: 'send' },
  calendar: { ios: 'calendar', android: 'calendar_today' },
  money: { ios: 'banknote', android: 'payments' },
  camera: { ios: 'camera', android: 'photo_camera' },
  photo: { ios: 'photo', android: 'image' },
  photoAdd: { ios: 'photo.badge.plus', android: 'add_photo_alternate' },

  // Settings rows (white on a colored tile on iOS, see SettingsIcon): filled symbols, like Settings.
  notifications: { ios: 'bell.fill', android: 'notifications' },
  currency: { ios: 'dollarsign', android: 'payments' },
  feedback: { ios: 'bubble.left.fill', android: 'feedback' },
  help: { ios: 'questionmark', android: 'help' },
  privacy: { ios: 'hand.raised.fill', android: 'privacy_tip' },
  terms: { ios: 'doc.text.fill', android: 'description' },
  download: { ios: 'arrow.down.doc.fill', android: 'download' },
  import: { ios: 'square.and.arrow.down.fill', android: 'move_to_inbox' },
  star: { ios: 'star.fill', android: 'star' },
  sendFill: { ios: 'paperplane.fill', android: 'send' },
} as const satisfies Record<string, IconName>;
