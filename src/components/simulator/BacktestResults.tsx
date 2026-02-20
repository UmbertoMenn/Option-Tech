import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BacktestResult, BacktestLeg } from '@/lib/backtestEngine';
import { TrendingUp, TrendingDown, BarChart3, Activity, DollarSign, Percent, List } from 'lucide-react';

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
}

function buildMovements(result: BacktestResult): TradeMovement[] {
  const movements: TradeMovement[] = [];

  const legToInstrument = (leg: BacktestLeg) => {
    if (leg.type === 'stock') return 'STOCK';
    return `${leg.type.toUpperCase()} K${leg.strike} exp ${leg.expiryDate}`;
  };

  // 1. Initial legs from first day
  const firstDate = result.days[0]?.date ?? '';
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

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="P/L Finale"
          value={`$${result.finalPL.toFixed(2)}`}
          icon={result.finalPL >= 0 ? TrendingUp : TrendingDown}
          color={result.finalPL >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}
        />
        <StatCard label="P/L %" value={`${result.finalPLPct.toFixed(2)}%`} icon={Percent} />
        <StatCard label="Max Drawdown" value={`$${result.maxDrawdown.toFixed(2)}`} icon={TrendingDown} color="bg-red-500/10" />
        <StatCard label="Max Profitto" value={`$${result.maxProfit.toFixed(2)}`} icon={TrendingUp} color="bg-green-500/10" />
        <StatCard label="Sharpe Ratio" value={result.sharpeRatio.toFixed(2)} icon={BarChart3} />
        <StatCard label="Win Rate" value={`${result.winRate.toFixed(1)}%`} icon={Activity} />
      </div>

      {/* Adjustment summary */}
      <Card>
        <CardContent className="p-4 flex items-center gap-4">
          <DollarSign className="w-5 h-5 text-muted-foreground" />
          <div className="flex gap-6 text-sm">
            <span>Aggiustamenti: <strong>{result.adjustmentLog.length}</strong></span>
            <span>Costo totale: <strong>${result.totalAdjustmentCost.toFixed(2)}</strong></span>
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
                    <TableHead className="text-xs text-right">Qty</TableHead>
                    <TableHead className="text-xs text-right">Prezzo</TableHead>
                    <TableHead className="text-xs text-right">Totale</TableHead>
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
                      <TableCell className="text-xs text-right font-mono">{m.quantity}</TableCell>
                      <TableCell className="text-xs text-right font-mono">${m.price.toFixed(2)}</TableCell>
                      <TableCell className={`text-xs text-right font-mono ${m.action === 'SELL' ? 'text-green-500' : 'text-red-500'}`}>
                        ${m.total.toFixed(2)}
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
