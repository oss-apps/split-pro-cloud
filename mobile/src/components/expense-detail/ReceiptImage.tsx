import { Image } from 'expo-image';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, ListRow, Text, icons } from '@/components/ui';
import { useAppConfig } from '@/lib/appConfig';
import { colors, radii, spacing } from '@/theme/tokens';

import { getReceiptUrl } from './expenseDetail';

const THUMBNAIL_SIZE = 44;

/**
 * The receipt full screen on black, like Photos: pinch to zoom (iOS), Done to close. Android
 * closes with the system back.
 */
const ReceiptViewer: React.FC<{ url: string; visible: boolean; onClose: () => void }> = ({
  url,
  visible,
  onClose,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.viewer}>
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.fill}
          maximumZoomScale={5}
          minimumZoomScale={1}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          centerContent
        >
          <Image
            source={{ uri: url }}
            style={styles.fill}
            contentFit="contain"
            accessibilityLabel={t('expense.detail.receipt_title')}
          />
        </ScrollView>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('expense.detail.close')}
          style={({ pressed }) => [
            styles.close,
            { top: insets.top + spacing[2] },
            pressed ? styles.pressed : null,
          ]}
        >
          {'ios' === Platform.OS ? (
            <Text weight="semibold" color="white">
              {t('expense.done')}
            </Text>
          ) : (
            <Icon name={icons.close} size={24} color={colors.white} />
          )}
        </Pressable>
      </View>
    </Modal>
  );
};

/** The receipt as a row with a thumbnail; tapping it opens the full-screen viewer. */
export const ReceiptRow: React.FC<{ fileKey: string }> = ({ fileKey }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Without the server's public storage URL the receipt is only marked as attached.
  const { storagePublicUrl } = useAppConfig();
  const url = getReceiptUrl(storagePublicUrl, fileKey);

  if (!url) {
    return (
      <ListRow
        left={
          <View style={[styles.thumbnail, styles.placeholder]}>
            <Icon name={icons.receipt} size={20} color={colors.secondaryLabel} />
          </View>
        }
        title={t('expense.detail.receipt')}
        subtitle={t('expense.detail.receipt_attached')}
      />
    );
  }

  return (
    <>
      <ListRow
        left={
          <Image
            source={{ uri: url }}
            style={styles.thumbnail}
            contentFit="cover"
            transition={150}
          />
        }
        title={t('expense.detail.receipt')}
        accessory="chevron"
        accessibilityLabel={t('expense.detail.view_receipt')}
        onPress={() => setOpen(true)}
      />
      <ReceiptViewer url={url} visible={open} onClose={() => setOpen(false)} />
    </>
  );
};

const styles = StyleSheet.create({
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: radii.sm,
    borderCurve: 'continuous',
    backgroundColor: colors.fill,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewer: {
    flex: 1,
    backgroundColor: colors.black,
  },
  fill: {
    flex: 1,
  },
  close: {
    position: 'absolute',
    right: spacing[4],
    minHeight: 36,
    minWidth: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    borderRadius: radii.full,
    backgroundColor: colors.overlay,
  },
  pressed: {
    opacity: 0.6,
  },
});
