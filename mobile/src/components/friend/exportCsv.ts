import { format } from 'date-fns';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { toUIString } from '~/utils/numbers';

type ExportExpense = {
  paidBy: number;
  name: string;
  category: string;
  amount: number;
  splitType: string;
  expenseDate: Date;
  currency: string;
  expenseParticipants: { userId: number; amount: number }[];
};

const HEADERS = [
  'Paid By',
  'Name',
  'Category',
  'Amount',
  'Split Type',
  'Expense Date',
  'Currency',
  'You Lent',
  'You Owe',
  'Settlement',
];

const escapeCell = (cell: string | number) => {
  if ('string' !== typeof cell || !/[",\n]/.test(cell)) {
    return cell;
  }

  return `"${cell.replace(/"/g, '""')}"`;
};

/** The same CSV as the web's src/components/Friend/Export.tsx. */
export const buildFriendExpensesCsv = ({
  expenses,
  currentUserId,
  friendId,
  friendName,
}: {
  expenses: ExportExpense[];
  currentUserId: number;
  friendId: number;
  friendName: string;
}) => {
  const rows = expenses.map((expense) => {
    const youPaid = expense.paidBy === currentUserId;
    const share = expense.expenseParticipants.find(
      (participant) => participant.userId === (youPaid ? friendId : currentUserId),
    );
    const shareAmount = toUIString(share?.amount ?? 0);
    const isSettlement = 'SETTLEMENT' === expense.splitType;

    return [
      youPaid ? 'You' : friendName,
      expense.name,
      expense.category,
      toUIString(expense.amount),
      expense.splitType,
      format(expense.expenseDate, 'yyyy-MM-dd HH:mm:ss'),
      expense.currency,
      youPaid && !isSettlement ? shareAmount : 0,
      !youPaid && !isSettlement ? shareAmount : 0,
      isSettlement ? shareAmount : 0,
    ];
  });

  return [HEADERS.join(','), ...rows.map((row) => row.map(escapeCell).join(','))].join('\n');
};

const toFileName = (name: string) => `${name.replace(/[^\w.-]+/g, '_')}.csv`;

const downloadOnWeb = (csv: string, fileName: string) => {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/**
 * Writes the CSV to the cache and opens the share sheet (save to Files, mail, ...). Downloads it on
 * web. Resolves `false` when the device can't share files.
 */
export const shareCsv = async (csv: string, name: string, dialogTitle: string) => {
  const fileName = toFileName(name);

  if ('web' === Platform.OS) {
    downloadOnWeb(csv, fileName);
    return true;
  }

  if (!(await Sharing.isAvailableAsync())) {
    return false;
  }

  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  await file.write(csv);

  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    UTI: 'public.comma-separated-values-text',
    dialogTitle,
  });

  return true;
};
