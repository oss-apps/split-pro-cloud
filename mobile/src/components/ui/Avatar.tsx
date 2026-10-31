import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Text as RNText, StyleSheet, View } from 'react-native';

import { avatarColors, avatarInitialsColor, colors } from '@/theme/tokens';

export interface AvatarProps {
  name?: string | null;
  /** Used for the initials and color when there is no name. */
  email?: string | null;
  image?: string | null;
  size?: number;
}

export const getInitials = (label: string) => {
  const words = label
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = 1 < words.length ? (words[words.length - 1]?.[0] ?? '') : '';

  return `${first}${last}`.toUpperCase() || '?';
};

const pickColor = (label: string) => {
  const hash = [...label].reduce((total, char) => (total * 31 + char.charCodeAt(0)) | 0, 0);
  return avatarColors[Math.abs(hash) % avatarColors.length] ?? avatarColors[0];
};

/** User or group avatar: the image if there is one, otherwise colored initials. */
export const Avatar: React.FC<AvatarProps> = ({ name, email, image, size = 40 }) => {
  const [failed, setFailed] = useState(false);
  const label = name?.trim() || email?.trim() || '';
  const shape = { width: size, height: size, borderRadius: size / 2 };

  if (image && !failed) {
    return (
      <Image
        source={{ uri: image }}
        style={[styles.base, shape]}
        accessibilityLabel={label}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View
      style={[styles.base, shape, { backgroundColor: pickColor(label) }]}
      accessibilityLabel={label}
    >
      {/* Sized with the avatar, not Dynamic Type: the circle doesn't grow */}
      <RNText allowFontScaling={false} style={[styles.initials, { fontSize: size * 0.4 }]}>
        {getInitials(label)}
      </RNText>
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.fill,
  },
  initials: {
    fontWeight: '600',
    color: avatarInitialsColor,
    includeFontPadding: false,
  },
});
