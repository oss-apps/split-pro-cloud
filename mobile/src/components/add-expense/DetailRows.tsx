import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { type RecurringFrequency } from '@prisma/client';
import { startOfDay } from 'date-fns';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import {
  type LocalDate,
  RECURRING_FREQUENCIES,
  describeSchedule,
  formatScheduleDate,
  getLocalDate,
  getNextOccurrence,
} from '~/utils/recurrence';

import { CategoryIcon, getCategoryIcon } from '@/components/expense';
import { Avatar, Icon, ListRow, type PopUpAction, PopUpButton, icons } from '@/components/ui';
import { formatDate } from '@/lib/dates';
import { haptics } from '@/lib/haptics';
import { isPendingInvite, useAddExpenseStore } from '@/store/addExpenseStore';
import { colors } from '@/theme/tokens';

import { isTodayOrUnset } from './calendar';
import { CATEGORY_SECTIONS, type CategoryKey, toCategory } from './categories';
import { getDeviceTimeZone } from './timeZone';

/** Size of the leading symbols, for the separator inset. */
export const DETAIL_ICON_SIZE = 22;

const RowIcon: React.FC<{ name: React.ComponentProps<typeof Icon>['name'] }> = ({ name }) => (
  <Icon name={name} size={DETAIL_ICON_SIZE} color={colors.tint} />
);

/** Who paid, picked from a menu of the people in the expense. */
export const PaidByRow: React.FC = () => {
  const { t } = useTranslation();
  const paidBy = useAddExpenseStore((s) => s.paidBy);
  const participants = useAddExpenseStore((s) => s.participants);
  const currentUser = useAddExpenseStore((s) => s.currentUser);
  const { setPaidBy } = useAddExpenseStore((s) => s.actions);

  const nameOf = (person: { id: number; name: string | null; email: string | null }) =>
    currentUser?.id === person.id ? t('expense.payer_you') : (person.name ?? person.email ?? '');

  return (
    <ListRow
      left={<RowIcon name={icons.payer} />}
      title={t('expense.paid_by')}
      right={
        <PopUpButton
          title={t('expense.choose_payer')}
          value={paidBy ? nameOf(paidBy) : ''}
          leading={
            paidBy ? (
              <Avatar name={paidBy.name} email={paidBy.email} image={paidBy.image} size={22} />
            ) : null
          }
          actions={participants.map((participant) => ({
            id: String(participant.id),
            title: nameOf(participant),
            state: participant.id === paidBy?.id ? 'on' : 'off',
            // An invited friend can't pay until the invite returns their account.
            attributes: { disabled: isPendingInvite(participant) },
          }))}
          onSelect={(id) => {
            const participant = participants.find((p) => String(p.id) === id);
            if (participant && !isPendingInvite(participant)) {
              setPaidBy(participant);
            }
          }}
        />
      }
    />
  );
};

/** How it's split; opens the split editor. */
export const SplitRow: React.FC = () => {
  const { t } = useTranslation();
  const splitType = useAddExpenseStore((s) => s.splitType);
  const { setSplitScreenOpen } = useAddExpenseStore((s) => s.actions);

  return (
    <ListRow
      left={<RowIcon name={icons.split} />}
      title={t('expense.split')}
      detail={t(`expense.split_value.${splitType}`)}
      accessory="chevron"
      onPress={() => setSplitScreenOpen(true)}
      accessibilityLabel={t('expense.change_split')}
    />
  );
};

/** The category, from a menu with a submenu per section. */
export const CategoryRow: React.FC = () => {
  const { t } = useTranslation();
  const category = useAddExpenseStore((s) => s.category);
  const { setCategory } = useAddExpenseStore((s) => s.actions);

  const actions: PopUpAction[] = CATEGORY_SECTIONS.map((section) => ({
    id: section.key,
    title: t(`expense.categories.${section.key}`),
    image: getCategoryIcon(section.key).ios,
    subactions: section.items.map((item) => {
      const key = toCategory(section.key, item) as CategoryKey;
      return {
        id: key,
        title: t(`expense.categories.${key}`),
        image: getCategoryIcon(key).ios,
        state: key === category ? 'on' : 'off',
      };
    }),
  }));

  return (
    <ListRow
      left={<CategoryIcon category={category} color={colors.tint} size={DETAIL_ICON_SIZE} />}
      title={t('expense.category')}
      right={
        <PopUpButton
          title={t('expense.choose_category')}
          value={t(`expense.categories.${category as CategoryKey}`, {
            defaultValue: t('expense.categories.general'),
          })}
          actions={actions}
          onSelect={setCategory}
        />
      }
    />
  );
};

