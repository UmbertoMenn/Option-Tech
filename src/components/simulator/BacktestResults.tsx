import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BacktestResult, BacktestLeg } from '@/lib/backtestEngine';
import { TrendingUp, TrendingDown, BarChart3, Activity, DollarSign, Percent, List, Receipt } from 'lucide-react';

interface BacktestResultsProps {
  result: BacktestResult;
}

interface TradeMovement {
  date: string;
  action: 'BUY' | 'SELL';
  instrument: string;
  type: 'stock' | 'call' | 'put';
  strike: number;
  expiry: string;
  quantity: number;
  price: number;
  total: number;
  commission: number;
  underlyingPrice?: number;
}

function buildMovements(result: BacktestResult): TradeMovement[] {
  const movements: TradeMovement[] = [];

  const legToInstrument = (leg: BacktestLeg) => {
    if (leg.type === 'stock') return 'STOCK';
    return `${leg.type.toUpperCase()} K${leg.strike} exp ${leg.expiryDate}`;
  };

  // 1. Initial legs from first day
  const firstDate = result.days[0]?.date ?? '';
  const initialPrice = result.days[0]?.underlyingPrice ?? 0;
  for (const leg of (result.days[0]?.legs ?? [])) {
    const action: 'BUY' | 'SELL' = leg.quantity > 0 ? 'BUY' : 'SELL';
    const qty = Math.abs(leg.quantity);
    const mult = leg.type === 'stock' ? 1 : 100;
    movements.push({
      date: firstDate,
      action,
      instrument: leg.type === 'stock' ? 'STOCK' : `${leg.type.toUpperCase()} K${leg.strike}`,
      type: leg.type,
      strike: leg.strike,
      expiry: '',
      quantity: qty,
      price: leg.price,
      total: leg.price * qty * mult,
      commission: 10,
      underlyingPrice: leg.type === 'stock' ? leg.price : initialPrice,
    });
  }

  // 2. From adjustment log
  for (const adj of result.adjustmentLog) {
    for (const leg of adj.legsRemoved) {
      const action: 'BUY' | 'SELL' = leg.quantity < 0 ? 'BUY' : 'SELL';
      const qty = Math.abs(leg.quantity);
      const mult = leg.type === 'stock' ? 1 : 100;
      const closeP = leg.closePrice ?? leg.entryPrice;
      movements.push({
        date: adj.date,
        action,
        instrument: legToInstrument(leg) + ' (chiusura)',
        type: leg.type,
        strike: leg.strike,
        expiry: leg.expiryDate,
        quantity: qty,
        price: closeP,
        total: closeP * qty * mult,
        commission: 10,
        underlyingPrice: adj.underlyingPrice,
      });
    }
    for (const leg of adj.legsAdded) {
      const action: 'BUY' | 'SELL' = leg.quantity > 0 ? 'BUY' : 'SELL';
      const qty = Math.abs(leg.quantity);
      const mult = leg.type === 'stock' ? 1 : 100;
      movements.push({
        date: adj.date,
        action,
        instrument: legToInstrument(leg),
        type: leg.type,
        strike: leg.strike,
        expiry: leg.expiryDate,
        quantity: qty,
        price: leg.entryPrice,
        total: leg.entryPrice * qty * mult,
        commission: 10,
        underlyingPrice: adj.underlyingPrice,
      });
    }
  }

  movements.sort((a, b) => a.date.localeCompare(b.date));
  return movements;
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ElementType; color?: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color || 'bg-primary/10'}`}>
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function BacktestResults({ result }: BacktestResultsProps) {
  const movements = useMemo(() => buildMovements(result), [result]);

  const avgPremium = result.tradeCount > 0
    ? result.totalGrossPremiums / result.tradeCount
    : 0;

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard
          label="P/L Sottostante"
          value={`$${result.underlyingPL.toFixed(2)}`}
          icon={result.underlyingPL >= 0 ? TrendingUp : TrendingDown}
          color={result.underlyingPL >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}
        />
        <StatCard
          label="P/L Strategia"
          value={`$${result.strategyPL.toFixed(2)}`}
          icon={result.strategyPL >= 0 ? TrendingUp : TrendingDown}
          color={result.strategyPL >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}
        />
        <StatCard label="Max Drawdown" value={`$${result.maxDrawdown.toFixed(2)}`} icon={TrendingDown} color="bg-red-500/10" />
        <StatCard label="Sharpe Ratio" value={result.sharpeRatio.toFixed(2)} icon={BarChart3} />
        <StatCard label="Win Rate" value={`${result.winRate.toFixed(1)}%`} icon={Activity} />
      </div>

      {/* Premium & Commission summary */}
      <Card>
        <CardContent className="p-4 flex items-center gap-4">
          <Receipt className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>Premi lordi: <strong className="text-green-500">${result.totalGrossPremiums.toFixed(2)}</strong></span>
            <span>Premio unitario: <strong>${avgPremium.toFixed(2)}</strong></span>
            <span>Commissioni: <strong className="text-red-500">${result.totalCommissions.toFixed(2)}</strong> ({result.tradeCount} op)</span>
            <span>Premi netti: <strong>${result.totalNetPremiums.toFixed(2)}</strong></span>
          </div>
        </CardContent>
      </Card>

      {/* Movimenti cronologici */}
      {movements.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <List className="w-4 h-4" />
              Movimenti Cronologici
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Data</TableHead>
                    <TableHead className="text-xs">Operazione</TableHead>
                    <TableHead className="text-xs">Strumento</TableHead>
                    <TableHead className="text-xs text-right">Sottostante</TableHead>
                    <TableHead className="text-xs text-right">Qty</TableHead>
                    <TableHead className="text-xs text-right">Prezzo</TableHead>
                    <TableHead className="text-xs text-right">Importo</TableHead>
                    <TableHead className="text-xs text-right">Commissione</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((m, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{m.date}</TableCell>
                      <TableCell>
                        <Badge
                          variant={m.action === 'SELL' ? 'default' : 'destructive'}
                          className="text-xs"
                        >
                          {m.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{m.instrument}</TableCell>
                      <TableCell className="text-xs text-right font-mono">
                        {m.underlyingPrice != null ? `$${m.underlyingPrice.toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">{m.quantity}</TableCell>
                      <TableCell className="text-xs text-right font-mono">${m.price.toFixed(2)}</TableCell>
                      <TableCell className={`text-xs text-right font-mono ${m.action === 'SELL' ? 'text-green-500' : 'text-red-500'}`}>
                        ${m.total.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono text-red-500">
                        $10.00
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Adjustment log table */}
      {result.adjustmentLog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Log Aggiustamenti</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Data</TableHead>
                    <TableHead className="text-xs">Regola</TableHead>
                    <TableHead className="text-xs">Descrizione</TableHead>
                    <TableHead className="text-xs text-right">Sottostante</TableHead>
                    <TableHead className="text-xs text-right">Costo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.adjustmentLog.map((adj, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{adj.date}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{adj.ruleName}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{adj.description}</TableCell>
                      <TableCell className="text-xs text-right font-mono">${adj.underlyingPrice.toFixed(2)}</TableCell>
                      <TableCell className={`text-xs text-right font-mono ${adj.cost < 0 ? 'text-green-500' : 'text-red-500'}`}>
                        ${adj.cost.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
