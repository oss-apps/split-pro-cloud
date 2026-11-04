import { MenuView } from '@expo/ui/community/menu';
import { RecurringStatus } from '@prisma/client';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { describeSchedule, formatScheduleDate, fromDbDate } from '~/utils/recurrence';

import { Icon, ListRow, Section, Spinner, Text, icons, toast } from '@/components/ui';
import { type RouterOutputs, api } from '@/lib/api';
import { confirmAction } from '@/lib/dialogs';
import { haptics } from '@/lib/haptics';
import { colors, spacing } from '@/theme/tokens';

type RuleView = RouterOutputs['recurring']['getRule'];

const useStatusLine = (rule: RuleView) => {
  const { t } = useTranslation();

  if (RecurringStatus.ACTIVE === rule.status) {
    return t('expense.next_on', { date: formatScheduleDate(fromDbDate(rule.nextOccurrenceDate)) });
  }

  const status =
    RecurringStatus.PAUSED === rule.status
      ? t('expense.recurring.paused')
      : t('expense.recurring.stopped');
  if (!rule.statusReason) {
    return status;
  }

  // E.g. "Paused by Sam" says it all.
  return rule.statusReason.startsWith(status)
    ? rule.statusReason
    : t('expense.recurring.status_reason', { status, reason: rule.statusReason });
};

/**
 * How the expense repeats. Tapping the row opens a menu to pause, resume or stop it. Like the
 * web's RecurringRule.
 */
const RecurringRule: React.FC<{ rule: RuleView }> = ({ rule }) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const setPausedMutation = api.recurring.setPaused.useMutation();
  const deleteMutation = api.recurring.delete.useMutation();
  const statusLine = useStatusLine(rule);

  const onChanged = () =>
    Promise.all([
      utils.recurring.invalidate(),
      utils.group.invalidate(),
      utils.user.invalidate(),
    ]).catch(console.error);

  const isActive = RecurringStatus.ACTIVE === rule.status;

  const togglePaused = () =>
    setPausedMutation.mutate(
      { ruleId: rule.id, paused: isActive },
      {
        onSuccess: () => {
          toast.success(isActive ? t('expense.recurring.paused') : t('expense.recurring.resumed'));
          void onChanged();
        },
        onError: (error) => toast.error(error.message),
      },
    );

  const stop = () => {
    haptics.warning();
    confirmAction({
      destructive: true,
      title: t('expense.recurring.stop_title'),
      message: t('expense.recurring.stop_message'),
      confirmLabel: t('expense.recurring.stop'),
      cancelLabel: t('common.cancel'),
      onConfirm: () =>
        deleteMutation.mutate(
          { ruleId: rule.id },
          {
            onSuccess: () => {
              toast.success(t('expense.recurring.stopped_toast'));
              void onChanged();
            },
            onError: (error) => toast.error(error.message),
          },
        ),
    });
  };

  const canChange = rule.canManage && RecurringStatus.STOPPED !== rule.status;
  const isBusy = setPausedMutation.isLoading || deleteMutation.isLoading;

  const menu = (
    <MenuView
      actions={[
        {
          id: 'toggle',
          title: isActive ? t('expense.recurring.pause') : t('expense.recurring.resume'),
          image: 'ios' === Platform.OS ? (isActive ? icons.pause.ios : icons.play.ios) : undefined,
        },
        {
          id: 'stop',
          title: t('expense.recurring.stop'),
          image: 'ios' === Platform.OS ? icons.stop.ios : undefined,
          attributes: { destructive: true },
        },
      ]}
      onPressAction={({ nativeEvent }) => {
        if ('toggle' === nativeEvent.event) {
          togglePaused();
          return;
        }

        if ('stop' === nativeEvent.event) {
          stop();
        }
      }}
    >
      <View
        style={styles.menuButton}
        accessible
        accessibilityRole="button"
        accessibilityLabel={t('expense.detail.manage_repeat')}
      >
        <Icon name={icons.moreCircle} size={22} color={colors.tint} />
      </View>
    </MenuView>
  );

  return (
    <Section header={t('expense.detail.repeat')}>
      <ListRow
        left={<Icon name={icons.repeat} size={20} color={colors.tint} />}
        title={describeSchedule(rule.frequency, fromDbDate(rule.startDate))}
        subtitle={
          <Text variant="subheadline" color={isActive ? 'secondaryLabel' : 'negative'}>
            {statusLine}
          </Text>
        }
        right={isBusy ? <Spinner /> : canChange ? menu : null}
      />
    </Section>
  );
};

/** The schedule of the expense's series. Hidden if it can't be loaded, like on the web. */
export const ExpenseRecurringRule: React.FC<{ ruleId: number }> = ({ ruleId }) => {
  const ruleQuery = api.recurring.getRule.useQuery({ ruleId }, { retry: false });
  return ruleQuery.data ? <RecurringRule rule={ruleQuery.data} /> : null;
};

const styles = StyleSheet.create({
  menuButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing[2],
  },
});
