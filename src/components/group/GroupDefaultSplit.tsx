import React from 'react';
import { type Group, type GroupUser, SplitType, type User } from '@prisma/client';
import { BarChart2, Check, Equal, Percent } from 'lucide-react';
import { toast } from 'sonner';
import { AppDrawer } from '../ui/drawer';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { UserAvatar } from '../ui/avatar';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { api } from '~/utils/api';
import { sumHundredths } from '~/utils/numbers';
import {
  DEFAULT_SPLIT_TYPES,
  type DefaultSplit,
  type DefaultSplitType,
  getDefaultSplitError,
  getDefaultSplitNote,
  getEditorSplit,
  getEditorValues,
  getGroupDefaultSplit,
  joinNames,
  resolveDefaultSplit,
} from '~/utils/defaultSplit';

type Member = Pick<User, 'id' | 'name' | 'email' | 'image'>;

const TYPE_ICONS = {
  [SplitType.EQUAL]: Equal,
  [SplitType.PERCENTAGE]: Percent,
  [SplitType.SHARE]: BarChart2,
} satisfies Record<DefaultSplitType, unknown>;

const memberName = (member: Pick<User, 'name' | 'email'>) => member.name ?? member.email ?? '';

/** E.g. "Alex 60% · Sam 40%", for the members of the group now. */
const describeSplit = (split: DefaultSplit, members: Member[]) => {
  if (SplitType.EQUAL === split.splitType) {
    const included = members.filter((member) => 0 !== (split.shares[member.id] ?? 1));
    return `Equally between ${joinNames(included.map(memberName))}`;
  }

  return members
    .filter((member) => undefined !== split.shares[member.id])
    .map((member) => {
      const value = split.shares[member.id] ?? 0;
      return SplitType.PERCENTAGE === split.splitType
        ? `${memberName(member)} ${value}%`
        : `${memberName(member)} ${value} ${1 === value ? 'share' : 'shares'}`;
    })
    .join(' · ');
};

/**
 * The group's default split for new expenses, in the group's info, and the drawer to change it.
 */
export const GroupDefaultSplit: React.FC<{
  group: Group & {
    groupUsers: Array<GroupUser & { user: User }>;
    defaultSplitBy: Pick<User, 'id' | 'name' | 'email'> | null;
  };
}> = ({ group }) => {
  const members = group.groupUsers.map((groupUser) => groupUser.user);
  const memberIds = members.map((member) => member.id);
  const current = getGroupDefaultSplit(group);

  const [open, setOpen] = React.useState(false);
  const [splitType, setSplitType] = React.useState<DefaultSplitType>(SplitType.EQUAL);
  const [values, setValues] = React.useState(() => getEditorValues(current, memberIds));

  const setDefaultSplitMutation = api.group.setDefaultSplit.useMutation();
  const utils = api.useUtils();

  const split = getEditorSplit(splitType, values[splitType], memberIds);
  const error = getDefaultSplitError(split, memberIds);
  const resolved = current ? resolveDefaultSplit(current, memberIds) : undefined;
  const note =
    current && resolved
      ? getDefaultSplitNote(
          current,
          members.filter((member) => resolved.addedIds.includes(member.id)).map(memberName),
          resolved.outdated,
        )
      : undefined;
  const remainingPercentage = (10_000 - sumHundredths(Object.values(split.shares))) / 100;

  function onOpenChange(isOpen: boolean) {
    if (isOpen) {
      setSplitType(current?.splitType ?? SplitType.EQUAL);
      setValues(getEditorValues(current, memberIds));
    }
    setOpen(isOpen);
  }

  function setValue(memberId: number, value: string) {
    setValues((prev) => ({ ...prev, [splitType]: { ...prev[splitType], [memberId]: value } }));
  }

  function save(splitToSave: DefaultSplit | null) {
    setDefaultSplitMutation.mutate(
      { groupId: group.id, split: splitToSave },
      {
        onSuccess: () => {
          setOpen(false);
          void utils.group.getGroupDetails.invalidate({ groupId: group.id });
          void utils.group.getAllGroups.invalidate();
        },
        onError: (mutationError) => toast.error(mutationError.message),
      },
    );
  }

  return (
    <div className="mt-8">
      <p className="font-semibold">Default split</p>
      <p className="mt-2 text-sm text-gray-300">
        {current ? describeSplit(current, members) : 'None, new expenses are split equally'}
      </p>
      {current && group.defaultSplitBy ? (
        <p className="mt-1 text-xs text-gray-500">Set by {memberName(group.defaultSplitBy)}</p>
      ) : null}
      {note ? <p className="mt-1 text-xs text-amber-500">{note}</p> : null}
      <AppDrawer
        trigger={
          <Button variant="ghost" className="mt-1 justify-start p-0 text-left text-cyan-500">
            {current ? 'Change default split' : 'Set default split'}
          </Button>
        }
        title="Default split"
        className="h-[85vh] lg:h-[70vh]"
        open={open}
        onOpenChange={onOpenChange}
        actionTitle="Save"
        actionDisabled={!!error || setDefaultSplitMutation.isLoading}
        actionOnClick={() => save(split)}
      >
        <p className="text-sm text-gray-400">
          New expenses in {group.name} start with this split. It can still be changed on each
          expense.
        </p>
        <Tabs
          value={splitType}
          className="mx-auto mt-5 w-full"
          onValueChange={(value) => setSplitType(value as DefaultSplitType)}
        >
          <TabsList className="w-full justify-between">
            {DEFAULT_SPLIT_TYPES.map((type) => {
              const Icon = TYPE_ICONS[type];
              return (
                <TabsTrigger key={type} className="flex-1 gap-1 text-xs" value={type}>
                  <Icon className="h-4 w-4" />
                  {type.charAt(0) + type.slice(1).toLowerCase()}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
        <div className="mt-4 flex flex-col gap-5 px-2">
          {SplitType.PERCENTAGE === splitType ? (
            <p
              className={`text-center ${0 === remainingPercentage ? 'text-gray-300' : 'text-red-500'}`}
            >
              Remaining {remainingPercentage}%
            </p>
          ) : null}
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserAvatar user={member} size={30} />
                <p>{memberName(member)}</p>
              </div>
              {SplitType.EQUAL === splitType ? (
                <button
                  aria-label={`Include ${memberName(member)}`}
                  aria-pressed={'0' !== values[splitType][member.id]}
                  className="flex h-8 w-8 items-center justify-center"
                  onClick={() =>
                    setValue(member.id, '0' === values[splitType][member.id] ? '1' : '0')
                  }
                >
                  {'0' !== values[splitType][member.id] ? (
                    <Check className="h-6 w-6 text-cyan-500" />
                  ) : null}
                </button>
              ) : (
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    inputMode="decimal"
                    className="w-20 text-lg"
                    aria-label={`${memberName(member)} ${SplitType.PERCENTAGE === splitType ? 'percentage' : 'shares'}`}
                    value={values[splitType][member.id] ?? ''}
                    onChange={(e) => setValue(member.id, e.target.value)}
                  />
                  <p className="w-12 text-xs">
                    {SplitType.PERCENTAGE === splitType ? '%' : 'Share(s)'}
                  </p>
                </div>
              )}
            </div>
          ))}
          {error ? <p className="text-center text-sm text-red-500">{error}</p> : null}
          {current ? (
            <Button
              variant="ghost"
              className="justify-center text-red-500 hover:text-red-500"
              disabled={setDefaultSplitMutation.isLoading}
              onClick={() => save(null)}
            >
              Remove default split
            </Button>
          ) : null}
        </div>
      </AppDrawer>
    </div>
  );
};
