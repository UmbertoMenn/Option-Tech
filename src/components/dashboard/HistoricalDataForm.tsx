import { useState } from 'react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { Plus, Trash2, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { formatCurrency } from '@/lib/formatters';
import { HistoricalDataEntry, HistoricalDataInput } from '@/types/historicalData';
import { cn } from '@/lib/utils';

interface HistoricalDataFormProps {
  historicalData: HistoricalDataEntry[];
  onSave: (data: HistoricalDataInput) => void;
  onDelete: (id: string) => void;
  isLoading?: boolean;
  currentTotalValue: number;
  currentNettingTotal: number;
  currentNettingExCC: number;
}

export function HistoricalDataForm({
  historicalData,
  onSave,
  onDelete,
  isLoading,
  currentTotalValue,
  currentNettingTotal,
  currentNettingExCC,
}: HistoricalDataFormProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newEntryDate, setNewEntryDate] = useState<Date | undefined>(undefined);
  const [newEntryTotalValue, setNewEntryTotalValue] = useState('');
  const [newEntryNettingTotal, setNewEntryNettingTotal] = useState('');
  const [newEntryNettingExCC, setNewEntryNettingExCC] = useState('');

  const parseValue = (val: string) => {
    return parseFloat(val.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
  };

  const handleSave = () => {
    if (!newEntryDate) return;
    
    onSave({
      snapshot_date: format(newEntryDate, 'yyyy-MM-dd'),
      total_value: parseValue(newEntryTotalValue),
      netting_total: parseValue(newEntryNettingTotal),
      netting_ex_cc: parseValue(newEntryNettingExCC),
      deposits: 0,
      average_balance: 0,
    });
    
    setNewEntryDate(undefined);
    setNewEntryTotalValue('');
    setNewEntryNettingTotal('');
    setNewEntryNettingExCC('');
    setIsAddingNew(false);
  };

  const useCurrent = () => {
    setNewEntryTotalValue(currentTotalValue.toString());
    setNewEntryNettingTotal(currentNettingTotal.toString());
    setNewEntryNettingExCC(currentNettingExCC.toString());
  };

  return (
    <div className="p-4 rounded-lg bg-background-secondary border border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <h3 className="font-semibold">Dati Storici</h3>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          {/* Existing entries */}
          {historicalData.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Dati salvati</p>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {historicalData.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3 rounded-md bg-muted/30 border border-border/50 text-sm"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <p className="font-medium">
                          {format(new Date(entry.snapshot_date), 'dd MMMM yyyy', { locale: it })}
                        </p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Patrimonio: <span className="font-mono text-foreground">{formatCurrency(entry.total_value)}</span></span>
                          <span>Netting Tot: <span className="font-mono text-foreground">{formatCurrency(entry.netting_total)}</span></span>
                          <span className="col-span-2">Netting ex CC: <span className="font-mono text-foreground">{formatCurrency(entry.netting_ex_cc)}</span></span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => onDelete(entry.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add new entry form */}
          {isAddingNew ? (
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Nuovo dato storico</p>
                <Button variant="outline" size="sm" onClick={useCurrent}>
                  Usa valori attuali
                </Button>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Data</Label>
                <DateInput
                  value={newEntryDate}
                  onChange={(date) => setNewEntryDate(date)}
                  disabled={(d) => d > new Date()}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Patrimonio Totale ($)</Label>
                  <Input
                    type="text"
                    placeholder="es. 100.000"
                    value={newEntryTotalValue}
                    onChange={(e) => setNewEntryTotalValue(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Netting Totale ($)</Label>
                  <Input
                    type="text"
                    placeholder="es. 95.000"
                    value={newEntryNettingTotal}
                    onChange={(e) => setNewEntryNettingTotal(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Netting ex CC ($)</Label>
                  <Input
                    type="text"
                    placeholder="es. 98.000"
                    value={newEntryNettingExCC}
                    onChange={(e) => setNewEntryNettingExCC(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddingNew(false)}
                  className="flex-1"
                >
                  Annulla
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!newEntryDate || !newEntryTotalValue || isLoading}
                  className="flex-1"
                >
                  <Save className="w-4 h-4 mr-1" />
                  Salva
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAddingNew(true)}
              className="w-full"
            >
              <Plus className="w-4 h-4 mr-1" />
              Aggiungi dato storico
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
