import React from 'react';
import { Button } from '../ui/button';
import { Trash2 } from 'lucide-react';
import { api } from '~/utils/api';
import { useRouter } from 'next/router';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog';

export const DeleteExpense: React.FC<{
  expenseId: string;
  friendId?: number;
  groupId?: number;
}> = ({ expenseId, friendId, groupId }) => {
  const router = useRouter();

  const deleteExpenseMutation = api.user.deleteExpense.useMutation();

  const onDeleteExpense = async () => {
    try {
      await deleteExpenseMutation.mutateAsync({ expenseId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete expense');
      return;
    }
    if (groupId) {
      await router.replace(`/groups/${groupId}`);
      return;
    }
    if (friendId) {
      await router.replace(`/balances/${friendId}`);
      return;
    }

    await router.replace(`/balances`);
  };

  return (
    <div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost">
            <Trash2 className="text-red-400" size={23} />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="max-w-xs rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete your expense.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction size="sm" variant="destructive" onClick={onDeleteExpense}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
