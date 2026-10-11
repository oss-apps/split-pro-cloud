import { toast } from 'sonner';
import { inviteParticipant, useAddExpenseStore } from '~/store/addStore';
import { GroupAvatar, UserAvatar } from '../ui/avatar';
import { z } from 'zod';
import { api } from '~/utils/api';

export const UserInput: React.FC<{
  isEditing?: boolean;
}> = ({ isEditing }) => {
  const { setNameOrEmail, removeLastParticipant, setParticipants, setGroup } = useAddExpenseStore(
    (s) => s.actions,
  );
  const nameOrEmail = useAddExpenseStore((s) => s.nameOrEmail);
  const participants = useAddExpenseStore((s) => s.participants);
  const currentUser = useAddExpenseStore((s) => s.currentUser);
  const group = useAddExpenseStore((s) => s.group);

  const addFriendMutation = api.user.inviteFriend.useMutation();

  const isEmail = z.string().email().safeParse(nameOrEmail);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && nameOrEmail === '') {
      if (group) {
        setGroup(undefined);
        console.log('set Remove called 1', group);

        if (currentUser) {
          setParticipants([currentUser]);
        }
      } else {
        removeLastParticipant(); // Assuming deleteUser is the function you want to call
      }
    } else if (e.key === 'Enter' && isEmail.success && !group) {
      inviteParticipant(nameOrEmail, (email) =>
        addFriendMutation.mutateAsync({ email: email.toLowerCase() }),
      ).catch((error) => {
        toast.error(error instanceof Error ? error.message : 'Failed to invite friend');
      });
    }
  };

  return (
    <div className="mt-4 flex flex-wrap gap-2 border-b pb-4">
      {group ? (
        <div className="flex items-center gap-2 rounded-full bg-slate-800 p-0.5 pr-4">
          <GroupAvatar name={group.name} size={30} />
          <p className="text-xs">{group.name}</p>
        </div>
      ) : (
        participants.map((p) =>
          p.id !== currentUser?.id ? (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-full bg-slate-800 p-0.5 pr-4"
            >
              <UserAvatar user={p} size={30} />
              <p className="text-xs">{p.name ?? p.email}</p>
            </div>
          ) : null,
        )
      )}

      <input
        type="email"
        placeholder={
          isEditing && !!group
            ? 'Cannot change group while editing'
            : group
              ? 'Press delete to remove group'
              : participants.length > 1
                ? 'Add more friends'
                : 'Search friends, groups or add email'
        }
        value={nameOrEmail}
        onChange={(e) => setNameOrEmail(e.target.value)}
        onKeyDown={handleKeyDown}
        className="min-w-[100px] flex-grow bg-transparent outline-none placeholder:text-sm focus:ring-0"
        autoFocus
        disabled={isEditing && !!group}
      />
    </div>
  );
};
