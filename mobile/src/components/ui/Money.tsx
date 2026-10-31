import React from 'react';

import { formatMoney, formatSignedMoney } from '@/lib/money';

import { Text, type TextProps } from './Text';

export interface MoneyProps extends Omit<TextProps, 'children'> {
  /** Integer cents, as the API returns them. */
  amount: number;
  currency: string;
  /**
   * `balance` colors by sign (green when you get money, orange when you owe) and drops the sign.
   * `signed` keeps the minus sign. `plain` is unsigned and uncolored.
   */
  mode?: 'balance' | 'signed' | 'plain';
}

/** An amount in tabular digits, so columns of amounts line up. */
export const Money: React.FC<MoneyProps> = ({ amount, currency, mode = 'plain', ...props }) => {
  if ('signed' === mode) {
    return (
      <Text tabular {...props}>
        {formatSignedMoney(amount, currency)}
      </Text>
    );
  }

  const color = 'balance' !== mode ? props.color : 0 > amount ? 'negative' : 'positive';

  return (
    <Text tabular {...props} color={0 === amount && 'balance' === mode ? 'secondaryLabel' : color}>
      {formatMoney(amount, currency)}
    </Text>
  );
};
