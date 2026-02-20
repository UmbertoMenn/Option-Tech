import { useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldAlert, Play, Loader2, Sun, Moon, LogOut } from 'lucide-react';
import { IronCondorIcon } from '@/components/ui/iron-condor-icon';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';

import { TickerSelector, CsvPriceData } from '@/components/simulator/TickerSelector';
import { IVCurveEditor, IVPoint, generateMonthlyPoints } from '@/components/simulator/IVCurveEditor';
import { StrategyBuilder } from '@/components/simulator/StrategyBuilder';
import { AdjustmentRuleEditor } from '@/components/simulator/AdjustmentRuleEditor';
import { BacktestChart } from '@/components/simulator/BacktestChart';
import { BacktestResults } from '@/components/simulator/BacktestResults';
import { GreeksChart } from '@/components/simulator/GreeksChart';

import { BacktestLeg, BacktestResult, runBacktest } from '@/lib/backtestEngine';
import { AdjustmentRule, StrategyPresetType } from '@/lib/adjustmentRules';
import { buildManualIVSurface, IVSurface } from '@/lib/ivSurface';
import { toast } from 'sonner';

export function Simulator() {
  const { isAdmin, signOut } = useAuth();
  const { theme, setTheme } = useTheme();

  const [priceData, setPriceData] = useState<{ date: string; close: number }[] | null>(null);
  const [ticker, setTicker] = useState('');
  const [ivPoints, setIVPoints] = useState<IVPoint[]>([]);
  const [riskFreeRate, setRiskFreeRate] = useState(0.045);

  const [legs, setLegs] = useState<BacktestLeg[]>([]);
  const [entryDate, setEntryDate] = useState('');
  const [strategyType, setStrategyType] = useState<StrategyPresetType>('iron_condor');
  const [adjustmentRules, setAdjustmentRules] = useState<AdjustmentRule[]>([]);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [configOpen, setConfigOpen] = useState(true);

  // Build IVSurface from manual curve
  const ivSurface: IVSurface = useMemo(
    () => buildManualIVSurface(ivPoints, riskFreeRate),
    [ivPoints, riskFreeRate]
  );

  const dateRange = useMemo(() => {
    if (!priceData || priceData.length === 0) return { from: '', to: '' };
    return { from: priceData[0].date, to: priceData[priceData.length - 1].date };
  }, [priceData]);

  const handleDataLoaded = useCallback((data: CsvPriceData) => {
    setPriceData(data.priceData);
    setTicker(data.ticker);
    setBacktestResult(null);
    // Generate monthly IV points from filtered date range
    if (data.priceData.length > 0) {
      setIVPoints(generateMonthlyPoints(data.priceData));
    }
  }, []);

  const handleLegsChange = useCallback((newLegs: BacktestLeg[], date: string) => {
    setLegs(newLegs);
    setEntryDate(date);
  }, []);

  const handleRunBacktest = useCallback(() => {
    if (!priceData || legs.length === 0) {
      toast.error('Configura prima dati e strategia');
      return;
    }

    setRunning(true);
    const entryIdx = priceData.findIndex(p => p.date >= entryDate);
    const filteredPriceData = entryIdx >= 0 ? priceData.slice(entryIdx) : priceData;

    setTimeout(() => {
      try {
        const result = runBacktest({
          legs,
          priceData: filteredPriceData,
          ivSurface,
          riskFreeRate,
          adjustmentRules,
        });
        setBacktestResult(result);
        setConfigOpen(false);
        toast.success(`Backtest completato: ${result.days.length} giorni simulati`);
      } catch (err) {
        console.error('Backtest error:', err);
        toast.error(`Errore: ${err instanceof Error ? err.message : 'Errore sconosciuto'}`);
      } finally {
        setRunning(false);
      }
    }, 50);
  }, [priceData, legs, entryDate, adjustmentRules, ivSurface, riskFreeRate]);

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Accesso riservato agli admin.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/50 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <IronCondorIcon size={24} className="text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Simulatore Backtest</h1>
                {priceData && (
                  <p className="text-xs text-muted-foreground">
                    {ticker} • {priceData.length} giorni
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/"><ArrowLeft className="w-4 h-4 mr-2" />Dashboard</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/derivatives"><ShieldAlert className="w-4 h-4 mr-2" />Derivati</Link>
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        <Collapsible open={configOpen} onOpenChange={setConfigOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between text-left">
              <span className="font-semibold">Configurazione</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${configOpen ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 mt-2">
            <TickerSelector onDataLoaded={handleDataLoaded} />

            {priceData && (
              <>
                <IVCurveEditor
                  priceData={priceData}
                  ivPoints={ivPoints}
                  riskFreeRate={riskFreeRate}
                  onIVPointsChange={setIVPoints}
                  onRiskFreeRateChange={setRiskFreeRate}
                />

                <StrategyBuilder
                  priceData={priceData}
                  ivSurface={ivSurface}
                  riskFreeRate={riskFreeRate}
                  dateRange={dateRange}
                  onLegsChange={handleLegsChange}
                  onStrategyTypeChange={setStrategyType}
                />

                <AdjustmentRuleEditor
                  rules={adjustmentRules}
                  onRulesChange={setAdjustmentRules}
                  strategyType={strategyType}
                />
              </>
            )}
          </CollapsibleContent>
        </Collapsible>

        {priceData && legs.length > 0 && (
          <div className="flex justify-center">
            <Button size="lg" onClick={handleRunBacktest} disabled={running} className="px-12">
              {running ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Play className="w-5 h-5 mr-2" />}
              Esegui Backtest
            </Button>
          </div>
        )}

        {backtestResult && (
          <div className="space-y-6">
            <BacktestResults result={backtestResult} />
            <BacktestChart days={backtestResult.days} adjustmentLog={backtestResult.adjustmentLog} />
            <GreeksChart days={backtestResult.days} />
          </div>
        )}
      </main>
    </div>
  );
}

export default Simulator;
