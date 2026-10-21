import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { icons, toast } from '@/components/ui';
import { type RouterOutputs, api } from '@/lib/api';
import { confirmAction, showMessage } from '@/lib/dialogs';
import { haptics } from '@/lib/haptics';

type GroupDetails = NonNullable<RouterOutputs['group']['getGroupDetails']>;

/**
 * Leave the group, or delete it for its admin, with the web's rules: the admin can delete once
 * everyone is settled, others can leave once they are. Asks first with a native alert.
 */
export const useGroupExit = (group: GroupDetails | undefined, userId: number | undefined) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const deleteGroupMutation = api.group.delete.useMutation();
  const leaveGroupMutation = api.group.leaveGroup.useMutation();

  const isAdmin = !!group && group.userId === userId;
  const balances = group?.groupBalances ?? [];
  const canDelete = isAdmin && !balances.some((balance) => 0 !== balance.amount);
  const canLeave = !balances.some((balance) => 0 !== balance.amount && balance.userId === userId);

  const onDone = () => {
    void utils.group.getAllGroupsWithBalances.invalidate();
    void utils.group.getAllGroups.invalidate();
    void utils.user.invalidate();
    router.dismissTo('/groups');
  };

  const onError = (error: { message: string }) =>
    toast.error(error.message || t('common.something_went_wrong'));

  const confirmDelete = () => {
    if (!group) {
      return;
    }

    if (!canDelete) {
      showMessage(t('groups.delete_group'), t('groups.cannot_delete'), t('groups.ok'));
      return;
    }

    haptics.warning();
    confirmAction({
      title: t('groups.confirm_title'),
      message: t('groups.cannot_be_reversed'),
      confirmLabel: t('groups.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () =>
        deleteGroupMutation.mutate({ groupId: group.id }, { onSuccess: onDone, onError }),
    });
  };

  const confirmLeave = () => {
    if (!group) {
      return;
    }

    if (!canLeave) {
      showMessage(t('groups.leave_group'), t('groups.cannot_leave'), t('groups.ok'));
      return;
    }

    haptics.warning();
    confirmAction({
      title: t('groups.confirm_title'),
      message: t('groups.cannot_be_reversed'),
      confirmLabel: t('groups.leave'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () =>
        leaveGroupMutation.mutate({ groupId: group.id }, { onSuccess: onDone, onError }),
    });
  };

  return {
    label: isAdmin ? t('groups.delete_group') : t('groups.leave_group'),
    icon: isAdmin ? icons.trash : icons.leave,
    onPress: isAdmin ? confirmDelete : confirmLeave,
    loading: deleteGroupMutation.isLoading || leaveGroupMutation.isLoading,
  };
};
