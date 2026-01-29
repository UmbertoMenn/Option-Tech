import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { CalendarIcon, Save, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';

interface InitialValueFormProps {
  initialValue: number | null;
  initialDate: string | null;
  deposits: number | null;
  averageBalance: number | null;
  averageBalanceDate: string | null;
  onSave: (data: { 
    initialValue: number; 
    initialDate: string; 
    deposits: number; 
    averageBalance: number;
    averageBalanceDate: string;
  }) => void;
  isLoading?: boolean;
}

export function InitialValueForm({ 
  initialValue, 
  initialDate,
  deposits,
  averageBalance,
  averageBalanceDate,
  onSave, 
  isLoading 
}: InitialValueFormProps) {
  const hasData = initialValue !== null && initialValue > 0;
  const [isEditing, setIsEditing] = useState(!hasData);
  const [value, setValue] = useState<string>(initialValue?.toString() || '');
  const [depositsValue, setDepositsValue] = useState<string>(deposits?.toString() || '0');
  const [avgBalanceValue, setAvgBalanceValue] = useState<string>(averageBalance?.toString() || '0');
  const [date, setDate] = useState<Date | undefined>(
    initialDate ? new Date(initialDate) : undefined
  );
  const [avgBalanceEndDate, setAvgBalanceEndDate] = useState<Date | undefined>(
    averageBalanceDate ? new Date(averageBalanceDate) : undefined
  );

  // Calculate the sum of initial value + deposits
  const parsedInitialValue = parseFloat(value.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
  const parsedDeposits = parseFloat(depositsValue.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
  const totalInitialPlusDeposits = parsedInitialValue + parsedDeposits;

  useEffect(() => {
    setValue(initialValue?.toString() || '');
    setDepositsValue(deposits?.toString() || '0');
    setAvgBalanceValue(averageBalance?.toString() || '0');
    setDate(initialDate ? new Date(initialDate) : undefined);
    setAvgBalanceEndDate(averageBalanceDate ? new Date(averageBalanceDate) : undefined);
  }, [initialValue, deposits, averageBalance, initialDate, averageBalanceDate]);

  const handleSave = () => {
    const numValue = parseFloat(value.replace(/[^\d.,]/g, '').replace(',', '.'));
    const numDeposits = parseFloat(depositsValue.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
    const numAvgBalance = parseFloat(avgBalanceValue.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
    
    if (!isNaN(numValue) && numValue > 0 && date && avgBalanceEndDate) {
      onSave({
        initialValue: numValue,
        initialDate: format(date, 'yyyy-MM-dd'),
        deposits: numDeposits,
        averageBalance: numAvgBalance,
        averageBalanceDate: format(avgBalanceEndDate, 'yyyy-MM-dd'),
      });
      setIsEditing(false);
    }
  };

  if (!isEditing && hasData && initialDate) {
    const savedTotal = (initialValue || 0) + (deposits || 0);
    return (
      <div className="p-4 rounded-lg bg-background-secondary border border-border space-y-3">
        <div className="flex items-start justify-between">
          <div className="space-y-3 flex-1">
            <div>
              <p className="text-xs text-muted-foreground">Patrimonio Iniziale</p>
              <p className="text-lg font-bold font-mono">{formatCurrency(initialValue || 0)}</p>
              <p className="text-xs text-muted-foreground">
                al {format(new Date(initialDate), 'dd MMMM yyyy', { locale: it })}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Versamenti</p>
              <p className="text-lg font-bold font-mono">{formatCurrency(deposits || 0)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Patrimonio Iniziale + Versamenti</p>
              <p className="text-lg font-bold font-mono text-primary">{formatCurrency(savedTotal)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Giacenza Media</p>
              <p className="text-lg font-bold font-mono">{formatCurrency(averageBalance || 0)}</p>
              {initialDate && averageBalanceDate && (
                <p className="text-xs text-muted-foreground">
                  dal {format(new Date(initialDate), 'dd/MM/yyyy')} al {format(new Date(averageBalanceDate), 'dd/MM/yyyy')}
                </p>
              )}
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setIsEditing(true)}
          >
            <Edit2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 rounded-lg bg-background-secondary border border-border">
      <div className="space-y-2">
        <Label htmlFor="initial-value">Patrimonio Iniziale (€)</Label>
        <Input
          id="initial-value"
          type="text"
          placeholder="es. 100.000"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="font-mono"
        />
      </div>

      <div className="space-y-2">
        <Label>Data Patrimonio Iniziale</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !date && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {date ? format(date, "dd MMMM yyyy", { locale: it }) : "Seleziona data"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={date}
              onSelect={setDate}
              disabled={(d) => d > new Date()}
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-2">
        <Label htmlFor="deposits">Versamenti (€)</Label>
        <Input
          id="deposits"
          type="text"
          placeholder="es. 10.000"
          value={depositsValue}
          onChange={(e) => setDepositsValue(e.target.value)}
          className="font-mono"
        />
      </div>

      <div className="space-y-2">
        <Label>Patrimonio Iniziale + Versamenti</Label>
        <div className="p-3 rounded-md bg-muted/50 border border-border">
          <p className="text-lg font-bold font-mono text-primary">
            {formatCurrency(totalInitialPlusDeposits)}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="avg-balance">Giacenza Media (€)</Label>
        <Input
          id="avg-balance"
          type="text"
          placeholder="es. 80.000"
          value={avgBalanceValue}
          onChange={(e) => setAvgBalanceValue(e.target.value)}
          className="font-mono"
        />
      </div>

      <div className="space-y-2">
        <Label>Data Giacenza Media</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !avgBalanceEndDate && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {avgBalanceEndDate ? format(avgBalanceEndDate, "dd MMMM yyyy", { locale: it }) : "Seleziona data"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={avgBalanceEndDate}
              onSelect={setAvgBalanceEndDate}
              disabled={(d) => d > new Date() || (date && d < date)}
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>

      <Button 
        onClick={handleSave} 
        disabled={!value || !date || !avgBalanceEndDate || isLoading}
        className="w-full"
      >
        <Save className="w-4 h-4 mr-2" />
        Salva
      </Button>
    </div>
  );
}
