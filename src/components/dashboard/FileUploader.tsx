import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, FileSpreadsheet, Loader2, CheckCircle2 } from 'lucide-react';
import { parsePortfolioExcel, type PortfolioParseOptions } from '@/lib/excelParser';
import { detectFlussiCsvType, parseFlussiCsvText } from '@/lib/flussiCsvParser';
import { ingestCashMovements, ingestTitoliTrades, ingestStockTradesCostBasis } from '@/lib/flussiMovementsIngest';
import { applyCostBasisToPositions, fetchCostBasisStore, syncCostBasisStoreFromPositions, fetchDynamicAliases } from '@/lib/costBasisStore';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { upsertUploadSnapshot } from '@/lib/uploadSnapshot';
import { refreshStrategyCacheForPortfolio } from '@/lib/refreshStrategyCache';
import {
  getEffectiveUploadUserId,
  getPortfolioParseOptions,
  shouldRefreshGpSnapshot,
  shouldRefreshPositionsSnapshot,
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
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const { portfolio, updatePositionsAsync } = usePortfolio();
  const { user } = useAuth();
  const { isAdminMode, adminViewUserId } = usePortfolioContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const effectiveUserId = getEffectiveUploadUserId(isAdminMode, adminViewUserId, user?.id);

  // ============ PORTFOLIO UPLOAD (1 o 2 file) ============
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

      // ---- Smistamento: file MOVIMENTI (mov cash / mov titoli) vs SNAPSHOT (saldi/Excel) ----
      const snapshotFiles: File[] = [];
      const movementTexts: { type: 'mov_cash' | 'mov_titoli'; text: string }[] = [];
      for (const f of acceptedFiles) {
        if (/\.csv$/i.test(f.name)) {
          const text = await f.text();
          const t = detectFlussiCsvType(text);
          if (t === 'mov_cash' || t === 'mov_titoli') {
            movementTexts.push({ type: t, text });
            continue;
          }
        }
        snapshotFiles.push(f);
      }

      // ---- Parse degli snapshot PRIMA dei movimenti: il rilevamento delle
      // assegnazioni anticipate confronta le put del saldo aggiornato con
      // quelle pre-upload nel DB (che i movimenti non hanno ancora toccato). ----
      const parsed = snapshotFiles.length > 0
        ? await Promise.all(snapshotFiles.map(f => parsePortfolioExcel(f, parseOptions)))
        : [];
      const parsedSnapshotPositions = parsed.flatMap(p => p.positions);

      // ---- Movimenti: processati PRIMA dell'aggiornamento posizioni, così i
      // riacquisti call e i PMC vengono confrontati con lo stato PRE-upload.
      // Idempotenti: ricaricare lo stesso file non raddoppia nulla. ----
      const movementSummary: string[] = [];
      for (const m of movementTexts) {
        const parsedMov = parseFlussiCsvText(m.text, parseOptions);
        if (m.type === 'mov_cash') {
          const res = await ingestCashMovements(targetPortfolioId, parsedMov.cashMovements);
          if (res.depositsUpserted > 0) {
            movementSummary.push(`${res.depositsUpserted} versamenti/prelievi (${res.totalAmount.toLocaleString('it-IT', { maximumFractionDigits: 0 })} €)`);
          } else {
            movementSummary.push('nessun bonifico/giroconto nei movimenti cash');
          }
          if (res.skippedManualDates.length > 0) {
            movementSummary.push(`${res.skippedManualDates.length} date con versamenti manuali preservati (${res.skippedManualDates.join(', ')})`);
          }
          if (res.internalTransfersExcluded > 0) {
            movementSummary.push(`${res.internalTransfersExcluded} giroconti interni esclusi`);
          }
        } else {
          const res = await ingestTitoliTrades(targetPortfolioId, parsedMov.titoliOptionTrades);
          const parts: string[] = [];
          if (res.buybacksUpserted > 0) parts.push(`${res.buybacksUpserted} riacquisti call tracciati`);
          if (res.resellsApplied > 0) parts.push(`${res.resellsApplied} contratti rivenduti applicati`);
          for (const w of res.warnings) {
            toast.warning('Call da rivendere', { description: w });
          }

          // PMC: acquisti/vendite titoli aggiornano la media ponderata; le
          // vendite che chiudono lotti assegnati (assegnazione anticipata di
          // put) vengono nettate a parte senza toccare il PMC.
          try {
            const cb = await ingestStockTradesCostBasis(
              targetPortfolioId,
              parsedMov.titoliStockTrades,
              parsedMov.titoliOptionTrades,
              parsedSnapshotPositions.length > 0 ? parsedSnapshotPositions : undefined,
            );
            if (cb.tradesApplied > 0) parts.push(`${cb.tradesApplied} operazioni titoli applicate al PMC`);
            if (cb.assignmentsDetected > 0) parts.push(`${cb.assignmentsDetected} assegnazioni anticipate rilevate`);
            for (const w of cb.warnings) {
              toast.warning('PMC', { description: w });
            }
          } catch (cbErr) {
            console.error('[FileUploader] aggiornamento PMC fallito:', cbErr);
            toast.error('Aggiornamento PMC non riuscito', {
              description: cbErr instanceof Error ? cbErr.message : 'errore sconosciuto',
            });
          }

          movementSummary.push(parts.length > 0 ? parts.join(', ') : 'nessun riacquisto call nei movimenti titoli');
        }
      }
      if (movementSummary.length > 0) {
        await queryClient.invalidateQueries({ queryKey: ['deposits'] });
        await queryClient.invalidateQueries({ queryKey: ['call-buybacks'] });
        toast.success('Movimenti elaborati', { description: movementSummary.join(' • ') });
      }

      // Solo file movimenti: fine, niente aggiornamento posizioni.
      if (snapshotFiles.length === 0) {
        setUploadSuccess(true);
        return;
      }

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
        const { synced } = await syncCostBasisStoreFromPositions(targetPortfolioId, positions, dynamicAliases);
        if (synced > 0) console.log(`[CostBasis] store sincronizzato da Excel: ${synced} titoli`);
        const store = await fetchCostBasisStore(targetPortfolioId);
        const { applied } = applyCostBasisToPositions(positions, store, dynamicAliases);
        if (applied > 0) console.log(`[CostBasis] PMC applicato a ${applied} posizioni dallo store`);

        // Flussi CSV senza store: le posizioni restano senza PMC e nessuno lo
        // segnala. Il PMC iniziale va caricato una volta per portafoglio dal
        // vecchio Excel, altrimenti P&L e prezzo di carico restano vuoti.
        const needingPmc = positions.filter(
          p => ['stock', 'etf', 'derivative'].includes(p.asset_type) && p.avg_cost == null,
        ).length;
        if (needingPmc > 0 && synced === 0) {
          toast.warning('PMC iniziale mancante', {
            description: `${needingPmc} posizioni senza prezzo medio di carico. Carica una volta il vecchio file Excel con "Carica PMC" per questo portafoglio: dai movimenti successivi il PMC si aggiorna da solo.`,
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

      // GP dai flussi CSV: depositi "08..." (titoli) + conti "B0..." (liquidità)
      const gpHoldingsFromCsv = parsed.flatMap(p => p.gpHoldings || []);
      const seenGpCash = new Map<string, number>();
      for (const p of parsed) {
        for (const acc of (p.gpCashAccounts || [])) {
          const id = (acc.accountId || '').trim();
          if (id && !seenGpCash.has(id)) seenGpCash.set(id, acc.value);
        }
      }
      const gpCashFromCsv = Array.from(seenGpCash.values()).reduce((s, v) => s + v, 0);
      const hasGpFromCsv = shouldRefreshGpSnapshot(parsed);
      const hasGpTitoliSource = parsed.some(p => p.gpSnapshotPresent);
      const hasPositionsSource = shouldRefreshPositionsSnapshot(parsed);

      if (positions.length === 0 && !hasGpTitoliSource && !hasPositionsSource) {
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

      // GP dai flussi CSV: sostituisce le holdings e aggiorna i totali PRIMA
      // dello snapshot, così saveFullSnapshot congela la GP aggiornata.
      if (hasGpFromCsv) {
        const gpCashHoldings = gpCashFromCsv !== 0
          ? [{
              asset_type: 'cash' as const,
              description: 'Liquidità GP',
              quantity: 0,
              market_value: gpCashFromCsv,
              price: null,
              currency: 'EUR',
              exchange_rate: 1,
              weight_pct: null,
              ticker_code: null,
              price_date: snapshotDate,
            }]
          : [];
        const allGpHoldings = [...gpHoldingsFromCsv, ...gpCashHoldings];
        const gpTotalValue = allGpHoldings.reduce((s, h) => s + (h.market_value || 0), 0);

        const { error: gpDeleteError } = await supabase
          .from('gp_holdings')
          .delete()
          .eq('portfolio_id', targetPortfolioId);
        if (gpDeleteError) {
          console.error('[FileUploader] Errore cancellazione GP precedente:', gpDeleteError.message);
        } else {
          const gpInsertResult = allGpHoldings.length > 0
            ? await supabase.from('gp_holdings').insert(
                allGpHoldings.map(h => ({
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
              )
            : { error: null };
          if (gpInsertResult.error) {
            console.error('[FileUploader] Errore inserimento GP da CSV:', gpInsertResult.error.message);
          } else {
            await supabase.from('portfolios').update({
              gp_total_value: gpTotalValue,
              gp_cash_value: gpCashFromCsv,
            }).eq('id', targetPortfolioId);
            console.log(`[FileUploader] GP da CSV: ${allGpHoldings.length} holdings aggiornate`);
          }
        }
      }

      if (!error) {
        await queryClient.invalidateQueries({ queryKey: ['portfolios'] });
        await queryClient.invalidateQueries({ queryKey: ['admin-view-portfolio'] });
      }

      if (positions.length > 0 || hasPositionsSource) {
        await updatePositionsAsync({ positions, targetPortfolioId });
      }
      setUploadSuccess(true);

      if (snapshotDate) {
        try {
          await upsertUploadSnapshot({
            portfolioId: targetPortfolioId,
            snapshotDate,
            cashValue: cashValue > 0 ? cashValue : (portfolio?.cash_value || 0),
            gpRefreshedInThisUpload: hasGpFromCsv,
          });
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['historical-data'] }),
            queryClient.invalidateQueries({ queryKey: ['positions'] }),
            queryClient.invalidateQueries({ queryKey: ['portfolios'] }),
            queryClient.invalidateQueries({ queryKey: ['gp-holdings'] }),
            queryClient.invalidateQueries({ queryKey: ['admin-view-portfolio'] }),
          ]);
        } catch (snapErr) {
          console.error('[FileUploader] Snapshot save failed:', snapErr);
        }
      }

      refreshStrategyCacheForPortfolio(targetPortfolioId);

      const dateInfo = snapshotDate ? ` (data: ${new Date(snapshotDate).toLocaleDateString('it-IT')})` : '';
      const filesInfo = snapshotFiles.length > 1 ? ` da ${snapshotFiles.length} file` : '';
      toast.success('Portfolio caricato!', {
        description: `${positions.length} posizioni importate${filesInfo}${dateInfo}.`,
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

  const portfolioDropzone = useDropzone({
    onDrop: onDropPortfolio,
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv'],
    },
    maxFiles: 4,
    disabled: isProcessing,
  });

  return (
    <Card className="border-dashed border-2 border-border hover:border-primary/50 transition-colors">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground text-center mb-3 px-2">
          Carica fino a 4 CSV (saldi cash, saldi titoli, movimenti cash, movimenti titoli). Quando presenti nei flussi, holdings e liquidità GP vengono aggiornati nello stesso caricamento.
        </p>
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
            label="Carica Portfolio (fino a 4 CSV)"
          />
        </div>
      </CardContent>
    </Card>
  );
}
