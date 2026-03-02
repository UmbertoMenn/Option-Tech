import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, FileSpreadsheet, Loader2, CheckCircle2 } from 'lucide-react';
import { parsePortfolioExcel } from '@/lib/excelParser';
import { usePortfolio } from '@/hooks/usePortfolio';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolioContext } from '@/contexts/PortfolioContext';

const EXCLUDED_CASH_PATTERNS: Record<string, { mid: string; last: string }[]> = {
  '7515bcc7-11b3-42c0-927d-4b2526f3a2b4': [{ mid: '2789', last: '0' }],
};

export function FileUploader() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const { portfolio, updatePositions } = usePortfolio();
  const { user } = useAuth();
  const { isAdminMode, adminViewUserId } = usePortfolioContext();
  const queryClient = useQueryClient();
  const effectiveUserId = isAdminMode && adminViewUserId ? adminViewUserId : user?.id;

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    const targetPortfolioId = portfolio?.id;
    if (!targetPortfolioId) {
      toast.error('Nessun portfolio selezionato', {
        description: 'Seleziona un portfolio prima di caricare il file.',
      });
      return;
    }

    setIsProcessing(true);
    setUploadSuccess(false);

    try {
      const excludedPatterns = EXCLUDED_CASH_PATTERNS[effectiveUserId || ''] || [];
      const { positions, cashValue, snapshotDate } = await parsePortfolioExcel(file, { excludedCashPatterns: excludedPatterns });
      
      console.log('[FileUploader] Parsed Excel result:', { 
        positionsCount: positions.length, 
        cashValue, 
        snapshotDate,
        targetPortfolioId, // Log del portfolio target bloccato
      });
      
      if (positions.length === 0) {
        toast.error('Nessuna posizione trovata', {
          description: 'Il file non contiene dati validi.',
        });
        return;
      }

      // Update cash value and snapshot date in portfolio usando targetPortfolioId
      const updateData: { cash_value?: number; snapshot_date?: string | null } = {};
      if (cashValue > 0) {
        updateData.cash_value = cashValue;
      }
      // Always update snapshot_date (even if null, to clear old value)
      updateData.snapshot_date = snapshotDate;
      
      console.log('[FileUploader] Updating portfolio with:', updateData);
      
      const { error } = await supabase
        .from('portfolios')
        .update(updateData)
        .eq('id', targetPortfolioId); // Usa targetPortfolioId invece di portfolio.id
        
      if (error) {
        console.error('[FileUploader] Error updating portfolio:', error);
      } else {
        console.log('[FileUploader] Portfolio updated successfully');
        // Force refresh portfolio query to get the new snapshot_date
        await queryClient.invalidateQueries({ queryKey: ['portfolios'] });
        await queryClient.invalidateQueries({ queryKey: ['admin-view-portfolio'] });
      }

      // Passa targetPortfolioId alla mutation per garantire coerenza
      updatePositions({ positions, targetPortfolioId });
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
  }, [portfolio?.id, updatePositions, queryClient]);

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