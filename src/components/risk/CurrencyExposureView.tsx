import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from '@/components/ui/accordion';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Coins, TrendingUp, BarChart3, TrendingDown, DollarSign, Layers } from 'lucide-react';
import { CurrencyExposure, getCurrencyColor } from '@/lib/currencyExposure';
import { formatEUR } from '@/lib/formatters';

interface CurrencyExposureViewProps {
  currencyExposure: CurrencyExposure[];
  grandTotal: number;
}

const BREAKDOWN_LABELS = {
  stocks: { label: 'Stocks & ETF', icon: TrendingUp, colorClass: 'text-blue-500' },
  commodities: { label: 'Commodities', icon: BarChart3, colorClass: 'text-orange-500' },
  nakedPuts: { label: 'Naked PUT', icon: TrendingDown, colorClass: 'text-red-500' },
  leapCalls: { label: 'Leap Call', icon: DollarSign, colorClass: 'text-amber-500' },
  strategies: { label: 'Strategie', icon: Layers, colorClass: 'text-purple-500' },
};

export function CurrencyExposureView({ currencyExposure, grandTotal }: CurrencyExposureViewProps) {
  const hasData = currencyExposure.length > 0 && grandTotal > 0;

  return (
    <div className="space-y-6">
      {/* Total Exposure Card with Large Donut Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Total Card */}
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded bg-primary/20">
                <Coins className="w-4 h-4 text-primary" />
              </div>
              <span className="text-sm font-medium text-primary">Esposizione Valutaria Totale</span>
            </div>
            <div className="text-3xl font-bold text-primary">{formatEUR(grandTotal)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Rischio aggregato per valuta
            </div>
          </CardContent>
        </Card>

        {/* Large Thin Donut Chart */}
        <Card className="border-border bg-card">
          <CardContent className="pt-4 pb-4">
            {hasData ? (
              <div className="flex items-center gap-6">
                <div className="w-40 h-40 flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={currencyExposure}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={75}
                        paddingAngle={2}
                        dataKey="totalRisk"
                      >
                        {currencyExposure.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={getCurrencyColor(entry.currency)}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-2">
                  {currencyExposure.map((curr) => (
                    <div key={curr.currency} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: getCurrencyColor(curr.currency) }}
                        />
                        <span className="font-medium">{curr.currency}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-medium">{curr.percentage.toFixed(1)}%</span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {formatEUR(curr.totalRisk)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40 text-muted-foreground">
                Nessun dato disponibile
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Currency Breakdown Accordion */}
      {hasData && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Dettaglio per Valuta</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="space-y-2">
              {currencyExposure.map((curr) => (
                <AccordionItem 
                  key={curr.currency} 
                  value={curr.currency}
                  className="border rounded-lg bg-muted/30"
                >
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="flex items-center gap-3 flex-1">
                      <div 
                        className="w-4 h-4 rounded-full" 
                        style={{ backgroundColor: getCurrencyColor(curr.currency) }}
                      />
                      <div className="flex items-center justify-between flex-1 pr-2">
                        <span className="font-semibold">{curr.currency}</span>
                        <div className="text-right">
                          <span className="font-semibold">{formatEUR(curr.totalRisk)}</span>
                          <span className="text-muted-foreground text-sm ml-2">
                            ({curr.percentage.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <div className="space-y-2 pt-2">
                      {Object.entries(curr.breakdown).map(([key, value]) => {
                        if (value === 0) return null;
                        const config = BREAKDOWN_LABELS[key as keyof typeof BREAKDOWN_LABELS];
                        const Icon = config.icon;
                        return (
                          <div 
                            key={key} 
                            className="flex items-center justify-between p-2 rounded-lg bg-background"
                          >
                            <div className="flex items-center gap-2">
                              <Icon className={`w-4 h-4 ${config.colorClass}`} />
                              <span className="text-sm">{config.label}</span>
                            </div>
                            <span className="font-medium">{formatEUR(value)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!hasData && (
        <Card className="border-border bg-card">
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Coins className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">Nessuna esposizione valutaria</p>
              <p className="text-sm">Carica un portfolio per visualizzare l'analisi</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
