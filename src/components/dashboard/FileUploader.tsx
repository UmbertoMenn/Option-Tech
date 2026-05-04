import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, FileSpreadsheet, Loader2, CheckCircle2 } from 'lucide-react';
import { parsePortfolioExcel } from '@/lib/excelParser';
import { parseGPExcel } from '@/lib/gpExcelParser';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { upsertUploadSnapshot } from '@/lib/uploadSnapshot';
import { refreshStrategyCacheForPortfolio } from '@/lib/refreshStrategyCache';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';

const EXCLUDED_CASH_PATTERNS: Record<string, { mid: string; last: string }[]> = {
  '7515bcc7-11b3-42c0-927d-4b2526f3a2b4': [{ mid: '2789', last: '0' }],
};

function DropzoneContent({
  isProcessing,
  uploadSuccess,
  isDragActive,
  label,
}: {
  isProcessing: boolean;
  uploadSuccess: boolean;
  isDragActive: boolean;
  label: string;
}) {
  return (
    <>
      <div className={`p-3 rounded-full ${
        uploadSuccess 
          ? 'bg-profit/10 text-profit' 
          : 'bg-primary/10 text-primary'
      }`}>
        {isProcessing ? (
          <Loader2 className="w-6 h-6 animate-spin" />
        ) : uploadSuccess ? (
          <CheckCircle2 className="w-6 h-6" />
        ) : isDragActive ? (
          <FileSpreadsheet className="w-6 h-6" />
        ) : (
          <Upload className="w-6 h-6" />
        )}
      </div>
      
      <div className="text-center">
        {isProcessing ? (
          <p className="text-sm text-muted-foreground">Elaborazione in corso...</p>
        ) : uploadSuccess ? (
          <p className="text-sm text-profit">Caricato con successo!</p>
        ) : isDragActive ? (
          <p className="text-sm text-primary">Rilascia il file qui</p>
        ) : (
          <>
            <p className="font-medium text-sm">{label}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Trascina il file qui o clicca per selezionare
            </p>
          </>
        )}
      </div>
      
      {!isProcessing && !uploadSuccess && (
        <Button variant="outline" size="sm" className="mt-1">
          Seleziona file
        </Button>
      )}
    </>
  );
}

