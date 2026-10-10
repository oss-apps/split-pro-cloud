import { allocate, minorUnitFactor, parseAmount, parsePercent, percentOf } from './money';

export interface BillPerson {
  id: string;
  name: string;
}

export interface BillItem {
  id: string;
  name: string;
  price: string;
  sharedBy: string[];
}

export interface BillCharges {
  taxPercent: string;
  tipPercent: string;
  tipOnPreTax: boolean;
}

export interface BillTotals {
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
}

const charges = (subtotal: number, { taxPercent, tipPercent, tipOnPreTax }: BillCharges) => {
  const tax = percentOf(subtotal, parsePercent(taxPercent));
  const tip = percentOf(tipOnPreTax ? subtotal : subtotal + tax, parsePercent(tipPercent));
  return { subtotal, tax, tip, total: subtotal + tax + tip };
};

export interface EvenSplit extends BillTotals {
  perPerson: number[];
  roundedPerPerson: number;
  roundingExtra: number;
}

export const splitEvenly = (
  amount: string,
  people: number,
  billCharges: BillCharges,
  currency: string,
): EvenSplit => {
  const count = Math.max(1, Math.floor(people));
  const totals = charges(parseAmount(amount, currency), billCharges);
  const perPerson = allocate(
    totals.total,
    Array.from({ length: count }, () => 1),
  );
  const factor = minorUnitFactor(currency);
  const highest = Math.max(...perPerson);
  const roundedPerPerson = Math.ceil(highest / factor) * factor;
  return {
    ...totals,
    perPerson,
    roundedPerPerson,
    roundingExtra: roundedPerPerson * count - totals.total,
  };
};

export interface ItemizedShare {
  id: string;
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
}

export interface ItemizedSplit extends BillTotals {
  shares: ItemizedShare[];
  unassigned: number;
}

/**
 * Splits each item among the people who shared it, then spreads tax and tip in proportion to
 * what each person ordered. Items nobody is assigned to are shared by everyone.
 */
export const splitByItem = (
  people: readonly BillPerson[],
  items: readonly BillItem[],
  billCharges: BillCharges,
  currency: string,
): ItemizedSplit => {
  const subtotals = new Map(people.map((p) => [p.id, 0]));
  let unassigned = 0;

  items.forEach((item) => {
    const price = parseAmount(item.price, currency);
    if (!price) {
      return;
    }
    const assigned = item.sharedBy.filter((id) => subtotals.has(id));
    const sharers = 0 === assigned.length ? people.map((p) => p.id) : assigned;
    if (0 === assigned.length) {
      unassigned += 1;
    }
    allocate(
      price,
      sharers.map(() => 1),
    ).forEach((part, index) => {
      const id = sharers[index] ?? '';
      subtotals.set(id, (subtotals.get(id) ?? 0) + part);
    });
  });

  const personSubtotals = people.map((p) => subtotals.get(p.id) ?? 0);
  const totals = charges(
    personSubtotals.reduce((acc, value) => acc + value, 0),
    billCharges,
  );
  const taxParts = allocate(totals.tax, personSubtotals);
  const tipParts = allocate(totals.tip, personSubtotals);

  return {
    ...totals,
    unassigned,
    shares: people.map((p, index) => {
      const subtotal = personSubtotals[index] ?? 0;
      const tax = taxParts[index] ?? 0;
      const tip = tipParts[index] ?? 0;
      return { id: p.id, subtotal, tax, tip, total: subtotal + tax + tip };
    }),
  };
};
