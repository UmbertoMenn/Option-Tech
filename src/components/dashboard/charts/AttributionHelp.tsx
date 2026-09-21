import { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Explicit, keyboard- and touch-accessible trigger for the app's click tooltips. */
export function AttributionHelp({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={`Informazioni: ${label}`} title={`Clicca per spiegare: ${label}`} className="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground">
          <Info className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-80 text-xs font-normal text-left">{children}</TooltipContent>
    </Tooltip>
  );
}
