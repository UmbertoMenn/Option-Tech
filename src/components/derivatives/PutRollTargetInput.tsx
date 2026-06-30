import { useEffect, useRef, useState } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Position } from '@/types/portfolio';
import { usePutRollTargets } from '@/hooks/usePutRollTargets';
import { nakedPutKeyForPosition, isSoldPut } from '@/lib/strategyKeys';

interface PutRollTargetInputProps {
  /** The sold put leg the target attaches to. */
  option: Position;
  className?: string;
}

/**
 * Casella inline "Target da recuperare" per le PUT vendute ITM da rollare al rialzo.
 *
 * Modificabile a mano direttamente sulla riga. Il valore è salvato in `put_roll_targets`
 * keyed by Naked Put strategy_key e isolato per-utente dalla RLS (admin compreso).
 * Renderizza nulla per le posizioni che non sono (sold put).
 */
export function PutRollTargetInput({ option, className }: PutRollTargetInputProps) {
  const { getTarget, setTarget, isSaving } = usePutRollTargets();

  // Hooks vanno chiamati sempre, anche se poi non renderizziamo nulla.
  const key = isSoldPut(option) ? nakedPutKeyForPosition(option) : '';
  const saved = key ? getTarget(key) : null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Sincronizza il valore mostrato quando cambia il salvato e non stiamo editando.
  useEffect(() => {
    if (!editing) setDraft(saved !== null ? String(saved) : '');
  }, [saved, editing]);

  if (!isSoldPut(option)) return null;

  const commit = () => {
    setEditing(false);
    const raw = draft.trim().replace(',', '.');
    if (raw === '') {
      if (saved !== null) setTarget({ strategyKey: key, target: null, portfolioId: option.portfolio_id });
      return;
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      // input non valido → ripristina il salvato
      setDraft(saved !== null ? String(saved) : '');
      return;
    }
    if (parsed !== saved) {
      setTarget({ strategyKey: key, target: parsed, portfolioId: option.portfolio_id });
    }
  };

  return (
    <div className={`flex items-center justify-end ${className || ''}`} onClick={(e) => e.stopPropagation()}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={draft}
              placeholder="—"
              disabled={isSaving}
              onFocus={(e) => { setEditing(true); e.currentTarget.select(); }}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); inputRef.current?.blur(); }
                if (e.key === 'Escape') {
                  setEditing(false);
                  setDraft(saved !== null ? String(saved) : '');
                  inputRef.current?.blur();
                }
              }}
              className={`w-full h-7 px-1.5 text-right text-sm font-mono rounded-md border bg-background/60 outline-none transition-colors
                focus:border-primary focus:ring-1 focus:ring-primary/40
                ${saved !== null ? 'border-amber-500/50 text-amber-400' : 'border-border text-muted-foreground'}
                placeholder:text-muted-foreground/40`}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[240px]">
            Target da recuperare per questa PUT (roll-up). Valore privato del singolo
            utente: modificabile a mano, premi Invio per salvare, campo vuoto per
            cancellarlo.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