/** The expense date: the compact date picker on iOS, the Material date dialog on Android. */
export const DateRow: React.FC = () => {
  const { t } = useTranslation();
  const expenseDate = useAddExpenseStore((s) => s.expenseDate);
  const { setExpenseDate } = useAddExpenseStore((s) => s.actions);
  const [today] = useState(() => new Date());
  const [dialogOpen, setDialogOpen] = useState(false);

  // Like the web's calendar, a picked day is saved at its start.
  const onPick = (date: Date) => {
    haptics.selection();
    setExpenseDate(startOfDay(date));
  };

  if ('ios' === Platform.OS) {
    return (
      <ListRow
        left={<RowIcon name={icons.calendar} />}
        title={t('expense.date')}
        right={
          <DateTimePicker
            value={expenseDate ?? today}
            mode="date"
            display="compact"
            // Typed as a string, but the SwiftUI tint takes any color, like the system tint here.
            accentColor={colors.tint as string}
            onValueChange={(_event, date) => onPick(date)}
          />
        }
      />
    );
  }

  return (
    <>
      <ListRow
        left={<RowIcon name={icons.calendar} />}
        title={t('expense.date')}
        detail={
          isTodayOrUnset(expenseDate, today) ? t('expense.today') : formatDate(expenseDate ?? today)
        }
        onPress={() => setDialogOpen(true)}
        accessibilityLabel={t('expense.date_title')}
      />
      {dialogOpen ? (
        <DateTimePicker
          value={expenseDate ?? today}
          mode="date"
          presentation="dialog"
          onValueChange={(_event, date) => {
            setDialogOpen(false);
            onPick(date);
          }}
          onDismiss={() => setDialogOpen(false)}
        />
      ) : null}
    </>
  );
};

/** The calendar date in the time zone, or the device's own if the engine lacks zoned `Intl`. */
const toLocalDate = (date: Date, timeZone: string): LocalDate => {
  try {
    return getLocalDate(date, timeZone);
  } catch {
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
  }
};

/** When the next repeat is added, or nothing for an expense that already repeats. */
export const useRepeatFooter = () => {
  const { t } = useTranslation();
  const recurrence = useAddExpenseStore((s) => s.recurrence);
  const loadedRecurrence = useAddExpenseStore((s) => s.loadedRecurrence);
  const expenseDate = useAddExpenseStore((s) => s.expenseDate);

  // An expense that already repeats keeps its series' dates, so there's no preview.
  if (!recurrence || loadedRecurrence) {
    return undefined;
  }

  const timeZone = getDeviceTimeZone();
  const today = toLocalDate(new Date(), timeZone);
  const start = expenseDate ? toLocalDate(expenseDate, timeZone) : today;

  return t('expense.next_on', {
    date: formatScheduleDate(getNextOccurrence(recurrence, start, start, today)),
  });
};

/** How the expense repeats, like the web's RepeatInput, as a menu. Settlements don't repeat. */
export const RepeatRow: React.FC = () => {
  const { t } = useTranslation();
  const recurrence = useAddExpenseStore((s) => s.recurrence);
  const expenseDate = useAddExpenseStore((s) => s.expenseDate);
  const { setRecurrence } = useAddExpenseStore((s) => s.actions);

  const timeZone = getDeviceTimeZone();
  const start = toLocalDate(expenseDate ?? new Date(), timeZone);
  const options: (RecurringFrequency | null)[] = [null, ...RECURRING_FREQUENCIES];

  return (
    <ListRow
      left={<RowIcon name={icons.repeat} />}
      title={t('expense.repeat')}
      right={
        <PopUpButton
          value={recurrence ? t(`expense.frequency.${recurrence}`) : t('expense.repeat_never')}
          actions={options.map((option) => ({
            id: option ?? 'none',
            title: option ? describeSchedule(option, start) : t('expense.dont_repeat'),
            state: option === recurrence ? 'on' : 'off',
          }))}
          onSelect={(id) =>
            setRecurrence(options.find((option) => (option ?? 'none') === id) ?? null)
          }
        />
      }
    />
  );
};
