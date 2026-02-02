import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { formatEUR, formatNumber } from '@/lib/formatters';
import { ConsolidatedHoldingWithDetails } from '@/lib/sectorExposure';
import { TrendingDown, TrendingUp, BarChart3 } from 'lucide-react';

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
                        {lc.contracts} ctr × PMC {formatNumber(lc.avgCost, 2)} • {formatExpiry(lc.expiry)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-amber-500">
                        {formatEUR(lc.premiumPaid)}
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
