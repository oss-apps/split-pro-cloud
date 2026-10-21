import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { toast } from '@/components/ui';
import { api } from '@/lib/api';
import { inviteParticipant } from '@/store/addExpenseStore';

/**
 * Adds someone new by email: they join the form as a pending invite until the server returns their
 * account, like the web's "Add to Split Pro". With `sendInviteEmail` the server also emails them an
 * invite ("Send invite to user"), if the server has invites turned on.
 */
export const useInviteFriend = () => {
  const { t } = useTranslation();
  const { mutateAsync } = api.user.inviteFriend.useMutation();

  return useCallback(
    (email: string, sendInviteEmail = false) => {
      inviteParticipant(email, (value) => mutateAsync({ email: value, sendInviteEmail })).catch(
        (error: unknown) => {
          toast.error(error instanceof Error ? error.message : t('expense.invite_failed'));
        },
      );
    },
    [mutateAsync, t],
  );
};
