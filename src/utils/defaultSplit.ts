import { type Group, SplitType } from '@prisma/client';
import { z } from 'zod';
import { hasAtMostTwoDecimals, sumHundredths } from './numbers';

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

export const MEMBERS_CHANGED_MESSAGE = 'The group members changed. Reload and try again.';
export const DECIMALS_MESSAGE = 'Use at most 2 decimals.';
export const PERCENTAGE_SUM_MESSAGE = 'Percentages must add up to 100%.';
export const SPLIT_WAITING_MESSAGE =
  'An invite is still pending. Review the split once it finishes.';

/** User ids are positive int4 values. */
const MAX_MEMBER_ID = 2_147_483_647;
/** Shares and percentages above this are a typo, not a split. */
const MAX_SHARE = 1_000_000;

/**
 * The user id a stored key stands for, if it is written exactly as `String(id)` would: no sign,
 * leading zeros, decimals or spaces. Splits are read back by `String(id)`, so any other spelling
 * of an id would be accepted but never found.
 */
export const parseMemberId = (key: string) => {
  if (!/^[1-9]\d*$/.test(key)) {
    return undefined;
  }

  const id = Number(key);
  return id <= MAX_MEMBER_ID ? id : undefined;
};

/**
 * Values have at most 2 decimals, so the editor shows them exactly and saving it unchanged stores
 * the same split. 0 leaves a member out.
 */
const shareValueSchema = z
  .number()
  .min(0)
  .max(MAX_SHARE)
  .refine(hasAtMostTwoDecimals, { message: DECIMALS_MESSAGE });

export const defaultSplitSchema = z.object({
  splitType: z.enum(DEFAULT_SPLIT_TYPES),
  shares: z.record(
    z.string().refine((key) => undefined !== parseMemberId(key), { message: 'Unknown member' }),
    shareValueSchema,
  ),
});

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

/** Why the split can't be the default of a group with these members, if it can't. */
export const getDefaultSplitError = (split: DefaultSplit, memberIds: number[]) => {
  const ids = Object.keys(split.shares).map(parseMemberId);
  if (ids.length !== memberIds.length || !memberIds.every((id) => ids.includes(id))) {
    return MEMBERS_CHANGED_MESSAGE;
  }

  const values = memberIds.map((id) => split.shares[id] ?? 0);
  if (!values.every((value) => shareValueSchema.safeParse(value).success)) {
    return values.every(hasAtMostTwoDecimals)
      ? 'Use a value from 0 to 1,000,000.'
      : DECIMALS_MESSAGE;
  }

  switch (split.splitType) {
    case SplitType.EQUAL:
      if (!values.every((value) => 0 === value || 1 === value)) {
        return 'Include or leave out each member.';
      }
      return values.includes(1) ? undefined : 'Include at least one member.';
    case SplitType.PERCENTAGE:
      return 10_000 === sumHundredths(values) ? undefined : PERCENTAGE_SUM_MESSAGE;
    case SplitType.SHARE:
      return 0 < sumHundredths(values) ? undefined : 'Give at least one member a share.';
  }
};

/** Whether saving `next` would leave the group's default split as it is. */
export const isSameDefaultSplit = (current: DefaultSplit | undefined, next: DefaultSplit) => {
  if (!current) {
    return false;
  }

  const currentKeys = Object.keys(current.shares);
  return (
    current.splitType === next.splitType &&
    currentKeys.length === Object.keys(next.shares).length &&
    currentKeys.every((key) => current.shares[Number(key)] === next.shares[Number(key)])
  );
};

/** The editor's input values per split type, starting from the current default where there is one. */
export const getEditorValues = (split: DefaultSplit | undefined, memberIds: number[]) => {
  const fromDefault = (type: DefaultSplitType, fallback: (index: number) => number) =>
    Object.fromEntries(
      memberIds.map((id, index) => {
        const value =
          split?.splitType === type ? split.shares[id] ?? fallback(index) : fallback(index);
        return [id, String(value)];
      }),
    );
  // An even start that adds up to exactly 100%, the remainder on the first member.
  const evenHundredths = Math.floor(10_000 / Math.max(memberIds.length, 1));
  const evenPercentage = (index: number) =>
    (evenHundredths + (0 === index ? 10_000 - evenHundredths * memberIds.length : 0)) / 100;

  return {
    [SplitType.EQUAL]: fromDefault(SplitType.EQUAL, () => 1),
    [SplitType.PERCENTAGE]: fromDefault(SplitType.PERCENTAGE, evenPercentage),
    [SplitType.SHARE]: fromDefault(SplitType.SHARE, () => 1),
  } satisfies Record<DefaultSplitType, Record<string, string>>;
};

/** The split the editor would save for the values entered for one split type. */
export const getEditorSplit = (
  splitType: DefaultSplitType,
  values: Record<string, string | undefined>,
  memberIds: number[],
): DefaultSplit => ({
  splitType,
  shares: Object.fromEntries(memberIds.map((id) => [id, parseFloat(values[id] ?? '') || 0])),
});

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
 * up to 100% among the participants, everyone is split equally. `leftOutIds` (members who deleted
 * their account) get nothing, whatever the split has for them.
 */
export const resolveDefaultSplit = (
  split: DefaultSplit,
  participantIds: number[],
  leftOutIds: number[] = [],
): ResolvedSplit => {
  const isLeftOut = (id: number) => leftOutIds.includes(id);
  const equally: ResolvedSplit = {
    splitType: SplitType.EQUAL,
    shares: participantIds.map((id) => (isLeftOut(id) ? 0 : 1)),
    addedIds: [],
    outdated: true,
  };
  const known = (id: number) => isLeftOut(id) || undefined !== split.shares[id];

  if (SplitType.PERCENTAGE === split.splitType) {
    const shares = participantIds.map((id) => (isLeftOut(id) ? 0 : split.shares[id] ?? 0));
    return participantIds.every(known) && 10_000 === sumHundredths(shares)
      ? { splitType: split.splitType, shares, addedIds: [], outdated: false }
      : equally;
  }

  const shares = participantIds.map((id) => (isLeftOut(id) ? 0 : split.shares[id] ?? 1));
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
