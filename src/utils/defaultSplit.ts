import { type Group, SplitType } from '@prisma/client';
import { z } from 'zod';

/** Split types that don't depend on the amount, so a group can use them for every expense. */
export const DEFAULT_SPLIT_TYPES = [
  SplitType.EQUAL,
  SplitType.PERCENTAGE,
  SplitType.SHARE,
] as const;

export type DefaultSplitType = (typeof DEFAULT_SPLIT_TYPES)[number];

/**
 * A split as its type and each member's value by user id: 1 or 0 to include or leave someone out
 * of an equal split, else their percentage or number of shares.
 */
export type DefaultSplit = { splitType: DefaultSplitType; shares: Record<number, number> };

export const defaultSplitSchema = z.object({
  splitType: z.enum(DEFAULT_SPLIT_TYPES),
  shares: z.record(z.string().regex(/^\d+$/), z.number().nonnegative().max(1_000_000)),
});

export const MEMBERS_CHANGED_MESSAGE = 'The group members changed. Reload and try again.';

export const isDefaultSplitType = (splitType: SplitType): splitType is DefaultSplitType =>
  DEFAULT_SPLIT_TYPES.some((type) => type === splitType);

export const getGroupDefaultSplit = (
  group: Pick<Group, 'defaultSplitType' | 'defaultSplitShares'>,
): DefaultSplit | undefined => {
  if (!group.defaultSplitType) {
    return undefined;
  }

  const parsed = defaultSplitSchema.safeParse({
    splitType: group.defaultSplitType,
    shares: group.defaultSplitShares,
  });
  return parsed.success ? parsed.data : undefined;
};

/** In hundredths, so float noise never makes percentages miss 100. */
const sumHundredths = (values: number[]) =>
  values.reduce((total, value) => total + Math.round(value * 100), 0);

/** Why the split can't be the default of a group with these members, if it can't. */
export const getDefaultSplitError = (split: DefaultSplit, memberIds: number[]) => {
  const ids = Object.keys(split.shares).map(Number);
  if (ids.length !== memberIds.length || !memberIds.every((id) => ids.includes(id))) {
    return MEMBERS_CHANGED_MESSAGE;
  }

  const values = memberIds.map((id) => split.shares[id] ?? 0);
  switch (split.splitType) {
    case SplitType.EQUAL:
      if (!values.every((value) => 0 === value || 1 === value)) {
        return 'Include or leave out each member.';
      }
      return values.includes(1) ? undefined : 'Include at least one member.';
    case SplitType.PERCENTAGE:
      return 10_000 === sumHundredths(values) ? undefined : 'Percentages must add up to 100%.';
    case SplitType.SHARE:
      return 0 < sumHundredths(values) ? undefined : 'Give at least one member a share.';
  }
};

export type ResolvedSplit = {
  splitType: DefaultSplitType;
  /** One per participant, in their order. */
  shares: number[];
  /** Participants the split has no value for, who got an equal share or 1 share. */
  addedIds: number[];
  /** The split no longer fits the participants, so they are split equally instead. */
  outdated: boolean;
};

/**
 * Fits a stored split to who takes part now. Someone it doesn't know joins an equal split or gets
 * 1 share. Percentages can't take anyone new without changing the others, so if they don't add
 * up to 100% among the participants, everyone is split equally.
 */
export const resolveDefaultSplit = (
  split: DefaultSplit,
  participantIds: number[],
): ResolvedSplit => {
  const equally: ResolvedSplit = {
    splitType: SplitType.EQUAL,
    shares: participantIds.map(() => 1),
    addedIds: [],
    outdated: true,
  };
  const known = (id: number) => undefined !== split.shares[id];

  if (SplitType.PERCENTAGE === split.splitType) {
    const shares = participantIds.map((id) => split.shares[id] ?? 0);
    return participantIds.every(known) && 10_000 === sumHundredths(shares)
      ? { splitType: split.splitType, shares, addedIds: [], outdated: false }
      : equally;
  }

  const shares = participantIds.map((id) => split.shares[id] ?? 1);
  if (0 === sumHundredths(shares)) {
    return equally;
  }

  return {
    splitType: split.splitType,
    shares,
    addedIds: participantIds.filter((id) => !known(id)),
    outdated: false,
  };
};

export const joinNames = (names: string[]) =>
  1 < names.length
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : names[0] ?? '';

/** What new members get from the default split, if it doesn't simply apply. */
export const getDefaultSplitNote = (
  split: Pick<DefaultSplit, 'splitType'>,
  added: string[],
  outdated: boolean,
) => {
  if (outdated) {
    return "The default split needs updating for the current members, so it's split equally for now.";
  }

  if (!added.length) {
    return undefined;
  }

  const names = joinNames(added);
  const isOne = 1 === added.length;
  return SplitType.EQUAL === split.splitType
    ? `${names} ${isOne ? "isn't" : "aren't"} in the default split yet and ${isOne ? 'is' : 'are'} included equally.`
    : `${names} ${isOne ? "isn't" : "aren't"} in the default split yet and ${isOne ? 'gets' : 'get'} 1 share${isOne ? '' : ' each'}.`;
};
