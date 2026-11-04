import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CURRENCIES } from '~/lib/currency';

import { haptics } from '@/lib/haptics';
import { layout, spacing } from '@/theme/tokens';

import { ListRow, Separator } from './ListRow';
import { SearchField } from './SearchField';
import { Sheet } from './Sheet';
import { Text } from './Text';

type Currency = (typeof CURRENCIES)[number];

const NO_RECENT: string[] = [];

export interface CurrencySheetProps {
  visible: boolean;
  value: string;
  /** Codes to list first, newest first. */
  recent?: string[];
  onChange: (code: string) => void;
  onClose: () => void;
}

/** Every currency the server accepts in a searchable list, recently used ones first. */
export const CurrencySheet: React.FC<CurrencySheetProps> = ({
  visible,
  value,
  recent = NO_RECENT,
  onChange,
  onClose,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const search = query.trim().toLowerCase();
    const matches = (currency: Currency) =>
      '' === search ||
      currency.code.toLowerCase().includes(search) ||
      currency.name.toLowerCase().includes(search);
    const recentCurrencies = recent
      .flatMap((code) => CURRENCIES.filter((currency) => currency.code === code))
      .filter(matches);
    const others = CURRENCIES.filter(
      (currency) => !recent.includes(currency.code) && matches(currency),
    );

    return [
      { key: 'recent', title: t('currency.recent'), data: recentCurrencies },
      {
        key: 'all',
        title: recentCurrencies.length ? t('currency.all') : undefined,
        data: others,
      },
    ].filter((section) => section.data.length);
  }, [query, recent, t]);

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={t('currency.select')}
      size="large"
      padded={false}
    >
      <View style={styles.search}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={t('currency.search')}
          autoCapitalize="none"
          accessibilityLabel={t('currency.search')}
        />
      </View>
      <SectionList
        style={styles.list}
        sections={sections}
        keyExtractor={(currency) => currency.code}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // The sheet's background is the system's (glass on iOS 26), which no color token matches,
        // so headers stay transparent and scroll with the list.
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: insets.bottom }}
        ItemSeparatorComponent={Separator}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <Text variant="footnote" weight="semibold" style={styles.heading}>
              {section.title}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={item.code}
            accessory={value === item.code ? 'checkmark' : undefined}
            onPress={() => {
              haptics.selection();
              onChange(item.code);
              close();
            }}
          />
        )}
        ListEmptyComponent={
          <Text color="secondaryLabel" align="center" style={styles.empty}>
            {t('currency.none')}
          </Text>
        }
      />
    </Sheet>
  );
};

const styles = StyleSheet.create({
  search: {
    paddingHorizontal: layout.rowPadding,
    paddingBottom: spacing[2],
  },
  list: {
    flex: 1,
  },
  heading: {
    paddingHorizontal: layout.rowPadding,
    paddingTop: spacing[3],
    paddingBottom: spacing[1],
  },
  empty: {
    padding: spacing[8],
  },
});
