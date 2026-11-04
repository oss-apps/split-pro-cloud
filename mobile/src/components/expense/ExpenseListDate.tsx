import React from 'react';
import { StyleSheet, View } from 'react-native';

import { formatMonthHeader, getDateColumn } from '~/utils/dates';

import { SectionHeader, Text } from '@/components/ui';

/** "October" above the first expense of each month, like the web's `MonthHeader`. */
export const MonthHeader: React.FC<{ date: Date }> = ({ date }) => (
  <SectionHeader title={formatMonthHeader(date)} large />
);

/** "21 Oct", the short date shown in expense rows. */
export const formatShortDate = (date: Date) => getDateColumn(date).join(' ');

/**
 * @deprecated Month and day as two short lines. Expense rows show `formatShortDate` in their
 * subtitle instead.
 */
export const DateColumn: React.FC<{ date: Date }> = ({ date }) => (
  <View style={styles.dateColumn}>
    {getDateColumn(date).map((part) => (
      <Text key={part} variant="caption1" align="center">
        {part}
      </Text>
    ))}
  </View>
);

const styles = StyleSheet.create({
  dateColumn: {
    width: 32,
  },
});
