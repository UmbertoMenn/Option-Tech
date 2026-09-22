import { useState } from 'react';
import { Calculator } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CallPremiumCalculatorDialog } from '@/components/derivatives/CallPremiumCalculatorDialog';
import { useCoveredCallPremiums } from '@/hooks/useCoveredCallPremiums';
import { usePortfolio } from '@/hooks/usePortfolio';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { resellCallOptionSymbol } from '@/lib/coveredCallPremiumKeys';

interface ResellCallCalculatorButtonProps {
  ticker: string;
  underlyingName: string;
  contracts: number;
  underlyingPrice: number;
  currency: string;
  /** De-risking covered call: la calcolatrice include il costo della put di protezione. */
  isDeRisking?: boolean;
}

/** Calcolatrice premi CALL per una covered call a cui manca la call da rivendere. */
export function ResellCallCalculatorButton({
  ticker,
  underlyingName,
  contracts,
  underlyingPrice,
  currency,
  isDeRisking = false,
}: ResellCallCalculatorButtonProps) {
  const [open, setOpen] = useState(false);
  const { portfolio } = usePortfolio();
  const { getPremiumByTickerAndSymbol } = useCoveredCallPremiums(portfolio?.id);
  const optionSymbol = resellCallOptionSymbol(ticker);
  const saved = getPremiumByTickerAndSymbol(ticker, optionSymbol);
  const hasSaved = !!saved && saved.orders_json.length > 0;

  return (
    // Blocca la propagazione (anche dal dialog, che è in un portal) verso le
    // righe collassabili che contengono il pulsante.
    <span
      className="inline-flex"
      onClick={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-6 gap-1 px-1.5 text-[11px]',
              hasSaved ? 'text-primary hover:text-primary hover:bg-primary/20' : 'text-muted-foreground hover:bg-muted',
            )}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(true);
            }}
            aria-label={`Calcola premi CALL incassati ${ticker}`}
          >
            <Calculator className="h-3.5 w-3.5" />
            {hasSaved && (
              <span className={cn('font-mono', saved!.net_per_share >= 0 ? 'text-green-500' : 'text-red-500')}>
                {formatCurrency(saved!.net_per_share, currency)}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Calcola premi CALL incassati ({ticker}, call da rivendere)</p>
          {hasSaved && <p className="text-muted-foreground">Netto unitario dalla calcolatrice</p>}
        </TooltipContent>
      </Tooltip>
      <CallPremiumCalculatorDialog
        open={open}
        onOpenChange={setOpen}
        underlying={underlyingName}
        ticker={ticker}
        optionSymbol={optionSymbol}
        contractsInPortfolio={contracts}
        underlyingPrice={underlyingPrice}
        strategyType="covered_call"
        isDeRisking={isDeRisking}
      />
    </span>
  );
}
