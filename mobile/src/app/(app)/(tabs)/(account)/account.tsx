import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { NotificationsSection } from '@/components/account/NotificationsSection';
import { XLogo } from '@/components/account/XLogo';
import { shareDataExport } from '@/components/account/downloadData';
import {
  Avatar,
  ListRow,
  SETTINGS_ICON_SIZE,
  Section,
  SettingsIcon,
  Skeleton,
  Spinner,
  Text,
  icons,
  rowInset,
  toast,
} from '@/components/ui';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { confirmAction } from '@/lib/dialogs';
import { useAuthStore } from '@/store/authStore';
import { colors, spacing } from '@/theme/tokens';

const GITHUB_URL = 'https://github.com/oss-apps/split-pro';
const X_URL = 'https://twitter.com/KM_Koushik_';
const PROFILE_AVATAR_SIZE = 60;

const openInApp = (url: string) => {
  WebBrowser.openBrowserAsync(url).catch(console.warn);
};

/** External sites open in their own app (X, GitHub) when it's installed. */
const openExternal = (url: string) => {
  Linking.openURL(url).catch(console.warn);
};

const iconInset = rowInset(SETTINGS_ICON_SIZE);

/** Port of the web's src/pages/account.tsx, laid out like the Settings app. */
const Account = () => {
  const { t } = useTranslation();
  const signOut = useAuthStore((state) => state.signOut);
  const sessionUser = useAuthStore((state) => state.user);
  const meQuery = api.user.me.useQuery();
  const downloadData = api.user.downloadData.useMutation();
  const [signingOut, setSigningOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const user = meQuery.data ?? sessionUser;
  const version = Constants.expoConfig?.version;

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    meQuery.refetch().finally(() => setRefreshing(false));
  }, [meQuery]);

  const confirmSignOut = () =>
    confirmAction({
      title: t('account.sign_out'),
      message: t('account.sign_out_confirm'),
      confirmLabel: t('account.sign_out'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () => {
        setSigningOut(true);
        signOut().catch(console.warn);
      },
    });

  const exportData = async () => {
    try {
      const data = await downloadData.mutateAsync();

      if (!(await shareDataExport(data, t('account.download_data')))) {
        toast.error(t('account.download_unavailable'));
      }
    } catch (error) {
      console.warn(error);
      toast.error(t('account.download_failed'));
    }
  };

  const profile = user ? (
    <ListRow
      left={
        <Avatar name={user.name} email={user.email} image={user.image} size={PROFILE_AVATAR_SIZE} />
      }
      title={
        <Text variant="title3" weight="regular" numberOfLines={1}>
          {user.name ?? user.email}
        </Text>
      }
      subtitle={user.name && user.email ? user.email : undefined}
      accessory="chevron"
      accessibilityLabel={t('account.edit_details')}
      onPress={() => router.push('/edit-profile')}
    />
  ) : (
    <View style={styles.profileLoading}>
      <Skeleton width={PROFILE_AVATAR_SIZE} height={PROFILE_AVATAR_SIZE} radius={30} />
      <View style={styles.profileLoadingText}>
        <Skeleton width={160} height={20} />
        <Skeleton width={200} height={14} />
      </View>
    </View>
  );

  return (
    // The scroll view is the screen's first view, so the large title collapses with it.
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Section>{profile}</Section>

      <NotificationsSection />

      {user ? (
        <Section header={t('account.preferences')} footer={t('account.currency_hint')}>
          <ListRow
            left={<SettingsIcon name={icons.currency} color="green" />}
            title={t('account.currency')}
            detail={user.currency}
          />
        </Section>
      ) : null}

      <Section header={t('account.support')} separatorInset={iconInset}>
        <ListRow
          left={<SettingsIcon name={icons.feedback} color="blue" />}
          title={t('account.feedback')}
          accessory="chevron"
          onPress={() => router.push('/feedback')}
        />
        <ListRow
          left={<SettingsIcon name={icons.help} color="purple" />}
          title={t('account.faq')}
          accessory="chevron"
          onPress={() => openInApp(`${API_URL}/faq`)}
        />
        <ListRow
          left={<SettingsIcon name={icons.privacy} color="indigo" />}
          title={t('account.privacy')}
          accessory="chevron"
          onPress={() => openInApp(`${API_URL}/privacy`)}
        />
        <ListRow
          left={<SettingsIcon name={icons.terms} color="gray" />}
          title={t('account.terms')}
          accessory="chevron"
          onPress={() => openInApp(`${API_URL}/terms`)}
        />
      </Section>

      <Section header={t('account.data')} separatorInset={iconInset}>
        <ListRow
          left={<SettingsIcon name={icons.download} color="teal" />}
          title={t('account.download_data')}
          right={downloadData.isLoading ? <Spinner /> : undefined}
          accessory={downloadData.isLoading ? undefined : 'chevron'}
          disabled={downloadData.isLoading}
          onPress={() => void exportData()}
        />
        <ListRow
          left={<SettingsIcon name={icons.import} color="orange" />}
          title={t('account.import_splitwise')}
          subtitle={t('account.on_website')}
          accessory="chevron"
          onPress={() => openInApp(`${API_URL}/import-splitwise`)}
        />
      </Section>

      <Section header={t('account.community')} separatorInset={iconInset}>
        <ListRow
          left={<SettingsIcon name={icons.star} color="yellow" />}
          title={t('account.star_github')}
          accessory="chevron"
          onPress={() => openExternal(GITHUB_URL)}
        />
        <ListRow
          left={
            <SettingsIcon color="black">{(tint) => <XLogo color={tint} size={15} />}</SettingsIcon>
          }
          title={t('account.follow_x')}
          accessory="chevron"
          onPress={() => openExternal(X_URL)}
        />
      </Section>

      {version ? (
        <Section header={t('account.about')}>
          <ListRow title={t('account.version_label')} detail={version} />
        </Section>
      ) : null}

      <Section>
        <ListRow
          title={
            <Text color="destructive" align="center">
              {t('account.sign_out')}
            </Text>
          }
          right={signingOut ? <Spinner /> : undefined}
          disabled={signingOut}
          onPress={confirmSignOut}
          accessibilityLabel={t('account.sign_out')}
        />
        <ListRow
          title={
            <Text color="destructive" align="center">
              {t('account.delete_account')}
            </Text>
          }
          disabled={signingOut}
          onPress={() => router.push('/delete-account')}
          accessibilityLabel={t('account.delete_account')}
        />
      </Section>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.groupedBackground,
  },
  content: {
    paddingTop: spacing[2],
    paddingBottom: spacing[8],
  },
  profileLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
  },
  profileLoadingText: {
    flex: 1,
    gap: spacing[2],
  },
});

export default Account;
