import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from '@/components/ui/accordion';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Coins, TrendingUp, BarChart3, TrendingDown, DollarSign, Layers, ExternalLink } from 'lucide-react';
import { CurrencyExposure, getCurrencyColor, InstrumentDetail } from '@/lib/currencyExposure';
import { formatEUR, formatCurrency } from '@/lib/formatters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface CurrencyExposureViewProps {
  currencyExposure: CurrencyExposure[];
  grandTotal: number;
  isLoadingETFData?: boolean;
  etfCount?: number;
  loadedETFCount?: number;
}

const CATEGORY_CONFIG = {
  stocks: { label: 'Stocks & ETF', icon: TrendingUp, colorClass: 'text-blue-500' },
  commodities: { label: 'Commodities', icon: BarChart3, colorClass: 'text-orange-500' },
  nakedPuts: { label: 'Naked PUT', icon: TrendingDown, colorClass: 'text-red-500' },
  leapCalls: { label: 'Leap Call', icon: DollarSign, colorClass: 'text-amber-500' },
  strategies: { label: 'Strategie', icon: Layers, colorClass: 'text-purple-500' },
};

function InstrumentRow({ instrument }: { instrument: InstrumentDetail }) {
  const config = CATEGORY_CONFIG[instrument.category];
  const Icon = config.icon;
  
  const handleJustETFClick = () => {
    // Try to find ISIN in the name or use the name as search
    const searchTerm = instrument.name.replace(/\s+/g, '+');
    window.open(`https://www.justetf.com/en/find-etf.html?query=${searchTerm}`, '_blank');
  };
  
  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Icon className={`w-3.5 h-3.5 ${config.colorClass} flex-shrink-0`} />
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{instrument.name}</span>
            {instrument.isETF && (
              <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 bg-blue-500/10 text-blue-500 border-blue-500/30">
                ETF
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground truncate">{instrument.details}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="font-medium text-sm">{formatEUR(instrument.riskEUR)}</span>
        {instrument.isETF && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
            onClick={handleJustETFClick}
            title="Cerca su justETF"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function CategoryBreakdown({ 
  instruments, 
  category, 
  total 
}: { 
  instruments: InstrumentDetail[]; 
  category: keyof typeof CATEGORY_CONFIG;
  total: number;
}) {
  const categoryInstruments = instruments.filter(i => i.category === category);
  if (categoryInstruments.length === 0) return null;
  
  const config = CATEGORY_CONFIG[category];
  const Icon = config.icon;
  
  return (
    <AccordionItem value={category} className="border-0">
      <AccordionTrigger className="py-2 px-3 hover:no-underline hover:bg-background/50 rounded-lg">
        <div className="flex items-center gap-2 flex-1">
          <Icon className={`w-4 h-4 ${config.colorClass}`} />
          <span className="text-sm">{config.label}</span>
          <Badge variant="secondary" className="ml-auto mr-2 text-xs">
            {categoryInstruments.length}
          </Badge>
          <span className="font-medium text-sm">{formatEUR(total)}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-1 pb-2 px-2">
        <div className="space-y-1">
          {categoryInstruments.map((instrument, idx) => (
            <InstrumentRow key={`${instrument.name}-${idx}`} instrument={instrument} />
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export function CurrencyExposureView({ 
  currencyExposure, 
  grandTotal,
  isLoadingETFData = false,
  etfCount = 0,
  loadedETFCount = 0
}: CurrencyExposureViewProps) {
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
              {isLoadingETFData && (
                <span className="ml-2 text-primary animate-pulse">
                  Caricamento dati ETF ({loadedETFCount}/{etfCount})...
                </span>
              )}
              {!isLoadingETFData && etfCount > 0 && (
                <span className="ml-2 text-green-500">
                  ✓ {loadedETFCount} ETF analizzati
                </span>
              )}
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
                      <div className="text-right flex flex-col">
                        <div className="flex items-center gap-2 justify-end">
                          <span className="font-medium">{curr.percentage.toFixed(1)}%</span>
                          <span className="text-muted-foreground text-xs">
                            {formatEUR(curr.totalRisk)}
                          </span>
                        </div>
                        {curr.currency !== 'EUR' && (
                          <span className="text-xs text-muted-foreground">
                            {formatCurrency(curr.totalRiskOriginal, curr.currency)}
                          </span>
                        )}
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

      {/* Currency Breakdown Accordion with Instrument Details */}
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
                        <div className="text-right flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {curr.instruments.length} strumenti
                          </Badge>
                          <span className="font-semibold">{formatEUR(curr.totalRisk)}</span>
                          <span className="text-muted-foreground text-sm">
                            ({curr.percentage.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <Accordion type="multiple" className="space-y-1">
                      <CategoryBreakdown 
                        instruments={curr.instruments} 
                        category="stocks" 
                        total={curr.breakdown.stocks} 
                      />
                      <CategoryBreakdown 
                        instruments={curr.instruments} 
                        category="commodities" 
                        total={curr.breakdown.commodities} 
                      />
                      <CategoryBreakdown 
                        instruments={curr.instruments} 
                        category="nakedPuts" 
                        total={curr.breakdown.nakedPuts} 
                      />
                      <CategoryBreakdown 
                        instruments={curr.instruments} 
                        category="leapCalls" 
                        total={curr.breakdown.leapCalls} 
                      />
                      <CategoryBreakdown 
                        instruments={curr.instruments} 
                        category="strategies" 
                        total={curr.breakdown.strategies} 
                      />
                    </Accordion>
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
