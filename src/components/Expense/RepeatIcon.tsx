import { Repeat } from 'lucide-react';
import React from 'react';

import { cn } from '~/lib/utils';

/** Marks an expense that repeats, in lists. */
export const RepeatIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Repeat
    className={cn('h-3.5 w-3.5 shrink-0 text-cyan-500', className)}
    aria-label="Repeats"
    role="img"
  />
);
