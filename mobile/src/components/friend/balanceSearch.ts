import { type RouterOutputs } from '@/lib/api';

type Balance = RouterOutputs['user']['getBalances']['balances'][number];

export const filterBalances = (balances: Balance[], search: string) => {
  const query = search.trim().toLocaleLowerCase();
  return balances.filter((row) =>
    `${row.friend.name ?? ''} ${row.friend.email ?? ''}`.toLocaleLowerCase().includes(query),
  );
};
