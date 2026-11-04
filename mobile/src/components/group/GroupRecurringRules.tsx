import { MenuView } from '@expo/ui/community/menu';
import { type TFunction } from 'i18next';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { describeSchedule, formatScheduleDate, fromDbDate } from '~/utils/recurrence';

import {
  Icon,
  ListRow,
  Section,
  Spinner,
  type SwipeAction,
  SwipeActions,
  Text,
  icons,
  rowInset,
  toast,
} from '@/components/ui';
import { type RouterOutputs, api } from '@/lib/api';
import { confirmAction } from '@/lib/dialogs';
import { haptics } from '@/lib/haptics';
import { formatSignedMoney } from '@/lib/money';
import { colors, layout, radii, spacing } from '@/theme/tokens';

type Rule = RouterOutputs['recurring']['getGroupRules'][number];

const TILE_SIZE = 29;

const getStatusLine = (rule: Rule, t: TFunction) => {
  if ('ACTIVE' === rule.status) {
    return t('groups.next_on', {
      date: formatScheduleDate(fromDbDate(rule.nextOccurrenceDate)),
    });
  }

  const status = 'PAUSED' === rule.status ? t('groups.paused') : t('groups.stopped');
  if (!rule.statusReason) {
    return status;
  }
  // E.g. "Paused by Sam" says it all.
  return rule.statusReason.startsWith(status)
    ? rule.statusReason
    : `${status}: ${rule.statusReason}`;
};

/**
 * One recurring expense. People who can manage it get a menu on the row (tap or long press) and
 * swipe actions on iOS: pause or resume, and stop repeating.
 */
const RecurringRuleRow: React.FC<{ rule: Rule }> = ({ rule }) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const setPausedMutation = api.recurring.setPaused.useMutation();
  const deleteMutation = api.recurring.delete.useMutation();
  const { width } = useWindowDimensions();
  const isActive = 'ACTIVE' === rule.status;
  const canManage = rule.canManage && 'STOPPED' !== rule.status;
  const isSaving = setPausedMutation.isLoading || deleteMutation.isLoading;
  const schedule = describeSchedule(rule.frequency, fromDbDate(rule.startDate));

  const onChanged = () =>
    Promise.all([utils.recurring.invalidate(), utils.group.invalidate(), utils.user.invalidate()]);

  const setPaused = (paused: boolean) =>
    setPausedMutation.mutate(
      { ruleId: rule.id, paused },
      {
        onSuccess: () => {
          toast.success(paused ? t('groups.paused') : t('groups.resumed'));
          onChanged().catch(console.error);
        },
        onError: (error) => toast.error(error.message),
      },
    );

  const onStop = () => {
    haptics.warning();
    confirmAction({
      title: t('groups.stop_repeating_title'),
      message: t('groups.stop_repeating_description'),
      confirmLabel: t('groups.stop_repeating'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () =>
        deleteMutation.mutate(
          { ruleId: rule.id },
          {
            onSuccess: () => {
              toast.success(t('groups.stopped_repeating'));
              onChanged().catch(console.error);
            },
            onError: (error) => toast.error(error.message),
          },
        ),
    });
  };

  const row = (
    <ListRow
      left={
        <View style={styles.tile}>
          <Icon name={icons.repeat} size={15} weight="semibold" color={colors.secondaryLabel} />
        </View>
      }
      title={
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={styles.name}>
            {rule.latest?.name ?? schedule}
          </Text>
          {rule.latest ? (
            <Text color="secondaryLabel" tabular numberOfLines={1}>
              {formatSignedMoney(rule.latest.amount, rule.latest.currency)}
            </Text>
          ) : null}
        </View>
      }
      subtitle={
        <View>
          {rule.latest ? (
            <Text variant="subheadline" color="secondaryLabel" numberOfLines={2}>
              {schedule}
            </Text>
          ) : null}
          <Text
            variant="subheadline"
            color={isActive ? 'secondaryLabel' : 'negative'}
            numberOfLines={2}
          >
            {getStatusLine(rule, t)}
          </Text>
        </View>
      }
      right={
        isSaving ? (
          <Spinner />
        ) : canManage ? (
          <Icon name={icons.more} size={17} color={colors.tertiaryLabel} />
        ) : null
      }
    />
  );

  if (!canManage) {
    return row;
  }

  const pauseLabel = isActive ? t('groups.pause') : t('groups.resume');
  const pauseIcon = isActive ? icons.pause : icons.play;
  const menuActions = [
    { id: 'pause', title: pauseLabel, image: pauseIcon.ios },
    {
      id: 'stop',
      title: t('groups.stop_repeating'),
      image: icons.trash.ios,
      attributes: { destructive: true },
    },
  ];
  const swipeActions: SwipeAction[] = [
    {
      label: pauseLabel,
      icon: pauseIcon,
      color: isActive ? 'orange' : 'green',
      onPress: () => setPaused(isActive),
    },
    { label: t('groups.stop'), icon: icons.trash, color: 'destructive', onPress: onStop },
  ];

  return (
    <SwipeActions actions={swipeActions} enabled={!isSaving}>
      <MenuView
        title={t('groups.repeating_options', { name: rule.latest?.name ?? schedule })}
        actions={menuActions}
        style={styles.menu}
        onPressAction={({ nativeEvent }) => {
          if ('pause' === nativeEvent.event) {
            setPaused(isActive);
            return;
          }
          onStop();
        }}
      >
        {/* The menu's native host sizes to its content: give the row the section's full width */}
        <View style={{ width: width - 2 * layout.sectionMargin }}>{row}</View>
      </MenuView>
    </SwipeActions>
  );
};

/** The group's recurring expenses, like the web's `GroupRecurringRules`. */
export const GroupRecurringRules: React.FC<{ groupId: number }> = ({ groupId }) => {
  const { t } = useTranslation();
  const rulesQuery = api.recurring.getGroupRules.useQuery({ groupId });
  const rules = rulesQuery.data ?? [];

  return (
    <Section header={t('groups.recurring')} separatorInset={rowInset(TILE_SIZE)}>
      {rules.length ? (
        rules.map((rule) => <RecurringRuleRow key={rule.id} rule={rule} />)
      ) : (
        <ListRow
          title={
            <Text color="secondaryLabel">
              {rulesQuery.isLoading ? t('common.loading') : t('groups.recurring_none')}
            </Text>
          }
        />
      )}
    </Section>
  );
};

const styles = StyleSheet.create({
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderCurve: 'continuous',
    backgroundColor: colors.tertiaryFill,
  },
  menu: {
    alignSelf: 'stretch',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  name: {
    flex: 1,
  },
});
