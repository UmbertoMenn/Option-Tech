import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, FileSpreadsheet, Loader2, CheckCircle2 } from 'lucide-react';
import { parsePortfolioExcel } from '@/lib/excelParser';
import { usePortfolio } from '@/hooks/usePortfolio';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export function FileUploader() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const { portfolio, updatePositions } = usePortfolio();

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setIsProcessing(true);
    setUploadSuccess(false);

    try {
      const { positions, cashValue, snapshotDate } = await parsePortfolioExcel(file);
      
      if (positions.length === 0) {
        toast.error('Nessuna posizione trovata', {
          description: 'Il file non contiene dati validi.',
        });
        return;
      }

      // Update cash value and snapshot date in portfolio
      if (portfolio?.id) {
        const updateData: { cash_value?: number; snapshot_date?: string } = {};
        if (cashValue > 0) {
          updateData.cash_value = cashValue;
        }
        if (snapshotDate) {
          updateData.snapshot_date = snapshotDate;
        }
        if (Object.keys(updateData).length > 0) {
          await supabase
            .from('portfolios')
            .update(updateData)
            .eq('id', portfolio.id);
        }
      }

      updatePositions(positions);
      setUploadSuccess(true);
      
      const dateInfo = snapshotDate ? ` (data: ${new Date(snapshotDate).toLocaleDateString('it-IT')})` : '';
      toast.success('Portfolio caricato!', {
        description: `${positions.length} posizioni importate${dateInfo}.`,
      });
    } catch (error) {
      console.error('Error parsing file:', error);
      toast.error('Errore elaborazione file', {
        description: 'Assicurati che il file sia nel formato corretto.',
      });
    } finally {
      setIsProcessing(false);
    }
  }, [portfolio, updatePositions]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxFiles: 1,
    disabled: isProcessing,
  });

  return (
    <Card className="border-dashed border-2 border-border hover:border-primary/50 transition-colors">
      <CardContent className="p-6">
        <div
          {...getRootProps()}
          className={`flex flex-col items-center justify-center gap-4 py-8 cursor-pointer rounded-lg transition-colors ${
            isDragActive ? 'bg-primary/5' : ''
          } ${isProcessing ? 'opacity-50 cursor-wait' : ''}`}
        >
          <input {...getInputProps()} />
          
          <div className={`p-4 rounded-full ${
            uploadSuccess 
              ? 'bg-profit/10 text-profit' 
              : 'bg-primary/10 text-primary'
          }`}>
            {isProcessing ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : uploadSuccess ? (
              <CheckCircle2 className="w-8 h-8" />
            ) : isDragActive ? (
              <FileSpreadsheet className="w-8 h-8" />
            ) : (
              <Upload className="w-8 h-8" />
            )}
          </div>
          
          <div className="text-center">
            {isProcessing ? (
              <p className="text-sm text-muted-foreground">Elaborazione in corso...</p>
            ) : uploadSuccess ? (
              <p className="text-sm text-profit">Portfolio aggiornato con successo!</p>
            ) : isDragActive ? (
              <p className="text-sm text-primary">Rilascia il file qui</p>
            ) : (
              <>
                <p className="font-medium">Carica il file Excel</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Trascina il file qui o clicca per selezionare
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Formati supportati: .xls, .xlsx
                </p>
              </>
            )}
          </div>
          
          {!isProcessing && !uploadSuccess && (
            <Button variant="outline" size="sm" className="mt-2">
              Seleziona file
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}