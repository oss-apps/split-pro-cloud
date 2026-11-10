import {
  Button,
  ContentUnavailableView,
  ContextMenu,
  HStack,
  Host,
  Image,
  List,
  ProgressView,
  RNHostView,
  Section,
  Spacer,
  SwipeActions,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  listRowBackground,
  listRowSeparator,
  listStyle,
  padding,
  refreshable,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { Avatar } from '@/components/ui';
import { type RouterOutputs } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { colors } from '@/theme/tokens';

type Balances = RouterOutputs['user']['getBalances'];

// The app still supports iOS 16.4; Expo's ContentUnavailableView is empty before iOS 17.
const Unavailable = (props: React.ComponentProps<typeof ContentUnavailableView>) =>
  17 <= Number.parseInt(String(Platform.Version), 10) ? (
    <ContentUnavailableView {...props} />
  ) : (
    <VStack spacing={12}>
      <Image systemName={props.systemImage} modifiers={[font({ textStyle: 'largeTitle' })]} />
      <Text modifiers={[font({ textStyle: 'headline' })]}>{props.title}</Text>
      <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
        {props.description}
      </Text>
    </VStack>
  );

/** Genuine SwiftUI rows: system insets, separators, highlighting, swipe physics and menus. */
export const NativeBalances = ({
  data,
  search,
  loading,
  error,
  onRefresh,
}: {
  data?: Balances;
  search: string;
  loading: boolean;
  error?: string;
  onRefresh: () => Promise<void>;
}) => {
  const { t } = useTranslation();
  const rows =
    data?.balances.filter((row) =>
      `${row.friend.name ?? ''} ${row.friend.email ?? ''}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    ) ?? [];

  return (
    <Host style={{ flex: 1 }} seedColor={colors.tint}>
      <List modifiers={[listStyle('insetGrouped'), refreshable(onRefresh)]}>
        {data && !search && (data.youOwe.length || data.youGet.length) ? (
          <Section>
            <HStack alignment="top" spacing={24} modifiers={[padding({ vertical: 8 })]}>
              {[
                { title: t('balances.you_owe'), totals: data.youOwe, color: colors.negative },
                { title: t('balances.you_get'), totals: data.youGet, color: colors.positive },
              ]
                .filter(({ totals }) => totals.length)
                .map(({ title, totals, color }) => (
                  <VStack
                    key={title}
                    alignment="leading"
                    spacing={6}
                    modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}
                  >
                    <Text
                      modifiers={[
                        font({ textStyle: 'subheadline' }),
                        foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                      ]}
                    >
                      {title}
                    </Text>
                    {[...totals]
                      .sort((a, b) => a.currency.localeCompare(b.currency))
                      .map((total) => (
                        <Text
                          key={total.currency}
                          modifiers={[
                            font({ textStyle: 'title3', weight: 'semibold' }),
                            foregroundStyle(color),
                          ]}
                        >
                          {formatMoney(total.amount, total.currency)}
                        </Text>
                      ))}
                  </VStack>
                ))}
            </HStack>
          </Section>
        ) : null}
        <Section>
          {rows.map((row) => {
            const params = { friendId: String(row.friendId) };
            const add = () => router.push({ pathname: '/add', params });
            const settle = () => router.push({ pathname: '/settle-up', params });
            const open = () => router.push({ pathname: '/balances/[friendId]', params });
            return (
              <SwipeActions key={row.friendId}>
                <ContextMenu>
                  <ContextMenu.Trigger>
                    <Button onPress={open} modifiers={[buttonStyle('plain')]}>
                      <HStack spacing={12} modifiers={[padding({ vertical: 2 })]}>
                        <RNHostView matchContents>
                          <Avatar
                            name={row.friend.name}
                            email={row.friend.email}
                            image={row.friend.image}
                            size={36}
                          />
                        </RNHostView>
                        <Text>{row.friend.name ?? row.friend.email ?? ''}</Text>
                        <Spacer />
                        <VStack alignment="trailing" spacing={3}>
                          <Text
                            modifiers={[
                              font({ textStyle: 'caption' }),
                              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                            ]}
                          >
                            {0 < row.amount
                              ? t('balances.you_get_short')
                              : t('balances.you_owe_short')}
                          </Text>
                          <Text
                            modifiers={[
                              font({ textStyle: 'body', weight: 'semibold' }),
                              foregroundStyle(0 < row.amount ? colors.positive : colors.negative),
                            ]}
                          >
                            {formatMoney(row.amount, row.currency)}
                            {row.hasMore ? ' *' : ''}
                          </Text>
                        </VStack>
                        <Image
                          systemName="chevron.right"
                          modifiers={[
                            font({ textStyle: 'caption', weight: 'semibold' }),
                            foregroundStyle({ type: 'hierarchical', style: 'tertiary' }),
                          ]}
                        />
                      </HStack>
                    </Button>
                  </ContextMenu.Trigger>
                  <ContextMenu.Items>
                    <Button
                      label={t('balances.friend.add_expense')}
                      systemImage="plus"
                      onPress={add}
                    />
                    <Button
                      label={t('balances.friend.settle_up')}
                      systemImage="arrow.left.arrow.right"
                      onPress={settle}
                    />
                  </ContextMenu.Items>
                </ContextMenu>
                <SwipeActions.Actions allowsFullSwipe={false}>
                  <Button
                    label={t('balances.friend.settle_up')}
                    systemImage="arrow.left.arrow.right"
                    onPress={settle}
                    modifiers={[tint(colors.positive)]}
                  />
                  <Button
                    label={t('balances.friend.add_expense')}
                    systemImage="plus"
                    onPress={add}
                    modifiers={[tint(colors.tint)]}
                  />
                </SwipeActions.Actions>
              </SwipeActions>
            );
          })}
          {!rows.length ? (
            <VStack
              spacing={16}
              modifiers={[
                listRowBackground('clear'),
                listRowSeparator('hidden'),
                padding({ vertical: 48 }),
              ]}
            >
              {loading ? (
                <ProgressView />
              ) : (
                <>
                  <Unavailable
                    systemImage={
                      error ? 'exclamationmark.triangle' : search ? 'magnifyingglass' : 'scale.3d'
                    }
                    title={
                      error
                        ? t('balances.load_error')
                        : search
                          ? t('common.no_results')
                          : t('balances.empty_title')
                    }
                    description={error ?? (search ? undefined : t('balances.empty_description'))}
                  />
                  {error ? (
                    <Button label={t('common.retry')} onPress={() => void onRefresh()} />
                  ) : null}
                </>
              )}
            </VStack>
          ) : null}
        </Section>
      </List>
    </Host>
  );
};
