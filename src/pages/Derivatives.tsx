import { ErrorBoundary } from '@/components/ErrorBoundary';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useUnderlyingPrices } from '@/hooks/useUnderlyingPrices';
import { useCoveredCallPremiums, CoveredCallPremium } from '@/hooks/useCoveredCallPremiums';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TrendingUp, LogOut, Settings, ArrowLeft, Shield, Target, ChevronDown, ChevronRight, ShieldAlert, Layers, CircleDollarSign, Puzzle, Umbrella, Rocket, Calculator, HelpCircle, Menu, Sun, Moon, Info, ArrowDownUp, ArrowUp, AlertTriangle } from 'lucide-react';

import { IronCondorIcon } from '@/components/ui/iron-condor-icon';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { AppHeaderMenu } from '@/components/layout/AppHeaderMenu';
import { useSearchParams } from 'react-router-dom';
import { StalePriceIndicator } from '@/components/ui/stale-price-indicator';
import { isMarketOpen } from '@/lib/marketHours';

// Helper: show stale indicator when price is stale OR market is closed
function shouldShowStaleIndicator(priceData: UnderlyingPrice | undefined): boolean {
  if (!priceData) return false;
  if (priceData.isStale) return true;
  if (priceData.ticker && !isMarketOpen(priceData.ticker)) return true;
  return false;
}

// Helper: show stale indicator for option prices (based on position updated_at)
function shouldShowOptionStaleIndicator(option: Position, ticker?: string): boolean {
  if (!option.updated_at) return false;
  const STALE_MS = 10 * 60 * 1000; // 10 minutes
  const isStale = Date.now() - new Date(option.updated_at).getTime() > STALE_MS;
  if (isStale) return true;
  if (ticker && !isMarketOpen(ticker)) return true;
  return false;
}
import { DerivativesSummaryCard } from '@/components/derivatives/DerivativesSummaryCard';
import { Link } from 'react-router-dom';
import { Position } from '@/types/portfolio';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { reconcileConfigs } from '@/lib/strategyReconciliation';
import { autoReconcileStrategies } from '@/lib/strategyAutoReconcile';
import { buildDynamicAliasMap } from '@/lib/tickerIdentity';
import { useUnderlyingMappings } from '@/hooks/useUnderlyingMappings';
import { toast } from 'sonner';
import { 
  categorizeDerivatives,
  normalizeForMatching, 
  formatOptionDescription,
  CoveredCallPosition,
  LongPutPosition,
  IronCondorPosition,
  DoubleDiagonalPosition,
  NakedPutPosition,
  LeapCallPosition,
  OtherStrategyPosition,
  GroupedOtherStrategy,
  DerivativeCategories,
  DeRiskingCoveredCallPosition,
  ResolvedConfig,
  IncompleteStrategyPosition,
} from '@/lib/derivativeStrategies';
import { formatCurrency, formatPercentage, formatNumber } from '@/lib/formatters';
import { 
  calculateOptionPayoff, 
  findBreakevenPoints, 
  getPriceRangeForPositions 
} from '@/lib/optionCalculator';
import { DerivativePosition, OptionType } from '@/types/portfolio';
import { PutRollUpToggle } from '@/components/derivatives/PutRollUpToggle';
import { RollTargetInput } from '@/components/derivatives/RollTargetInput';
import { nakedPutKeyForPosition, coveredCallKeyForPosition, deRiskingCoveredCallKeyForPosition } from '@/lib/strategyKeys';
import { CallPremiumCalculatorDialog, StrategyLeg } from '@/components/derivatives/CallPremiumCalculatorDialog';
import { isLegOpenInOrders, ParsedOrder } from '@/lib/orderFileParser';
import { OptionStratButton } from '@/components/derivatives/OptionStratButton';
import {
  buildIronCondorUrl,
  buildDoubleDiagonalUrl,
  buildCoveredCallUrl,
  buildNakedPutUrl,
  buildLeapCallUrl,
  buildLongPutUrl,
  buildGroupedStrategyUrl,
  buildOptionStratUrlFromOrders,
} from '@/lib/optionStratUrl';
import { useDerivativeOverrides } from '@/hooks/useDerivativeOverrides';
import { useStrategyConfigurations, UpsertConfigParams } from '@/hooks/useStrategyConfigurations';
import { StrategyConfigWizard, autoClassify, buildConfigsFromStrategies } from '@/components/derivatives/StrategyConfigWizard';
import { useArchivedUnderlyings, useArchiveUnderlying, useUnarchiveUnderlying } from '@/hooks/useArchivedUnderlyings';
import { PortfolioSelector } from '@/components/portfolio/PortfolioSelector';
import { usePortfolioContext, isAnyAggregatedId, AGGREGATED_PORTFOLIO_ID } from '@/contexts/PortfolioContext';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { saveStrategyCache } from '@/lib/strategyCache';

import {
  decideWizardResume,
  wizardActiveKey,
  wizardDraftKey,
  LEGACY_WIZARD_ACTIVE_KEY,
} from '@/lib/strategyWizardResume';

// Format expiry as MMM/YY (e.g., DIC/27, FEB/26) - Italian months
function formatExpiryMMY(date: string | null | undefined): string {
  if (!date) return '-';
  const months = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
  const d = new Date(date);
  const month = months[d.getMonth()];
  const year = d.getFullYear().toString().slice(-2);
  return `${month}/${year}`;
}

// Helper: get the currency for a derivative position
function getOptionCurrency(option: Position): string {
  return option.currency || 'USD';
}

/** Scheda unificata di una gamba (opzione) — usata sia nelle righe complete che incomplete.
 *  V (venduta) = verde, A (acquistata) = rosso, coerente con la convenzione della pagina. */
