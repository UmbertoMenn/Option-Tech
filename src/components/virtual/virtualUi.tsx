/** Componenti UI condivisi dai pannelli del Portafoglio virtuale. */
import { ReactNode } from 'react';
import { Info, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { SortState } from './virtualFormat';

export function Tip({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="inline w-3.5 h-3.5 ml-1 text-muted-foreground cursor-help align-[-2px]" />
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-xs leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}

/** Intestazione di colonna cliccabile: 1° click ascendente, 2° discendente. */
export function SortTh<C extends string>({
  col,
  sort,
  onSort,
  children,
  className = '',
  align = 'left',
}: {
  col: C;
  sort: SortState<C>;
  onSort: (s: SortState<C>) => void;
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right';
}) {
  const active = sort.col === col;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`p-2 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? 'text-foreground' : ''} ${align === 'right' ? 'flex-row-reverse' : ''}`}
        onClick={() => onSort({ col, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' })}
      >
        {children}
        <Icon className={`w-3 h-3 ${active ? '' : 'opacity-40'}`} />
      </button>
    </th>
  );
}
