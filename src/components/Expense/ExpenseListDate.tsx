import React from 'react';
import { formatMonthHeader, getDateColumn } from '~/utils/dates';

export const MonthHeader: React.FC<{ date: Date }> = ({ date }) => (
  <p className="px-2 pt-2 text-xs font-medium uppercase tracking-wide text-gray-500">
    {formatMonthHeader(date)}
  </p>
);

export const DateColumn: React.FC<{ date: Date }> = ({ date }) => (
  <div className="text-xs text-gray-500">
    {getDateColumn(date).map((part) => (
      <div className="text-center" key={part}>
        {part}
      </div>
    ))}
  </div>
);
