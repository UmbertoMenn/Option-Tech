import { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DerivativePosition } from '@/types/portfolio';
import { calculateOptionPayoff, findBreakevenPoints, calculateMaxProfit, calculateMaxLoss, getPriceRangeForPositions } from '@/lib/optionCalculator';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Badge } from '@/components/ui/badge';

interface OptionPayoffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  positions: DerivativePosition[];
}

export function OptionPayoffDialog({ open, onOpenChange, positions }: OptionPayoffDialogProps) {
  const underlying = positions[0]?.underlying || 'Sottostante';
  const priceRange = useMemo(() => getPriceRangeForPositions(positions), [positions]);
  
  const payoffData = useMemo(
    () => calculateOptionPayoff(positions, 0, priceRange),
    [positions, priceRange]
  );
  
  const breakevens = useMemo(() => findBreakevenPoints(payoffData), [payoffData]);
  const maxProfit = useMemo(() => calculateMaxProfit(payoffData), [payoffData]);
  const maxLoss = useMemo(() => calculateMaxLoss(payoffData), [payoffData]);
  
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const isProfit = data.payoff >= 0;
      
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="text-sm text-muted-foreground">
            Prezzo: <span className="font-mono font-medium text-foreground">${data.price.toFixed(2)}</span>
          </p>
          <p className={`text-sm font-mono font-medium ${isProfit ? 'text-profit' : 'text-loss'}`}>
            P/L: {isProfit ? '+' : ''}{formatCurrency(data.payoff, 'USD')}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>Grafico Payoff - {underlying}</span>
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Position summary */}
          <div className="flex flex-wrap gap-2">
            {positions.map((pos, i) => (
              <Badge 
                key={i}
                variant="outline"
                className={pos.option_type === 'call' ? 'border-profit text-profit' : 'border-loss text-loss'}
              >
                {pos.quantity > 0 ? 'Long' : 'Short'} {pos.option_type?.toUpperCase()} ${pos.strike_price}
                {pos.expiry_date && ` (${formatDate(pos.expiry_date)})`}
              </Badge>
            ))}
          </div>
          
          {/* Chart */}
          <div className="h-[400px] chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={payoffData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <defs>
                  <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="lossGradient" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 16%, 18%)" />
                <XAxis 
                  dataKey="price" 
                  stroke="hsl(215, 20%, 55%)"
                  tickFormatter={(v) => `$${v.toFixed(0)}`}
                  fontSize={12}
                />
                <YAxis 
                  stroke="hsl(215, 20%, 55%)"
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  fontSize={12}
                />
                <Tooltip content={<CustomTooltip />} />
                
                {/* Zero line */}
                <ReferenceLine y={0} stroke="hsl(215, 20%, 55%)" strokeDasharray="5 5" />
                
                {/* Breakeven lines */}
                {breakevens.map((be, i) => (
                  <ReferenceLine 
                    key={i}
                    x={be} 
                    stroke="hsl(38, 92%, 50%)" 
                    strokeDasharray="5 5"
                    label={{ value: `BE: $${be.toFixed(2)}`, fill: 'hsl(38, 92%, 50%)', fontSize: 11 }}
                  />
                ))}
                
                {/* Strike lines */}
                {positions.map((pos, i) => (
                  <ReferenceLine 
                    key={`strike-${i}`}
                    x={pos.strike_price} 
                    stroke={pos.option_type === 'call' ? 'hsl(142, 71%, 45%)' : 'hsl(0, 84%, 60%)'} 
                    strokeDasharray="3 3"
                    strokeOpacity={0.5}
                  />
                ))}
                
                <Line 
                  type="monotone" 
                  dataKey="payoff" 
                  stroke="hsl(217, 91%, 60%)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 6, fill: 'hsl(217, 91%, 60%)' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">Max Profit</p>
              <p className={`font-mono font-medium ${maxProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
                {maxProfit === Infinity ? 'Illimitato' : formatCurrency(maxProfit, 'USD')}
              </p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">Max Loss</p>
              <p className={`font-mono font-medium ${maxLoss >= 0 ? 'text-profit' : 'text-loss'}`}>
                {maxLoss === -Infinity ? 'Illimitato' : formatCurrency(maxLoss, 'USD')}
              </p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">Breakeven</p>
              <p className="font-mono font-medium text-warning">
                {breakevens.length > 0 
                  ? breakevens.map(b => `$${b.toFixed(2)}`).join(', ')
                  : 'N/A'}
              </p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">Posizioni</p>
              <p className="font-mono font-medium">{positions.length}</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}