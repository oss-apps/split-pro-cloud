import React, { useState } from 'react';
import { SearchIcon, X } from 'lucide-react';
import { cn } from '~/lib/utils';
import { Input } from '~/components/ui/input';
import { Button } from '~/components/ui/button';
import {
  type ExpenseFilter,
  type SearchableExpense,
  filterExpenses,
  getFilterOptions,
} from '~/utils/expenseSearch';

/** Search and category filter state for an expense list, kept on the page while it is open. */
export const useExpenseSearch = <T extends SearchableExpense>(
  expenses: T[] | undefined,
  getOtherText?: (expense: T) => (string | null | undefined)[],
) => {
  const [filter, setFilter] = useState<ExpenseFilter>({ query: '', category: null });

  return {
    filter,
    setFilter,
    options: getFilterOptions(expenses ?? []),
    filtered: expenses ? filterExpenses(expenses, filter, getOtherText) : undefined,
    isFiltering: '' !== filter.query.trim() || null !== filter.category,
  };
};

export const ExpenseSearch: React.FC<{
  filter: ExpenseFilter;
  onChange: (filter: ExpenseFilter) => void;
  options: { key: string; label: string }[];
  className?: string;
}> = ({ filter, onChange, options, className }) => (
  <div className={cn('flex flex-col gap-2', className)}>
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
      <Input
        type="search"
        inputMode="search"
        placeholder="Search expenses"
        aria-label="Search expenses"
        value={filter.query}
        onChange={(e) => onChange({ ...filter, query: e.target.value })}
        className="h-9 pl-9 pr-9 text-base [&::-webkit-search-cancel-button]:hidden"
      />
      {filter.query ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange({ ...filter, query: '' })}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
    {1 < options.length ? (
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {options.map((option) => {
          const isSelected = option.key === filter.category;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onChange({ ...filter, category: isSelected ? null : option.key })}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-xs',
                isSelected ? 'border-primary bg-primary text-primary-foreground' : 'text-gray-400',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    ) : null}
  </div>
);

export const NoMatchingExpenses: React.FC<{ onClear: () => void }> = ({ onClear }) => (
  <div className="mt-10 flex flex-col items-center gap-2 text-sm text-gray-400">
    No expenses match your search
    <Button size="sm" variant="secondary" onClick={onClear}>
      Clear search
    </Button>
  </div>
);
