import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { HistoricalDataEntry, HistoricalDataInput, SyntheticDeposit, AggregatedHistoricalResult } from '@/types/historicalData';
import { AGGREGATED_PORTFOLIO_ID, isUserAggregatedId, getUserIdFromAggregatedId, isAnyAggregatedId } from '@/contexts/PortfolioContext';
import { useAuth } from '@/contexts/AuthContext';
import { ViewMode } from '@/components/dashboard/ViewModeSelector';
import { useUserPortfolioIds } from '@/hooks/useUserPortfolioIds';

// Helper: interpola il valore tra due snapshot
function interpolateValue(
  targetDate: Date,
  before: HistoricalDataEntry | null,
  after: HistoricalDataEntry | null
): Partial<HistoricalDataEntry> | null {
  if (!before && !after) return null;
  if (!before) return after;
  if (!after) return before;
  
  const beforeDate = new Date(before.snapshot_date).getTime();
  const afterDate = new Date(after.snapshot_date).getTime();
  const targetTime = targetDate.getTime();
  
  if (afterDate === beforeDate) return before;
  
  const ratio = (targetTime - beforeDate) / (afterDate - beforeDate);
  
  return {
    total_value: before.total_value + (after.total_value - before.total_value) * ratio,
    netting_total: before.netting_total + (after.netting_total - before.netting_total) * ratio,
    netting_ex_cc: before.netting_ex_cc + (after.netting_ex_cc - before.netting_ex_cc) * ratio,
    netting_ex_cc_np: (before.netting_ex_cc_np ?? before.netting_ex_cc) + 
      ((after.netting_ex_cc_np ?? after.netting_ex_cc) - (before.netting_ex_cc_np ?? before.netting_ex_cc)) * ratio,
    equity_exposure_pct: before.equity_exposure_pct,
    usd_exposure_pct: before.usd_exposure_pct,
  };
}

// Helper: get value based on view mode
function getValueForViewMode(entry: HistoricalDataEntry, viewMode: ViewMode): number {
  switch (viewMode) {
    case 'netting_total':
      return entry.netting_total;
    case 'netting_ex_cc':
      return entry.netting_ex_cc;
    case 'netting_ex_cc_np':
      return entry.netting_ex_cc_np ?? entry.netting_ex_cc;
    case 'base':
    default:
      return entry.total_value;
  }
}

