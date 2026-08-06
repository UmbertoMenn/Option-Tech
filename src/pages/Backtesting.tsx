import { useState } from 'react';
import { BarChart3, Database, Loader2, RefreshCw } from 'lucide-react';
import { AppHeaderMenu } from '@/components/layout/AppHeaderMenu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { ShortPutBacktestPanel } from '@/components/backtesting/ShortPutBacktestPanel';
import { checkThetaDataHealth } from '@/lib/backtesting/thetaDataClient';
import { STRATEGY_CATALOG } from '@/lib/backtesting/strategyCatalog';
import { BacktestStrategyId, ThetaDataHealth } from '@/lib/backtesting/types';
import { toast } from 'sonner';

/** Strategie con motore eseguibile. Le altre restano solo nel selettore. */
const IMPLEMENTED: BacktestStrategyId[] = ['cash_secured_put'];

export default function Backtesting() {
  const { isAdmin } = useAuth();
  const [strategyId, setStrategyId] = useState<BacktestStrategyId>('cash_secured_put');
  const [health, setHealth] = useState<ThetaDataHealth | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const handleHealthCheck = async () => {
    setCheckingHealth(true);
    try {
      const result = await checkThetaDataHealth();
      setHealth(result);
      toast[result.connected ? 'success' : 'error'](result.connected ? 'ThetaData collegato' : result.message || 'ThetaData non raggiungibile');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Verifica non riuscita';
      setHealth({ connected: false, message, provider: 'thetadata', apiVersion: 'v3', baseUrlConfigured: false });
      toast.error(message);
    } finally {
      setCheckingHealth(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Alert className="max-w-md">
          <AlertTitle>Accesso riservato</AlertTitle>
          <AlertDescription>Il backtesting è disponibile solo agli admin.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const isImplemented = IMPLEMENTED.includes(strategyId);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <BarChart3 className="w-5 h-5 text-primary shrink-0" />
            <h1 className="text-base font-bold shrink-0">Backtesting</h1>
            <Select value={strategyId} onValueChange={(v) => setStrategyId(v as BacktestStrategyId)}>
              <SelectTrigger className="h-8 w-[260px] ml-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STRATEGY_CATALOG.map((s) => (
                  <SelectItem key={s.id} value={s.id} disabled={!IMPLEMENTED.includes(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={handleHealthCheck}
              disabled={checkingHealth}
              title="Verifica collegamento ThetaData"
            >
              {checkingHealth ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className={`w-3.5 h-3.5 ${health?.connected ? 'text-emerald-500' : 'text-muted-foreground'}`} />}
              <span className="hidden sm:inline">{health?.connected ? 'ThetaData ok' : 'ThetaData'}</span>
              <RefreshCw className="w-3 h-3 opacity-50" />
            </Button>
            <AppHeaderMenu includePortfolioSelector={false} />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-5">
        {isImplemented ? (
          <ShortPutBacktestPanel />
        ) : (
          <Alert className="max-w-xl">
            <AlertTitle>Motore non ancora implementato</AlertTitle>
            <AlertDescription>Per questa strategia il motore non è disponibile. Al momento è eseguibile la vendita PUT OTM mensile.</AlertDescription>
          </Alert>
        )}
      </main>
    </div>
  );
}
