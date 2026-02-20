import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Download, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { fetchStockBars, fetchOptionChain, StockBar, OptionSnapshotResult } from '@/lib/massiveApi';
import { buildIVSurface, snapshotToDataPoints, IVSurface } from '@/lib/ivSurface';
import { getMonthlyExpiries } from '@/lib/backtestEngine';
import { toast } from 'sonner';

export interface TickerData {
  ticker: string;
  priceData: { date: string; close: number }[];
  ivSurface: IVSurface;
  riskFreeRate: number;
  dateRange: { from: string; to: string };
}

interface TickerSelectorProps {
  onDataLoaded: (data: TickerData) => void;
}

export function TickerSelector({ onDataLoaded }: TickerSelectorProps) {
  const [ticker, setTicker] = useState('');
  const [fromDate, setFromDate] = useState<Date>();
  const [toDate, setToDate] = useState<Date>();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');

  const handleFetch = useCallback(async () => {
    if (!ticker || !fromDate || !toDate) {
      toast.error('Inserisci ticker e date');
      return;
    }

    const from = format(fromDate, 'yyyy-MM-dd');
    const to = format(toDate, 'yyyy-MM-dd');

    setLoading(true);
    setProgress(0);

    try {
      // Step 1: Fetch stock bars
      setProgressMsg('Scaricamento prezzi sottostante...');
      setProgress(10);
      const stockBars = await fetchStockBars(ticker.toUpperCase(), from, to);

      if (!stockBars || stockBars.length === 0) {
        toast.error('Nessun dato trovato per questo ticker/periodo');
        setLoading(false);
        return;
      }

      const priceData = (stockBars as StockBar[]).map(bar => ({
        date: format(new Date(bar.t), 'yyyy-MM-dd'),
        close: bar.c,
      }));

      const priceByDate = new Map(priceData.map(p => [p.date, p.close]));

      // Step 2: Get monthly expiries in the period
      const expiries = getMonthlyExpiries(from, to);
      setProgress(30);
      setProgressMsg(`Scaricamento catena opzioni per ${expiries.length} scadenze...`);

      // Step 3: Fetch option chains for each expiry
      const allSnapshots: OptionSnapshotResult[] = [];
      for (let i = 0; i < expiries.length; i++) {
        setProgressMsg(`Catena opzioni ${expiries[i]} (${i + 1}/${expiries.length})...`);
        setProgress(30 + (i / expiries.length) * 50);
        try {
          const chain = await fetchOptionChain(ticker.toUpperCase(), expiries[i]);
          if (chain) allSnapshots.push(...(chain as OptionSnapshotResult[]));
        } catch (err) {
          console.warn(`Errore catena ${expiries[i]}:`, err);
        }
      }

      // Step 4: Build IV surface
      setProgress(85);
      setProgressMsg('Calcolo superficie volatilità implicita...');
      const dataPoints = snapshotToDataPoints(allSnapshots);
      const ivSurface = buildIVSurface(dataPoints, priceByDate);

      setProgress(100);
      setProgressMsg('Completato!');

      const tickerData: TickerData = {
        ticker: ticker.toUpperCase(),
        priceData,
        ivSurface,
        riskFreeRate: ivSurface.riskFreeRate,
        dateRange: { from, to },
      };

      onDataLoaded(tickerData);
      toast.success(`Dati caricati: ${priceData.length} giorni, ${allSnapshots.length} contratti opzioni`);
    } catch (err) {
      console.error('Fetch error:', err);
      toast.error(`Errore: ${err instanceof Error ? err.message : 'Errore sconosciuto'}`);
    } finally {
      setLoading(false);
    }
  }, [ticker, fromDate, toDate, onDataLoaded]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dati di Mercato</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
          <div className="space-y-1.5">
            <Label>Ticker</Label>
            <Input
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              placeholder="PLTR"
              disabled={loading}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Da</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn('w-full justify-start text-left font-normal', !fromDate && 'text-muted-foreground')} disabled={loading}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {fromDate ? format(fromDate, 'dd/MM/yyyy') : 'Seleziona'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={fromDate} onSelect={setFromDate} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label>A</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn('w-full justify-start text-left font-normal', !toDate && 'text-muted-foreground')} disabled={loading}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {toDate ? format(toDate, 'dd/MM/yyyy') : 'Seleziona'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={toDate} onSelect={setToDate} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>

          <Button onClick={handleFetch} disabled={loading || !ticker}>
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Carica Dati
          </Button>
        </div>

        {loading && (
          <div className="space-y-2">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground">{progressMsg}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
