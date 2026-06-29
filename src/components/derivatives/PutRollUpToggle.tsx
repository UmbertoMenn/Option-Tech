import { TrendingUp } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Position } from '@/types/portfolio';
import { usePutRollFlags } from '@/hooks/usePutRollFlags';
import { nakedPutKeyForPosition, isSoldPut } from '@/lib/strategyKeys';

interface PutRollUpToggleProps {
  /** The sold put leg the flag attaches to. */
  option: Position;
  className?: string;
  /** When true, render only the switch (no "Roll-up" text label). */
  hideLabel?: boolean;
}

/**
 * Per-position toggle "PUT da rollare al rialzo".
 *
 * Writes to `put_roll_flags` keyed by the Naked Put strategy_key. When ON, the
 * alert engine fires the dedicated roll-up alerts (ITM + avvicinamento) for this
 * put and suppresses the standard naked-put alerts. Renders nothing for
 * non-(sold put) positions.
 */
export function PutRollUpToggle({ option, className, hideLabel = false }: PutRollUpToggleProps) {
  const { isRollUp, setRollUp, isSaving } = usePutRollFlags();

  if (!isSoldPut(option)) return null;

  const key = nakedPutKeyForPosition(option);
  const checked = isRollUp(key);
  const id = `rollup-${option.id}`;

  const tip = (
    <TooltipContent side="top" className="text-xs max-w-[260px]">
      PUT ITM da rollare al rialzo (come una covered call): avviso quando il
      titolo sale e si avvicina allo strike, e avviso critico quando lo
      supera (PUT OTM). Sostituisce gli alert Naked Put standard per questa put.
    </TooltipContent>
  );

  const sw = (
    <Switch
      id={id}
      checked={checked}
      disabled={isSaving}
      onCheckedChange={(v) =>
        setRollUp({ strategyKey: key, rollUp: v, portfolioId: option.portfolio_id })
      }
      className="scale-75"
    />
  );

  return (
    <div className={`flex items-center gap-1.5 ${className || ''}`}>
      <TooltipProvider delayDuration={200}>
        {hideLabel ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">{sw}</span>
            </TooltipTrigger>
            {tip}
          </Tooltip>
        ) : (
          <>
            {sw}
            <Tooltip>
              <TooltipTrigger asChild>
                <Label htmlFor={id} className="text-[10px] text-muted-foreground cursor-pointer flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Roll-up
                </Label>
              </TooltipTrigger>
              {tip}
            </Tooltip>
          </>
        )}
      </TooltipProvider>
    </div>
  );
}
