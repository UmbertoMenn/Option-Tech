import { useState } from 'react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { Plus, Trash2, Save, ChevronDown, ChevronUp, Pencil, X } from 'lucide-react';
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
  currentNettingExCCNP: number;
  currentEquityExposurePct: number; // 0-1
  currentUsdExposurePct: number;    // 0-1
}

export function HistoricalDataForm({
  historicalData,
  onSave,
  onDelete,
  isLoading,
  currentTotalValue,
  currentNettingTotal,
  currentNettingExCC,
  currentNettingExCCNP,
  currentEquityExposurePct,
  currentUsdExposurePct,
}: HistoricalDataFormProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Form state for new/edit
  const [formDate, setFormDate] = useState<Date | undefined>(undefined);
  const [formTotalValue, setFormTotalValue] = useState('');
  const [formNettingTotal, setFormNettingTotal] = useState('');
  const [formNettingExCC, setFormNettingExCC] = useState('');
  const [formNettingExCCNP, setFormNettingExCCNP] = useState('');
  const [formEquityExposure, setFormEquityExposure] = useState(''); // 0-100 user input
  const [formUsdExposure, setFormUsdExposure] = useState(''); // 0-100 user input

  const parseValue = (val: string) => {
    return parseFloat(val.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
  };

  const resetForm = () => {
    setFormDate(undefined);
    setFormTotalValue('');
    setFormNettingTotal('');
    setFormNettingExCC('');
    setFormNettingExCCNP('');
    setFormEquityExposure('');
    setFormUsdExposure('');
    setIsAddingNew(false);
    setEditingId(null);
  };

  const handleSave = () => {
    if (!formDate) return;
    
    // Parse equity exposure: user inputs 0-100, we save as 0-1
    let equityPct = parseValue(formEquityExposure);
    equityPct = Math.max(0, Math.min(100, equityPct)); // Clamp 0-100
    equityPct = equityPct / 100; // Convert to 0-1
    
    // Parse USD exposure: user inputs 0-100, we save as 0-1
    let usdPct = parseValue(formUsdExposure);
    usdPct = Math.max(0, Math.min(100, usdPct)); // Clamp 0-100
    usdPct = usdPct / 100; // Convert to 0-1
    
    onSave({
      snapshot_date: format(formDate, 'yyyy-MM-dd'),
      total_value: parseValue(formTotalValue),
      netting_total: parseValue(formNettingTotal),
      netting_ex_cc: parseValue(formNettingExCC),
      netting_ex_cc_np: parseValue(formNettingExCCNP),
      deposits: 0,
      average_balance: 0,
      equity_exposure_pct: equityPct,
      usd_exposure_pct: usdPct,
    });
    
    resetForm();
  };

  const startEdit = (entry: HistoricalDataEntry) => {
    setEditingId(entry.id);
    setFormDate(new Date(entry.snapshot_date));
    setFormTotalValue(entry.total_value.toString());
    setFormNettingTotal(entry.netting_total.toString());
    setFormNettingExCC(entry.netting_ex_cc.toString());
    setFormNettingExCCNP((entry.netting_ex_cc_np ?? 0).toString());
    // Convert 0-1 to 0-100 for display
    const equityPct = entry.equity_exposure_pct ?? 0.6;
    setFormEquityExposure((equityPct * 100).toFixed(1));
    const usdPct = entry.usd_exposure_pct ?? 0.8;
    setFormUsdExposure((usdPct * 100).toFixed(1));
    setIsAddingNew(false);
  };

  const startAddNew = () => {
    resetForm();
    setIsAddingNew(true);
  };

  const useCurrent = () => {
    setFormTotalValue(currentTotalValue.toString());
    setFormNettingTotal(currentNettingTotal.toString());
    setFormNettingExCC(currentNettingExCC.toString());
    setFormNettingExCCNP(currentNettingExCCNP.toString());
    // Convert 0-1 to 0-100 for display
    setFormEquityExposure((currentEquityExposurePct * 100).toFixed(1));
    setFormUsdExposure((currentUsdExposurePct * 100).toFixed(1));
  };

  const isEditing = editingId !== null || isAddingNew;

  // Render form fields (reused for both new and edit modes)
  const renderFormFields = () => (
    <>
      <div className="space-y-2">
        <Label className="text-xs">Data</Label>
        <DateInput
          value={formDate}
          onChange={(date) => setFormDate(date)}
          disabled={(d) => d > new Date()}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Patrimonio Totale ($)</Label>
        <Input
          type="text"
          placeholder="es. 100.000"
          value={formTotalValue}
          onChange={(e) => setFormTotalValue(e.target.value)}
          className="font-mono text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Netting Totale ($)</Label>
          <Input
            type="text"
            placeholder="es. 95.000"
            value={formNettingTotal}
            onChange={(e) => setFormNettingTotal(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Netting ex. Covered Call ($)</Label>
          <Input
            type="text"
            placeholder="es. 98.000"
            value={formNettingExCC}
            onChange={(e) => setFormNettingExCC(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Netting ex. CC e NP ($)</Label>
        <Input
          type="text"
          placeholder="es. 99.000"
          value={formNettingExCCNP}
          onChange={(e) => setFormNettingExCCNP(e.target.value)}
          className="font-mono text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Equity Exposure (%)</Label>
          <Input
            type="text"
            placeholder="es. 65"
            value={formEquityExposure}
            onChange={(e) => setFormEquityExposure(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">USD Exposure (%)</Label>
          <Input
            type="text"
            placeholder="es. 80"
            value={formUsdExposure}
            onChange={(e) => setFormUsdExposure(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
      </div>
    </>
  );

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
                    className={cn(
                      "p-3 rounded-md bg-muted/30 border border-border/50 text-sm",
                      editingId === entry.id && "ring-2 ring-primary"
                    )}
                  >
                    {editingId === entry.id ? (
                      // Edit mode for this entry
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">Modifica dato</p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={resetForm}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>

                        {renderFormFields()}

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
                            disabled={!formDate || !formTotalValue || isLoading}
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
                            {format(new Date(entry.snapshot_date), 'dd MMMM yyyy', { locale: it })}
                          </p>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>Patrimonio: <span className="font-mono text-foreground">{formatCurrency(entry.total_value)}</span></span>
                            <span>Netting Tot: <span className="font-mono text-foreground">{formatCurrency(entry.netting_total)}</span></span>
                            <span>Netting ex. CC: <span className="font-mono text-foreground">{formatCurrency(entry.netting_ex_cc)}</span></span>
                            <span>Netting ex. CC e NP: <span className="font-mono text-foreground">{formatCurrency(entry.netting_ex_cc_np ?? 0)}</span></span>
                            <span>Equity Exp.: <span className="font-mono text-foreground">{((entry.equity_exposure_pct ?? 0.6) * 100).toFixed(0)}%</span></span>
                            <span>USD Exp.: <span className="font-mono text-foreground">{((entry.usd_exposure_pct ?? 0.8) * 100).toFixed(0)}%</span></span>
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
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Nuovo dato storico</p>
                <Button variant="outline" size="sm" onClick={useCurrent}>
                  Usa valori attuali
                </Button>
              </div>

              {renderFormFields()}

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
                  disabled={!formDate || !formTotalValue || isLoading}
                  className="flex-1"
                >
                  <Save className="w-4 h-4 mr-1" />
                  Salva
                </Button>
              </div>
            </div>
          ) : (
            <div className="pt-2 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={startAddNew}
                disabled={editingId !== null}
                className="w-full"
              >
                <Plus className="w-4 h-4 mr-1" />
                Aggiungi dato storico
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
