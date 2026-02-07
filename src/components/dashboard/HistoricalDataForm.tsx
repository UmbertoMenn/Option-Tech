import { useState, useCallback } from 'react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { Plus, Trash2, Save, ChevronDown, ChevronUp, Pencil, X, Upload, FileSpreadsheet } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { formatCurrency } from '@/lib/formatters';
import { HistoricalDataEntry, HistoricalDataInput } from '@/types/historicalData';
import { cn } from '@/lib/utils';
import { parsePortfolioExcel } from '@/lib/excelParser';
import { calculateNettingFromPositions } from '@/lib/historicalNettingCalculator';

interface HistoricalDataFormProps {
  historicalData: HistoricalDataEntry[];
  onSave: (data: HistoricalDataInput) => void;
  onDelete: (id: string) => void;
  isLoading?: boolean;
  currentTotalValue: number;
  currentNettingTotal: number;
  currentNettingExCC: number;
  currentNettingExCCNP: number;
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
}: HistoricalDataFormProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  
  // Form state for new/edit
  const [formDate, setFormDate] = useState<Date | undefined>(undefined);
  const [formTotalValue, setFormTotalValue] = useState('');
  const [formNettingTotal, setFormNettingTotal] = useState('');
  const [formNettingExCC, setFormNettingExCC] = useState('');
  const [formNettingExCCNP, setFormNettingExCCNP] = useState('');

  const parseValue = (val: string) => {
    return parseFloat(val.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
  };

  const resetForm = () => {
    setFormDate(undefined);
    setFormTotalValue('');
    setFormNettingTotal('');
    setFormNettingExCC('');
    setFormNettingExCCNP('');
    setIsAddingNew(false);
    setEditingId(null);
  };

  // Handle Excel file upload
  const handleExcelUpload = useCallback(async (file: File) => {
    setIsProcessingFile(true);
    
    try {
      // Parse the Excel file
      const { positions, cashValue, snapshotDate } = await parsePortfolioExcel(file);
      
      if (!snapshotDate) {
        toast.error('Data non trovata nel file', {
          description: 'Il file Excel deve contenere una data di snapshot (cella C4 o pattern "POSIZIONE AL")',
        });
        return;
      }
      
      // Calculate netting values from positions
      const nettingResult = calculateNettingFromPositions(positions, cashValue);
      
      // Save the historical data
      onSave({
        snapshot_date: snapshotDate,
        total_value: nettingResult.totalValue,
        netting_total: nettingResult.nettingTotal,
        netting_ex_cc: nettingResult.nettingExCC,
        netting_ex_cc_np: nettingResult.nettingExCCNP,
        deposits: 0,
        average_balance: 0,
      });
      
      toast.success('Dati storici importati!', {
        description: `Data: ${format(new Date(snapshotDate), 'dd MMMM yyyy', { locale: it })} - Patrimonio: ${formatCurrency(nettingResult.totalValue)}`,
      });
      
    } catch (error) {
      console.error('Error parsing Excel:', error);
      toast.error('Errore nel parsing del file', {
        description: error instanceof Error ? error.message : 'Errore sconosciuto',
      });
    } finally {
      setIsProcessingFile(false);
    }
  }, [onSave]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      handleExcelUpload(acceptedFiles[0]);
    }
  }, [handleExcelUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    multiple: false,
    disabled: isProcessingFile,
  });

  const handleSave = () => {
    if (!formDate) return;
    
    onSave({
      snapshot_date: format(formDate, 'yyyy-MM-dd'),
      total_value: parseValue(formTotalValue),
      netting_total: parseValue(formNettingTotal),
      netting_ex_cc: parseValue(formNettingExCC),
      netting_ex_cc_np: parseValue(formNettingExCCNP),
      deposits: 0,
      average_balance: 0,
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
  };

  const isEditing = editingId !== null || isAddingNew;

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
                          <Label className="text-xs">Netting ex. Covered Call e NP ($)</Label>
                          <Input
                            type="text"
                            placeholder="es. 99.000"
                            value={formNettingExCCNP}
                            onChange={(e) => setFormNettingExCCNP(e.target.value)}
                            className="font-mono text-sm"
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
                <Label className="text-xs">Netting ex. Covered Call e NP ($)</Label>
                <Input
                  type="text"
                  placeholder="es. 99.000"
                  value={formNettingExCCNP}
                  onChange={(e) => setFormNettingExCCNP(e.target.value)}
                  className="font-mono text-sm"
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
                  disabled={!formDate || !formTotalValue || isLoading}
                  className="flex-1"
                >
                  <Save className="w-4 h-4 mr-1" />
                  Salva
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 pt-2 border-t border-border">
              {/* Action buttons row */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startAddNew}
                  disabled={editingId !== null || isProcessingFile}
                  className="flex-1"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Aggiungi manuale
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('excel-upload-hidden')?.click()}
                  disabled={editingId !== null || isProcessingFile}
                  className="flex-1"
                >
                  <FileSpreadsheet className="w-4 h-4 mr-1" />
                  {isProcessingFile ? 'Elaborazione...' : 'Carica Excel'}
                </Button>
              </div>
              
              {/* Dropzone */}
              <div
                {...getRootProps()}
                className={cn(
                  "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
                  isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50",
                  isProcessingFile && "opacity-50 cursor-not-allowed"
                )}
              >
                <input {...getInputProps()} id="excel-upload-hidden" />
                <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                {isDragActive ? (
                  <p className="text-sm text-primary">Rilascia il file qui...</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Trascina un file Excel qui per importare automaticamente
                  </p>
                )}
                <p className="text-xs text-muted-foreground/70 mt-1">
                  .xlsx, .xls
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