export function FileUploader() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [isProcessingGP, setIsProcessingGP] = useState(false);
  const [uploadGPSuccess, setUploadGPSuccess] = useState(false);
  const { portfolio, updatePositionsAsync } = usePortfolio();
  const { user } = useAuth();
  const { isAdminMode, adminViewUserId } = usePortfolioContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const effectiveUserId = isAdminMode && adminViewUserId ? adminViewUserId : user?.id;

  // ============ PORTFOLIO UPLOAD ============
  const onDropPortfolio = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    const targetPortfolioId = portfolio?.id;
    if (!targetPortfolioId) {
      toast.error('Nessun portfolio selezionato');
      return;
    }

    setIsProcessing(true);
    setUploadSuccess(false);

    try {
      const excludedPatterns = EXCLUDED_CASH_PATTERNS[effectiveUserId || ''] || [];
      const { positions, cashValue, snapshotDate } = await parsePortfolioExcel(file, { excludedCashPatterns: excludedPatterns });
      
      if (positions.length === 0) {
        toast.error('Nessuna posizione trovata');
        return;
      }

      const updateData: { cash_value?: number; snapshot_date?: string | null } = {};
      if (cashValue > 0) updateData.cash_value = cashValue;
      updateData.snapshot_date = snapshotDate;
      
      const { error } = await supabase
        .from('portfolios')
        .update(updateData)
        .eq('id', targetPortfolioId);
        
      if (!error) {
        await queryClient.invalidateQueries({ queryKey: ['portfolios'] });
        await queryClient.invalidateQueries({ queryKey: ['admin-view-portfolio'] });
      }

      await updatePositionsAsync({ positions, targetPortfolioId });
      setUploadSuccess(true);
      
      if (snapshotDate) {
        try {
          await upsertUploadSnapshot({
            portfolioId: targetPortfolioId,
            snapshotDate,
            cashValue: cashValue > 0 ? cashValue : (portfolio?.cash_value || 0),
          });
          queryClient.invalidateQueries({ queryKey: ['historical-data'] });
        } catch (snapErr) {
          console.error('[FileUploader] Snapshot save failed:', snapErr);
        }
      }
      
      refreshStrategyCacheForPortfolio(targetPortfolioId);
      
      const dateInfo = snapshotDate ? ` (data: ${new Date(snapshotDate).toLocaleDateString('it-IT')})` : '';
      toast.success('Portfolio caricato!', {
        description: `${positions.length} posizioni importate${dateInfo}.`,
      });

      const hasDerivatives = positions.some(p => p.asset_type === 'derivative');
      if (hasDerivatives) navigate('/derivatives');
    } catch (error) {
      console.error('Error parsing file:', error);
      toast.error('Errore elaborazione file', {
        description: 'Assicurati che il file sia nel formato corretto.',
      });
    } finally {
      setIsProcessing(false);
    }
  }, [portfolio?.id, portfolio?.cash_value, updatePositionsAsync, queryClient]);

  // ============ GP UPLOAD ============
  const onDropGP = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    const targetPortfolioId = portfolio?.id;
    if (!targetPortfolioId) {
      toast.error('Nessun portfolio selezionato');
      return;
    }

    setIsProcessingGP(true);
    setUploadGPSuccess(false);

    try {
      const { holdings, cashValue, totalValue } = await parseGPExcel(file);
      
      if (holdings.length === 0) {
        toast.error('Nessuna posizione GP trovata');
        return;
      }

      // Delete old GP holdings for this portfolio
      await supabase.from('gp_holdings').delete().eq('portfolio_id', targetPortfolioId);

      // Insert new GP holdings
      const { error: insertError } = await supabase.from('gp_holdings').insert(
        holdings.map(h => ({
          portfolio_id: targetPortfolioId,
          asset_type: h.asset_type,
          description: h.description,
          quantity: h.quantity,
          market_value: h.market_value,
          price: h.price,
          currency: h.currency,
          exchange_rate: h.exchange_rate,
          weight_pct: h.weight_pct,
          ticker_code: h.ticker_code,
          price_date: h.price_date,
        }))
      );

      if (insertError) throw insertError;

      // Update portfolio GP totals
      await supabase.from('portfolios').update({
        gp_total_value: totalValue,
        gp_cash_value: cashValue,
      }).eq('id', targetPortfolioId);

      await queryClient.invalidateQueries({ queryKey: ['portfolios'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-view-portfolio'] });
      await queryClient.invalidateQueries({ queryKey: ['gp-holdings'] });

      // NB: lo snapshot storico NON viene aggiornato qui.
      // Lo snapshot in historical_data è legato esclusivamente all'upload del
      // file Portafoglio principale, per evitare disallineamenti tra le card
      // (ricalcolate live) e i grafici storici (basati sullo snapshot DB).

      setUploadGPSuccess(true);
      toast.success('Gestione Patrimoniale caricata!', {
        description: `${holdings.length} posizioni importate.`,
      });
      toast.warning('Snapshot storico non aggiornato', {
        description: 'Lo snapshot storico verrà aggiornato solo dopo aver caricato un nuovo file Portafoglio.',
        duration: 8000,
      });
    } catch (error) {
      console.error('Error parsing GP file:', error);
      toast.error('Errore elaborazione file GP', {
        description: 'Assicurati che il file sia nel formato corretto.',
      });
    } finally {
      setIsProcessingGP(false);
    }
  }, [portfolio?.id, queryClient]);

  const portfolioDropzone = useDropzone({
    onDrop: onDropPortfolio,
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxFiles: 1,
    disabled: isProcessing,
  });

  const gpDropzone = useDropzone({
    onDrop: onDropGP,
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxFiles: 1,
    disabled: isProcessingGP,
  });

  return (
    <Card className="border-dashed border-2 border-border hover:border-primary/50 transition-colors">
      <CardContent className="p-4">
        <Carousel opts={{ loop: false }}>
          <CarouselContent>
            {/* Slide 1: Portfolio Upload */}
            <CarouselItem>
              <div
                {...portfolioDropzone.getRootProps()}
                className={`flex flex-col items-center justify-center gap-3 py-6 cursor-pointer rounded-lg transition-colors ${
                  portfolioDropzone.isDragActive ? 'bg-primary/5' : ''
                } ${isProcessing ? 'opacity-50 cursor-wait' : ''}`}
              >
                <input {...portfolioDropzone.getInputProps()} />
                <DropzoneContent
                  isProcessing={isProcessing}
                  uploadSuccess={uploadSuccess}
                  isDragActive={portfolioDropzone.isDragActive}
                  label="Carica Portfolio"
                />
              </div>
            </CarouselItem>

            {/* Slide 2: GP Upload */}
            <CarouselItem>
              <div
                {...gpDropzone.getRootProps()}
                className={`flex flex-col items-center justify-center gap-3 py-6 cursor-pointer rounded-lg transition-colors ${
                  gpDropzone.isDragActive ? 'bg-primary/5' : ''
                } ${isProcessingGP ? 'opacity-50 cursor-wait' : ''}`}
              >
                <input {...gpDropzone.getInputProps()} />
                <DropzoneContent
                  isProcessing={isProcessingGP}
                  uploadSuccess={uploadGPSuccess}
                  isDragActive={gpDropzone.isDragActive}
                  label="Carica GP"
                />
              </div>
            </CarouselItem>
          </CarouselContent>
          <CarouselPrevious className="left-1 h-6 w-6" />
          <CarouselNext className="right-1 h-6 w-6" />
        </Carousel>
      </CardContent>
    </Card>
  );
}
