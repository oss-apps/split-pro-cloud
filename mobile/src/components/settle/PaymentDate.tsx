import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { format } from 'date-fns';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { formatShortDate, toDateInputValue } from '~/utils/dates';

import { Icon, ListRow, icons } from '@/components/ui';
import { haptics } from '@/lib/haptics';
import { colors } from '@/theme/tokens';

export interface PaymentDateProps {
  /** A `yyyy-MM-dd` day, or `''` for today (the server then records the current time). */
  value: string;
  onChange: (value: string) => void;
}

const fromInputValue = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return year && month && day ? new Date(year, month - 1, day, 12) : new Date();
};

/**
 * The day the payment was made, never in the future: a row with the compact date picker on iOS,
 * the Material date dialog on Android.
 */
export const PaymentDate: React.FC<PaymentDateProps> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const today = toDateInputValue(new Date());
  const selected = value || today;
  const isToday = selected >= today;
  const date = fromInputValue(selected);

  const setDay = (next: Date) => {
    const nextValue = format(next, 'yyyy-MM-dd');
    if (nextValue !== selected) {
      haptics.selection();
    }
    onChange(nextValue >= today ? '' : nextValue);
  };

  const left = <Icon name={icons.calendar} size={20} color={colors.tint} />;

  if ('ios' === Platform.OS) {
    return (
      <ListRow
        left={left}
        title={t('balances.settle.date')}
        right={
          <DateTimePicker
            value={date}
            onValueChange={(_event, next) => setDay(next)}
            mode="date"
            display="compact"
            maximumDate={new Date()}
            // The system color, passed through to SwiftUI's tint (typed as a string).
            accentColor={colors.tint as string}
          />
        }
      />
    );
  }

  return (
    <>
      <ListRow
        left={left}
        title={t('balances.settle.date')}
        detail={isToday ? t('balances.settle.today') : formatShortDate(date)}
        accessibilityLabel={t('balances.settle.payment_date')}
        onPress={() => setDialogOpen(true)}
      />
      {dialogOpen ? (
        <DateTimePicker
          value={date}
          onValueChange={(_event, next) => {
            setDialogOpen(false);
            setDay(next);
          }}
          onDismiss={() => setDialogOpen(false)}
          mode="date"
          maximumDate={new Date()}
        />
      ) : null}
    </>
  );
};
