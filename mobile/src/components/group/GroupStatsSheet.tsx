import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ListRow, Separator, Sheet, Spinner, Text } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/dates';
import { formatSignedMoney } from '@/lib/money';

export interface GroupStatsSheetProps {
  groupId: number;
  /** When the group's oldest expense was added, if it has any. */
  firstExpenseAt?: Date;
  visible: boolean;
  onClose: () => void;
}

/** Total spent per currency and the first expense, like the web's "Group statistics" drawer. */
export const GroupStatsSheet: React.FC<GroupStatsSheetProps> = ({
  groupId,
  firstExpenseAt,
  visible,
  onClose,
}) => {
  const { t } = useTranslation();
  const totalsQuery = api.group.getGroupTotals.useQuery({ groupId }, { enabled: visible });
  const totals = (totalsQuery.data ?? []).flatMap((total) =>
    null === total._sum.amount ? [] : [formatSignedMoney(total._sum.amount, total.currency)],
  );

  return (
    <Sheet visible={visible} onClose={onClose} title={t('groups.stats')} padded={false}>
      <ListRow
        title={t('groups.total_expenses')}
        right={
          totalsQuery.isLoading ? (
            <Spinner />
          ) : (
            <View style={styles.totals}>
              {(totals.length ? totals : ['--']).map((total) => (
                <Text key={total} color="secondaryLabel" tabular align="right">
                  {total}
                </Text>
              ))}
            </View>
          )
        }
      />
      {firstExpenseAt ? (
        <>
          <Separator />
          <ListRow title={t('groups.first_expense')} detail={formatDate(firstExpenseAt)} />
        </>
      ) : null}
    </Sheet>
  );
};

const styles = StyleSheet.create({
  totals: {
    flexShrink: 1,
    alignItems: 'flex-end',
  },
});
