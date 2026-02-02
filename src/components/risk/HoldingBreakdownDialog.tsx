import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { formatEUR, formatNumber } from '@/lib/formatters';
import { ConsolidatedHolding } from '@/lib/sectorExposure';
import { TrendingDown, TrendingUp, BarChart3 } from 'lucide-react';

// Extended interface with details for breakdown
interface ConsolidatedHoldingWithDetails extends ConsolidatedHolding {
  nakedPutDetails?: Array<{
    strike: number;
    contracts: number;
    riskEUR: number;
    expiry: string;
  }>;
  etfDetails?: Array<{
    etfName: string;
    holdingPercentage: number;
    exposure: number;
  }>;
  stockDetails?: Array<{
    quantity: number;
    price: number;
    currency: string;
    value: number;
    valueWithProtection: number;
  }>;
}

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
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-blue-500">
                        {formatEUR(includeProtections ? stock.valueWithProtection : stock.value)}
                      </div>
                      {includeProtections && stock.valueWithProtection < stock.value && (
                        <div className="text-xs text-green-500">
                          (Protetto, lordo: {formatEUR(stock.value)})
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

          {/* ETF Details */}
          {holding.etfDetails.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <BarChart3 className="w-4 h-4 text-cyan-500" />
                Esposizione via ETF
              </div>
              <div className="rounded-lg border bg-muted/30 divide-y">
                {holding.etfDetails.map((etf, i) => (
                  <div key={i} className="p-3 flex justify-between items-center">
                    <div>
                      <div className="text-sm font-medium truncate max-w-[200px]">
                        {etf.etfName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {etf.holdingPercentage.toFixed(2)}% del fondo
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-cyan-500">
                        {formatEUR(etf.exposure)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-right text-sm font-medium">
                Subtotale ETF:{' '}
                <span className="text-cyan-500">{formatEUR(holding.etfExposure)}</span>
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
            {holding.etfExposure > 0 && (
              <Badge variant="outline" className="bg-cyan-500/10 text-cyan-500 border-cyan-500/30">
                ETF: {formatEUR(holding.etfExposure)}
              </Badge>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
