/**
 * useVirtualPortfolio — stato del Portafoglio virtuale per il portafoglio selezionato.
 *
 * Va chiamato FUORI da VirtualPositionsContext: legge le posizioni reali via usePortfolio()
 * e produce le posizioni virtuali da iniettare nel provider. Lo stato (rimosse + aggiunte)
 * è salvato nel browser per portafoglio, così sopravvive a refresh e navigazione.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useUnderlyingPrices } from '@/hooks/useUnderlyingPrices';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { Position } from '@/types/portfolio';
import {
  DEFAULT_SIM,
  VirtualSimSettings,
  EMPTY_VIRTUAL_STATE,
  VirtualPortfolioState,
  VirtualPositionSpec,
  buildVirtualPositions,
  deriveFxRates,
  parseStoredState,
  positionKey,
  storageKey,
  FxRates,
} from '@/lib/virtualPortfolio';

function readState(portfolioId: string | null): VirtualPortfolioState {
  if (!portfolioId) return EMPTY_VIRTUAL_STATE;
  try {
    return parseStoredState(localStorage.getItem(storageKey(portfolioId)));
  } catch {
    return EMPTY_VIRTUAL_STATE;
  }
}

export interface UseVirtualPortfolio {
  portfolioId: string | null;
  isLoading: boolean;
  /** Posizioni reali del portafoglio selezionato (base). */
  realPositions: Position[];
  /** Liquidità reale del portafoglio selezionato (EUR). */
  realCash: number;
  /** Posizioni del portafoglio virtuale (reali non rimosse + aggiunte risolte). */
  positions: Position[];
  /** Aggiunte non ancora valorizzabili (prezzo live in caricamento / non disponibile). */
  pending: VirtualPositionSpec[];
  state: VirtualPortfolioState;
  removedKeys: Set<string>;
  fx: FxRates;
  isFetchingPrices: boolean;
  /** Parametri di simulazione (patrimonio / esposizione obiettivo / esclusione GP). */
  sim: VirtualSimSettings;
  setSim: (patch: Partial<VirtualSimSettings>) => void;
  addSpecs: (specs: VirtualPositionSpec[]) => void;
  /** Sostituisce le posizioni generate dalla simulazione casuale con `specs` (le manuali restano). */
  replaceRandom: (specs: VirtualPositionSpec[]) => void;
  /** Rimuove posizioni reali (chiavi stabili) e/o aggiunte (id spec). */
  remove: (realKeys: string[], addedIds: string[]) => void;
  restoreReal: (realKeys: string[]) => void;
  /** Torna al portafoglio reale (nessuna rimozione, nessuna aggiunta). */
  resetToReal: () => void;
  /** Portafoglio vuoto: rimuove tutte le reali e tutte le aggiunte. */
  clearAll: () => void;
}

export function useVirtualPortfolio(): UseVirtualPortfolio {
  const { positions: realPositions, isLoading, portfolio } = usePortfolio();
  const { selectedPortfolioId } = usePortfolioContext();
  const portfolioId = selectedPortfolioId ?? null;

  const [state, setState] = useState<VirtualPortfolioState>(() => readState(portfolioId));
  const [loadedFor, setLoadedFor] = useState<string | null>(portfolioId);

  // Cambio portafoglio → carica lo stato di quel portafoglio.
  useEffect(() => {
    if (loadedFor === portfolioId) return;
    setState(readState(portfolioId));
    setLoadedFor(portfolioId);
  }, [portfolioId, loadedFor]);

  // Persistenza (solo dopo aver caricato lo stato del portafoglio corrente).
  useEffect(() => {
    if (!portfolioId || loadedFor !== portfolioId) return;
    try {
      localStorage.setItem(storageKey(portfolioId), JSON.stringify(state));
    } catch {
      /* storage non disponibile: lo stato resta in memoria */
    }
  }, [state, portfolioId, loadedFor]);

  const fx = useMemo(() => deriveFxRates(realPositions || []), [realPositions]);

  // Titoli aggiunti senza prezzo → prezzo live dal price layer (con fetch on-demand).
  const tickersNeedingPrice = useMemo(
    () => [
      ...new Set(
        state.added.filter((s) => s.kind !== 'option' && !(s.price && s.price > 0)).map((s) => s.ticker.toUpperCase()),
      ),
    ],
    [state.added],
  );
  const { prices, isFetchingMissing, isLoading: isLoadingPrices } = useUnderlyingPrices(tickersNeedingPrice);
  const livePrices = useMemo(() => {
    const m: Record<string, { price: number; currency?: string }> = {};
    for (const t of tickersNeedingPrice) {
      const p = prices[t];
      if (p?.price && p.price > 0) m[t] = { price: p.price, currency: p.currency };
    }
    return m;
  }, [prices, tickersNeedingPrice]);

  const { positions, pending } = useMemo(
    () => buildVirtualPositions(realPositions || [], state, portfolioId ?? '', fx, livePrices),
    [realPositions, state, portfolioId, fx, livePrices],
  );

  const removedKeys = useMemo(() => new Set(state.removedKeys), [state.removedKeys]);

  const addSpecs = useCallback((specs: VirtualPositionSpec[]) => {
    if (!specs.length) return;
    setState((s) => ({ ...s, added: [...s.added, ...specs] }));
  }, []);

  const remove = useCallback((realKeys: string[], addedIds: string[]) => {
    const ids = new Set(addedIds);
    setState((s) => ({
      ...s,
      removedKeys: [...new Set([...s.removedKeys, ...realKeys])],
      added: s.added.filter((a) => !ids.has(a.id)),
    }));
  }, []);

  const restoreReal = useCallback((realKeys: string[]) => {
    const ks = new Set(realKeys);
    setState((s) => ({ ...s, removedKeys: s.removedKeys.filter((k) => !ks.has(k)) }));
  }, []);

  const replaceRandom = useCallback((specs: VirtualPositionSpec[]) => {
    setState((s) => ({ ...s, added: [...s.added.filter((a) => a.origin !== 'random'), ...specs] }));
  }, []);

  const sim = useMemo<VirtualSimSettings>(() => ({ ...DEFAULT_SIM, ...(state.sim ?? {}) }), [state.sim]);
  const setSim = useCallback((patch: Partial<VirtualSimSettings>) => {
    setState((s) => ({ ...s, sim: { ...DEFAULT_SIM, ...(s.sim ?? {}), ...patch } }));
  }, []);

  // Ripristina/Svuota toccano solo la composizione: i parametri di simulazione restano.
  const resetToReal = useCallback(() => setState((s) => ({ ...EMPTY_VIRTUAL_STATE, ...(s.sim ? { sim: s.sim } : {}) })), []);

  const clearAll = useCallback(() => {
    setState((s) => ({
      version: 1,
      removedKeys: [...new Set((realPositions || []).map(positionKey))],
      added: [],
      ...(s.sim ? { sim: s.sim } : {}),
    }));
  }, [realPositions]);

  return {
    portfolioId,
    isLoading,
    realPositions: realPositions || [],
    realCash: portfolio?.cash_value ?? 0,
    positions,
    pending,
    state,
    removedKeys,
    fx,
    isFetchingPrices: isFetchingMissing || (tickersNeedingPrice.length > 0 && isLoadingPrices),
    sim,
    setSim,
    addSpecs,
    replaceRandom,
    remove,
    restoreReal,
    resetToReal,
    clearAll,
  };
}