// Aggregazione intelligente con interpolazione lineare e apporti sintetici
function aggregateHistoricalWithInterpolation(
  data: HistoricalDataEntry[],
  viewMode: ViewMode = 'base'
): AggregatedHistoricalResult {
  if (data.length === 0) return { entries: [], syntheticDeposits: [] };
  
  // Raggruppa per portfolio_id
  const byPortfolio = new Map<string, HistoricalDataEntry[]>();
  data.forEach(entry => {
    const list = byPortfolio.get(entry.portfolio_id) || [];
    list.push(entry);
    byPortfolio.set(entry.portfolio_id, list);
  });
  
  // Ordina ogni portfolio per data (ascendente per trovare il primo)
  byPortfolio.forEach((entries, key) => {
    entries.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    byPortfolio.set(key, entries);
  });
  
  // Calcola gli apporti sintetici: il valore del primo snapshot di ogni portfolio
  const syntheticDeposits: SyntheticDeposit[] = [];
  byPortfolio.forEach((entries, portfolioId) => {
    if (entries.length === 0) return;
    const firstEntry = entries[0];
    const firstValue = getValueForViewMode(firstEntry, viewMode);
    syntheticDeposits.push({
      date: firstEntry.snapshot_date,
      amount: firstValue,
      portfolioId,
    });
  });
  
  // Raccogli tutte le date uniche
  const allDates = new Set<string>();
  data.forEach(entry => allDates.add(entry.snapshot_date));
  const sortedDates = Array.from(allDates).sort();
  
  // Per ogni data, calcola il valore aggregato con interpolazione
  const aggregated: HistoricalDataEntry[] = sortedDates.map(dateStr => {
    const targetDate = new Date(dateStr);
    let totalValue = 0;
    let nettingTotal = 0;
    let nettingExCC = 0;
    let nettingExCCNP = 0;
    let sumEquityPct = 0;
    let sumUsdPct = 0;
    let totalWeight = 0;
    
    byPortfolio.forEach((entries) => {
      const exact = entries.find(e => e.snapshot_date === dateStr);
      
      if (exact) {
        totalValue += exact.total_value;
        nettingTotal += exact.netting_total;
        nettingExCC += exact.netting_ex_cc;
        nettingExCCNP += exact.netting_ex_cc_np ?? exact.netting_ex_cc;
        sumEquityPct += exact.equity_exposure_pct * exact.total_value;
        sumUsdPct += exact.usd_exposure_pct * exact.total_value;
        totalWeight += exact.total_value;
      } else {
        // Trova before e after per interpolazione
        let before: HistoricalDataEntry | null = null;
        let after: HistoricalDataEntry | null = null;
        
        for (const e of entries) {
          if (e.snapshot_date < dateStr) before = e;
          else if (e.snapshot_date > dateStr && !after) { after = e; break; }
        }
        
        // Interpola solo se la data è tra il primo e l'ultimo snapshot del portfolio
        if (before && after) {
          const interpolated = interpolateValue(targetDate, before, after);
          if (interpolated) {
            totalValue += interpolated.total_value || 0;
            nettingTotal += interpolated.netting_total || 0;
            nettingExCC += interpolated.netting_ex_cc || 0;
            nettingExCCNP += interpolated.netting_ex_cc_np || 0;
            sumEquityPct += (before.equity_exposure_pct || 0) * (interpolated.total_value || 0);
            sumUsdPct += (before.usd_exposure_pct || 0) * (interpolated.total_value || 0);
            totalWeight += interpolated.total_value || 0;
          }
        } else if (before && !after) {
          // Carry forward: usa l'ultimo valore noto
          totalValue += before.total_value;
          nettingTotal += before.netting_total;
          nettingExCC += before.netting_ex_cc;
          nettingExCCNP += before.netting_ex_cc_np ?? before.netting_ex_cc;
          sumEquityPct += before.equity_exposure_pct * before.total_value;
          sumUsdPct += before.usd_exposure_pct * before.total_value;
          totalWeight += before.total_value;
        }
        // Se !before, il portfolio non esisteva ancora: non contribuisce
      }
    });
    
    // Medie ponderate per equity/usd exposure
    const avgEquityPct = totalWeight > 0 ? sumEquityPct / totalWeight : 0.6;
    const avgUsdPct = totalWeight > 0 ? sumUsdPct / totalWeight : 0.8;
    
    return {
      id: `aggregated-${dateStr}`,
      portfolio_id: 'AGGREGATED',
      snapshot_date: dateStr,
      total_value: totalValue,
      netting_total: nettingTotal,
      netting_ex_cc: nettingExCC,
      netting_ex_cc_np: nettingExCCNP,
      deposits: 0,
      average_balance: 0,
      equity_exposure_pct: avgEquityPct,
      usd_exposure_pct: avgUsdPct,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
  
  return {
    entries: aggregated.sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date)),
    syntheticDeposits,
    rawEntries: data, // Salva dati originali per ricalcolo viewMode
  };
}

export function useHistoricalData(portfolioId: string | undefined, viewMode: ViewMode = 'base') {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const isGlobalAggregated = portfolioId === AGGREGATED_PORTFOLIO_ID;
  const isAggregated = isAnyAggregatedId(portfolioId);
  const { portfolioIds: userPortfolioIds, isUserAggregated } = useUserPortfolioIds(portfolioId);

  const historicalDataQuery = useQuery({
    queryKey: ['historical-data', portfolioId],
    queryFn: async (): Promise<AggregatedHistoricalResult> => {
      if (!portfolioId) return { entries: [], syntheticDeposits: [] };
      
      // Global aggregated: fetch all
      if (isGlobalAggregated && isAdmin) {
        const { data, error } = await supabase
          .from('historical_data')
          .select('*')
          .order('snapshot_date', { ascending: false });
        if (error) throw error;
        return aggregateHistoricalWithInterpolation(data as unknown as HistoricalDataEntry[], 'base');
      }
      
      // Per-user aggregated: fetch for user's portfolios
      if (isUserAggregated && userPortfolioIds.length > 0) {
        const { data, error } = await supabase
          .from('historical_data')
          .select('*')
          .in('portfolio_id', userPortfolioIds)
          .order('snapshot_date', { ascending: false });
        if (error) throw error;
        // Only aggregate if multiple portfolios
        if (userPortfolioIds.length > 1) {
          return aggregateHistoricalWithInterpolation(data as unknown as HistoricalDataEntry[], 'base');
        }
        return { entries: data as unknown as HistoricalDataEntry[], syntheticDeposits: [] };
      }
      
      // Single portfolio
      const { data, error } = await supabase
        .from('historical_data')
        .select('*')
        .eq('portfolio_id', portfolioId)
        .order('snapshot_date', { ascending: false });
      if (error) throw error;
      return { entries: data as unknown as HistoricalDataEntry[], syntheticDeposits: [] };
    },
    enabled: !!portfolioId && (!isGlobalAggregated || isAdmin) && (!isUserAggregated || userPortfolioIds.length > 0),
  });

  // Recalculate syntheticDeposits based on current viewMode
  const syntheticDeposits = useMemo((): SyntheticDeposit[] => {
    const rawEntries = historicalDataQuery.data?.rawEntries;
    if (!isAggregated || !rawEntries || rawEntries.length === 0) return [];
    
    const byPortfolio = new Map<string, HistoricalDataEntry[]>();
    rawEntries.forEach(entry => {
      const list = byPortfolio.get(entry.portfolio_id) || [];
      list.push(entry);
      byPortfolio.set(entry.portfolio_id, list);
    });
    
    byPortfolio.forEach((entries, key) => {
      entries.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
      byPortfolio.set(key, entries);
    });
    
    const deposits: SyntheticDeposit[] = [];
    byPortfolio.forEach((entries, pId) => {
      if (entries.length === 0) return;
      const firstEntry = entries[0];
      const firstValue = getValueForViewMode(firstEntry, viewMode);
      deposits.push({ date: firstEntry.snapshot_date, amount: firstValue, portfolioId: pId });
    });
    return deposits;
  }, [historicalDataQuery.data?.rawEntries, viewMode, isAggregated]);

  const upsertMutation = useMutation({
    mutationFn: async (entry: HistoricalDataInput) => {
      if (!portfolioId) throw new Error('Portfolio non trovato');
      const upsertPayload = {
        portfolio_id: portfolioId, snapshot_date: entry.snapshot_date,
        total_value: entry.total_value, netting_total: entry.netting_total,
        netting_ex_cc: entry.netting_ex_cc, netting_ex_cc_np: entry.netting_ex_cc_np,
        deposits: entry.deposits, average_balance: entry.average_balance,
        equity_exposure_pct: entry.equity_exposure_pct, usd_exposure_pct: entry.usd_exposure_pct,
        ...(entry.id && { id: entry.id }),
      };
      const { data, error } = await supabase
        .from('historical_data')
        .upsert(upsertPayload, { onConflict: entry.id ? 'id' : 'portfolio_id,snapshot_date' })
        .select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['historical-data'] });
      toast.success('Dati storici salvati!');
    },
    onError: (error) => { toast.error('Errore nel salvataggio', { description: error.message }); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('historical_data').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['historical-data'] });
      toast.success('Dato storico eliminato');
    },
    onError: (error) => { toast.error('Errore nell\'eliminazione', { description: error.message }); },
  });

  const entries = historicalDataQuery.data?.entries || [];
  const earliestEntry = entries.length ? entries[entries.length - 1] : null;
  const latestEntry = entries[0] || null;

  return {
    historicalData: entries, syntheticDeposits,
    isLoading: historicalDataQuery.isLoading, earliestEntry, latestEntry,
    upsertHistoricalData: upsertMutation.mutate, deleteHistoricalData: deleteMutation.mutate,
    isUpserting: upsertMutation.isPending, isDeleting: deleteMutation.isPending,
  };
}
