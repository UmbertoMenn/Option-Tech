import { useState } from 'react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { Plus, Trash2, Save, ChevronDown, ChevronUp, Pencil, X, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { formatCurrency } from '@/lib/formatters';
import { DepositEntry, DepositInput } from '@/types/deposits';
import { cn } from '@/lib/utils';

interface DepositsSectionProps {
  deposits: DepositEntry[];
  totalDeposits: number;
  onSave: (data: DepositInput) => void;
  onDelete: (id: string) => void;
  isLoading?: boolean;
}

export function DepositsSection({
  deposits,
  totalDeposits,
  onSave,
  onDelete,
  isLoading,
}: DepositsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Form state
  const [formDate, setFormDate] = useState<Date | undefined>(undefined);
  const [formAmount, setFormAmount] = useState('');
  const [formDescription, setFormDescription] = useState('');

  const parseValue = (val: string) => {
    // Support Italian number formats:
    // - 5.000 -> 5000
    // - 5.000,50 -> 5000.50
    // - 5000,50 -> 5000.50
    // Also supports negatives.
    const cleaned = val
      .toString()
      .replace(/\s/g, '')
      .replace(/[^0-9.,-]/g, '');

    if (!cleaned) return 0;

    const normalized = cleaned.includes(',')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/\./g, '');

    const num = parseFloat(normalized);
    return Number.isFinite(num) ? num : 0;
  };

  const resetForm = () => {
    setFormDate(undefined);
    setFormAmount('');
    setFormDescription('');
    setIsAddingNew(false);
    setEditingId(null);
  };

  const handleSave = () => {
    if (!formDate) return;
    
    onSave({
      id: editingId || undefined,
      deposit_date: format(formDate, 'yyyy-MM-dd'),
      amount: parseValue(formAmount),
      description: formDescription || undefined,
    });
    
    resetForm();
  };

  const startEdit = (entry: DepositEntry) => {
    setEditingId(entry.id);
    setFormDate(new Date(entry.deposit_date));
    setFormAmount(entry.amount.toString());
    setFormDescription(entry.description || '');
    setIsAddingNew(false);
  };

  const startAddNew = () => {
    resetForm();
    setIsAddingNew(true);
  };

  const isEditing = editingId !== null || isAddingNew;

  return (
    <div className="p-4 rounded-lg bg-background-secondary border border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Versamenti</h3>
          {deposits.length > 0 && (
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {deposits.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {totalDeposits !== 0 && (
            <span className={cn(
              "text-sm font-mono font-medium",
              totalDeposits > 0 ? "text-success" : "text-destructive"
            )}>
              {formatCurrency(totalDeposits)}
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          {/* Existing entries */}
          {deposits.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Versamenti salvati</p>
              <div className="space-y-2 max-h-[250px] overflow-y-auto">
                {deposits.map((entry) => (
                  <div
                    key={entry.id}
                    className={cn(
                      "p-3 rounded-md bg-muted/30 border border-border/50 text-sm",
                      editingId === entry.id && "ring-2 ring-primary"
                    )}
                  >
                    {editingId === entry.id ? (
                      // Edit mode
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">Modifica versamento</p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={resetForm}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs">Data</Label>
                          <DateInput
                            value={formDate}
                            onChange={(date) => setFormDate(date)}
                            disabled={(d) => d > new Date()}
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Importo ($)</Label>
                          <Input
                            type="text"
                            placeholder="es. 5.000"
                            value={formAmount}
                            onChange={(e) => setFormAmount(e.target.value)}
                            className="font-mono text-sm"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Descrizione (opzionale)</Label>
                          <Input
                            type="text"
                            placeholder="es. Bonifico mensile"
                            value={formDescription}
                            onChange={(e) => setFormDescription(e.target.value)}
                            className="text-sm"
                          />
                        </div>

                        <div className="flex gap-2 pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={resetForm}
                            className="flex-1"
                          >
                            Annulla
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleSave}
                            disabled={!formDate || !formAmount || isLoading}
                            className="flex-1"
                          >
                            <Save className="w-4 h-4 mr-1" />
                            Salva
                          </Button>
                        </div>
                      </div>
                    ) : (
                      // Display mode
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <p className="font-medium">
                            {format(new Date(entry.deposit_date), 'dd MMMM yyyy', { locale: it })}
                          </p>
                          <div className="flex items-center gap-3 text-xs">
                            <span className={cn(
                              "font-mono font-medium",
                              entry.amount > 0 ? "text-success" : "text-destructive"
                            )}>
                              {entry.amount > 0 ? '+' : ''}{formatCurrency(entry.amount)}
                            </span>
                            {entry.description && (
                              <span className="text-muted-foreground">{entry.description}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => startEdit(entry)}
                            disabled={isEditing}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => onDelete(entry.id)}
                            disabled={isEditing}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add new entry form */}
          {isAddingNew ? (
            <div className="space-y-3 pt-2 border-t border-border">
              <p className="text-sm font-medium">Nuovo versamento</p>

              <div className="space-y-2">
                <Label className="text-xs">Data</Label>
                <DateInput
                  value={formDate}
                  onChange={(date) => setFormDate(date)}
                  disabled={(d) => d > new Date()}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Importo ($)</Label>
                <Input
                  type="text"
                  placeholder="es. 5.000 (negativo per prelievi)"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Descrizione (opzionale)</Label>
                <Input
                  type="text"
                  placeholder="es. Bonifico mensile"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="text-sm"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetForm}
                  className="flex-1"
                >
                  Annulla
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!formDate || !formAmount || isLoading}
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
              onClick={startAddNew}
              className="w-full"
              disabled={editingId !== null}
            >
              <Plus className="w-4 h-4 mr-1" />
              Aggiungi versamento
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
