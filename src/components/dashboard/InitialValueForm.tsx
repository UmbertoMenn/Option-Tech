import { useState } from 'react';
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
  onSave: (value: number, date: string) => void;
  isLoading?: boolean;
}

export function InitialValueForm({ 
  initialValue, 
  initialDate, 
  onSave, 
  isLoading 
}: InitialValueFormProps) {
  const [isEditing, setIsEditing] = useState(!initialValue);
  const [value, setValue] = useState<string>(initialValue?.toString() || '');
  const [date, setDate] = useState<Date | undefined>(
    initialDate ? new Date(initialDate) : undefined
  );

  const handleSave = () => {
    const numValue = parseFloat(value.replace(/[^\d.,]/g, '').replace(',', '.'));
    if (!isNaN(numValue) && numValue > 0 && date) {
      onSave(numValue, format(date, 'yyyy-MM-dd'));
      setIsEditing(false);
    }
  };

  if (!isEditing && initialValue && initialDate) {
    return (
      <div className="flex items-center justify-between p-4 rounded-lg bg-background-secondary border border-border">
        <div>
          <p className="text-xs text-muted-foreground">Patrimonio Iniziale</p>
          <p className="text-lg font-bold font-mono">{formatCurrency(initialValue)}</p>
          <p className="text-xs text-muted-foreground">
            al {format(new Date(initialDate), 'dd MMMM yyyy', { locale: it })}
          </p>
        </div>
        <Button 
          variant="ghost" 
          size="icon"
          onClick={() => setIsEditing(true)}
        >
          <Edit2 className="w-4 h-4" />
        </Button>
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
        <Label>Data Riferimento</Label>
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

      <Button 
        onClick={handleSave} 
        disabled={!value || !date || isLoading}
        className="w-full"
      >
        <Save className="w-4 h-4 mr-2" />
        Salva
      </Button>
    </div>
  );
}
