import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { parsePortfolioExcel, type PortfolioParseOptions } from '@/lib/excelParser';
import { parseGPExcel } from '@/lib/gpExcelParser';
import { applyCostBasisToPositions, fetchCostBasisStore, syncCostBasisStoreFromPositions, fetchDynamicAliases } from '@/lib/costBasisStore';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { upsertUploadSnapshot } from '@/lib/uploadSnapshot';
import { ingestExpiryAssignments } from '@/lib/expiryAssignmentsIngest';
import { refreshStrategyCacheForPortfolio } from '@/lib/refreshStrategyCache';
import {
  getEffectiveUploadUserId,
  getPortfolioParseOptions,
  filterSupportedUploadFiles,
} from '@/lib/portfolioUpload';

/** Risolve le regole di esclusione per l'utente effettivo (UUID + username). */
async function resolveParseOptions(userId: string | undefined): Promise<PortfolioParseOptions> {
  const options = getPortfolioParseOptions(userId);
  if (!userId) return options;
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, email')
      .eq('user_id', userId)
      .maybeSingle();
    const username = (profile?.username || profile?.email?.replace('@internal.local', '') || '')
      .trim()
      .toLowerCase();
    return getPortfolioParseOptions(userId, username);
  } catch (err) {
    console.error('[FileUploader] Impossibile risolvere lo username per le esclusioni conti:', err);
  }
  return options;
}

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
  const [excelTarget, setExcelTarget] = useState<'portfolio' | 'gp'>('portfolio');
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [isProcessingGP, setIsProcessingGP] = useState(false);
  const [uploadGPSuccess, setUploadGPSuccess] = useState(false);
  const { portfolio, updatePositionsAsync } = usePortfolio();
  const { user } = useAuth();
  const { isAdminMode, adminViewUserId } = usePortfolioContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const effectiveUserId = getEffectiveUploadUserId(isAdminMode, adminViewUserId, user?.id);

  // ============ PORTFOLIO EXCEL ============
  const onDropPortfolio = useCallback(async (acceptedFiles: File[]) => {
    if (!acceptedFiles || acceptedFiles.length === 0) return;

    const targetPortfolioId = portfolio?.id;
    if (!targetPortfolioId) {
      toast.error('Nessun portfolio selezionato');
      return;
    }

    setIsProcessing(true);
    setUploadSuccess(false);

    try {
      const parseOptions = await resolveParseOptions(effectiveUserId);

      const parsed = await Promise.all(acceptedFiles.map(f => parsePortfolioExcel(f, parseOptions)));

      // Verifica che le snapshot date siano coerenti
      const dates = parsed.map(p => p.snapshotDate).filter((d): d is string => !!d);
      const uniqueDates = Array.from(new Set(dates));
      if (uniqueDates.length > 1) {
        toast.error('Date dei file non coerenti', {
          description: `I file hanno date diverse: ${uniqueDates.join(', ')}. Devono essere identiche.`,
        });
        return;
      }
      const snapshotDate = uniqueDates[0] || null;

      // Merge posizioni (concatenazione semplice)
      const positions = parsed.flatMap(p => p.positions);

      // ---- PMC ----
      // 1. Se l'upload contiene PMC (vecchio file Excel): sincronizza lo store
      //    (fonte 'excel') — è il riallineamento.
      // 2. Applica lo store alle posizioni senza PMC (flussi CSV): i saldi
      //    banca non includono più il prezzo di carico.
      try {
        const dynamicAliases = await fetchDynamicAliases();

        // Assegnazione PUT a SCADENZA (senza file movimenti): confronta il DB
        // pre-upload con lo snapshot e aggiorna il PMC del titolo assegnato
        // ("carico = strike"). Idempotente via ledger cost_basis_trades.
        try {
          const snapshotDateForAssign = Array.from(new Set(parsed.map(p => p.snapshotDate).filter((d): d is string => !!d)))[0] || null;
          const asg = await ingestExpiryAssignments(targetPortfolioId, snapshotDateForAssign, positions);
          if (asg.assignmentsApplied > 0) {
            toast.success('Assegnazioni a scadenza', {
              description: `${asg.assignmentsApplied} put short assegnate: PMC del titolo aggiornato al valore dello strike.`,
            });
          }
          for (const w of asg.warnings) toast.warning('Assegnazione put a scadenza', { description: w });
        } catch (asgErr) {
          console.error('[FileUploader] rilevamento assegnazioni a scadenza fallito:', asgErr);
        }

        const { synced } = await syncCostBasisStoreFromPositions(targetPortfolioId, positions, dynamicAliases);
        if (synced > 0) console.log(`[CostBasis] store sincronizzato da Excel: ${synced} titoli`);
        const store = await fetchCostBasisStore(targetPortfolioId);
        const { applied } = applyCostBasisToPositions(positions, store, dynamicAliases);
        if (applied > 0) console.log(`[CostBasis] PMC applicato a ${applied} posizioni dallo store`);

        const needingPmc = positions.filter(
          p => ['stock', 'etf', 'derivative'].includes(p.asset_type) && p.avg_cost == null,
        ).length;
        if (needingPmc > 0 && synced === 0) {
          toast.warning('PMC iniziale mancante', {
            description: `${needingPmc} posizioni senza prezzo medio di carico nel file Excel.`,
            duration: 12000,
          });
        }
      } catch (pmcErr) {
        console.error('[FileUploader] gestione PMC fallita:', pmcErr);
        toast.warning('PMC non applicati', {
          description: pmcErr instanceof Error ? pmcErr.message : 'errore sconosciuto',
        });
      }

      // Deduplica liquidità per accountId (prima occorrenza vince).
      // Conti senza ID riconoscibile vengono trattati come distinti.
      const seenAccounts = new Map<string, { value: number; restricted: boolean }>();
      let anonCash = 0;
      let anonCount = 0;
      let dedupCount = 0;
      for (const p of parsed) {
        for (const acc of p.cashAccounts) {
          const id = (acc.accountId || '').trim();
          if (!id) {
            anonCash += acc.value;
            anonCount += 1;
            continue;
          }
          if (!seenAccounts.has(id)) {
            seenAccounts.set(id, { value: acc.value, restricted: !!acc.restricted });
          } else {
            dedupCount += 1;
          }
        }
      }
      // Log volutamente REDATTO: nessun numero di conto né importo (dati sensibili).
      console.log(
        `[FileUploader] liquidità: ${seenAccounts.size} conti, ${anonCount} senza ID, ${dedupCount} duplicati rimossi`,
      );
      const cashValue = Array.from(seenAccounts.values()).reduce((s, v) => s + v.value, 0) + anonCash;
      // Liquidità vincolata (conti "A9...", garanzia derivati): inclusa in cashValue,
      // salvata separatamente per la visualizzazione in dashboard.
      const restrictedCashValue = Array.from(seenAccounts.values())
        .filter(v => v.restricted)
        .reduce((s, v) => s + v.value, 0);

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

      // Liquidità vincolata: update separato e non bloccante — se la colonna
      // restricted_cash_value non è ancora stata migrata, l'upload principale
      // non deve fallire.
      try {
        const { error: restrictedErr } = await supabase
          .from('portfolios')
          .update({ restricted_cash_value: restrictedCashValue })
          .eq('id', targetPortfolioId);
        if (restrictedErr) console.error('[FileUploader] restricted_cash_value non salvata:', restrictedErr.message);
      } catch (restrictedErr) {
        console.error('[FileUploader] restricted_cash_value non salvata:', restrictedErr);
      }

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
            gpRefreshedInThisUpload: false,
          });
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['historical-data'] }),
            queryClient.invalidateQueries({ queryKey: ['positions'] }),
            queryClient.invalidateQueries({ queryKey: ['portfolios'] }),
            queryClient.invalidateQueries({ queryKey: ['gp-holdings'] }),
            queryClient.invalidateQueries({ queryKey: ['admin-view-portfolio'] }),
            queryClient.invalidateQueries({ queryKey: ['performance-attribution'] }),
          ]);
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
  }, [portfolio?.id, portfolio?.cash_value, updatePositionsAsync, queryClient, effectiveUserId, navigate]);

  // ============ GP EXCEL ============
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
      // Il file resta nel browser: vengono persistite solo le holdings necessarie
      // alla piattaforma, mai il file originale o identificativi di conto.
      const { holdings, cashValue, totalValue } = await parseGPExcel(file);
      if (holdings.length === 0) {
        toast.error('Nessuna posizione GP trovata');
        return;
      }

      const { error: deleteError } = await supabase
        .from('gp_holdings')
        .delete()
        .eq('portfolio_id', targetPortfolioId);
      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase.from('gp_holdings').insert(
        holdings.map(holding => ({
          portfolio_id: targetPortfolioId,
          asset_type: holding.asset_type,
          description: holding.description,
          quantity: holding.quantity,
          market_value: holding.market_value,
          price: holding.price,
          currency: holding.currency,
          exchange_rate: holding.exchange_rate,
          weight_pct: holding.weight_pct,
          ticker_code: holding.ticker_code,
          price_date: holding.price_date,
        })),
      );
      if (insertError) throw insertError;

      const { error: portfolioError } = await supabase
        .from('portfolios')
        .update({ gp_total_value: totalValue, gp_cash_value: cashValue })
        .eq('id', targetPortfolioId);
      if (portfolioError) throw portfolioError;

      // Se il vecchio Excel ordinario ha già fissato la data, riscrive la stessa
      // snapshot includendo la GP appena caricata. Nessuna data viene inventata.
      if (portfolio.snapshot_date) {
        await upsertUploadSnapshot({
          portfolioId: targetPortfolioId,
          snapshotDate: portfolio.snapshot_date,
          cashValue: portfolio.cash_value || 0,
          gpRefreshedInThisUpload: true,
        });
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['portfolios'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-view-portfolio'] }),
        queryClient.invalidateQueries({ queryKey: ['gp-holdings'] }),
        queryClient.invalidateQueries({ queryKey: ['historical-data'] }),
        queryClient.invalidateQueries({ queryKey: ['performance-attribution'] }),
      ]);

      setUploadGPSuccess(true);
      toast.success('Gestione Patrimoniale caricata!', {
        description: `${holdings.length} posizioni importate dal file Excel GP.`,
      });
    } catch (error) {
      console.error('[FileUploader] Errore parser GP legacy:', error instanceof Error ? error.message : 'errore sconosciuto');
      toast.error('Errore elaborazione file GP', {
        description: 'Assicurati di aver selezionato il vecchio file Excel della Gestione Patrimoniale.',
      });
    } finally {
      setIsProcessingGP(false);
    }
  }, [portfolio?.id, portfolio?.snapshot_date, portfolio?.cash_value, queryClient]);

  const portfolioDropzone = useDropzone({
    onDrop: excelTarget === 'gp' ? onDropGP : onDropPortfolio,
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxFiles: 1,
    disabled: isProcessing || isProcessingGP,
  });

  // ---- Incolla da appunti (Ctrl+V / Cmd+V) ----
  // Alternativa al drag-and-drop: molti client email (in particolare la
  // webmail in un'altra scheda del browser) non espongono l'allegato come
  // "Files" durante il drag e il browser mostra il cursore di divieto anche
  // prima che il nostro dropzone riceva l'evento. Copiare l'allegato (tasto
  // destro → Copia) e incollarlo qui bypassa quel limite: il paste porta i
  // byte reali sugli appunti del sistema operativo.
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (isProcessing || isProcessingGP) return;
      const files = event.clipboardData?.files;
      if (!files || files.length === 0) return; // paste di solo testo: non intercettare
      const supported = filterSupportedUploadFiles(Array.from(files), 'legacy');
      if (supported.length === 0) {
        toast.error('Nessun file Excel riconosciuto negli appunti');
        return;
      }
      event.preventDefault();
      if (excelTarget === 'gp') {
        onDropGP(supported.slice(0, 1));
      } else {
        onDropPortfolio(supported.slice(0, 1));
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [isProcessing, isProcessingGP, excelTarget, onDropGP, onDropPortfolio]);

  return (
    <Card className="border-dashed border-2 border-border hover:border-primary/50 transition-colors">
      <CardContent className="p-4">
        <>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <Button
                type="button"
                size="sm"
                variant={excelTarget === 'portfolio' ? 'default' : 'outline'}
                onClick={() => {
                  setExcelTarget('portfolio');
                  setUploadSuccess(false);
                }}
                disabled={isProcessing || isProcessingGP}
              >
                Portfolio Excel
              </Button>
              <Button
                type="button"
                size="sm"
                variant={excelTarget === 'gp' ? 'default' : 'outline'}
                onClick={() => {
                  setExcelTarget('gp');
                  setUploadGPSuccess(false);
                }}
                disabled={isProcessing || isProcessingGP}
              >
                GP Excel
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center mb-3 px-2">
              Il Portfolio Excel importa anche il prezzo medio fiscale; il GP Excel aggiorna soltanto la Gestione Patrimoniale.
            </p>
            <div className="mb-3 flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-950 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p>
                <span className="font-semibold">Ordine di caricamento obbligatorio per la stessa data:</span>{' '}
                prima <strong>Portfolio Excel</strong>, poi <strong>GP Excel</strong>. Caricando il Portfolio dopo la GP, lo snapshot può restare incompleto e generare incongruenze nei dati e nei calcoli.
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground/80 text-center mb-3 px-2">
              Il file viene elaborato localmente nel browser e non viene conservato. Sul Portfolio Excel restano attive le esclusioni dei conti liquidità configurate per l'utente.
            </p>
        </>
        <div
          {...portfolioDropzone.getRootProps()}
          className={`flex flex-col items-center justify-center gap-3 py-6 cursor-pointer rounded-lg transition-colors ${
            portfolioDropzone.isDragActive ? 'bg-primary/5' : ''
          } ${isProcessing ? 'opacity-50 cursor-wait' : ''}`}
        >
          <input {...portfolioDropzone.getInputProps()} />
          <DropzoneContent
            isProcessing={excelTarget === 'gp' ? isProcessingGP : isProcessing}
            uploadSuccess={excelTarget === 'gp' ? uploadGPSuccess : uploadSuccess}
            isDragActive={portfolioDropzone.isDragActive}
            label={excelTarget === 'portfolio'
              ? 'Carica Portfolio Excel'
              : 'Carica Excel GP'}
          />
        </div>
      </CardContent>
    </Card>
  );
}
