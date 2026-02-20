import { useState, useCallback, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, FileText, CheckCircle2 } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { DateInput } from '@/components/ui/date-input';

export interface CsvPriceData {
  ticker: string;
  priceData: { date: string; close: number }[];
}

interface TickerSelectorProps {
  onDataLoaded: (data: CsvPriceData) => void;
}

function detectSeparator(header: string): string {
  if (header.includes('\t')) return '\t';
  if (header.includes(';')) return ';';
  return ',';
}

function findColumn(headers: string[], patterns: string[]): number {
  for (const pat of patterns) {
    const idx = headers.findIndex(h => h.toLowerCase().trim().includes(pat.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseDate(dateStr: string, timeStr?: string): string | null {
  let combined = dateStr.trim();
  if (timeStr) combined += ' ' + timeStr.trim();

  const d = new Date(combined);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  const m = combined.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (m) {
    const d2 = new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
    if (!isNaN(d2.getTime())) return d2.toISOString().slice(0, 10);
  }

  return null;
}

function parseCsvContent(text: string): { date: string; close: number }[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('Il file deve avere almeno 2 righe (header + dati)');

  const sep = detectSeparator(lines[0]);
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^["']|["']$/g, ''));

  const dateIdx = findColumn(headers, ['datetime', 'date', 'time', 'data', 'timestamp']);
  const timeIdx = findColumn(headers, ['time', 'ora']);
  const closeIdx = findColumn(headers, ['close', 'chiusura', 'price', 'prezzo', 'last', 'ultimo', 'adj close']);

  if (dateIdx < 0) throw new Error(`Colonna data non trovata. Header: ${headers.join(', ')}`);
  if (closeIdx < 0) throw new Error(`Colonna prezzo non trovata. Header: ${headers.join(', ')}`);

  const rawRows: { date: string; close: number }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(c => c.trim().replace(/^["']|["']$/g, ''));
    if (cols.length <= Math.max(dateIdx, closeIdx)) continue;

    const dateStr = cols[dateIdx];
    const timeStr = timeIdx >= 0 && timeIdx !== dateIdx ? cols[timeIdx] : undefined;
    const parsedDate = parseDate(dateStr, timeStr);
    if (!parsedDate) continue;

    const closeVal = parseFloat(cols[closeIdx].replace(',', '.'));
    if (isNaN(closeVal) || closeVal <= 0) continue;

    rawRows.push({ date: parsedDate, close: closeVal });
  }

  if (rawRows.length === 0) throw new Error('Nessuna riga valida trovata nel file');

  const byDay = new Map<string, number>();
  for (const row of rawRows) {
    byDay.set(row.date, row.close);
  }

  return Array.from(byDay.entries())
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function TickerSelector({ onDataLoaded }: TickerSelectorProps) {
  const [ticker, setTicker] = useState('');
  const [allData, setAllData] = useState<{ date: string; close: number }[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();

  // Date bounds from CSV
  const csvBounds = useMemo(() => {
    if (!allData || allData.length === 0) return null;
    return {
      min: new Date(allData[0].date + 'T00:00:00'),
      max: new Date(allData[allData.length - 1].date + 'T00:00:00'),
    };
  }, [allData]);

  // Filter data and emit when dates or ticker change
  const filteredData = useMemo(() => {
    if (!allData) return null;
    const startStr = startDate ? startDate.toISOString().slice(0, 10) : allData[0].date;
    const endStr = endDate ? endDate.toISOString().slice(0, 10) : allData[allData.length - 1].date;
    return allData.filter(d => d.date >= startStr && d.date <= endStr);
  }, [allData, startDate, endDate]);

  // Emit filtered data when it changes
  useEffect(() => {
    if (filteredData && filteredData.length > 0 && ticker) {
      onDataLoaded({ ticker: ticker.toUpperCase(), priceData: filteredData });
    }
  }, [filteredData, ticker, onDataLoaded]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = parseCsvContent(text);
        setAllData(data);

        // Auto-set dates to full range
        setStartDate(new Date(data[0].date + 'T00:00:00'));
        setEndDate(new Date(data[data.length - 1].date + 'T00:00:00'));

        toast.success(`${data.length} giorni caricati (${data[0].date} → ${data[data.length - 1].date})`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Errore nel parsing del file');
        setAllData(null);
      }
    };
    reader.readAsText(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.txt'] },
    maxFiles: 1,
  });

  const handleTickerChange = useCallback((val: string) => {
    setTicker(val.toUpperCase());
  }, []);

  const disabledDates = useCallback((date: Date) => {
    if (!csvBounds) return true;
    return date < csvBounds.min || date > csvBounds.max;
  }, [csvBounds]);

  const miniChartData = useMemo(() => {
    if (!filteredData) return [];
    const step = Math.max(1, Math.floor(filteredData.length / 60));
    return filteredData.filter((_, i) => i % step === 0);
  }, [filteredData]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dati di Mercato</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div className="space-y-1.5">
            <Label>Ticker</Label>
            <Input
              value={ticker}
              onChange={e => handleTickerChange(e.target.value)}
              placeholder="PLTR"
            />
          </div>

          <div className="sm:col-span-2">
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
                ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'}
                ${allData ? 'border-primary/50 bg-primary/5' : ''}`}
            >
              <input {...getInputProps()} />
              {allData ? (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  <span className="text-muted-foreground">
                    <strong>{fileName}</strong> — {allData.length} giorni ({allData[0].date} → {allData[allData.length - 1].date})
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  {isDragActive ? (
                    <><Upload className="w-4 h-4" /> Rilascia il file</>
                  ) : (
                    <><FileText className="w-4 h-4" /> Trascina un file CSV/TXT o clicca per selezionare</>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {allData && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Data Inizio</Label>
              <DateInput
                value={startDate}
                onChange={(d) => {
                  if (d) setStartDate(d);
                }}
                disabled={disabledDates}
                placeholder="GG/MM/AAAA"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data Fine</Label>
              <DateInput
                value={endDate}
                onChange={(d) => {
                  if (d) setEndDate(d);
                }}
                disabled={disabledDates}
                placeholder="GG/MM/AAAA"
              />
            </div>
          </div>
        )}

        {filteredData && miniChartData.length > 0 && (
          <div className="h-16">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={miniChartData}>
                <YAxis domain={['dataMin', 'dataMax']} hide />
                <Line type="monotone" dataKey="close" stroke="hsl(var(--primary))" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