function LegDetailCard({ leg, underlyingPrices, label }: { leg: Position; underlyingPrices: Record<string, UnderlyingPrice>; label?: string }) {
  const q = leg.quantity || 0;
  const isSold = q < 0;
  const cur = getOptionCurrency(leg);
  const pmc = leg.avg_cost || 0;
  const px = leg.current_price || 0;
  const pricePct = pmc > 0 ? ((px - pmc) / pmc) * 100 : null;
  const profit = isSold ? (pmc - px) : (px - pmc); // >0 = in guadagno per il lato posizione
  const uTicker = leg.underlying ? underlyingPrices[leg.underlying]?.ticker : undefined;
  const uPrice = (leg.underlying ? underlyingPrices[leg.underlying]?.price : 0) || 0;
  return (
    <div className="rounded-md bg-background/50 border border-border/50 p-2">
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <Badge variant="outline" className={`text-[10px] ${isSold ? 'text-green-500 border-green-500' : 'text-red-500 border-red-500'}`}>
          {isSold ? 'V' : 'A'}
        </Badge>
        <span className="text-sm font-medium">{formatOptionDescription(leg)}</span>
        {label && <span className="text-[10px] text-emerald-500 font-medium">{label}</span>}
        {uPrice > 0 && (
          <span className="text-xs font-mono font-semibold text-cyan-300">
            {(uTicker || leg.underlying)}: {formatCurrency(uPrice, cur)}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 md:grid-cols-5 gap-3 text-xs">
        <div><p className="text-muted-foreground">Strike</p><p className="font-medium">{formatNumber(leg.strike_price || 0, 0)}</p></div>
        <div><p className="text-muted-foreground">Scadenza</p><p className="font-medium">{formatExpiryMMY(leg.expiry_date)}</p></div>
        <div><p className="text-muted-foreground">Contratti</p><p className="font-medium">{Math.abs(q)}</p></div>
        <div><p className="text-muted-foreground">PMC</p><p className="font-medium">{formatCurrency(pmc, cur)}</p></div>
        <div>
          <p className="text-muted-foreground">Prezzo</p>
          <p className="font-medium flex items-center gap-1">
            {formatCurrency(px, cur)}
            {pricePct !== null && (
              <span className={`text-[10px] ${profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {pricePct >= 0 ? '+' : ''}{pricePct.toFixed(1)}%
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Scheda della gamba azionaria (sottostante reale) di una covered call / DR-CC. */
function StockUnderlyingCard({ stock, cur }: { stock: Position; cur: string }) {
  return (
    <div className="rounded-md bg-background/50 border border-border/50 p-2">
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-400">AZ</Badge>
        <span className="text-sm font-medium">{stock.description}</span>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-5 gap-3 text-xs">
        <div><p className="text-muted-foreground">Azioni</p><p className="font-medium">{formatNumber(stock.quantity || 0)}</p></div>
        <div><p className="text-muted-foreground">PMC</p><p className="font-medium">{formatCurrency(stock.avg_cost || 0, stock.currency || cur)}</p></div>
        <div><p className="text-muted-foreground">Prezzo</p><p className="font-medium">{formatCurrency(stock.current_price || 0, stock.currency || cur)}</p></div>
      </div>
    </div>
  );
}

/** Lista uniforme di schede-gamba, usata in TUTTE le righe espanse (complete e incomplete). */
function LegsDetailList({ legs, underlyingPrices, stock, labels }: {
  legs: Position[];
  underlyingPrices: Record<string, UnderlyingPrice>;
  stock?: Position | null;
  labels?: (string | undefined)[];
}) {
  const cur = legs[0] ? getOptionCurrency(legs[0]) : 'USD';
  return (
    <div className="ml-7 mt-2 p-3 rounded-lg border border-border/50 bg-muted/30 space-y-2">
      {stock && <StockUnderlyingCard stock={stock} cur={cur} />}
      {legs.map((leg, i) => (
        <LegDetailCard key={i} leg={leg} underlyingPrices={underlyingPrices} label={labels?.[i]} />
      ))}
    </div>
  );
}

/** Risolve ticker+prezzo del sottostante per una riga incompleta, con più fallback:
 *  1) underlyingPrices per nome/chiave diretta, 2) match normalizzato per nome o ticker,
 *  3) il titolo collegato realmente detenuto (linkedStock). */
function resolveIncompleteHeader(
  inc: IncompleteStrategyPosition,
  underlyingPrices: Record<string, UnderlyingPrice>,
): { ticker: string; price: number; cur: string } | null {
  const first = inc.presentLegs[0];
  const cur = first ? getOptionCurrency(first) : (inc.linkedStock?.currency || 'USD');
  const cands = [inc.underlying, first?.underlying, first?.description, inc.linkedStock?.ticker, inc.linkedStock?.description]
    .filter((x): x is string => !!x);
  // 1) chiave diretta
  for (const c of cands) {
    const v = underlyingPrices[c];
    if (v && v.price > 0) return { ticker: v.ticker || c, price: v.price, cur };
  }
  // 2) match normalizzato per nome o ticker
  const norm = (x: string) => (x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const wanted = new Set(cands.map(norm));
  for (const [k, v] of Object.entries(underlyingPrices)) {
    if (v && v.price > 0 && (wanted.has(norm(k)) || (v.ticker && wanted.has(norm(v.ticker))))) {
      return { ticker: v.ticker || k, price: v.price, cur };
    }
  }
  // 3) fallback sul titolo collegato realmente detenuto
  const ls = inc.linkedStock;
  if (ls) {
    const price = (ls as { snapshot_price?: number | null }).snapshot_price ?? ls.current_price ?? 0;
    if (price > 0) return { ticker: ls.ticker || inc.underlying, price, cur: ls.currency || cur };
  }
  return null;
}

/** Riga di una strategia incompleta (gamba mancante), COLLASSABILE come le righe complete. */
function IncompleteStrategyRow({ inc, underlyingPrices }: { inc: IncompleteStrategyPosition; underlyingPrices: Record<string, UnderlyingPrice> }) {
  const [isOpen, setIsOpen] = useState(false);
  const header = resolveIncompleteHeader(inc, underlyingPrices);
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
        className="flex items-center gap-2 p-3 rounded-lg border border-orange-500/30 bg-orange-500/5 hover:bg-orange-500/10 cursor-pointer transition-colors"
      >
        {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
        <span className="font-semibold text-sm shrink-0">{inc.underlying}</span>
        {header && (
          <span className="text-xs font-mono font-semibold text-cyan-300 shrink-0">{header.ticker}: {formatCurrency(header.price, header.cur)}</span>
        )}
        {inc.isSynthetic && (
          <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500 shrink-0">Sintetica</Badge>
        )}
        <div className="flex items-center gap-1.5 flex-wrap ml-auto">
          <Badge variant="outline" className="text-[10px] bg-orange-500/15 text-orange-500 border-orange-500/40 uppercase tracking-wide">
            <AlertTriangle className="w-3 h-3 mr-1" /> Gamba mancante
          </Badge>
          <span className="text-xs text-orange-500 font-medium">Manca:</span>
          {inc.missingLegs.map((leg, i) => (
            <Badge key={i} variant="outline" className="text-[10px] bg-orange-500/15 text-orange-500 border-orange-500/40">
              {leg}
            </Badge>
          ))}
        </div>
      </div>
      <CollapsibleContent>
        {(inc.presentLegs.length > 0 || inc.linkedStock) ? (
          <LegsDetailList legs={inc.presentLegs} underlyingPrices={underlyingPrices} stock={inc.linkedStock} />
        ) : (
          <div className="ml-7 mt-2 p-3 rounded-lg border border-border/50 bg-muted/30 text-xs text-muted-foreground">
            Nessuna gamba presente in portafoglio per questa strategia.
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}


export function Derivatives() {
  const { portfolio, positions, isLoading, isHistoricalView } = usePortfolio();
  const { isAggregatedView, selectedPortfolioId } = usePortfolioContext();
  const { overrides, getOverrideForPosition } = useDerivativeOverrides();
  const { configurations: strategyConfigs, hasConfigurations, upsertBatch, cancelOverride, isSaving: isConfigSaving, isLoading: isConfigsLoading } = useStrategyConfigurations();
  const { premiums: ccPremiums, getPremiumByTickerAndSymbol } = useCoveredCallPremiums(portfolio?.id);
  const { data: archivedItems = [] } = useArchivedUnderlyings(portfolio?.id ?? null);
  const { allMappings } = useUnderlyingMappings();
  const dynamicAliases = useMemo(
    () => buildDynamicAliasMap(allMappings.data || []),
    [allMappings.data],
  );
  const archiveMutation = useArchiveUnderlying();
  const unarchiveMutation = useUnarchiveUnderlying();
  
  // Manual configurations do not delete the user's existing overrides.
  const handleSaveConfigs = useCallback(async (configs: UpsertConfigParams[]) => {
    // Block reconciliation from auto-opening after this save
    justSavedRef.current = true;
    reconciliationCheckedRef.current = true;
    
    // Save the configs
    await upsertBatch(configs);
  }, [upsertBatch]);
  
  const [coveredCallOpen, setCoveredCallOpen] = useState(false);
  
  const [deRiskingOpen, setDeRiskingOpen] = useState(false);
  const [ironCondorOpen, setIronCondorOpen] = useState(false);
  const [doubleDiagonalOpen, setDoubleDiagonalOpen] = useState(false);
  const [nakedPutsOpen, setNakedPutsOpen] = useState(false);
  const [putSpreadOpen, setPutSpreadOpen] = useState(false);
  const [diagonalPutSpreadOpen, setDiagonalPutSpreadOpen] = useState(false);
  const [leapCallsOpen, setLeapCallsOpen] = useState(false);
  const [protectionsOpen, setProtectionsOpen] = useState(false);
  const [otherStrategiesOpen, setOtherStrategiesOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Chiave del wizard: scoped per portafoglio, come il draft.
  const wizardPortfolioKey = portfolio?.id ?? selectedPortfolioId ?? null;
  const activeKeyRef = useRef<string | null>(null);
  activeKeyRef.current = wizardPortfolioKey ? wizardActiveKey(wizardPortfolioKey) : null;

  const setWizardOpenPersisted = useCallback((open: boolean) => {
    setWizardOpen(open);
    const key = activeKeyRef.current;
    if (!key) return;
    if (open) {
      sessionStorage.setItem(key, JSON.stringify({ ts: Date.now() }));
    } else {
      sessionStorage.removeItem(key);
    }
  }, []);

  // Ripresa del wizard SOLO dopo un reload della pagina con draft in corso.
  const resumeCheckedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    sessionStorage.removeItem(LEGACY_WIZARD_ACTIVE_KEY); // marker globale legacy: bug dei riaperture continue
    if (!wizardPortfolioKey) return;
    if (resumeCheckedKeyRef.current === wizardPortfolioKey) return;
    resumeCheckedKeyRef.current = wizardPortfolioKey;

    const key = wizardActiveKey(wizardPortfolioKey);
    const decision = decideWizardResume(
      sessionStorage.getItem(key),
      sessionStorage.getItem(wizardDraftKey(wizardPortfolioKey)) != null,
    );
    if (decision.resume) {
      setWizardOpen(true);
      return;
    }
    // Nessuna ripresa: il draft residuo è stantio e non deve sovrascrivere
    // le configurazioni già salvate alla prossima apertura manuale.
    sessionStorage.removeItem(key);
    sessionStorage.removeItem(wizardDraftKey(wizardPortfolioKey));
  }, [wizardPortfolioKey]);

  // Navigazione SPA via dalla pagina: il wizard non deve riaprirsi al ritorno.
  // Su un reload vero React non esegue i cleanup, quindi il marker sopravvive
  // e la ripresa continua a funzionare.
  useEffect(() => () => {
    if (activeKeyRef.current) sessionStorage.removeItem(activeKeyRef.current);
  }, []);
  const reconciliationCheckedRef = useRef(false);
  // includePutPremiums toggle removed — now inside CallPremiumCalculatorDialog

  const derivatives = useMemo(() => 
    positions.filter(p => p.asset_type === 'derivative'),
    [positions]
  );

  const stockPositions = useMemo(() => 
    positions.filter(p => p.asset_type === 'stock'),
    [positions]
  );

  // Early return for global aggregate - page is hidden
  const isGlobalAggregate = selectedPortfolioId === AGGREGATED_PORTFOLIO_ID;

  const categories = useMemo(() => {
    // Sort functions for different types
    const sortByOptionUnderlying = <T extends { option: Position }>(arr: T[]): T[] =>
      [...arr].sort((a, b) => (a.option.underlying || '').localeCompare(b.option.underlying || ''));
    const sortByUnderlyingString = <T extends { underlying: string }>(arr: T[]): T[] =>
      [...arr].sort((a, b) => a.underlying.localeCompare(b.underlying));

    let raw: DerivativeCategories;

    if (isAggregatedView) {
      // Per-portfolio categorization: run categorizeDerivatives separately for each portfolio
      const positionsByPortfolio = new Map<string, Position[]>();
      positions.forEach(p => {
        const pid = p.portfolio_id;
        if (!positionsByPortfolio.has(pid)) positionsByPortfolio.set(pid, []);
        positionsByPortfolio.get(pid)!.push(p);
      });

      const overridesByPortfolio = new Map<string, typeof overrides>();
      overrides.forEach(o => {
        const pid = o.portfolio_id;
        if (!overridesByPortfolio.has(pid)) overridesByPortfolio.set(pid, []);
        overridesByPortfolio.get(pid)!.push(o);
      });

      // Initialize empty merged result
      const merged: DerivativeCategories = {
        coveredCalls: [], deRiskingCoveredCalls: [], longPuts: [], ironCondors: [], doubleDiagonals: [],
        nakedPuts: [], leapCalls: [], otherStrategies: [], groupedOtherStrategies: [], resolvedConfigs: [],
        incompleteStrategies: [],
      };

      for (const [pid, portfolioPositions] of positionsByPortfolio) {
        const portfolioDerivatives = portfolioPositions.filter(p => p.asset_type === 'derivative');
        const portfolioOverrides = overridesByPortfolio.get(pid) || [];
        const portfolioConfigs = strategyConfigs.filter(c => c.portfolio_id === pid);
        const result = categorizeDerivatives(portfolioDerivatives, portfolioPositions, portfolioOverrides, portfolioConfigs, { configOnly: true, dynamicAliases });

        merged.coveredCalls.push(...result.coveredCalls);
        merged.deRiskingCoveredCalls.push(...result.deRiskingCoveredCalls);
        merged.longPuts.push(...result.longPuts);
        merged.ironCondors.push(...result.ironCondors);
        merged.doubleDiagonals.push(...result.doubleDiagonals);
        merged.nakedPuts.push(...result.nakedPuts);
        merged.leapCalls.push(...result.leapCalls);
        merged.otherStrategies.push(...result.otherStrategies);
        merged.groupedOtherStrategies.push(...result.groupedOtherStrategies);
        merged.resolvedConfigs.push(...result.resolvedConfigs);
        merged.incompleteStrategies.push(...result.incompleteStrategies);
      }

      raw = merged;
    } else {
      raw = categorizeDerivatives(derivatives, positions, overrides, strategyConfigs, { configOnly: true, dynamicAliases });
    }
    
    return {
      ...raw,
      coveredCalls: sortByOptionUnderlying(raw.coveredCalls),
      deRiskingCoveredCalls: [...raw.deRiskingCoveredCalls].sort((a, b) => 
        (a.coveredCall.option.underlying || '').localeCompare(b.coveredCall.option.underlying || '')
      ),
      longPuts: sortByOptionUnderlying(raw.longPuts),
      ironCondors: sortByUnderlyingString(raw.ironCondors),
      doubleDiagonals: sortByUnderlyingString(raw.doubleDiagonals),
      nakedPuts: sortByOptionUnderlying(raw.nakedPuts),
      leapCalls: sortByOptionUnderlying(raw.leapCalls),
      groupedOtherStrategies: sortByUnderlyingString(raw.groupedOtherStrategies),
    };
  }, [derivatives, positions, overrides, strategyConfigs, isAggregatedView, dynamicAliases]);

  // Strategie incomplete (gamba mancante) raggruppate per tipo, per renderle NELLE loro categorie
  const incompleteByType = useMemo(() => {
    const m: Record<string, IncompleteStrategyPosition[]> = {};
    for (const inc of categories.incompleteStrategies || []) {
      (m[inc.strategyType] ??= []).push(inc);
    }
    return m;
  }, [categories.incompleteStrategies]);
  const completeDrcc = useMemo(
    () => categories.deRiskingCoveredCalls.filter(dr => !dr.incomplete),
    [categories.deRiskingCoveredCalls],
  );
  const incDrcc = useMemo(() => incompleteByType['derisking_covered_call'] || [], [incompleteByType]);
  const incCovered = useMemo(() => incompleteByType['covered_call'] || [], [incompleteByType]);
  const incIronCondor = useMemo(() => incompleteByType['iron_condor'] || [], [incompleteByType]);
  const incDoubleDiagonal = useMemo(() => incompleteByType['double_diagonal'] || [], [incompleteByType]);

  // Split groupedOtherStrategies into putSpreads, diagonalPutSpreads, and remaining
  const { putSpreads, diagonalPutSpreads, remainingOtherStrategies } = useMemo(() => {
    const putSpreads: GroupedOtherStrategy[] = [];
    const diagonalPutSpreads: GroupedOtherStrategy[] = [];
    const remainingOtherStrategies: GroupedOtherStrategy[] = [];

    for (const group of categories.groupedOtherStrategies) {
      // Use configStrategyType (from per-config tracking) when available, fallback to heuristic
      const stratType = group.configStrategyType;
      if (stratType === 'put_spread' || (!stratType && group.strategyName === 'Put Spread')) {
        putSpreads.push(group);
      } else if (stratType === 'diagonal_put_spread' || (!stratType && group.strategyName === 'Diagonal Put Spread')) {
        diagonalPutSpreads.push(group);
      } else {
        remainingOtherStrategies.push(group);
      }
    }

    return { putSpreads, diagonalPutSpreads, remainingOtherStrategies };
  }, [categories.groupedOtherStrategies]);

  // Calculate total covered call contracts per underlying (for partial coverage badge)
  const totalCoveredCallContractsByUnderlying = useMemo(() => {
    const totals: Record<string, number> = {};
    categories.coveredCalls.forEach(cc => {
      const underlyingName = cc.underlying.description || cc.option.underlying || '';
      if (underlyingName) {
        totals[underlyingName] = (totals[underlyingName] || 0) + cc.contractsCovered;
      }
    });
    return totals;
  }, [categories.coveredCalls]);

  // Extract all unique underlying names for price fetching (include ALL for ticker resolution)
  const allUnderlyingNames = useMemo(() => {
    const names = new Set<string>();
    
    // Iron Condors
    categories.ironCondors.forEach(ic => names.add(ic.underlying));
    
    // Double Diagonals
    categories.doubleDiagonals.forEach(dd => names.add(dd.underlying));
    
    // Naked Puts - ALL (need ticker resolution even if has portfolio price)
    categories.nakedPuts.forEach(np => {
      if (np.option.underlying) {
        names.add(np.option.underlying);
      }
    });
    
    // Leap Calls - ALL (need ticker resolution even if has portfolio price)
    categories.leapCalls.forEach(lc => {
      if (lc.option.underlying) {
        names.add(lc.option.underlying);
      }
    });
    
    // Covered Calls - ALL (need ticker resolution)
    categories.coveredCalls.forEach(cc => {
      if (cc.option.underlying) {
        names.add(cc.option.underlying);
      }
    });
    
    // Long Puts (protections) - ALL
    categories.longPuts.forEach(lp => {
      if (lp.option.underlying) {
        names.add(lp.option.underlying);
      }
    });
    
    
    
    // De-Risking Covered Calls - ALL underlyings
    categories.deRiskingCoveredCalls.forEach(dr => {
      if (dr.coveredCall.option.underlying) {
        names.add(dr.coveredCall.option.underlying);
      }
    });
    
    // Grouped Other Strategies
    categories.groupedOtherStrategies.forEach(group => {
      names.add(group.underlying);
    });

    // Stock positions - add cleaned descriptions for ticker resolution
    stockPositions.forEach(sp => {
      const cleaned = sp.description.replace(/^AZ\./i, '').trim();
      if (cleaned) names.add(cleaned);
    });
    
    return Array.from(names);
  }, [categories, stockPositions]);

  // Fetch underlying prices from Yahoo Finance
  const { prices: underlyingPrices, isLoading: isPricesLoading, missingCount, isFetchingMissing } = useUnderlyingPrices(allUnderlyingNames);
  
  // nakedPutPremiumsByUnderlying removed — PUT premiums now handled inside CallPremiumCalculatorDialog

  // Track if we've saved the cache for the current portfolio + categories
  const lastSavedRef = useRef<string>('');
  
  // Save strategy cache to database whenever categories change
  useEffect(() => {
    if (!portfolio?.id || Object.keys(underlyingPrices).length === 0) return;
    
    // Create a key to track what we've saved
    const cacheKey = `${portfolio.id}_${JSON.stringify({
      cc: categories.coveredCalls.length,
      np: categories.nakedPuts.length,
      ic: categories.ironCondors.length,
      dd: categories.doubleDiagonals.length,
      lc: categories.leapCalls.length,
      os: categories.groupedOtherStrategies.length,
    })}`;
    
    if (lastSavedRef.current === cacheKey) return;
    lastSavedRef.current = cacheKey;
    
    // Save to database (fire and forget)
    saveStrategyCache(portfolio.id, categories, underlyingPrices).catch(err => {
      console.error('Failed to save strategy cache:', err);
    });
  }, [portfolio?.id, categories, underlyingPrices]);

  // Reconciliation: compare saved configs vs current positions
  const reconciliationItems = useMemo(() => {
    if (!hasConfigurations || strategyConfigs.length === 0 || positions.length === 0) return [];
    return reconcileConfigs(
      strategyConfigs.filter(config => !config.config_locked),
      positions,
      dynamicAliases,
    );
  }, [hasConfigurations, strategyConfigs, positions, dynamicAliases]);

  const [searchParams, setSearchParams] = useSearchParams();

  // Compute whether wizard is needed: derivatives exist but configs are missing or incomplete
  // Build archived keys set for fast lookups
  // Build archived keys using normalizeForMatching for robust matching
  const archivedNormalizedKeys = useMemo(() => {
    return archivedItems.map(item => normalizeForMatching(item.key));
  }, [archivedItems]);

  const isArchivedDerivative = useCallback((d: Position) => {
    const key = normalizeForMatching(d.underlying || d.description || '');
    if (!key) return false;
    return archivedNormalizedKeys.some(ak =>
      ak.length > 0 && (key.includes(ak) || ak.includes(key))
    );
  }, [archivedNormalizedKeys]);

  const needsWizard = useMemo(() => {
    if (derivatives.length === 0) return false;
    if (!hasConfigurations) {
      const nonArchived = derivatives.filter(d => !isArchivedDerivative(d));
      return nonArchived.length > 0;
    }
    // Use resolvedConfigs from the shared resolver — same source of truth as the page
    // A derivative is "covered" if it appears in any resolvedConfig's matchedPositions
    const coveredPositionIds = new Set<string>();
    for (const rc of categories.resolvedConfigs) {
      for (const mp of rc.matchedPositions) {
        // Virtual positions share the same base id as the real position
        coveredPositionIds.add(mp.id);
      }
    }
    // Also mark the real position IDs as covered (virtual IDs equal real IDs in our case)
    const uncoveredCount = derivatives.filter(d => {
      if (coveredPositionIds.has(d.id)) return false;
      if (isArchivedDerivative(d)) return false;
      return true;
    }).length;
    return uncoveredCount > 0;
  }, [derivatives, hasConfigurations, categories.resolvedConfigs, isArchivedDerivative]);
  

   // Clean up legacy ?wizard=1 param without opening wizard
  useEffect(() => {
    if (searchParams.get('wizard') === '1') {
      searchParams.delete('wizard');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Riconciliazione AUTOMATICA (once per mount): risolve roll, chiusure e
  // aggiunte deterministiche senza dialog. Il dialog manuale si apre solo
  // per gli item genuinamente ambigui rimasti irrisolti.
  const justSavedRef = useRef(false);
  const autoReconcileRunningRef = useRef(false);
  useEffect(() => {
    if (reconciliationCheckedRef.current) return;
    if (justSavedRef.current) { justSavedRef.current = false; return; }
    if (autoReconcileRunningRef.current) return;
    if (isLoading || isConfigsLoading || wizardOpen) return;
    // CRITICO: gli alias dinamici (underlying_mappings) devono essere caricati
    // PRIMA di riconciliare. Con la mappa vuota, config legacy con underlying
    // "Micron Technology Inc" e posizioni con underlying "MU" finiscono in
    // gruppi distinti: l'auto-reconcile crea config duplicate col ticker senza
    // chiudere le originali (hanno linked_stock), producendo riferimenti
    // duplicati allo stesso stock base e slot persi nel wizard.
    if (allMappings.isLoading || allMappings.isFetching) return;
    if (isHistoricalView) return; // vista storica: sola lettura, niente riparazioni
    // Gira anche SENZA item di riconciliazione: la Regola 0 (riparazione
    // covered call smarrite) opera sulle config esistenti. Serve però che
    // config e posizioni siano caricate.
    if (strategyConfigs.length === 0 || positions.length === 0) return;

    reconciliationCheckedRef.current = true;

    const result = autoReconcileStrategies(strategyConfigs, reconciliationItems, positions, underlyingPrices, dynamicAliases);

    if (!result.hasAutoChanges) {
      // Nulla di automatizzabile: la riconciliazione è interamente automatica,
      // il vecchio dialog manuale non esiste più. Se restano item è solo
      // diagnostica: le regole 3a-3f sono esaustive, quindi qui gli item
      // residui indicano config bloccate (config_locked) o nessuna differenza
      // sostanziale — in entrambi i casi non c'è nulla da chiedere all'utente.
      if (reconciliationItems.length > 0) {
        console.log('[AutoReconcile] Item non azionabili (config bloccate o nessuna modifica):',
          reconciliationItems.map(i => `${i.underlying} (${i.strategyType})`));
      }
      return;
    }

    autoReconcileRunningRef.current = true;
    console.log('[AutoReconcile] Modifiche automatiche:', result.changes);

    handleSaveConfigs(result.resolvedConfigs!)
      .then(() => {
        toast.success('Strategie aggiornate automaticamente', {
          description: result.changes.slice(0, 5).join('\n') +
            (result.changes.length > 5 ? `\n… e altre ${result.changes.length - 5} modifiche` : ''),
          duration: 10000,
        });
        // Le regole 3a-3f classificano ogni gamba: non restano mai item
        // irrisolti da sottoporre all'utente.
      })
      .catch(err => {
        console.error('[AutoReconcile] Errore nel salvataggio automatico:', err);
        toast.error('Riconciliazione automatica fallita', {
          description: 'Riprova ricaricando la pagina; se persiste, usa "Riconfigura".',
        });
      })
      .finally(() => {
        autoReconcileRunningRef.current = false;
      });
  }, [reconciliationItems, isLoading, isConfigsLoading, isHistoricalView, wizardOpen, strategyConfigs, positions, underlyingPrices, dynamicAliases, allMappings.isLoading, allMappings.isFetching, handleSaveConfigs]);

  // Auto-classificazione iniziale (Bug 1): quando non esistono configurazioni salvate,
  // classifica automaticamente i derivati senza richiedere il wizard manuale.
  const initialAutoClassifyDoneRef = useRef(false);
  useEffect(() => {
    if (initialAutoClassifyDoneRef.current) return;
    if (hasConfigurations) return; // già configurato
    if (isLoading || isConfigsLoading) return; // ancora in caricamento
    if (isHistoricalView) return; // sola lettura
    if (derivatives.length === 0 || positions.length === 0) return;
    // Attendere gli alias dinamici: senza di essi ADBE/Adobe finirebbero in
    // config distinte e servirebbe una riconciliazione manuale successiva.
    if (allMappings.isLoading || allMappings.isFetching) return;

    initialAutoClassifyDoneRef.current = true;

    const archivedKeysList = archivedItems.map(a => a.key);
    const strategies = autoClassify(derivatives, positions, archivedKeysList, dynamicAliases);
    if (strategies.length === 0) return;

    const configs = buildConfigsFromStrategies(strategies, dynamicAliases).map(c => ({ ...c, config_locked: false }));
    handleSaveConfigs(configs);
  }, [hasConfigurations, isLoading, isConfigsLoading, isHistoricalView, derivatives, positions, archivedItems, handleSaveConfigs, dynamicAliases, allMappings.isLoading, allMappings.isFetching]);

  if (isLoading) {
    return <DerivativesSkeleton />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background-secondary/50 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 shrink-0">
              <div className="p-2 rounded-lg bg-primary/10">
                <IronCondorIcon size={24} className="text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold">Option Tech</h1>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-4 h-4 text-muted-foreground cursor-pointer hidden sm:inline" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs p-3">
                      <div className="space-y-2 text-sm">
                        <p>
                          <strong>Prezzi Sottostanti (PS):</strong> aggiornati automaticamente ogni 5 minuti durante le ore di mercato.
                        </p>
                         <p>
                           <strong>Prezzi Opzioni (PO):</strong> aggiornati ogni 5 minuti con (bid+ask)/2 da Yahoo Finance.
                         </p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  {derivatives.length} posizioni
                </p>
              </div>
            </div>

            <AppHeaderMenu />

          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        {isGlobalAggregate ? (
          <Card className="p-8 text-center">
            <CardContent className="space-y-3">
              <Info className="w-10 h-10 mx-auto text-muted-foreground" />
              <h2 className="text-lg font-semibold">Vista non disponibile</h2>
              <p className="text-muted-foreground">
                La vista Strategie Derivati non è disponibile per l'aggregato globale.
                Seleziona un singolo portafoglio o l'aggregato di un utente per visualizzare i dettagli.
              </p>
            </CardContent>
          </Card>
        ) : (<>
        {/* Strategy Config Wizard — mounted only when open */}
        {wizardOpen && (
          <ErrorBoundary title="Errore nel Wizard Strategie">
            <StrategyConfigWizard
              open={wizardOpen}
              onOpenChange={setWizardOpenPersisted}
              derivatives={derivatives}
              allPositions={positions}
              existingConfigs={strategyConfigs}
              onSave={handleSaveConfigs}
              isSaving={isConfigSaving}
              draftKey={portfolio?.id ?? selectedPortfolioId}
              archivedKeys={archivedItems.map(a => a.key)}
              archivedItems={archivedItems}
              onArchive={(key, displayName) => {
                if (portfolio?.id) {
                  archiveMutation.mutate({ portfolioId: portfolio.id, underlyingKey: key, displayName });
                }
              }}
              onUnarchive={(key) => {
                if (portfolio?.id) {
                  unarchiveMutation.mutate({ portfolioId: portfolio.id, underlyingKey: key });
                }
              }}
              onCancelOverride={cancelOverride}
              dynamicAliases={dynamicAliases}
            />
          </ErrorBoundary>
        )}

        {/* Info + Riconfigura button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Info aggiornamento dati</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-4 h-4 text-muted-foreground cursor-pointer" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                  <p><strong>Dashboard e Risk Analyzer:</strong> dati aggiornati ai prezzi del file Excel caricato.</p>
                  <p className="mt-1"><strong>Strategie Derivati:</strong> prezzi opzioni delayed 15 min, prezzi sottostanti aggiornati ogni 5 min.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {derivatives.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setWizardOpenPersisted(true)} className="relative">
              <Settings className="w-4 h-4 mr-2" />
              {hasConfigurations ? 'Riconfigura strategie' : 'Configura strategie'}
              {needsWizard && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-orange-500" />
              )}
            </Button>
          )}
        </div>
        {/* Empty state: no configurations saved yet */}
        {!hasConfigurations && derivatives.length > 0 && (
          <Card className="p-8 text-center border-dashed">
            <CardContent className="space-y-4">
              <Settings className="w-12 h-12 mx-auto text-muted-foreground" />
              <h2 className="text-lg font-semibold">Configura le strategie derivati</h2>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Per visualizzare le strategie, configura prima come classificare le posizioni derivati.
                La configurazione verrà ricordata per i prossimi upload.
              </p>
              <Button onClick={() => setWizardOpenPersisted(true)}>
                <Settings className="w-4 h-4 mr-2" />
                Configura strategie
              </Button>
            </CardContent>
          </Card>
        )}


        {/* Main content — only show when configurations exist */}
        {hasConfigurations && (<>

        {/* Summary Card */}
        <DerivativesSummaryCard
          categories={categories}
          allPositions={positions}
          stockPositions={stockPositions}
          underlyingPrices={underlyingPrices}
          strategyConfigs={strategyConfigs}
          archivedKeys={archivedItems.map(a => a.key)}
          dynamicAliases={dynamicAliases}
          missingCount={missingCount}
          isFetchingMissing={isFetchingMissing}
        />
        
        {/* Section 1: Covered Call (Collapsible) */}
        {(categories.coveredCalls.length > 0 || incCovered.length > 0) && (
        <Collapsible open={coveredCallOpen} onOpenChange={setCoveredCallOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-primary" />
                    <CardTitle className="text-xl">Covered Call</CardTitle>
                    <Badge variant="secondary" className="text-xs">{categories.coveredCalls.length + incCovered.length}</Badge>
                  </div>
                  {coveredCallOpen ? (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="space-y-1 overflow-x-auto">
                  <div className="grid grid-cols-[1.25rem_2rem_minmax(12rem,1fr)_2rem_3rem_3rem_5rem_2rem_8rem_4.5rem_5rem_8rem] gap-2 items-center px-3 pb-1 border border-transparent min-w-[980px] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <span className="col-span-3 text-left">Sottostante / Strategia</span>
                    <span /><span />
                    <span className="text-center">Stato</span>
                    <span className="text-right">Target</span>
                    <span />
                    <span className="text-right">Netto unit.</span>
                    <span className="text-right">Contratti</span>
                    <span className="text-right">PMC</span>
                    <span className="text-right">Prezzo</span>
                  </div>
                  {categories.coveredCalls.map((cc, index) => (
                    <CoveredCallRow 
                      key={index} 
                      coveredCall={cc} 
                      stockPositions={stockPositions} 
                      getOverrideForPosition={getOverrideForPosition}
                      underlyingPrices={underlyingPrices}
                      totalContractsForUnderlying={
                        totalCoveredCallContractsByUnderlying[
                          cc.underlying.description || cc.option.underlying || ''
                        ] || cc.contractsCovered
                      }
                      getPremiumByTickerAndSymbol={getPremiumByTickerAndSymbol}
                    />
                  ))}
                  {incCovered.map((inc, i) => (
                    <IncompleteStrategyRow key={`inc-cc-${i}`} inc={inc} underlyingPrices={underlyingPrices} />
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
        )}


        {(completeDrcc.length > 0 || incDrcc.length > 0) && (
        <Collapsible open={deRiskingOpen} onOpenChange={setDeRiskingOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Shield className="w-5 h-5 text-primary" />
                      <Umbrella className="w-3 h-3 text-emerald-500 absolute -bottom-0.5 -right-0.5" />
                    </div>
                    <CardTitle className="text-xl">De-Risking Covered Call</CardTitle>
                    <Badge variant="secondary" className="text-xs">{completeDrcc.length + incDrcc.length}</Badge>
                  </div>
                  {deRiskingOpen ? (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="space-y-1 overflow-x-auto">
                  <div className="grid grid-cols-[1.25rem_2rem_minmax(12rem,1fr)_2rem_3rem_3rem_5rem_2rem_8rem_4.5rem_5rem_8rem] gap-2 items-center px-3 pb-1 border border-transparent min-w-[980px] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <span className="col-span-3 text-left">Sottostante / Strategia</span>
                    <span /><span />
                    <span className="text-center">Stato</span>
                    <span className="text-right">Target</span>
                    <span />
                    <span className="text-right">Netto unit.</span>
                    <span className="text-right">Contratti</span>
                    <span className="text-right">PMC</span>
                    <span className="text-right">Prezzo</span>
                  </div>
                  {completeDrcc.map((dr, index) => (
                    <DeRiskingCoveredCallRow 
                      key={index} 
                      deRiskingCC={dr} 
                      stockPositions={stockPositions} 
                      getOverrideForPosition={getOverrideForPosition}
                      underlyingPrices={underlyingPrices}
                      getPremiumByTickerAndSymbol={getPremiumByTickerAndSymbol}
                    />
                  ))}
                  {incDrcc.map((inc, i) => (
                    <IncompleteStrategyRow key={`inc-drcc-${i}`} inc={inc} underlyingPrices={underlyingPrices} />
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
        )}

        {/* Section 3: Iron Condor */}
        {(categories.ironCondors.length > 0 || incIronCondor.length > 0) && (
        <Collapsible open={ironCondorOpen} onOpenChange={setIronCondorOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className="w-5 h-5 text-amber-500" />
                    <CardTitle className="text-xl">Iron Condor</CardTitle>
                    <Badge variant="secondary" className="text-xs">{categories.ironCondors.length + incIronCondor.length}</Badge>
                  </div>
                  {ironCondorOpen ? (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="space-y-1 overflow-x-auto">
                  <div className="grid grid-cols-[1.25rem_minmax(6rem,1fr)_4rem_3rem_3rem_5rem_6rem_4.5rem] gap-2 items-center px-3 pb-1 border border-transparent min-w-[880px] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <span className="col-span-2 text-left">Sottostante / Strategia</span>
                    <span />
                    <span className="text-center">Stato</span>
                    <span className="text-center">Scadenza</span>
                    <span className="text-center">PUT spread</span>
                    <span className="text-center">CALL spread</span>
                    <span className="text-right">Contratti</span>
                  </div>
                  {categories.ironCondors.map((ic, index) => (
                    <IronCondorRow key={index} ironCondor={ic} underlyingPrices={underlyingPrices} getPremiumByTickerAndSymbol={getPremiumByTickerAndSymbol} />
                  ))}
                  {incIronCondor.map((inc, i) => (
                    <IncompleteStrategyRow key={`inc-ic-${i}`} inc={inc} underlyingPrices={underlyingPrices} />
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
        )}

        {/* Section 3.5: Double Diagonal */}
        {(categories.doubleDiagonals.length > 0 || incDoubleDiagonal.length > 0) && (
        <Collapsible open={doubleDiagonalOpen} onOpenChange={setDoubleDiagonalOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-5 h-5 text-purple-500" />
                    <CardTitle className="text-xl">Double Diagonal</CardTitle>
                    <Badge variant="secondary" className="text-xs">{categories.doubleDiagonals.length + incDoubleDiagonal.length}</Badge>
                  </div>
                  {doubleDiagonalOpen ? (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="space-y-1 overflow-x-auto">
                  <div className="grid grid-cols-[1.25rem_minmax(6rem,1fr)_4rem_4rem_3rem_auto_6rem_6rem] gap-2 items-center px-3 pb-1 border border-transparent min-w-[880px] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <span className="col-span-2 text-left">Sottostante / Strategia</span>
                    <span />
                    <span className="text-center">Stato</span>
                    <span className="text-center">Scadenze</span>
                    <span className="text-center">PUT spread</span>
                    <span className="text-center">CALL spread</span>
                    <span className="text-right">Contratti</span>
                  </div>
                  {categories.doubleDiagonals.map((dd, index) => (
                    <DoubleDiagonalRow key={index} doubleDiagonal={dd} underlyingPrices={underlyingPrices} getPremiumByTickerAndSymbol={getPremiumByTickerAndSymbol} />
                  ))}
                  {incDoubleDiagonal.map((inc, i) => (
                    <IncompleteStrategyRow key={`inc-dd-${i}`} inc={inc} underlyingPrices={underlyingPrices} />
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
        )}

        {/* Section 4: Naked Put (Collapsible) */}
        {categories.nakedPuts.length > 0 && (
        <Collapsible open={nakedPutsOpen} onOpenChange={setNakedPutsOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CircleDollarSign className="w-5 h-5 text-red-500" />
                    <CardTitle className="text-xl">Naked Put</CardTitle>
                    <Badge variant="secondary" className="text-xs">{categories.nakedPuts.length}</Badge>
                  </div>
                  {nakedPutsOpen ? (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="space-y-1 overflow-x-auto">
                  <div className="grid grid-cols-[1.25rem_2rem_minmax(14rem,1fr)_2rem_3rem_2.5rem_5rem_2rem_8rem_4.5rem_5rem_8rem] gap-2 items-center px-3 pb-1 border border-transparent min-w-[1000px] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <span className="col-span-3 text-left">Sottostante / Strategia</span>
                    <span />
                    <span className="text-center">Stato</span>
                    <span className="text-center whitespace-nowrap flex items-center justify-center gap-0.5">
                      ROLL <ArrowUp className="w-3 h-3" />
                    </span>
                    <span className="text-right">Target</span>
                    <span />
                    <span className="text-right">Netto unit.</span>
                    <span className="text-right">Contratti</span>
                    <span className="text-right">PMC</span>
                    <span className="text-right">Prezzo</span>
                  </div>
                  {categories.nakedPuts.map((np, index) => (
                    <NakedPutRow key={index} nakedPut={np} stockPositions={stockPositions} getOverrideForPosition={getOverrideForPosition} underlyingPrices={underlyingPrices} getPremiumByTickerAndSymbol={getPremiumByTickerAndSymbol} />
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
        )}

        {/* Section 5a: Put Spread (Collapsible) */}
        {putSpreads.length > 0 && (
        <Collapsible open={putSpreadOpen} onOpenChange={setPutSpreadOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ArrowDownUp className="w-5 h-5 text-teal-500" />
                    <CardTitle className="text-xl">Put Spread</CardTitle>
                    <Badge variant="secondary" className="text-xs">{putSpreads.length}</Badge>
                  </div>
                  {putSpreadOpen ? (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="space-y-1 overflow-x-auto">
                  <div className="grid grid-cols-[1.25rem_minmax(10rem,1fr)_4rem_12rem_3.5rem_9rem_4rem_4.5rem_8rem] gap-3 items-center px-3 pb-1 border border-transparent min-w-[850px] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <span />
                    <span>Sottostante</span>
                    <span />
                    <span>Strategia</span>
                    <span className="text-center">Stato</span>
                    <span className="text-center">Break-even</span>
                    <span className="text-center">Gambe</span>
                    <span className="text-center">Call/Put</span>
                    <span className="text-right">P/L</span>
                  </div>
                  {putSpreads.map((group, index) => (
                    <GroupedOtherStrategyRow key={index} group={group} stockPositions={stockPositions} getOverrideForPosition={getOverrideForPosition} underlyingPrices={underlyingPrices} getPremiumByTickerAndSymbol={getPremiumByTickerAndSymbol} />
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
        )}

        {/* Section 5b: Diagonal Put Spread (Collapsible) */}
        {diagonalPutSpreads.length > 0 && (
        <Collapsible open={diagonalPutSpreadOpen} onOpenChange={setDiagonalPutSpreadOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ArrowDownUp className="w-5 h-5 text-indigo-500" />
                    <CardTitle className="text-xl">Diagonal Put Spread</CardTitle>
                    <Badge variant="secondary" className="text-xs">{diagonalPutSpreads.length}</Badge>
                  </div>
                  {diagonalPutSpreadOpen ? (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="space-y-1 overflow-x-auto">
                  <div className="grid grid-cols-[1.25rem_minmax(10rem,1fr)_4rem_12rem_3.5rem_9rem_4rem_4.5rem_8rem] gap-3 items-center px-3 pb-1 border border-transparent min-w-[850px] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <span />
                    <span>Sottostante</span>
                    <span />
                    <span>Strategia</span>
                    <span className="text-center">Stato</span>
                    <span className="text-center">Break-even</span>
                    <span className="text-center">Gambe</span>
                    <span className="text-center">Call/Put</span>
                    <span className="text-right">P/L</span>
                  </div>
                  {diagonalPutSpreads.map((group, index) => (
                    <GroupedOtherStrategyRow key={index} group={group} stockPositions={stockPositions} getOverrideForPosition={getOverrideForPosition} underlyingPrices={underlyingPrices} getPremiumByTickerAndSymbol={getPremiumByTickerAndSymbol} />
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
        )}

        {/* Section 6: Leap Call (Collapsible) */}
        {categories.leapCalls.length > 0 && (
        <Collapsible open={leapCallsOpen} onOpenChange={setLeapCallsOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Rocket className="w-5 h-5 text-blue-500" />
                    <CardTitle className="text-xl">Leap Call</CardTitle>
                    <Badge variant="secondary" className="text-xs">{categories.leapCalls.length}</Badge>
                  </div>
                  {leapCallsOpen ? (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="space-y-1 overflow-x-auto">
                  <div className="grid grid-cols-[1.25rem_2rem_minmax(12rem,1fr)_2rem_3rem_4.5rem_5rem_8rem] gap-2 items-center px-3 pb-1 border border-transparent min-w-[800px] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <span className="col-span-3 text-left">Sottostante / Strategia</span>
                    <span />
                    <span className="text-center">Stato</span>
                    <span className="text-right">Contratti</span>
                    <span className="text-right">PMC</span>
                    <span className="text-right">Prezzo</span>
                  </div>
                  {categories.leapCalls.map((lc, index) => (
                    <LeapCallRow key={index} leapCall={lc} stockPositions={stockPositions} getOverrideForPosition={getOverrideForPosition} underlyingPrices={underlyingPrices} />
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
        )}

        {/* Section 6: Protezioni - Long PUT (Collapsible) */}
        {categories.longPuts.length > 0 && (
        <Collapsible open={protectionsOpen} onOpenChange={setProtectionsOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Umbrella className="w-5 h-5 text-emerald-500" />
                    <CardTitle className="text-xl">Protezioni - Long Put</CardTitle>
                    <Badge variant="secondary" className="text-xs">{categories.longPuts.length}</Badge>
                  </div>
                  {protectionsOpen ? (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="space-y-1 overflow-x-auto">
                  <div className="grid grid-cols-[1.25rem_2rem_minmax(12rem,1fr)_2rem_3rem_3rem_4.5rem_5rem_8rem] gap-2 items-center px-3 pb-1 border border-transparent min-w-[800px] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <span className="col-span-3 text-left">Sottostante / Strategia</span>
                    <span /><span />
                    <span className="text-center">Stato</span>
                    <span className="text-right">Contratti</span>
                    <span className="text-right">PMC</span>
                    <span className="text-right">Prezzo</span>
                  </div>
                  {categories.longPuts.map((lp, index) => (
                    <LongPutRow key={index} longPut={lp} stockPositions={stockPositions} getOverrideForPosition={getOverrideForPosition} underlyingPrices={underlyingPrices} />
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
        )}

        {/* Section 7: Altre Strategie (Collapsible) */}
        {remainingOtherStrategies.length > 0 && (
        <Collapsible open={otherStrategiesOpen} onOpenChange={setOtherStrategiesOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Puzzle className="w-5 h-5 text-cyan-500" />
                    <CardTitle className="text-xl">Altre Strategie</CardTitle>
                    <Badge variant="secondary" className="text-xs">{remainingOtherStrategies.length}</Badge>
                  </div>
                  {otherStrategiesOpen ? (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="space-y-1 overflow-x-auto">
                  <div className="grid grid-cols-[1.25rem_minmax(10rem,1fr)_4rem_12rem_3.5rem_9rem_4rem_4.5rem_8rem] gap-3 items-center px-3 pb-1 border border-transparent min-w-[850px] text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <span />
                    <span>Sottostante</span>
                    <span />
                    <span>Strategia</span>
                    <span className="text-center">Stato</span>
                    <span className="text-center">Break-even</span>
                    <span className="text-center">Gambe</span>
                    <span className="text-center">Call/Put</span>
                    <span className="text-right">P/L</span>
                  </div>
                  {remainingOtherStrategies.map((group, index) => (
                    <GroupedOtherStrategyRow key={index} group={group} stockPositions={stockPositions} getOverrideForPosition={getOverrideForPosition} underlyingPrices={underlyingPrices} getPremiumByTickerAndSymbol={getPremiumByTickerAndSymbol} />
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
        )}
        </>)}
        </>)}
      </main>
    </div>
  );
}

interface RowProps {
  stockPositions: Position[];
  getOverrideForPosition: (positionId: string) => import('@/types/derivativeOverrides').DerivativeOverride | undefined;
}

interface RowPropsWithPrices extends RowProps {
  underlyingPrices: Record<string, UnderlyingPrice>;
}

interface CoveredCallRowProps extends RowPropsWithPrices {
  coveredCall: CoveredCallPosition;
  totalContractsForUnderlying: number;
  getPremiumByTickerAndSymbol: (ticker: string, optionSymbol: string) => CoveredCallPremium | undefined;
}

function CoveredCallRow({ coveredCall, stockPositions, getOverrideForPosition, underlyingPrices, totalContractsForUnderlying, getPremiumByTickerAndSymbol }: CoveredCallRowProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const { option, underlying, contractsCovered } = coveredCall;
  
  const hasOverride = !!getOverrideForPosition(option.id);
  
  // Calculate ITM/OTM status for CALL options
  // ITM: strike < underlying price, OTM: strike >= underlying price
  const strikePrice = option.strike_price || 0;
  const underlyingPrice = (option.underlying ? underlyingPrices[option.underlying]?.price : 0) || 0;
  const isITM = strikePrice < underlyingPrice;
  
  // For sold options (quantity < 0), P/L is inverted:
  // If option price drops, seller profits (can buy back cheaper)
  // If option price rises, seller loses (must buy back at higher price)
  const isSold = option.quantity < 0;
  const adjustedProfitLossPct = option.profit_loss_pct !== null && option.profit_loss_pct !== undefined
    ? (isSold ? -option.profit_loss_pct : option.profit_loss_pct)
    : null;
  
  // Calculate price change % vs avg cost (for sold options: green if negative, red if positive)
  const currentPrice = option.current_price || 0;
  const avgCost = option.avg_cost || 0;
  const priceChangePct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : null;
  
  // Calculate partial coverage badge using TOTAL contracts for this underlying (not just this row)
  const sharesOwned = underlying.quantity || 0;
  const potentialContracts = Math.floor(sharesOwned / 100);
  const uncoveredContracts = potentialContracts - totalContractsForUnderlying;
  const isPartialCoverage = uncoveredContracts >= 1;
  
  // Get ticker for calculator
  const ticker = option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined;
  
  // Derive option_symbol from strike + expiry to uniquely identify this CC position
  const optionSymbol = `C${option.strike_price || 0}_${option.expiry_date || 'noexp'}`;
  
  // Get saved premium data for this specific option position
  const savedPremium = ticker ? getPremiumByTickerAndSymbol(ticker, optionSymbol) : undefined;
  const netPerShare = savedPremium?.net_per_share;
  
  // Check if strategy legs are missing from calculator orders
  const ccLegs: StrategyLeg[] = [{ optionType: 'CALL', strikePrice: option.strike_price || 0, quantity: option.quantity }];
  const hasMissingLegs = savedPremium && (savedPremium.orders_json as ParsedOrder[]).length > 0
    ? !ccLegs.every(leg => isLegOpenInOrders(savedPremium.orders_json as ParsedOrder[], leg))
    : false;
  
  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div 
          role="button"
          tabIndex={0}
          onClick={() => setIsOpen(!isOpen)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
          className="grid grid-cols-[1.25rem_2rem_minmax(12rem,1fr)_2rem_3rem_3rem_5rem_2rem_8rem_4.5rem_5rem_8rem] gap-2 items-center p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors min-w-[980px]"
        >
            {/* Col 1: Chevron */}
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            
            {/* Col 2: V/A Badge */}
            <Badge variant="outline" className="text-xs text-green-500 border-green-500">V</Badge>
            
            {/* Col 3: Descrizione + Synthetic badge */}
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="flex items-baseline gap-2 min-w-0"><span className="font-medium truncate">{formatOptionDescription(option)}</span><span className="text-sm font-mono font-semibold text-cyan-300 whitespace-nowrap shrink-0">{(underlyingPrices[option.underlying || '']?.ticker || option.underlying)}: {formatCurrency(underlyingPrice, getOptionCurrency(option))}</span>{option.underlying && shouldShowStaleIndicator(underlyingPrices[option.underlying]) && (<StalePriceIndicator ticker={underlyingPrices[option.underlying]?.ticker} />)}</div>
              {coveredCall.isSynthetic && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span 
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-500/20 border border-orange-500/50 text-orange-400 text-xs font-bold cursor-pointer shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      S
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Synthetic position / short PUT delta -1</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            
            {/* Col 4: OptionStrat */}
            <OptionStratButton url={
              ticker
                ? (savedPremium?.orders_json?.length
                    ? buildOptionStratUrlFromOrders(savedPremium.orders_json, ticker, null)
                    : buildCoveredCallUrl(ticker, option))
                : null
            } />
            
            {/* Col 5: Badges (P!, Override) - larghezza fissa per allineamento */}
            <div className="flex items-center gap-1 w-12 justify-end">
              {isPartialCoverage && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span 
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-black border-2 border-yellow-400 text-yellow-400 text-xs font-bold cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      P!
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Covered Call parziale - numero titoli scoperti: {uncoveredContracts * 100}</p>
                  </TooltipContent>
                </Tooltip>
              )}
                          </div>
            
            {/* Col 6: ITM/OTM */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge 
                  variant="outline"
                  className={`text-xs cursor-pointer ${isITM ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-primary/20 border-primary/50 text-primary'}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {isITM ? 'ITM' : 'OTM'}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isITM ? 'In The Money: il sottostante è sopra lo strike' : 'Out of The Money: il sottostante è sotto lo strike'}</p>
              </TooltipContent>
            </Tooltip>
            

            
            {/* Col 7: Target da recuperare */}
            <RollTargetInput strategyKey={coveredCallKeyForPosition(option)} portfolioId={option.portfolio_id} />
            
            {/* Col 8: Calculator */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${
                    hasMissingLegs
                      ? 'text-destructive hover:text-destructive hover:bg-destructive/20'
                      : savedPremium && savedPremium.orders_json.length > 0
                        ? 'text-primary hover:text-primary hover:bg-primary/20'
                        : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowCalculator(true);
                  }}
                >
                  <Calculator className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Calcola premi CALL incassati</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Col 8: UNIT (net per share from saved premium) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span 
                  className={`text-sm text-right cursor-pointer font-mono font-medium whitespace-nowrap ${
                    netPerShare !== undefined 
                      ? netPerShare >= 0 
                        ? 'text-green-500' 
                        : 'text-red-500'
                      : 'text-muted-foreground'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {netPerShare !== undefined 
                    ? <>
                        {formatCurrency(netPerShare, getOptionCurrency(option))} {underlyingPrice > 0 && (
                          <span className="text-muted-foreground">
                            ({(netPerShare / underlyingPrice) * 100 >= 0 ? '+' : ''}{formatNumber((netPerShare / underlyingPrice) * 100, 1)}%)
                          </span>
                        )}
                      </>
                    : '-'
                  }
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Netto unitario premi (dalla calcolatrice)</p>
              </TooltipContent>
            </Tooltip>
            

            
            {/* Col 10: Contratti */}
            <span className="text-sm text-muted-foreground text-right">
              {contractsCovered} × 100
            </span>
            
            {/* Col 11: PMC */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm text-muted-foreground text-right cursor-pointer truncate" onClick={(e) => e.stopPropagation()}>
                {formatCurrency(option.avg_cost || 0, getOptionCurrency(option))}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Prezzo Medio di Carico Opzione</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Col 12: Prezzo + % */}
            <div className="flex items-center gap-1 justify-end whitespace-nowrap">
              <span className="font-mono font-semibold text-sm">
                {formatCurrency(option.current_price || 0, getOptionCurrency(option))}
              </span>
              {shouldShowOptionStaleIndicator(option, option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined) && (
                <StalePriceIndicator ticker={option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined} />
              )}
              {priceChangePct !== null && (
                <span className={`text-xs font-medium ${priceChangePct <= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {priceChangePct >= 0 ? '+' : ''}{priceChangePct.toFixed(1)}%
                </span>
              )}
            </div>
        </div>
        <CollapsibleContent>
          {(() => {
            const detailLegs: Position[] = [option];
            const detailLabels: (string | undefined)[] = [undefined];
            const synLeg = coveredCall.syntheticCall || coveredCall.syntheticPut;
            if (synLeg) { detailLegs.push(synLeg); detailLabels.push('Sintetica'); }
            return <LegsDetailList legs={detailLegs} labels={detailLabels} underlyingPrices={underlyingPrices} stock={coveredCall.isSynthetic ? null : underlying} />;
          })()}
        </CollapsibleContent>
      </Collapsible>
      
      <CallPremiumCalculatorDialog
        open={showCalculator}
        onOpenChange={setShowCalculator}
        underlying={option.underlying || underlying.description || ''}
        ticker={ticker}
        optionSymbol={optionSymbol}
        contractsInPortfolio={contractsCovered}
        underlyingPrice={(option.underlying ? underlyingPrices[option.underlying]?.price : 0) || 0}
        strategyLegs={ccLegs}
      />
    </>
  );
}


function DeRiskingCoveredCallRow({ deRiskingCC, stockPositions, getOverrideForPosition, underlyingPrices, getPremiumByTickerAndSymbol }: { deRiskingCC: DeRiskingCoveredCallPosition; getPremiumByTickerAndSymbol: (ticker: string, optionSymbol: string) => CoveredCallPremium | undefined } & RowPropsWithPrices) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const { coveredCall, protectionPut, isSynthetic, syntheticPut, syntheticCall } = deRiskingCC;
  const drccIncomplete = deRiskingCC.incomplete || coveredCall.incomplete;
  const drccMissingLegs = deRiskingCC.missingLegs || coveredCall.missingLegs || [];
  const { option, underlying, contractsCovered } = coveredCall;

  // ITM/OTM for the sold CALL
  const strikePrice = option.strike_price || 0;
  const underlyingPrice = (option.underlying ? underlyingPrices[option.underlying]?.price : 0) || 0;
  const isITM = strikePrice < underlyingPrice;

  const currentPrice = option.current_price || 0;
  const avgCost = option.avg_cost || 0;
  const priceChangePct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : null;

  // Get ticker for calculator & OptionStrat
  const ticker = option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined;
  const optionSymbol = `C${option.strike_price || 0}_${option.expiry_date || 'noexp'}`;
  const savedPremium = ticker ? getPremiumByTickerAndSymbol(ticker, optionSymbol) : undefined;
  const netPerShare = savedPremium?.net_per_share;
  const ccLegs: StrategyLeg[] = [{ optionType: 'CALL', strikePrice: option.strike_price || 0, quantity: option.quantity }];
  const hasMissingLegs = savedPremium && (savedPremium.orders_json as ParsedOrder[]).length > 0
    ? !ccLegs.every(leg => isLegOpenInOrders(savedPremium.orders_json as ParsedOrder[], leg))
    : false;

  // Protection PUT details (may be absent for synthetic DR-CC with bought CALL)
  const protPutPrice = protectionPut?.current_price || 0;
  const protPutAvgCost = protectionPut?.avg_cost || 0;
  const protPutChangePct = protPutAvgCost > 0 ? ((protPutPrice - protPutAvgCost) / protPutAvgCost) * 100 : null;

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div 
          role="button"
          tabIndex={0}
          onClick={() => setIsOpen(!isOpen)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
          className="grid grid-cols-[1.25rem_2rem_minmax(12rem,1fr)_2rem_3rem_3rem_5rem_2rem_8rem_4.5rem_5rem_8rem] gap-2 items-center p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors min-w-[980px]"
        >
            {/* Col 1: Chevron */}
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            
            {/* Col 2: V Badge */}
            <Badge variant="outline" className="text-xs text-green-500 border-green-500">V</Badge>
            
            {/* Col 3: Description + Synthetic badge */}
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="flex items-baseline gap-2 min-w-0"><span className="font-medium truncate">{formatOptionDescription(option)}</span><span className="text-sm font-mono font-semibold text-cyan-300 whitespace-nowrap shrink-0">{(underlyingPrices[option.underlying || '']?.ticker || option.underlying)}: {formatCurrency(underlyingPrice, getOptionCurrency(option))}</span>{option.underlying && shouldShowStaleIndicator(underlyingPrices[option.underlying]) && (<StalePriceIndicator ticker={underlyingPrices[option.underlying]?.ticker} />)}</div>
              {isSynthetic && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span 
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-500/20 border border-orange-500/50 text-orange-400 text-xs font-bold cursor-pointer shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      S
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Synthetic position / short PUT delta -1</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {drccIncomplete && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-orange-500/15 border border-orange-500/40 text-orange-500 text-[10px] font-semibold uppercase tracking-wide cursor-pointer shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <AlertTriangle className="w-3 h-3" /> Gamba mancante
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>DR-CC configurata ma manca: {drccMissingLegs.join(', ') || 'una gamba'}.</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            
            {/* Col 4: OptionStrat */}
            <OptionStratButton url={
              ticker
                ? (savedPremium?.orders_json?.length
                    ? buildOptionStratUrlFromOrders(savedPremium.orders_json, ticker, null)
                    : buildCoveredCallUrl(ticker, option))
                : null
            } />
            
            {/* Col 5: Badges */}
            <div className="flex items-center gap-1 w-12 justify-end">
                          </div>
            
            {/* Col 6: ITM/OTM */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge 
                  variant="outline"
                  className={`text-xs cursor-pointer ${isITM ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-primary/20 border-primary/50 text-primary'}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {isITM ? 'ITM' : 'OTM'}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isITM ? 'In The Money: il sottostante è sopra lo strike' : 'Out of The Money: il sottostante è sotto lo strike'}</p>
              </TooltipContent>
            </Tooltip>
            

            
            {/* Col 7: Target da recuperare */}
            <RollTargetInput strategyKey={deRiskingCoveredCallKeyForPosition(option)} portfolioId={option.portfolio_id} />
            
            {/* Col 8: Calculator */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${
                    hasMissingLegs
                      ? 'text-destructive hover:text-destructive hover:bg-destructive/20'
                      : savedPremium && savedPremium.orders_json.length > 0
                        ? 'text-primary hover:text-primary hover:bg-primary/20'
                        : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowCalculator(true);
                  }}
                >
                  <Calculator className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Calcola premi CALL incassati</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Col 9: UNIT */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span 
                  className={`text-sm text-right cursor-pointer font-mono font-medium whitespace-nowrap ${
                    netPerShare !== undefined 
                      ? netPerShare >= 0 
                        ? 'text-green-500' 
                        : 'text-red-500'
                      : 'text-muted-foreground'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {netPerShare !== undefined 
                    ? <>
                        {formatCurrency(netPerShare, getOptionCurrency(option))} {underlyingPrice > 0 && (
                          <span className="text-muted-foreground">
                            ({(netPerShare / underlyingPrice) * 100 >= 0 ? '+' : ''}{formatNumber((netPerShare / underlyingPrice) * 100, 1)}%)
                          </span>
                        )}
                      </>
                    : '-'
                  }
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Netto unitario premi (dalla calcolatrice)</p>
              </TooltipContent>
            </Tooltip>
            

            
            {/* Col 11: Contratti */}
            <span className="text-sm text-muted-foreground text-right">
              {contractsCovered} × 100
            </span>
            
            {/* Col 12: PMC */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm text-muted-foreground text-right cursor-pointer truncate" onClick={(e) => e.stopPropagation()}>
                {formatCurrency(option.avg_cost || 0, getOptionCurrency(option))}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Prezzo Medio di Carico Opzione</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Col 13: Prezzo + % */}
            <div className="flex items-center gap-1 justify-end whitespace-nowrap">
              <span className="font-mono font-semibold text-sm">
                {formatCurrency(option.current_price || 0, getOptionCurrency(option))}
              </span>
              {shouldShowOptionStaleIndicator(option, option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined) && (
                <StalePriceIndicator ticker={option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined} />
              )}
              {priceChangePct !== null && (
                <span className={`text-xs font-medium ${priceChangePct <= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {priceChangePct >= 0 ? '+' : ''}{priceChangePct.toFixed(1)}%
                </span>
              )}
            </div>
        </div>
        <CollapsibleContent>
          {(() => {
            const detailLegs: Position[] = [option];
            const detailLabels: (string | undefined)[] = [undefined];
            if (protectionPut) { detailLegs.push(protectionPut); detailLabels.push('Protettiva'); }
            const synLeg = syntheticCall || syntheticPut;
            if (synLeg) { detailLegs.push(synLeg); detailLabels.push('Sintetica'); }
            return <LegsDetailList legs={detailLegs} labels={detailLabels} underlyingPrices={underlyingPrices} stock={isSynthetic ? null : underlying} />;
          })()}
        </CollapsibleContent>
      </Collapsible>
      
      <CallPremiumCalculatorDialog
        open={showCalculator}
        onOpenChange={setShowCalculator}
        underlying={option.underlying || underlying.description || ''}
        ticker={ticker}
        optionSymbol={optionSymbol}
        contractsInPortfolio={contractsCovered}
        underlyingPrice={underlyingPrice}
        strategyLegs={ccLegs}
        isDeRisking
      />
    </>
  );
}

function LongPutRow({ longPut, stockPositions, getOverrideForPosition, underlyingPrices }: { longPut: LongPutPosition } & RowPropsWithPrices) {
  const [isOpen, setIsOpen] = useState(false);
  const { option, underlying, contracts, isPartial } = longPut;
  
  const hasOverride = !!getOverrideForPosition(option.id);
  
  // Calculate ITM/OTM status for PUT options
  // PUT is ITM when strike > underlying price (you can sell at higher than market)
  // PUT is OTM when strike <= underlying price
  const strikePrice = option.strike_price || 0;
  const underlyingPrice = (option.underlying ? underlyingPrices[option.underlying]?.price : 0) || 0;
  const hasUnderlyingPrice = underlyingPrice > 0;
  const isITM = hasUnderlyingPrice && strikePrice > underlyingPrice;

  const currentPrice = option.current_price || 0;
  const avgCost = option.avg_cost || 0;
  const priceChangePct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : null;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div 
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
className="grid grid-cols-[1.25rem_2rem_minmax(12rem,1fr)_2rem_3rem_3rem_4.5rem_5rem_8rem] gap-2 items-center p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors min-w-[800px]"
      >
          {/* Col 1: Chevron */}
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          
          {/* Col 2: V/A Badge */}
          <Badge variant="outline" className="text-xs text-red-500 border-red-500">A</Badge>
          
          {/* Col 3: Descrizione */}
          <div className="flex items-baseline gap-2 min-w-0"><span className="font-medium truncate">{formatOptionDescription(option)}</span><span className="text-sm font-mono font-semibold text-cyan-300 whitespace-nowrap shrink-0">{(underlyingPrices[option.underlying || '']?.ticker || option.underlying)}: {formatCurrency(underlyingPrice, getOptionCurrency(option))}</span>{option.underlying && shouldShowStaleIndicator(underlyingPrices[option.underlying]) && (<StalePriceIndicator ticker={underlyingPrices[option.underlying]?.ticker} />)}</div>
          
          {/* Col 4: OptionStrat */}
          <OptionStratButton url={option.underlying && underlyingPrices[option.underlying]?.ticker ? buildLongPutUrl(underlyingPrices[option.underlying].ticker, option) : null} />
          
          {/* Col 5: Badges (P!, Override) - larghezza fissa per allineamento */}
          <div className="flex items-center gap-1 w-12 justify-end">
            {isPartial && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span 
                    className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-black border-2 border-yellow-400 text-yellow-400 text-xs font-bold cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    P!
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Protezione parziale</p>
                </TooltipContent>
              </Tooltip>
            )}
                      </div>
          
          {/* Col 6: ITM/OTM */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge 
                variant="outline"
                className={`text-xs cursor-pointer ${!hasUnderlyingPrice ? 'bg-muted border-muted-foreground/50 text-muted-foreground' : isITM ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-primary/20 border-primary/50 text-primary'}`}
                onClick={(e) => e.stopPropagation()}
              >
                {!hasUnderlyingPrice ? '-' : isITM ? 'ITM' : 'OTM'}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>{!hasUnderlyingPrice ? 'Prezzo sottostante non disponibile' : isITM ? 'In The Money: il sottostante è sotto lo strike' : 'Out of The Money: il sottostante è sopra lo strike'}</p>
            </TooltipContent>
          </Tooltip>
          

          

          
          {/* Col 8: Contratti */}
          <span className="text-sm text-muted-foreground text-right">
            {contracts} × 100
          </span>
          
          {/* Col 9: PMC */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm text-muted-foreground text-right cursor-pointer truncate" onClick={(e) => e.stopPropagation()}>
              {formatCurrency(option.avg_cost || 0, getOptionCurrency(option))}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Prezzo Medio di Carico Opzione</p>
            </TooltipContent>
          </Tooltip>
          
          {/* Col 10: Prezzo */}
          <div className="flex items-center gap-1 justify-end whitespace-nowrap">
            <span className="font-mono font-semibold text-sm">
              {formatCurrency(option.current_price || 0, getOptionCurrency(option))}
            </span>
            {shouldShowOptionStaleIndicator(option, option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined) && (
              <StalePriceIndicator ticker={option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined} />
            )}
            {priceChangePct !== null && (
              <span className={`text-xs font-medium ${priceChangePct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {priceChangePct >= 0 ? '+' : ''}{priceChangePct.toFixed(1)}%
              </span>
            )}
          </div>
      </div>
      <CollapsibleContent>
        <div className="ml-7 mt-2 p-3 rounded-lg border border-border/50 bg-muted/30 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Sottostante</p>
              <p className="font-medium">{option.underlying || option.description}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Strike</p>
              <p className="font-medium">{option.strike_price}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Scadenza</p>
              <p className="font-medium">{formatExpiryMMY(option.expiry_date)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Prezzo Opzione</p>
              <p className="font-medium">{formatCurrency(option.current_price || 0, getOptionCurrency(option))}</p>
            </div>
          </div>
          {option.profit_loss_pct !== null && (
            <div className="text-xs text-muted-foreground">
              P/L: {formatPercentage(option.profit_loss_pct)}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function IronCondorRow({ ironCondor, underlyingPrices, getPremiumByTickerAndSymbol }: { ironCondor: IronCondorPosition; underlyingPrices: Record<string, UnderlyingPrice>; getPremiumByTickerAndSymbol: (ticker: string, optionSymbol: string) => CoveredCallPremium | undefined }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const { underlying, expiryDate, soldPut, boughtPut, soldCall, boughtCall, contracts } = ironCondor;
  
  const expiryFormatted = formatExpiryMMY(expiryDate);
  
  // Get underlying price from Yahoo Finance
  const underlyingPrice = underlyingPrices[underlying]?.price || 0;
  const hasUnderlyingPrice = underlyingPrice > 0;
  const legCurrency = soldCall.currency || soldPut.currency || 'USD';
  
  // Check for saved GP from calculator
  const ticker = underlyingPrices[underlying]?.ticker;
  const optionSymbol = `IC_${expiryDate || 'unknown'}`;
  const savedPremium = ticker ? getPremiumByTickerAndSymbol(ticker, optionSymbol) : undefined;
  const hasSavedGP = savedPremium && savedPremium.orders_json.length > 0;
  
  // Strategy legs for missing-legs check
  const icLegs: StrategyLeg[] = [
    { optionType: 'PUT', strikePrice: soldPut.strike_price || 0, quantity: soldPut.quantity },
    { optionType: 'PUT', strikePrice: boughtPut.strike_price || 0, quantity: boughtPut.quantity },
    { optionType: 'CALL', strikePrice: soldCall.strike_price || 0, quantity: soldCall.quantity },
    { optionType: 'CALL', strikePrice: boughtCall.strike_price || 0, quantity: boughtCall.quantity },
  ];
  const hasMissingLegs = hasSavedGP
    ? !icLegs.every(leg => isLegOpenInOrders(savedPremium.orders_json as ParsedOrder[], leg))
    : false;
  
  // Calculate if underlying price is In Range (between sold strikes)
  const soldPutStrike = soldPut.strike_price || 0;
  const soldCallStrike = soldCall.strike_price || 0;
  const isInRange = hasUnderlyingPrice && underlyingPrice >= soldPutStrike && underlyingPrice <= soldCallStrike;
  
  // P/L = saved GP + market value of open positions
  const marketValuePositions = 
    ((boughtPut.current_price || 0) * Math.abs(boughtPut.quantity) * 100) +
    ((boughtCall.current_price || 0) * Math.abs(boughtCall.quantity) * 100) -
    ((soldPut.current_price || 0) * Math.abs(soldPut.quantity) * 100) -
    ((soldCall.current_price || 0) * Math.abs(soldCall.quantity) * 100);
  const avgCostValue = 
    ((soldPut.avg_cost || 0) * Math.abs(soldPut.quantity) * 100) +
    ((soldCall.avg_cost || 0) * Math.abs(soldCall.quantity) * 100) +
    ((boughtPut.avg_cost || 0) * Math.abs(boughtPut.quantity) * 100) +
    ((boughtCall.avg_cost || 0) * Math.abs(boughtCall.quantity) * 100);
  const totalPL = hasSavedGP
    ? savedPremium.net_per_share + marketValuePositions
    : avgCostValue + marketValuePositions;
  
  // Strikes summary
  const putSpread = `${boughtPut.strike_price}/${soldPutStrike}`;
  const callSpread = `${soldCallStrike}/${boughtCall.strike_price}`;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div 
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
          className="grid grid-cols-[1.25rem_minmax(6rem,1fr)_4rem_3rem_3rem_5rem_6rem_4.5rem] gap-2 items-center p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors min-w-[880px]"
      >
          {/* Col 1: Chevron */}
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          
          {/* Col 2: Underlying */}
          <div className="flex items-baseline gap-2 min-w-0"><span className="font-medium truncate">{underlying}</span><span className="text-sm font-mono font-semibold text-cyan-300 whitespace-nowrap shrink-0">{(ticker || underlying)}: {formatCurrency(underlyingPrice, legCurrency)}</span>{shouldShowStaleIndicator(underlyingPrices[underlying]) && (<StalePriceIndicator ticker={underlyingPrices[underlying]?.ticker} />)}</div>
          
          {/* Col 3: OptionStrat + Calculator */}
          <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            <OptionStratButton url={
              ticker
                ? (savedPremium?.orders_json?.length
                    ? buildOptionStratUrlFromOrders(savedPremium.orders_json, ticker, 'Iron Condor')
                    : buildIronCondorUrl(ticker, boughtPut, soldPut, soldCall, boughtCall))
                : null
            } />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 shrink-0 ${
                    hasMissingLegs
                      ? 'text-destructive hover:text-destructive hover:bg-destructive/20'
                      : hasSavedGP
                        ? 'text-primary hover:text-primary hover:bg-primary/20'
                        : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowCalculator(true);
                  }}
                >
                  <Calculator className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Calcola flussi di cassa</p>
              </TooltipContent>
            </Tooltip>
          </div>
          
          {/* Col 5: IR/OOR */}
          <div className="flex justify-center">
            {hasUnderlyingPrice ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge 
                    variant="outline"
                    className={`text-xs ${isInRange 
                      ? 'bg-green-500/20 border-green-500/50 text-green-400' 
                      : 'bg-red-500/20 border-red-500/50 text-red-400'}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isInRange ? 'IR' : 'OOR'}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isInRange 
                    ? `In Range: prezzo tra ${soldPutStrike} e ${soldCallStrike}` 
                    : `Out of Range: prezzo fuori da ${soldPutStrike}-${soldCallStrike}`}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
          
          {/* Col 5: Scadenza */}
          <span className="text-xs text-muted-foreground text-right">
            {expiryFormatted}
          </span>
          
          {/* Col 6: PUT spread */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground cursor-pointer text-right truncate" onClick={(e) => e.stopPropagation()}>
                PUT {putSpread}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Put Spread: Buy {boughtPut.strike_price} / Sell {soldPut.strike_price}</p>
            </TooltipContent>
          </Tooltip>
          
          {/* Col 7: CALL spread */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground cursor-pointer text-right truncate" onClick={(e) => e.stopPropagation()}>
                CALL {callSpread}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Call Spread: Sell {soldCall.strike_price} / Buy {boughtCall.strike_price}</p>
            </TooltipContent>
          </Tooltip>
          

          
          {/* Col 9: Contratti */}
          <span className="text-sm text-muted-foreground text-right">
            {contracts} × 100
          </span>
      </div>
      <CollapsibleContent>
        <LegsDetailList
          underlyingPrices={underlyingPrices}
          legs={[soldCall, boughtCall, soldPut, boughtPut]}
          labels={['Short Call', 'Long Call (protezione)', 'Short Put', 'Long Put (protezione)']}
        />
      </CollapsibleContent>
      
      <CallPremiumCalculatorDialog
        open={showCalculator}
        onOpenChange={setShowCalculator}
        underlying={underlying}
        ticker={underlyingPrices[underlying]?.ticker}
        optionSymbol={`IC_${expiryDate || 'unknown'}`}
        contractsInPortfolio={contracts}
        underlyingPrice={underlyingPrice}
        strategyType="iron_condor"
        strategyLegs={icLegs}
      />
    </Collapsible>
  );
}

function DoubleDiagonalRow({ doubleDiagonal, underlyingPrices, getPremiumByTickerAndSymbol }: { doubleDiagonal: DoubleDiagonalPosition; underlyingPrices: Record<string, UnderlyingPrice>; getPremiumByTickerAndSymbol: (ticker: string, optionSymbol: string) => CoveredCallPremium | undefined }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const { underlying, soldExpiryDate, boughtExpiryDate, soldPut, boughtPut, soldCall, boughtCall, contracts } = doubleDiagonal;
  
  const soldExpiryFormatted = formatExpiryMMY(soldExpiryDate);
  const boughtExpiryFormatted = formatExpiryMMY(boughtExpiryDate);
  
  // Get underlying price from Yahoo Finance
  const underlyingPrice = underlyingPrices[underlying]?.price || 0;
  const hasUnderlyingPrice = underlyingPrice > 0;
  const legCurrency = soldCall.currency || soldPut.currency || 'USD';
  
  // Check for saved GP from calculator
  const ticker = underlyingPrices[underlying]?.ticker;
  const optionSymbol = `DD_${soldExpiryDate || 'unknown'}`;
  const savedPremium = ticker ? getPremiumByTickerAndSymbol(ticker, optionSymbol) : undefined;
  const hasSavedGP = savedPremium && savedPremium.orders_json.length > 0;
  
  // Strategy legs for missing-legs check
  const ddLegs: StrategyLeg[] = [
    { optionType: 'PUT', strikePrice: soldPut.strike_price || 0, quantity: soldPut.quantity },
    { optionType: 'PUT', strikePrice: boughtPut.strike_price || 0, quantity: boughtPut.quantity },
    { optionType: 'CALL', strikePrice: soldCall.strike_price || 0, quantity: soldCall.quantity },
    { optionType: 'CALL', strikePrice: boughtCall.strike_price || 0, quantity: boughtCall.quantity },
  ];
  const hasMissingLegs = hasSavedGP
    ? !ddLegs.every(leg => isLegOpenInOrders(savedPremium.orders_json as ParsedOrder[], leg))
    : false;
  
  // Calculate if underlying price is In Range (between sold strikes)
  const soldPutStrike = soldPut.strike_price || 0;
  const soldCallStrike = soldCall.strike_price || 0;
  const isInRange = hasUnderlyingPrice && underlyingPrice >= soldPutStrike && underlyingPrice <= soldCallStrike;
  
  // Calculate P/L = saved GP from calculator + market value of open positions
  const marketValuePositions = 
    ((boughtPut.current_price || 0) * Math.abs(boughtPut.quantity) * 100) +
    ((boughtCall.current_price || 0) * Math.abs(boughtCall.quantity) * 100) -
    ((soldPut.current_price || 0) * Math.abs(soldPut.quantity) * 100) -
    ((soldCall.current_price || 0) * Math.abs(soldCall.quantity) * 100);
  const avgCostValue = 
    ((soldPut.avg_cost || 0) * Math.abs(soldPut.quantity) * 100) +
    ((soldCall.avg_cost || 0) * Math.abs(soldCall.quantity) * 100) +
    ((boughtPut.avg_cost || 0) * Math.abs(boughtPut.quantity) * 100) +
    ((boughtCall.avg_cost || 0) * Math.abs(boughtCall.quantity) * 100);
  const totalPL = hasSavedGP
    ? savedPremium.net_per_share + marketValuePositions
    : avgCostValue + marketValuePositions;
  
  // Strikes summary
  const putSpread = `${boughtPut.strike_price}/${soldPutStrike}`;
  const callSpread = `${soldCallStrike}/${boughtCall.strike_price}`;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div 
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
        className="grid grid-cols-[1.25rem_minmax(6rem,1fr)_4rem_4rem_3rem_auto_6rem_6rem] gap-2 items-center p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors min-w-[880px]"
      >
          {/* Grid: Chevron | Underlying | OptionStrat | IR/OOR | Scadenze | PUT spread | CALL spread | Contratti | P/L */}
          {/* Col 1: Chevron */}
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          
          {/* Col 2: Underlying */}
          <div className="flex items-baseline gap-2 min-w-0"><span className="font-medium truncate">{underlying}</span><span className="text-sm font-mono font-semibold text-cyan-300 whitespace-nowrap shrink-0">{(ticker || underlying)}: {formatCurrency(underlyingPrice, legCurrency)}</span>{shouldShowStaleIndicator(underlyingPrices[underlying]) && (<StalePriceIndicator ticker={underlyingPrices[underlying]?.ticker} />)}</div>
          
          {/* Col 3: OptionStrat + Calculator */}
          <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            <OptionStratButton url={
              ticker
                ? (savedPremium?.orders_json?.length
                    ? buildOptionStratUrlFromOrders(savedPremium.orders_json, ticker, 'Double Diagonal')
                    : buildDoubleDiagonalUrl(ticker, soldPut, boughtPut, soldCall, boughtCall))
                : null
            } />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 shrink-0 ${
                    hasMissingLegs
                      ? 'text-destructive hover:text-destructive hover:bg-destructive/20'
                      : hasSavedGP
                        ? 'text-primary hover:text-primary hover:bg-primary/20'
                        : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowCalculator(true);
                  }}
                >
                  <Calculator className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Calcola flussi di cassa</p>
              </TooltipContent>
            </Tooltip>
          </div>
          
          {/* Col 3: IR/OOR */}
          <div className="flex justify-center">
            {hasUnderlyingPrice ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge 
                    variant="outline"
                    className={`text-xs ${isInRange 
                      ? 'bg-green-500/20 border-green-500/50 text-green-400' 
                      : 'bg-red-500/20 border-red-500/50 text-red-400'}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isInRange ? 'IR' : 'OOR'}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isInRange 
                    ? `In Range: prezzo tra ${soldPutStrike} e ${soldCallStrike}` 
                    : `Out of Range: prezzo fuori da ${soldPutStrike}-${soldCallStrike}`}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
          
          {/* Col 4: Scadenze */}
          <span className="text-xs text-muted-foreground text-right">
            {soldExpiryFormatted} - {boughtExpiryFormatted}
          </span>
          
          {/* Col 5: PUT spread */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground cursor-pointer text-right truncate" onClick={(e) => e.stopPropagation()}>
                PUT {putSpread}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Put Spread: Buy {boughtPut.strike_price} / Sell {soldPut.strike_price}</p>
            </TooltipContent>
          </Tooltip>
          
          {/* Col 6: CALL spread */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground cursor-pointer text-right truncate" onClick={(e) => e.stopPropagation()}>
                CALL {callSpread}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Call Spread: Sell {soldCall.strike_price} / Buy {boughtCall.strike_price}</p>
            </TooltipContent>
          </Tooltip>
          
          {/* Col 7: Contratti */}
          <span className="text-sm text-muted-foreground text-right">
            {contracts} × 100
          </span>
          

      </div>
      <CollapsibleContent>
        <LegsDetailList
          underlyingPrices={underlyingPrices}
          legs={[soldCall, boughtCall, soldPut, boughtPut]}
          labels={['Short Call', 'Long Call (protezione)', 'Short Put', 'Long Put (protezione)']}
        />
      </CollapsibleContent>
      
      <CallPremiumCalculatorDialog
        open={showCalculator}
        onOpenChange={setShowCalculator}
        underlying={underlying}
        ticker={underlyingPrices[underlying]?.ticker}
        optionSymbol={`DD_${soldExpiryDate || 'unknown'}`}
        contractsInPortfolio={contracts}
        underlyingPrice={underlyingPrice}
        strategyType="double_diagonal"
        strategyLegs={ddLegs}
      />
    </Collapsible>
  );
}

function GroupedOtherStrategyRow({ group, stockPositions, getOverrideForPosition, underlyingPrices, getPremiumByTickerAndSymbol }: { group: GroupedOtherStrategy; getPremiumByTickerAndSymbol: (ticker: string, optionSymbol: string) => CoveredCallPremium | undefined } & RowPropsWithPrices) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const { underlying, options, totalProfitLoss, strategyName } = group;
  
  // Get underlying price from live Yahoo data (updated every 5 min by cron)
  const underlyingPrice = underlyingPrices[underlying]?.price || 0;
  const hasUnderlyingPrice = underlyingPrice > 0;
  const legCurrency = options[0]?.option.currency || 'USD';
  
  // Check for saved GP from calculator
  const ticker = underlyingPrices[underlying]?.ticker;
  const optionSymbol = `OS_${underlying}`;
  const savedPremium = ticker ? getPremiumByTickerAndSymbol(ticker, optionSymbol) : undefined;
  const hasSavedGP = savedPremium && savedPremium.orders_json.length > 0;
  
  // Strategy legs for missing-legs check
  const osLegs: StrategyLeg[] = options.map(o => ({
    optionType: (o.option.option_type === 'call' ? 'CALL' : 'PUT') as 'CALL' | 'PUT',
    strikePrice: o.option.strike_price || 0,
    quantity: o.option.quantity,
  }));
  const hasMissingLegs = hasSavedGP
    ? !osLegs.every(leg => isLegOpenInOrders(savedPremium.orders_json as ParsedOrder[], leg))
    : false;
  
  // Calculate IR/OOR for strategies with sold PUT and CALL (Alternative Double Diagonal, Short Strangle)
  // or single-sided spread strategies (Put Spread, Call Spread, Diagonal Put/Call Spread)
  const isAltDoubleDiagonal = strategyName === 'Alternative Double Diagonal';
  const isShortStrangle = strategyName === 'Short Strangle';
  const isPutSpread = strategyName === 'Put Spread' || strategyName === 'Diagonal Put Spread';
  const isCallSpread = strategyName === 'Call Spread' || strategyName === 'Diagonal Call Spread';
  const showRangeBadge = isAltDoubleDiagonal || isShortStrangle || isPutSpread || isCallSpread;
  
  let isInRange = false;
  let soldPutStrike = 0;
  let soldCallStrike = 0;
  let rangeDisplay = '';
  
  if (showRangeBadge && hasUnderlyingPrice) {
    if (isAltDoubleDiagonal || isShortStrangle) {
      // Logica esistente: range tra PUT venduta e CALL venduta
      const soldPut = options.find(o => o.option.option_type === 'put' && o.option.quantity < 0);
      const soldCall = options.find(o => o.option.option_type === 'call' && o.option.quantity < 0);
      
      if (soldPut && soldCall) {
        soldPutStrike = soldPut.option.strike_price || 0;
        soldCallStrike = soldCall.option.strike_price || 0;
        isInRange = underlyingPrice >= soldPutStrike && underlyingPrice <= soldCallStrike;
        rangeDisplay = `${soldPutStrike} - ${soldCallStrike}`;
      }
    } else if (isPutSpread) {
      // Put Spread: IR se prezzo >= strike PUT venduta
      const soldPut = options.find(o => o.option.option_type === 'put' && o.option.quantity < 0);
      if (soldPut) {
        soldPutStrike = soldPut.option.strike_price || 0;
        isInRange = underlyingPrice >= soldPutStrike;
        rangeDisplay = `≥ ${soldPutStrike}`;
      }
    } else if (isCallSpread) {
      // Call Spread: IR se prezzo <= strike CALL venduta
      const soldCall = options.find(o => o.option.option_type === 'call' && o.option.quantity < 0);
      if (soldCall) {
        soldCallStrike = soldCall.option.strike_price || 0;
        isInRange = underlyingPrice <= soldCallStrike;
        rangeDisplay = `≤ ${soldCallStrike}`;
      }
    }
  }
  
  // IB/OOB logic for strategies other than Short Strangle and Alternative Double Diagonal
  const showBreakevenBadge = !showRangeBadge && hasUnderlyingPrice;
  let isInBreakeven = false;
  let breakevens: number[] = [];
  
  if (showBreakevenBadge) {
    // Convert options to DerivativePosition for using existing functions
    const derivativePositions: DerivativePosition[] = options.map(o => ({
      ...o.option,
      asset_type: 'derivative' as const,
      strike_price: o.option.strike_price || 0,
      expiry_date: o.option.expiry_date || '',
      underlying: o.option.underlying || underlying,
      option_type: o.option.option_type as OptionType,
    }));
    
    // Calculate payoff and find breakevens, including GP offset from calculator
    const priceRange = getPriceRangeForPositions(derivativePositions);
    const payoffPoints = calculateOptionPayoff(derivativePositions, underlyingPrice, priceRange);
    const gpOffset = hasSavedGP ? savedPremium.net_per_share : 0;
    const adjustedPayoffPoints = gpOffset !== 0
      ? payoffPoints.map(p => ({ ...p, payoff: p.payoff + gpOffset }))
      : payoffPoints;
    breakevens = findBreakevenPoints(adjustedPayoffPoints);
    
    // If there are at least 2 breakevens, check if price is in range
    if (breakevens.length >= 2) {
      const minBE = Math.min(...breakevens);
      const maxBE = Math.max(...breakevens);
      isInBreakeven = underlyingPrice >= minBE && underlyingPrice <= maxBE;
    } else if (breakevens.length === 1) {
      // With a single breakeven, show IB if we are in profit at current price
      const stepSize = (priceRange.max - priceRange.min) / 100;
      const currentPayoff = adjustedPayoffPoints.find(p => Math.abs(p.price - underlyingPrice) < stepSize);
      isInBreakeven = currentPayoff ? currentPayoff.payoff >= 0 : false;
    }
  }
  
  // Count calls and puts
  const callCount = options.filter(o => o.option.option_type === 'call').length;
  const putCount = options.filter(o => o.option.option_type === 'put').length;

  // Combined P/L: saved GP from calculator + market value of open positions
  const marketValuePositions = options.reduce((sum, o) => {
    const mv = (o.option.current_price || 0) * o.option.quantity * 100;
    return sum + mv;
  }, 0);
  const avgCostValue = options.reduce((sum, o) => {
    const acv = (o.option.avg_cost || 0) * o.option.quantity * 100;
    return sum + acv;
  }, 0);
  const combinedPL = hasSavedGP
    ? savedPremium.net_per_share + marketValuePositions
    : avgCostValue + marketValuePositions;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div 
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
        className="grid grid-cols-[1.25rem_minmax(10rem,1fr)_4rem_12rem_3.5rem_9rem_4rem_4.5rem_8rem] gap-3 items-center p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors min-w-[850px]"
      >
          {/* Colonna 1: Chevron */}
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          
          {/* Colonna 2: Underlying */}
          <div className="flex items-baseline gap-2 min-w-0"><span className="font-medium truncate">{underlying}</span><span className="text-sm font-mono font-semibold text-cyan-300 whitespace-nowrap shrink-0">{(ticker || underlying)}: {formatCurrency(underlyingPrice, legCurrency)}</span>{shouldShowStaleIndicator(underlyingPrices[underlying]) && (<StalePriceIndicator ticker={underlyingPrices[underlying]?.ticker} />)}</div>
          
          {/* Colonna 3: OptionStrat + Calculator */}
          <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            <OptionStratButton url={
              ticker
                ? (savedPremium?.orders_json?.length
                    ? buildOptionStratUrlFromOrders(savedPremium.orders_json, ticker, strategyName)
                    : buildGroupedStrategyUrl(ticker, options.map(o => o.option), strategyName))
                : null
            } />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 shrink-0 ${
                    hasMissingLegs
                      ? 'text-destructive hover:text-destructive hover:bg-destructive/20'
                      : hasSavedGP
                        ? 'text-primary hover:text-primary hover:bg-primary/20'
                        : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowCalculator(true);
                  }}
                >
                  <Calculator className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Calcola flussi di cassa</p>
              </TooltipContent>
            </Tooltip>
          </div>
          
          {/* Colonna 4: Badge Strategia */}
          <div className="flex justify-start">
            {strategyName ? (
              <Badge variant="outline" className="text-xs shrink-0 border-primary text-primary">
                {strategyName}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
          
          {/* Colonna 4: Badge IB/OOB o IR/OOR */}
          <div className="flex justify-center">
            {showRangeBadge && hasUnderlyingPrice && rangeDisplay ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge 
                    variant="outline"
                    className={`text-xs shrink-0 ${isInRange 
                      ? 'bg-green-500/20 border-green-500/50 text-green-400' 
                      : 'bg-red-500/20 border-red-500/50 text-red-400'}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isInRange ? 'IR' : 'OOR'}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isInRange 
                    ? `In Range: prezzo ${rangeDisplay}` 
                    : `Out of Range: prezzo non ${rangeDisplay}`}</p>
                </TooltipContent>
              </Tooltip>
            ) : showBreakevenBadge && breakevens.length > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge 
                    variant="outline"
                    className={`text-xs shrink-0 ${isInBreakeven 
                      ? 'bg-green-500/20 border-green-500/50 text-green-400' 
                      : 'bg-red-500/20 border-red-500/50 text-red-400'}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isInBreakeven ? 'IB' : 'OOB'}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isInBreakeven 
                    ? 'In Breakeven: prezzo nel range profittevole' 
                    : 'Out of Breakeven: prezzo fuori dal range profittevole'}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
          
          {/* Colonna 5: BE Range */}
          <div className="text-right">
            {showBreakevenBadge && breakevens.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                BE: {breakevens.length >= 2 
                  ? `${Math.min(...breakevens).toFixed(2)} - ${Math.max(...breakevens).toFixed(2)}` 
                  : breakevens[0].toFixed(2)}
              </span>
            ) : showRangeBadge && hasUnderlyingPrice && rangeDisplay ? (
              <span className="text-xs text-muted-foreground">
                {rangeDisplay}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
          
          {/* Colonna 6: Badge Gambe */}
          <div className="flex justify-center">
            <Badge variant="secondary" className="text-xs shrink-0">
              {options.length} gambe
            </Badge>
          </div>
          
          {/* Colonna 7: Conteggio Call/Put */}
          <div className="text-right">
            <span className="text-xs text-muted-foreground">
              {callCount > 0 && `${callCount}C`}
              {callCount > 0 && putCount > 0 && ' • '}
              {putCount > 0 && `${putCount}P`}
            </span>
          </div>
          

          
          {/* Colonna 9: P/L */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={`flex items-center gap-1 cursor-pointer justify-end whitespace-nowrap ${hasSavedGP ? (combinedPL >= 0 ? 'text-green-500' : 'text-red-500') : 'text-yellow-500'}`} onClick={(e) => e.stopPropagation()}>
                <span className="text-xs text-muted-foreground">P/L:</span>
                <span className="text-sm">{formatCurrency(combinedPL, legCurrency)}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{hasSavedGP ? `Profit/Loss: flussi di cassa calcolatrice + valore mercato posizioni aperte` : 'P/L calcolato senza operazioni storiche caricate'}</p>
            </TooltipContent>
          </Tooltip>
      </div>
      <CollapsibleContent>
        <div className="ml-7 mt-2 space-y-2">
          {options.map((os, idx) => (
            <GroupedOptionLegRow 
              key={idx} 
              otherStrategy={os} 
              stockPositions={stockPositions} 
              getOverrideForPosition={getOverrideForPosition}
              underlyingPrices={underlyingPrices}
            />
          ))}
        </div>
      </CollapsibleContent>
      
      <CallPremiumCalculatorDialog
        open={showCalculator}
        onOpenChange={setShowCalculator}
        underlying={underlying}
        ticker={underlyingPrices[underlying]?.ticker}
        optionSymbol={`OS_${underlying}`}
        contractsInPortfolio={options.reduce((sum, o) => sum + Math.abs(o.option.quantity), 0)}
        underlyingPrice={underlyingPrice}
        strategyType="other_strategy"
        strategyLegs={osLegs}
      />
    </Collapsible>
  );
}

function GroupedOptionLegRow({ otherStrategy, stockPositions, getOverrideForPosition, underlyingPrices }: { otherStrategy: OtherStrategyPosition, underlyingPrices: Record<string, { price: number; currency: string }> } & RowProps) {
  const { option, underlying } = otherStrategy;
  
  const hasOverride = !!getOverrideForPosition(option.id);
  
  const isCall = option.option_type === 'call';
  const isPut = option.option_type === 'put';
  const isBought = option.quantity > 0;
  
  // Calculate ITM/OTM
  const strikePrice = option.strike_price || 0;
  const underlyingPrice = underlyingPrices[option.underlying || '']?.price || 0;
  const hasUnderlyingPrice = underlyingPrice > 0;
  
  let isITM = false;
  if (hasUnderlyingPrice) {
    if (isCall) {
      isITM = strikePrice < underlyingPrice;
    } else if (isPut) {
      isITM = strikePrice > underlyingPrice;
    }
  }
  
  const optionTypeLabel = isCall ? 'CALL' : isPut ? 'PUT' : 'OPT';
  
  return (
    <div className="flex items-center justify-between p-2 rounded-lg border border-border/50 bg-muted/30">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Badge 
          variant="outline"
          className={`text-xs shrink-0 w-5 justify-center ${isBought ? 'text-red-500 border-red-500' : 'text-green-500 border-green-500'}`}
        >
          {isBought ? 'A' : 'V'}
        </Badge>
        <span className="text-sm">{optionTypeLabel}</span>
        <span className="font-medium text-sm">{option.strike_price}</span>
        <span className="text-xs text-muted-foreground">{formatExpiryMMY(option.expiry_date)}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge 
              variant="outline"
              className={`text-xs shrink-0 cursor-pointer ${!hasUnderlyingPrice ? 'bg-muted border-muted-foreground/50 text-muted-foreground' : isITM ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-primary/20 border-primary/50 text-primary'}`}
              onClick={(e) => e.stopPropagation()}
            >
              {!hasUnderlyingPrice ? '-' : isITM ? 'ITM' : 'OTM'}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>{!hasUnderlyingPrice ? 'Prezzo sottostante non disponibile' : isITM ? (isCall ? 'In The Money: il sottostante è sopra lo strike' : 'In The Money: il sottostante è sotto lo strike') : (isCall ? 'Out of The Money: il sottostante è sotto lo strike' : 'Out of The Money: il sottostante è sopra lo strike')}</p>
          </TooltipContent>
        </Tooltip>
              </div>
      <div className="flex items-center gap-4 shrink-0">
        <span />
        <span className="text-sm text-muted-foreground">
          {Math.abs(option.quantity)} × 100
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-sm text-muted-foreground cursor-pointer" onClick={(e) => e.stopPropagation()}>
               PMC: {formatCurrency(option.avg_cost || 0, getOptionCurrency(option))}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Prezzo Medio di Carico Opzione</p>
          </TooltipContent>
        </Tooltip>
        <span className="font-mono font-semibold text-sm">
          {formatCurrency(option.current_price || 0, getOptionCurrency(option))}
        </span>
      </div>
    </div>
  );
}

function NakedPutRow({ nakedPut, stockPositions, getOverrideForPosition, underlyingPrices, getPremiumByTickerAndSymbol }: { nakedPut: NakedPutPosition; getPremiumByTickerAndSymbol: (ticker: string, optionSymbol: string) => CoveredCallPremium | undefined } & RowPropsWithPrices) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const { option, underlying, contracts } = nakedPut;
  
  const hasOverride = !!getOverrideForPosition(option.id);
  
  // Calculate ITM/OTM status for PUT options
  const strikePrice = option.strike_price || 0;
  const underlyingPrice = (option.underlying ? underlyingPrices[option.underlying]?.price : 0) || 0;
  const hasUnderlyingPrice = underlyingPrice > 0;
  const isITM = hasUnderlyingPrice && underlyingPrice < strikePrice;
  
  const currentPrice = option.current_price || 0;
  const avgCost = option.avg_cost || 0;
  const priceChangePct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : null;
  
  // Get ticker for calculator
  const ticker = option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined;
  
  // Derive option_symbol for naked put
  const optionSymbol = `NP_P${option.strike_price || 0}_${option.expiry_date || 'noexp'}`;
  
  // Get saved premium data
  const savedPremium = ticker ? getPremiumByTickerAndSymbol(ticker, optionSymbol) : undefined;
  const netPerShare = savedPremium?.net_per_share;
  
  // Strategy legs for missing-legs check
  const npLegs: StrategyLeg[] = [{ optionType: 'PUT', strikePrice: option.strike_price || 0, quantity: option.quantity }];
  const hasMissingLegs = savedPremium && (savedPremium.orders_json as ParsedOrder[]).length > 0
    ? !npLegs.every(leg => isLegOpenInOrders(savedPremium.orders_json as ParsedOrder[], leg))
    : false;
  
  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div 
          role="button"
          tabIndex={0}
          onClick={() => setIsOpen(!isOpen)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
          className="grid grid-cols-[1.25rem_2rem_minmax(14rem,1fr)_2rem_3rem_2.5rem_5rem_2rem_8rem_4.5rem_5rem_8rem] gap-2 items-center p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors min-w-[1000px]"
        >
            {/* Col 1: Chevron */}
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            
            {/* Col 2: V Badge */}
            <Badge variant="outline" className="text-xs text-green-500 border-green-500">V</Badge>
            
            {/* Col 3: Descrizione */}
            <div className="flex items-baseline gap-2 min-w-0"><span className="font-medium truncate">{formatOptionDescription(option)}</span><span className="text-sm font-mono font-semibold text-cyan-300 whitespace-nowrap shrink-0">{(underlyingPrices[option.underlying || '']?.ticker || option.underlying)}: {formatCurrency(underlyingPrice, getOptionCurrency(option))}</span>{option.underlying && shouldShowStaleIndicator(underlyingPrices[option.underlying]) && (<StalePriceIndicator ticker={underlyingPrices[option.underlying]?.ticker} />)}</div>
            
            {/* Col 4: OptionStrat */}
            <OptionStratButton url={option.underlying && underlyingPrices[option.underlying]?.ticker ? buildNakedPutUrl(underlyingPrices[option.underlying].ticker, option) : null} />
            
            {/* Col 5: ITM/OTM */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge 
                  variant="outline"
                  className={`text-xs cursor-pointer ${!hasUnderlyingPrice ? 'bg-muted border-muted-foreground/50 text-muted-foreground' : isITM ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-primary/20 border-primary/50 text-primary'}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {!hasUnderlyingPrice ? '-' : isITM ? 'ITM' : 'OTM'}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>{!hasUnderlyingPrice ? 'Prezzo sottostante non disponibile' : isITM ? 'In The Money: il sottostante è sotto lo strike' : 'Out of The Money: il sottostante è sopra lo strike'}</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Col 6: Roll-up toggle */}
            <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <PutRollUpToggle option={option} hideLabel />
            </div>
            
            {/* Col 7: Target da recuperare (roll-up) */}
            <RollTargetInput strategyKey={nakedPutKeyForPosition(option)} portfolioId={option.portfolio_id} />
            
            {/* Col 8: Calculator */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${
                    hasMissingLegs
                      ? 'text-destructive hover:text-destructive hover:bg-destructive/20'
                      : savedPremium && savedPremium.orders_json.length > 0
                        ? 'text-primary hover:text-primary hover:bg-primary/20'
                        : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowCalculator(true);
                  }}
                >
                  <Calculator className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Calcola flussi di cassa PUT</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Col 9: UNIT */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span 
                  className={`text-sm text-right cursor-pointer font-mono font-medium whitespace-nowrap ${
                    netPerShare !== undefined 
                      ? netPerShare >= 0 
                        ? 'text-green-500' 
                        : 'text-red-500'
                      : 'text-muted-foreground'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {netPerShare !== undefined 
                    ? <>
                        {formatCurrency(netPerShare, getOptionCurrency(option))} {underlyingPrice > 0 && (
                          <span className="text-muted-foreground">
                            ({(netPerShare / underlyingPrice) * 100 >= 0 ? '+' : ''}{formatNumber((netPerShare / underlyingPrice) * 100, 1)}%)
                          </span>
                        )}
                      </>
                    : '-'
                  }
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Netto unitario flussi di cassa PUT (dalla calcolatrice)</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Col 11: Contratti */}
            <span className="text-sm font-mono text-muted-foreground text-right">
              {contracts} × 100
            </span>
            
            {/* Col 11: PMC */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm font-mono text-muted-foreground text-right cursor-pointer truncate" onClick={(e) => e.stopPropagation()}>
                  {formatCurrency(option.avg_cost || 0, getOptionCurrency(option))}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Prezzo Medio di Carico Opzione</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Col 12: Prezzo */}
            <div className="flex flex-col items-end justify-center leading-tight whitespace-nowrap">
              <span className="font-mono font-semibold text-sm flex items-center gap-1">
                {formatCurrency(option.current_price || 0, getOptionCurrency(option))}
                {shouldShowOptionStaleIndicator(option, option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined) && (
                  <StalePriceIndicator ticker={option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined} />
                )}
              </span>
              {priceChangePct !== null && (
                <span className={`text-[10px] font-mono ${priceChangePct <= 0 ? 'text-[#089981]' : 'text-[#F23645]'}`}>
                  {priceChangePct >= 0 ? '+' : ''}{priceChangePct.toFixed(1)}%
                </span>
              )}
            </div>
        </div>
        <CollapsibleContent>
          <div className="ml-7 mt-2 p-3 rounded-lg border border-border/50 bg-muted/30 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Sottostante</p>
                <p className="font-medium">{option.underlying || option.description}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Strike</p>
                <p className="font-medium">{option.strike_price}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Scadenza</p>
                <p className="font-medium">{formatExpiryMMY(option.expiry_date)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Prezzo Opzione</p>
                <p className="font-medium">{formatCurrency(option.current_price || 0, getOptionCurrency(option))}</p>
              </div>
            </div>
            {option.profit_loss_pct !== null && (
              <div className="text-xs text-muted-foreground">
                P/L: {formatPercentage(option.profit_loss_pct)}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
      
      <CallPremiumCalculatorDialog
        open={showCalculator}
        onOpenChange={setShowCalculator}
        underlying={option.underlying || option.description || ''}
        ticker={ticker}
        optionSymbol={optionSymbol}
        contractsInPortfolio={contracts}
        underlyingPrice={underlyingPrice}
        strategyType="other_strategy"
        strategyLegs={npLegs}
      />
    </>
  );
}

function LeapCallRow({ leapCall, stockPositions, getOverrideForPosition, underlyingPrices }: { leapCall: LeapCallPosition } & RowPropsWithPrices) {
  const [isOpen, setIsOpen] = useState(false);
  const { option, underlying, contracts } = leapCall;
  
  const hasOverride = !!getOverrideForPosition(option.id);
  
  // Calculate Gain/Loss status based on current price vs avg cost
  const currentPrice = option.current_price || 0;
  const avgCost = option.avg_cost || 0;
  const hasValidPrices = currentPrice > 0 && avgCost > 0;
  const isInGain = hasValidPrices && currentPrice > avgCost;
  const priceChangePct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : null;
  
  // Get underlying price from live Yahoo data (updated every 5 min by cron)
  const underlyingPrice = (option.underlying ? underlyingPrices[option.underlying]?.price : 0) || 0;
  const hasUnderlyingPrice = underlyingPrice > 0;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div 
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
        className="grid grid-cols-[1.25rem_2rem_minmax(12rem,1fr)_2rem_3rem_4.5rem_5rem_8rem] gap-2 items-center p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors min-w-[800px]"
      >
          {/* Col 1: Chevron */}
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          
          {/* Col 2: A Badge */}
          <Badge variant="outline" className="text-xs text-red-500 border-red-500">A</Badge>
          
          {/* Col 3: Descrizione */}
          <div className="flex items-baseline gap-2 min-w-0"><span className="font-medium truncate">{formatOptionDescription(option)}</span><span className="text-sm font-mono font-semibold text-cyan-300 whitespace-nowrap shrink-0">{(underlyingPrices[option.underlying || '']?.ticker || option.underlying)}: {formatCurrency(underlyingPrice, getOptionCurrency(option))}</span>{option.underlying && shouldShowStaleIndicator(underlyingPrices[option.underlying]) && (<StalePriceIndicator ticker={underlyingPrices[option.underlying]?.ticker} />)}</div>
          
          {/* Col 4: OptionStrat */}
          <OptionStratButton url={option.underlying && underlyingPrices[option.underlying]?.ticker ? buildLeapCallUrl(underlyingPrices[option.underlying].ticker, option) : null} />
          
          {/* Col 5: Gain/Loss Badge (G green if price > avg cost, L red if price < avg cost) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge 
                variant="outline"
                className={`text-xs cursor-pointer ${!hasValidPrices ? 'bg-muted border-muted-foreground/50 text-muted-foreground' : isInGain ? 'bg-green-500/20 border-green-500/50 text-green-400' : 'bg-red-500/20 border-red-500/50 text-red-400'}`}
                onClick={(e) => e.stopPropagation()}
              >
                {!hasValidPrices ? '-' : isInGain ? 'G' : 'L'}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>{!hasValidPrices ? 'Prezzi non disponibili' : isInGain ? 'In Gain: la Leap sta guadagnando' : 'Loss: la Leap sta perdendo'}</p>
            </TooltipContent>
          </Tooltip>
          

          

          

          
          {/* Col 8: Contratti */}
          <span className="text-sm text-muted-foreground text-right">
            {contracts} × 100
          </span>
          
          {/* Col 9: PMC */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm text-muted-foreground text-right cursor-pointer truncate" onClick={(e) => e.stopPropagation()}>
                {formatCurrency(avgCost, getOptionCurrency(option))}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Prezzo Medio di Carico Opzione</p>
            </TooltipContent>
          </Tooltip>
          
          {/* Col 10: Prezzo + % */}
          <div className="flex items-center gap-1 justify-end whitespace-nowrap">
            <span className="font-semibold text-sm">
              {formatCurrency(currentPrice, getOptionCurrency(option))}
            </span>
            {shouldShowOptionStaleIndicator(option, option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined) && (
              <StalePriceIndicator ticker={option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined} />
            )}
            {priceChangePct !== null && (
              <span className={`text-xs font-medium ${priceChangePct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {priceChangePct >= 0 ? '+' : ''}{priceChangePct.toFixed(1)}%
              </span>
            )}
          </div>
      </div>
      <CollapsibleContent>
        <div className="ml-7 mt-2 p-3 rounded-lg border border-border/50 bg-muted/30 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Sottostante</p>
              <p className="font-medium">{option.underlying || option.description}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Strike</p>
              <p className="font-medium">{option.strike_price}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Scadenza</p>
              <p className="font-medium">{formatExpiryMMY(option.expiry_date)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Prezzo Opzione</p>
              <p className="font-medium">{formatCurrency(currentPrice, getOptionCurrency(option))}</p>
            </div>
          </div>
          {option.profit_loss_pct !== null && (
            <div className="text-xs text-muted-foreground">
              P/L: {formatPercentage(option.profit_loss_pct)}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DerivativesSkeleton() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="container mx-auto space-y-6">
        <Skeleton className="h-12 w-64 rounded-lg" />
        <Skeleton className="h-[200px] rounded-lg" />
        <Skeleton className="h-[60px] rounded-lg" />
        <Skeleton className="h-[200px] rounded-lg" />
      </div>
    </div>
  );
}

export default Derivatives;
