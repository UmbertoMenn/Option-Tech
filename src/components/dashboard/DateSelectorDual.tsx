import { useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { Calendar, ChevronDown, ArrowLeft, X } from 'lucide-react';
import { HistoricalDataEntry } from '@/types/historicalData';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DateSelectorDualProps {
  historicalData: HistoricalDataEntry[];
  selectedDate: string | null;
  onDateChange: (date: string | null) => void;
}

type ViewLevel = 'year' | 'month' | 'date';

export function DateSelectorDual({ historicalData, selectedDate, onDateChange }: DateSelectorDualProps) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<ViewLevel>('year');
  const [selectedYear, setSelectedYear] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('');

  // Group data by year → month → dates
  const grouped = useMemo(() => {
    const map: Record<string, Record<string, HistoricalDataEntry[]>> = {};
    for (const entry of historicalData) {
      const year = entry.snapshot_date.slice(0, 4);
      const month = entry.snapshot_date.slice(5, 7);
      if (!map[year]) map[year] = {};
      if (!map[year][month]) map[year][month] = [];
      map[year][month].push(entry);
    }
    return map;
  }, [historicalData]);

  const years = useMemo(() => Object.keys(grouped).sort((a, b) => b.localeCompare(a)), [grouped]);

  const monthsInYear = useMemo(() => {
    if (!selectedYear || !grouped[selectedYear]) return [];
    return Object.keys(grouped[selectedYear]).sort((a, b) => b.localeCompare(a));
  }, [grouped, selectedYear]);

  const datesInMonth = useMemo(() => {
    if (!selectedYear || !selectedMonth || !grouped[selectedYear]?.[selectedMonth]) return [];
    return grouped[selectedYear][selectedMonth].sort(
      (a, b) => b.snapshot_date.localeCompare(a.snapshot_date)
    );
  }, [grouped, selectedYear, selectedMonth]);

  const handleOpen = useCallback((isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      // Reset to year level on open
      setLevel('year');
      setSelectedYear('');
      setSelectedMonth('');
    }
  }, []);

  const handleYearClick = (year: string) => {
    setSelectedYear(year);
    setLevel('month');
  };

  const handleMonthClick = (month: string) => {
    setSelectedMonth(month);
    setLevel('date');
  };

  const handleDateClick = (date: string) => {
    onDateChange(date);
    setOpen(false);
  };

  const handleClear = () => {
    onDateChange(null);
    setOpen(false);
  };

  const handleBack = () => {
    if (level === 'date') setLevel('month');
    else if (level === 'month') setLevel('year');
  };

  if (historicalData.length === 0) return null;

  const triggerLabel = selectedDate
    ? format(new Date(selectedDate), 'dd/MM/yyyy')
    : 'Seleziona data';

  return (
    <div className="mt-2">
      <Popover open={open} onOpenChange={handleOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "w-full h-7 text-xs justify-between font-normal",
              !selectedDate && "text-muted-foreground"
            )}
          >
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3 shrink-0" />
              {triggerLabel}
            </span>
            <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1" align="start">
          {level !== 'year' && (
            <button
              onClick={handleBack}
              className="flex items-center gap-1 w-full px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-sm transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              Indietro
            </button>
          )}

          {level === 'year' && (
            <>
              {selectedDate && (
                <button
                  onClick={handleClear}
                  className="flex items-center gap-1 w-full px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-sm transition-colors"
                >
                  <X className="w-3 h-3" />
                  Nessuna
                </button>
              )}
              {years.map((year) => (
                <button
                  key={year}
                  onClick={() => handleYearClick(year)}
                  className="w-full px-2 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground rounded-sm transition-colors"
                >
                  {year}
                </button>
              ))}
            </>
          )}

          {level === 'month' && (
            <>
              {monthsInYear.map((month) => (
                <button
                  key={month}
                  onClick={() => handleMonthClick(month)}
                  className="w-full px-2 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground rounded-sm transition-colors capitalize"
                >
                  {format(new Date(Number(selectedYear), Number(month) - 1, 1), 'MMMM', { locale: it })}
                </button>
              ))}
            </>
          )}

          {level === 'date' && (
            <>
              <button
                onClick={handleClear}
                className="flex items-center gap-1 w-full px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-sm transition-colors"
              >
                <X className="w-3 h-3" />
                Nessuna
              </button>
              {datesInMonth.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => handleDateClick(entry.snapshot_date)}
                  className={cn(
                    "w-full px-2 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground rounded-sm transition-colors",
                    entry.snapshot_date === selectedDate && "bg-accent text-accent-foreground font-medium"
                  )}
                >
                  {format(new Date(entry.snapshot_date), 'dd/MM/yyyy')}
                </button>
              ))}
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
