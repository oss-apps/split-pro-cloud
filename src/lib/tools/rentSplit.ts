import { allocate, parseAmount, parsePercent } from './money';

export type RentMethod = 'size' | 'income' | 'equal';

export interface Roommate {
  id: string;
  name: string;
  roomSize: string;
  income: string;
}

export interface RentShare {
  id: string;
  amount: number;
  percent: number;
  vsEqual: number;
}

export interface RentSplit {
  rent: number;
  shares: RentShare[];
  sharedPortion: number;
}

/**
 * By room size, `sharedPercent` of the rent covers kitchen, living room and other shared space and
 * is split equally; the rest is split in proportion to each private room's size. By income, the
 * whole rent is split in proportion to income. Missing sizes or incomes count as zero, and if
 * everyone is zero the rent is split equally.
 */
export const splitRent = (
  rentInput: string,
  roommates: readonly Roommate[],
  method: RentMethod,
  sharedPercent: number,
  currency: string,
): RentSplit => {
  const rent = parseAmount(rentInput, currency);
  const count = roommates.length;
  const equal = allocate(
    rent,
    roommates.map(() => 1),
  );

  let amounts: number[];
  let sharedPortion = 0;

  if ('size' === method) {
    const clamped = Math.min(100, Math.max(0, sharedPercent));
    sharedPortion = Math.round((rent * clamped) / 100);
    const sharedParts = allocate(
      sharedPortion,
      roommates.map(() => 1),
    );
    const privateParts = allocate(
      rent - sharedPortion,
      roommates.map((r) => parsePercent(r.roomSize)),
    );
    amounts = roommates.map((_, i) => (sharedParts[i] ?? 0) + (privateParts[i] ?? 0));
  } else if ('income' === method) {
    amounts = allocate(
      rent,
      roommates.map((r) => parsePercent(r.income.replace(/,/g, ''))),
    );
  } else {
    amounts = equal;
  }

  return {
    rent,
    sharedPortion,
    shares: roommates.map((r, i) => {
      const amount = amounts[i] ?? 0;
      return {
        id: r.id,
        amount,
        percent: rent && count ? (amount / rent) * 100 : 0,
        vsEqual: amount - (equal[i] ?? 0),
      };
    }),
  };
};
