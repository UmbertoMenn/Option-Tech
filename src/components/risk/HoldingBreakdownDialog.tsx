import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { formatEUR, formatNumber } from '@/lib/formatters';
import { ConsolidatedHoldingWithDetails } from '@/lib/sectorExposure';
import { TrendingDown, TrendingUp, BarChart3, AlertTriangle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface HoldingBreakdownDialogProps {
  holding: ConsolidatedHoldingWithDetails | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  includeProtections: boolean;
}

export function HoldingBreakdownDialog({
  holding,
  open,
  onOpenChange,
  includeProtections,
}: HoldingBreakdownDialogProps) {
  if (!holding) return null;

  const formatExpiry = (expiry: string) => {
    if (!expiry) return '-';
    const date = new Date(expiry);
    const month = date.toLocaleDateString('it-IT', { month: 'short' }).toUpperCase();
    const year = date.getFullYear().toString().slice(-2);
    return `${month}/${year}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            Breakdown: {holding.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
            <div className="text-2xl font-bold text-primary">
              {formatEUR(holding.totalExposure)}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              Esposizione Totale
            </div>
          </div>

          {/* Stock Details */}
          {holding.stockDetails.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="w-4 h-4 text-blue-500" />
                Stock Diretto
              </div>
              <div className="rounded-lg border bg-muted/30 divide-y">
                {holding.stockDetails.map((stock, i) => (
                  <div key={i} className="p-3 flex justify-between items-center">
                    <div>
                      <div className="text-sm">
                        {formatNumber(stock.quantity)} azioni @ {stock.currency} {formatNumber(stock.price, 2)}
                      </div>
                      {/* Show protection info if present */}
                      {stock.hasProtection && stock.protectionContracts > 0 && (
                        <div className="text-xs text-green-600 mt-1">
                          🛡️ Protetto: {stock.protectionContracts} PUT × Strike {formatNumber(stock.protectionStrike || 0, 0)}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-blue-500">
                        {formatEUR(includeProtections ? stock.valueWithProtection : stock.value)}
                      </div>
                      {includeProtections && stock.hasProtection && stock.valueWithProtection < stock.value && (
                        <div className="text-xs text-green-500">
                          (Lordo: {formatEUR(stock.value)})
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-right text-sm font-medium">
                Subtotale Stock:{' '}
                <span className="text-blue-500">
                  {formatEUR(includeProtections ? holding.stockRiskWithProtection : holding.stockRisk)}
                </span>
              </div>
            </div>
          )}

          {/* Naked PUT Details */}
          {holding.nakedPutDetails.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <TrendingDown className="w-4 h-4 text-red-500" />
                Naked PUT
              </div>
              <div className="rounded-lg border bg-muted/30 divide-y">
                {holding.nakedPutDetails.map((put, i) => (
                  <div key={i} className="p-3 flex justify-between items-center">
                    <div>
                      <div className="text-sm font-medium">
                        Strike {formatNumber(put.strike)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {put.contracts} contratti • {formatExpiry(put.expiry)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-red-500">
                        {formatEUR(put.riskEUR)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-right text-sm font-medium">
                Subtotale PUT:{' '}
                <span className="text-red-500">{formatEUR(holding.nakedPutRisk)}</span>
              </div>
            </div>
          )}

          {/* Leap Call Details */}
          {holding.leapCallDetails.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="w-4 h-4 text-amber-500" />
                Leap Call
              </div>
              <div className="rounded-lg border bg-muted/30 divide-y">
                {holding.leapCallDetails.map((lc, i) => (
                  <div key={i} className="p-3 flex justify-between items-center">
                    <div>
                      <div className="text-sm font-medium">
                        Strike {formatNumber(lc.strike)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {lc.contracts} ctr × Mkt {formatNumber(lc.marketPrice, 2)} • {formatExpiry(lc.expiry)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-amber-500">
                        {formatEUR(lc.marketValue)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-right text-sm font-medium">
                Subtotale LEAP:{' '}
                <span className="text-amber-500">{formatEUR(holding.leapCallRisk)}</span>
              </div>
            </div>
          )}

          {/* Strategy Details */}
          {holding.strategyDetails.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <BarChart3 className="w-4 h-4 text-purple-500" />
                Strategie
              </div>
              <div className="rounded-lg border bg-muted/30 divide-y">
                {holding.strategyDetails.map((strat, i) => (
                  <div key={i} className="p-3 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium">
                        {strat.strategyName}
                      </div>
                      {strat.hasUnlimitedRisk && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="font-medium text-amber-500">Rischio Illimitato</p>
                              <p className="text-sm">
                                Il Max Loss mostrato considera solo il lato PUT (rischio definito). 
                                Il lato CALL ha rischio teoricamente illimitato.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-purple-500">
                        {formatEUR(strat.maxLossEUR)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-right text-sm font-medium">
                Subtotale Strategie:{' '}
                <span className="text-purple-500">{formatEUR(holding.strategyRisk)}</span>
              </div>
            </div>
          )}

          {/* Footer badges */}
          <div className="flex flex-wrap gap-2 pt-2 border-t">
            {holding.stockRisk > 0 && (
              <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30">
                Stock: {formatEUR(includeProtections ? holding.stockRiskWithProtection : holding.stockRisk)}
              </Badge>
            )}
            {holding.nakedPutRisk > 0 && (
              <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/30">
                PUT: {formatEUR(holding.nakedPutRisk)}
              </Badge>
            )}
            {holding.leapCallRisk > 0 && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">
                LEAP: {formatEUR(holding.leapCallRisk)}
              </Badge>
            )}
            {holding.strategyRisk > 0 && (
              <Badge variant="outline" className="bg-purple-500/10 text-purple-500 border-purple-500/30">
                Strategie: {formatEUR(holding.strategyRisk)}
              </Badge>
            )}
            {holding.gpRisk > 0 && (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                GP: {formatEUR(holding.gpRisk)}
              </Badge>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
