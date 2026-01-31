import * as React from 'react';
import { format, parse, isValid } from 'date-fns';
import { it } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface DateInputProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  disabled?: (date: Date) => boolean;
  placeholder?: string;
  className?: string;
}

export function DateInput({ 
  value, 
  onChange, 
  disabled, 
  placeholder = 'GG/MM/AAAA',
  className 
}: DateInputProps) {
  const [inputValue, setInputValue] = React.useState(
    value ? format(value, 'dd/MM/yyyy') : ''
  );
  const [isCalendarOpen, setIsCalendarOpen] = React.useState(false);

  React.useEffect(() => {
    if (value) {
      setInputValue(format(value, 'dd/MM/yyyy'));
    }
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/[^\d/]/g, '');
    
    // Auto-add slashes
    if (val.length === 2 && inputValue.length < 2) {
      val += '/';
    } else if (val.length === 5 && inputValue.length < 5) {
      val += '/';
    }
    
    // Limit length
    if (val.length <= 10) {
      setInputValue(val);
    }
    
    // Try to parse the date
    if (val.length === 10) {
      const parsed = parse(val, 'dd/MM/yyyy', new Date());
      if (isValid(parsed)) {
        const isDisabled = disabled ? disabled(parsed) : false;
        if (!isDisabled) {
          onChange(parsed);
        }
      }
    }
  };

  const handleInputBlur = () => {
    if (inputValue.length > 0 && inputValue.length < 10) {
      // Invalid format, reset to last valid value
      setInputValue(value ? format(value, 'dd/MM/yyyy') : '');
    }
  };

  const handleCalendarSelect = (date: Date | undefined) => {
    onChange(date);
    if (date) {
      setInputValue(format(date, 'dd/MM/yyyy'));
    }
    setIsCalendarOpen(false);
  };

  return (
    <div className={cn("flex gap-2", className)}>
      <Input
        type="text"
        placeholder={placeholder}
        value={inputValue}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        className="font-mono flex-1"
      />
      <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon" className="shrink-0">
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={value}
            onSelect={handleCalendarSelect}
            disabled={disabled}
            initialFocus
            className="pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
