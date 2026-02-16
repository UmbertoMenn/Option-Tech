import { useAuth } from '@/contexts/AuthContext';
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
import { TrendingUp, LogOut, Settings, ArrowLeft, Shield, Target, ChevronDown, ChevronRight, ShieldAlert, Layers, CircleDollarSign, Puzzle, Umbrella, Rocket, Calculator, HelpCircle, Menu, Sun, Moon, Info } from 'lucide-react';
import { useTheme } from 'next-themes';
import { IronCondorIcon } from '@/components/ui/iron-condor-icon';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useNavigate } from 'react-router-dom';
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
import { useMemo, useState, useEffect, useRef } from 'react';
import { 
  categorizeDerivatives, 
  formatOptionDescription,
  CoveredCallPosition,
  LongPutPosition,
  IronCondorPosition,
  DoubleDiagonalPosition,
  NakedPutPosition,
  LeapCallPosition,
  OtherStrategyPosition,
  GroupedOtherStrategy
} from '@/lib/derivativeStrategies';
import { formatCurrency, formatPercentage, formatNumber } from '@/lib/formatters';
import { 
  calculateOptionPayoff, 
  findBreakevenPoints, 
  getPriceRangeForPositions 
} from '@/lib/optionCalculator';
import { DerivativePosition, OptionType } from '@/types/portfolio';
import { MoveOptionMenu, OverrideBadge } from '@/components/derivatives/MoveOptionMenu';
import { CallPremiumCalculatorDialog } from '@/components/derivatives/CallPremiumCalculatorDialog';
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
import { PortfolioSelector } from '@/components/portfolio/PortfolioSelector';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { saveStrategyCache } from '@/lib/strategyCache';

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

export function Derivatives() {
  const { user, isAdmin, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const { portfolio, positions, isLoading } = usePortfolio();
  const { overrides, getOverrideForPosition } = useDerivativeOverrides();
  const { premiums: ccPremiums, getPremiumByTickerAndSymbol } = useCoveredCallPremiums(portfolio?.id);
  const [coveredCallOpen, setCoveredCallOpen] = useState(false);
  const [deRiskingOpen, setDeRiskingOpen] = useState(false);
  const [ironCondorOpen, setIronCondorOpen] = useState(false);
  const [doubleDiagonalOpen, setDoubleDiagonalOpen] = useState(false);
  const [nakedPutsOpen, setNakedPutsOpen] = useState(false);
  const [leapCallsOpen, setLeapCallsOpen] = useState(false);
  const [otherStrategiesOpen, setOtherStrategiesOpen] = useState(false);

  const derivatives = useMemo(() => 
    positions.filter(p => p.asset_type === 'derivative'),
    [positions]
  );

  const stockPositions = useMemo(() => 
    positions.filter(p => p.asset_type === 'stock'),
    [positions]
  );

  const categories = useMemo(() => {
    const raw = categorizeDerivatives(derivatives, positions, overrides);
    
    // Sort functions for different types
    // For types where underlying is a Position object, use option.underlying field
    const sortByOptionUnderlying = <T extends { option: Position }>(arr: T[]): T[] =>
      [...arr].sort((a, b) => (a.option.underlying || '').localeCompare(b.option.underlying || ''));
    
    // For types where underlying is a string
    const sortByUnderlyingString = <T extends { underlying: string }>(arr: T[]): T[] =>
      [...arr].sort((a, b) => a.underlying.localeCompare(b.underlying));
    
    return {
      ...raw,
      coveredCalls: sortByOptionUnderlying(raw.coveredCalls),
      longPuts: sortByOptionUnderlying(raw.longPuts),
      ironCondors: sortByUnderlyingString(raw.ironCondors),
      doubleDiagonals: sortByUnderlyingString(raw.doubleDiagonals),
      nakedPuts: sortByOptionUnderlying(raw.nakedPuts),
      leapCalls: sortByOptionUnderlying(raw.leapCalls),
      groupedOtherStrategies: sortByUnderlyingString(raw.groupedOtherStrategies),
    };
  }, [derivatives, positions, overrides]);

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
  const { prices: underlyingPrices, isLoading: isPricesLoading } = useUnderlyingPrices(allUnderlyingNames);
  
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
                      <HelpCircle className="w-4 h-4 text-muted-foreground cursor-help hidden sm:inline" />
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
              <div className="ml-4 hidden sm:block">
                <PortfolioSelector />
              </div>
            </div>

            {/* Mobile: Indice dropdown */}
            <div className="sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Indice <Menu className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
                    <div className="w-full"><PortfolioSelector /></div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/')}>
                    <ArrowLeft className="w-4 h-4 mr-2" /> Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/risk-analyzer')}>
                    <ShieldAlert className="w-4 h-4 mr-2" /> Risk Analyzer
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem onClick={() => navigate('/admin')}>
                      <Settings className="w-4 h-4 mr-2" /> Admin
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                    {theme === 'dark' ? <Sun className="w-4 h-4 mr-2" /> : <Moon className="w-4 h-4 mr-2" />}
                    {theme === 'dark' ? 'Tema chiaro' : 'Tema scuro'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={signOut}>
                    <LogOut className="w-4 h-4 mr-2" /> Esci
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            
            {/* Desktop: full button bar */}
            <div className="hidden sm:flex items-center gap-2 overflow-x-auto flex-nowrap">
              <Button variant="outline" size="sm" asChild className="shrink-0">
                <Link to="/">
                  <ArrowLeft className="w-4 h-4" />
                  <span className="ml-2">Dashboard</span>
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="shrink-0">
                <Link to="/risk-analyzer">
                  <ShieldAlert className="w-4 h-4" />
                  <span className="ml-2">Risk Analyzer</span>
                </Link>
              </Button>
              {isAdmin && (
                <Button variant="outline" size="sm" asChild className="shrink-0">
                  <Link to="/admin">
                    <Settings className="w-4 h-4" />
                    <span className="ml-2">Admin</span>
                  </Link>
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'Tema chiaro' : 'Tema scuro'} className="shrink-0">
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={signOut} className="shrink-0">
                <LogOut className="w-4 h-4" />
                <span className="ml-2">Esci</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        {/* Info aggiornamento dati */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Info aggiornamento dati</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-4 h-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                <p><strong>Dashboard e Risk Analyzer:</strong> dati aggiornati ai prezzi del file Excel caricato.</p>
                <p className="mt-1"><strong>Strategie Derivati:</strong> prezzi opzioni delayed 15 min, prezzi sottostanti aggiornati ogni 5 min.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Summary Card */}
        <DerivativesSummaryCard 
          categories={categories}
          stockPositions={stockPositions}
          underlyingPrices={underlyingPrices}
          totalCoveredCallContractsByUnderlying={totalCoveredCallContractsByUnderlying}
        />
        
        {/* Section 1: Covered Call (Collapsible) */}
        <Collapsible open={coveredCallOpen} onOpenChange={setCoveredCallOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-primary" />
                    <CardTitle className="text-xl">Covered Call</CardTitle>
                    <Badge variant="secondary" className="text-xs">{categories.coveredCalls.length}</Badge>
                  </div>
                  {coveredCallOpen ? (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground text-left">
                  CALL vendute con sottostante in portafoglio
                </p>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                {categories.coveredCalls.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <p className="text-sm">Nessuna Covered Call presente</p>
                  </div>
                ) : (
                  <div className="space-y-1 overflow-x-auto">
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
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 2: Protezioni - Long PUT (Collapsible) */}
        <Collapsible open={deRiskingOpen} onOpenChange={setDeRiskingOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Umbrella className="w-5 h-5 text-emerald-500" />
                    <CardTitle className="text-xl">Protezioni - Long Put</CardTitle>
                    <Badge variant="secondary" className="text-xs">{categories.longPuts.length}</Badge>
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
                {categories.longPuts.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <p className="text-sm">Nessuna protezione Long Put presente</p>
                  </div>
                ) : (
                  <div className="space-y-1 overflow-x-auto">
                    {categories.longPuts.map((lp, index) => (
                      <LongPutRow key={index} longPut={lp} stockPositions={stockPositions} getOverrideForPosition={getOverrideForPosition} underlyingPrices={underlyingPrices} />
                    ))}
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 3: Iron Condor */}
        <Collapsible open={ironCondorOpen} onOpenChange={setIronCondorOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className="w-5 h-5 text-amber-500" />
                    <CardTitle className="text-xl">Iron Condor</CardTitle>
                    <Badge variant="secondary" className="text-xs">{categories.ironCondors.length}</Badge>
                  </div>
                  {ironCondorOpen ? (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground text-left">
                  Strategie a 4 gambe con rischio limitato
                </p>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                {categories.ironCondors.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <p className="text-sm">Nessun Iron Condor presente</p>
                  </div>
                ) : (
                  <div className="space-y-1 overflow-x-auto">
                    {categories.ironCondors.map((ic, index) => (
                      <IronCondorRow key={index} ironCondor={ic} underlyingPrices={underlyingPrices} getPremiumByTickerAndSymbol={getPremiumByTickerAndSymbol} />
                    ))}
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 3.5: Double Diagonal */}
        <Collapsible open={doubleDiagonalOpen} onOpenChange={setDoubleDiagonalOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-5 h-5 text-purple-500" />
                    <CardTitle className="text-xl">Double Diagonal</CardTitle>
                    <Badge variant="secondary" className="text-xs">{categories.doubleDiagonals.length}</Badge>
                  </div>
                  {doubleDiagonalOpen ? (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground text-left">
                  Strategie a 4 gambe con scadenze differenti
                </p>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                {categories.doubleDiagonals.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <p className="text-sm">Nessun Double Diagonal presente</p>
                  </div>
                ) : (
                  <div className="space-y-1 overflow-x-auto">
                    {categories.doubleDiagonals.map((dd, index) => (
                      <DoubleDiagonalRow key={index} doubleDiagonal={dd} underlyingPrices={underlyingPrices} getPremiumByTickerAndSymbol={getPremiumByTickerAndSymbol} />
                    ))}
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 4: Naked Put (Collapsible) */}
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
                <p className="text-sm text-muted-foreground text-left">
                  PUT vendute senza copertura
                </p>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                {categories.nakedPuts.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <p className="text-sm">Nessuna Naked Put presente</p>
                  </div>
                ) : (
                  <div className="space-y-1 overflow-x-auto">
                    {categories.nakedPuts.map((np, index) => (
                      <NakedPutRow key={index} nakedPut={np} stockPositions={stockPositions} getOverrideForPosition={getOverrideForPosition} underlyingPrices={underlyingPrices} />
                    ))}
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 5: Leap Call (Collapsible) */}
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
                <p className="text-sm text-muted-foreground text-left">
                  CALL acquistate a lungo termine
                </p>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                {categories.leapCalls.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <p className="text-sm">Nessuna Leap Call presente</p>
                  </div>
                ) : (
                  <div className="space-y-1 overflow-x-auto">
                    {categories.leapCalls.map((lc, index) => (
                      <LeapCallRow key={index} leapCall={lc} stockPositions={stockPositions} getOverrideForPosition={getOverrideForPosition} underlyingPrices={underlyingPrices} />
                    ))}
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 6: Altre Strategie (Collapsible) */}
        <Collapsible open={otherStrategiesOpen} onOpenChange={setOtherStrategiesOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Puzzle className="w-5 h-5 text-cyan-500" />
                    <CardTitle className="text-xl">Altre Strategie</CardTitle>
                    <Badge variant="secondary" className="text-xs">{categories.groupedOtherStrategies.length}</Badge>
                  </div>
                  {otherStrategiesOpen ? (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground text-left">
                  Opzioni non classificate in altre categorie
                </p>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                {categories.groupedOtherStrategies.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <p className="text-sm">Nessuna altra strategia presente</p>
                  </div>
                ) : (
                  <div className="space-y-1 overflow-x-auto">
                    {categories.groupedOtherStrategies.map((group, index) => (
                      <GroupedOtherStrategyRow key={index} group={group} stockPositions={stockPositions} getOverrideForPosition={getOverrideForPosition} underlyingPrices={underlyingPrices} getPremiumByTickerAndSymbol={getPremiumByTickerAndSymbol} />
                    ))}
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
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
  
  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div 
          role="button"
          tabIndex={0}
          onClick={() => setIsOpen(!isOpen)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
          className="grid grid-cols-[1.25rem_2rem_minmax(8rem,1fr)_2rem_3rem_3rem_2rem_2rem_8rem_6rem_4.5rem_5rem_8rem] gap-2 items-center p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors min-w-[900px]"
        >
            {/* Col 1: Chevron */}
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            
            {/* Col 2: V/A Badge */}
            <Badge variant="outline" className="text-xs text-green-500 border-green-500">V</Badge>
            
            {/* Col 3: Descrizione */}
            <span className="font-medium truncate">{formatOptionDescription(option)}</span>
            
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
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-black border-2 border-yellow-400 text-yellow-400 text-xs font-bold cursor-help"
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
              {hasOverride && <OverrideBadge />}
            </div>
            
            {/* Col 6: ITM/OTM */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge 
                  variant="outline"
                  className={`text-xs cursor-help ${isITM ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-primary/20 border-primary/50 text-primary'}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {isITM ? 'ITM' : 'OTM'}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isITM ? 'In The Money: il sottostante è sopra lo strike' : 'Out of The Money: il sottostante è sotto lo strike'}</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Col 7: Menu */}
            <MoveOptionMenu 
              option={option} 
              availableStocks={stockPositions} 
              currentCategory="covered_call" 
            />
            
            {/* Col 8: Calculator */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${
                    savedPremium && savedPremium.orders_json.length > 0
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
                  className={`text-sm text-right cursor-help font-medium whitespace-nowrap ${
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
                        UNIT: {formatCurrency(netPerShare, getOptionCurrency(option))} {underlyingPrice > 0 && (
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
                <p>Netto unitario premi CALL (dalla calcolatrice)</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Col 9: PS */}
            <div className="text-right flex items-center justify-end">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-muted-foreground cursor-help truncate" onClick={(e) => e.stopPropagation()}>
                    PS: {formatCurrency(underlyingPrice, getOptionCurrency(option))}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Prezzo Sottostante</p>
                </TooltipContent>
              </Tooltip>
              {option.underlying && shouldShowStaleIndicator(underlyingPrices[option.underlying]) && (
                <StalePriceIndicator ticker={underlyingPrices[option.underlying]?.ticker} />
              )}
            </div>
            
            {/* Col 10: Contratti */}
            <span className="text-sm text-muted-foreground text-right">
              {contractsCovered} × 100
            </span>
            
            {/* Col 11: PMC */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm text-muted-foreground text-right cursor-help truncate" onClick={(e) => e.stopPropagation()}>
                {formatCurrency(option.avg_cost || 0, getOptionCurrency(option))}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Prezzo Medio di Carico Opzione</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Col 12: Prezzo + % */}
            <div className="flex items-center gap-1 justify-end whitespace-nowrap">
              <span className="font-semibold text-sm">
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
          <div className="ml-7 mt-2 p-3 rounded-lg border border-border/50 bg-muted/30 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Sottostante</p>
                <p className="font-medium">{underlying.description}</p>
                <p className="text-xs text-muted-foreground">{underlying.quantity} azioni</p>
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
            {adjustedProfitLossPct !== null && (
              <div className="text-xs text-muted-foreground">
                P/L: {formatPercentage(adjustedProfitLossPct)}
              </div>
            )}
          </div>
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
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div 
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
className="grid grid-cols-[1.25rem_2rem_minmax(8rem,1fr)_2rem_3rem_3rem_2rem_6rem_4.5rem_5rem_7rem] gap-2 items-center p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors min-w-[800px]"
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
          <span className="font-medium truncate">{formatOptionDescription(option)}</span>
          
          {/* Col 4: OptionStrat */}
          <OptionStratButton url={option.underlying && underlyingPrices[option.underlying]?.ticker ? buildLongPutUrl(underlyingPrices[option.underlying].ticker, option) : null} />
          
          {/* Col 5: Badges (P!, Override) - larghezza fissa per allineamento */}
          <div className="flex items-center gap-1 w-12 justify-end">
            {isPartial && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span 
                    className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-black border-2 border-yellow-400 text-yellow-400 text-xs font-bold cursor-help"
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
            {hasOverride && <OverrideBadge />}
          </div>
          
          {/* Col 6: ITM/OTM */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge 
                variant="outline"
                className={`text-xs cursor-help ${!hasUnderlyingPrice ? 'bg-muted border-muted-foreground/50 text-muted-foreground' : isITM ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-primary/20 border-primary/50 text-primary'}`}
                onClick={(e) => e.stopPropagation()}
              >
                {!hasUnderlyingPrice ? '-' : isITM ? 'ITM' : 'OTM'}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>{!hasUnderlyingPrice ? 'Prezzo sottostante non disponibile' : isITM ? 'In The Money: il sottostante è sotto lo strike' : 'Out of The Money: il sottostante è sopra lo strike'}</p>
            </TooltipContent>
          </Tooltip>
          
          {/* Col 7: Menu */}
          <MoveOptionMenu 
            option={option} 
            availableStocks={stockPositions} 
            currentCategory="protection" 
          />
          
          {/* Col 7: PS */}
          <div className="text-right flex items-center justify-end">
            {hasUnderlyingPrice ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-sm text-muted-foreground cursor-help truncate" onClick={(e) => e.stopPropagation()}>
                      PS: {formatCurrency(underlyingPrice, getOptionCurrency(option))}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Prezzo Sottostante</p>
                  </TooltipContent>
                </Tooltip>
                {option.underlying && shouldShowStaleIndicator(underlyingPrices[option.underlying]) && (
                  <StalePriceIndicator ticker={underlyingPrices[option.underlying]?.ticker} />
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">-</span>
            )}
          </div>
          
          {/* Col 8: Contratti */}
          <span className="text-sm text-muted-foreground text-right">
            {contracts} × 100
          </span>
          
          {/* Col 9: PMC */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm text-muted-foreground text-right cursor-help truncate" onClick={(e) => e.stopPropagation()}>
              {formatCurrency(option.avg_cost || 0, getOptionCurrency(option))}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Prezzo Medio di Carico Opzione</p>
            </TooltipContent>
          </Tooltip>
          
          {/* Col 10: Prezzo */}
          <div className="flex items-center gap-1 justify-end whitespace-nowrap">
            <span className="font-semibold text-sm">
              {formatCurrency(option.current_price || 0, getOptionCurrency(option))}
            </span>
            {shouldShowOptionStaleIndicator(option, option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined) && (
              <StalePriceIndicator ticker={option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined} />
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
  
  // Calculate if underlying price is In Range (between sold strikes)
  const soldPutStrike = soldPut.strike_price || 0;
  const soldCallStrike = soldCall.strike_price || 0;
  const isInRange = hasUnderlyingPrice && underlyingPrice >= soldPutStrike && underlyingPrice <= soldCallStrike;
  
  // Calculate Gain Potenziale = premi incassati - premi pagati (from portfolio PMC)
  const premiumReceived = ((soldPut.avg_cost || 0) + (soldCall.avg_cost || 0)) * contracts * 100;
  const premiumPaid = ((boughtPut.avg_cost || 0) + (boughtCall.avg_cost || 0)) * contracts * 100;
  const gainPotenzialeFromPMC = premiumReceived - premiumPaid;
  
  // Use saved GP if available, otherwise use PMC-based calculation
  const gainPotenziale = hasSavedGP ? savedPremium.net_per_share : gainPotenzialeFromPMC;
  const isPositiveGP = gainPotenziale >= 0;
  
  // Calculate Max Loss = spread width * 100 * contracts - net premium received
  const putSpreadWidth = soldPutStrike - (boughtPut.strike_price || 0);
  const callSpreadWidth = (boughtCall.strike_price || 0) - soldCallStrike;
  const maxSpreadWidth = Math.max(putSpreadWidth, callSpreadWidth);
  const maxLoss = (maxSpreadWidth * 100 * contracts) - gainPotenzialeFromPMC;
  
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
        className="grid grid-cols-[1.25rem_minmax(6rem,1fr)_2rem_4rem_3rem_3rem_5rem_6rem_7rem_4.5rem_6rem_6.5rem] gap-2 items-center p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors min-w-[880px]"
      >
          {/* Col 1: Chevron */}
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          
          {/* Col 2: Underlying */}
          <span className="font-medium truncate">{underlying}</span>
          
          {/* Col 3: Badge IC */}
          <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/50">
            IC
          </Badge>
          
          {/* Col 4: OptionStrat + Calculator */}
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
                    hasSavedGP
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
                <p>Calcola gain potenziale</p>
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
              <span className="text-xs text-muted-foreground cursor-help text-right truncate" onClick={(e) => e.stopPropagation()}>
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
              <span className="text-xs text-muted-foreground cursor-help text-right truncate" onClick={(e) => e.stopPropagation()}>
                CALL {callSpread}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Call Spread: Sell {soldCall.strike_price} / Buy {boughtCall.strike_price}</p>
            </TooltipContent>
          </Tooltip>
          
          {/* Col 8: PS */}
          <div className="text-right flex items-center justify-end">
            {hasUnderlyingPrice ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-sm text-muted-foreground cursor-help truncate" onClick={(e) => e.stopPropagation()}>
                      PS: {formatCurrency(underlyingPrice, legCurrency)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Prezzo Sottostante</p>
                  </TooltipContent>
                </Tooltip>
                {shouldShowStaleIndicator(underlyingPrices[underlying]) && (
                  <StalePriceIndicator ticker={underlyingPrices[underlying]?.ticker} />
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">-</span>
            )}
          </div>
          
          {/* Col 9: Contratti */}
          <span className="text-sm text-muted-foreground text-right">
            {contracts} × 100
          </span>
          
          {/* Col 9: GP */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={`flex items-center gap-1 cursor-help justify-end whitespace-nowrap ${isPositiveGP ? 'text-green-500' : 'text-red-500'}`} onClick={(e) => e.stopPropagation()}>
                <span className="text-xs text-muted-foreground">GP:</span>
                <span className="text-sm">{formatCurrency(gainPotenziale, legCurrency)}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{hasSavedGP ? 'Gain Potenziale (da calcolatrice ordini)' : 'Gain Potenziale: premi incassati - premi pagati'}</p>
            </TooltipContent>
          </Tooltip>
          
          {/* Col 10: ML */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 cursor-help justify-end text-red-500 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                <span className="text-xs text-muted-foreground">ML:</span>
                <span className="text-sm">{formatCurrency(maxLoss, legCurrency)}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Max Loss: perdita massima possibile</p>
            </TooltipContent>
          </Tooltip>
      </div>
      <CollapsibleContent>
        <div className="ml-7 mt-2 p-3 rounded-lg border border-border/50 bg-muted/30 space-y-4">
          {/* Put Spread */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium">PUT SPREAD (Bull Put)</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-2 rounded bg-background/50 border border-border/30">
                <div className="flex justify-between items-center">
                  <Badge variant="outline" className="text-xs text-green-500 border-green-500">V</Badge>
                  <Badge variant="outline" className="text-xs">Strike {soldPut.strike_price}</Badge>
                </div>
                <div className="flex justify-between mt-1">
                    <span className="text-xs">Prezzo: {formatCurrency(soldPut.current_price || 0, legCurrency)}</span>
                  <span className="text-xs text-muted-foreground">
                      PMC: {formatCurrency(soldPut.avg_cost || 0, legCurrency)}
                  </span>
                </div>
              </div>
              <div className="p-2 rounded bg-background/50 border border-border/30">
                <div className="flex justify-between items-center">
                  <Badge variant="outline" className="text-xs text-red-500 border-red-500">A</Badge>
                  <Badge variant="outline" className="text-xs">Strike {boughtPut.strike_price}</Badge>
                </div>
                <div className="flex justify-between mt-1">
                    <span className="text-xs">Prezzo: {formatCurrency(boughtPut.current_price || 0, legCurrency)}</span>
                    <span className="text-xs text-muted-foreground">
                      PMC: {formatCurrency(boughtPut.avg_cost || 0, legCurrency)}
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Call Spread */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium">CALL SPREAD (Bear Call)</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-2 rounded bg-background/50 border border-border/30">
                <div className="flex justify-between items-center">
                  <Badge variant="outline" className="text-xs text-green-500 border-green-500">V</Badge>
                  <Badge variant="outline" className="text-xs">Strike {soldCall.strike_price}</Badge>
                </div>
                <div className="flex justify-between mt-1">
                    <span className="text-xs">Prezzo: {formatCurrency(soldCall.current_price || 0, legCurrency)}</span>
                    <span className="text-xs text-muted-foreground">
                      PMC: {formatCurrency(soldCall.avg_cost || 0, legCurrency)}
                  </span>
                </div>
              </div>
              <div className="p-2 rounded bg-background/50 border border-border/30">
                <div className="flex justify-between items-center">
                  <Badge variant="outline" className="text-xs text-red-500 border-red-500">A</Badge>
                  <Badge variant="outline" className="text-xs">Strike {boughtCall.strike_price}</Badge>
                </div>
                <div className="flex justify-between mt-1">
                    <span className="text-xs">Prezzo: {formatCurrency(boughtCall.current_price || 0, legCurrency)}</span>
                    <span className="text-xs text-muted-foreground">
                      PMC: {formatCurrency(boughtCall.avg_cost || 0, legCurrency)}
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Summary */}
          <div className="pt-2 border-t border-border/30 flex justify-between text-sm">
            <span className="text-muted-foreground">Gain Potenziale:</span>
            <span className={`font-semibold ${isPositiveGP ? 'text-green-500' : 'text-red-500'}`}>
              {formatCurrency(gainPotenziale, legCurrency)}
            </span>
          </div>
        </div>
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
  const totalPL = (hasSavedGP ? savedPremium.net_per_share : 0) + marketValuePositions;
  const isPositivePL = totalPL >= 0;
  
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
        className="grid grid-cols-[1.25rem_minmax(6rem,1fr)_4rem_4rem_3rem_auto_6rem_6rem_7rem_7rem] gap-2 items-center p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors min-w-[880px]"
      >
          {/* Grid: Chevron | Underlying | OptionStrat | IR/OOR | Scadenze | PUT spread | CALL spread | Contratti | P/L */}
          {/* Col 1: Chevron */}
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          
          {/* Col 2: Underlying */}
          <span className="font-medium truncate">{underlying}</span>
          
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
                    hasSavedGP
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
                <p>Calcola gain potenziale</p>
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
              <span className="text-xs text-muted-foreground cursor-help text-right truncate" onClick={(e) => e.stopPropagation()}>
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
              <span className="text-xs text-muted-foreground cursor-help text-right truncate" onClick={(e) => e.stopPropagation()}>
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
          
          {/* Col 8: PS */}
          <div className="text-right flex items-center justify-end">
            {hasUnderlyingPrice ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-sm text-muted-foreground cursor-help whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      PS: {formatCurrency(underlyingPrice, legCurrency)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Prezzo Sottostante</p>
                  </TooltipContent>
                </Tooltip>
                {shouldShowStaleIndicator(underlyingPrices[underlying]) && (
                  <StalePriceIndicator ticker={underlyingPrices[underlying]?.ticker} />
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">-</span>
            )}
          </div>
           
           {/* Col 10: P/L */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={`flex items-center gap-1 cursor-help justify-end whitespace-nowrap ${isPositivePL ? 'text-green-500' : 'text-red-500'}`} onClick={(e) => e.stopPropagation()}>
                <span className="text-xs text-muted-foreground">P/L:</span>
                <span className="text-sm">{formatCurrency(totalPL, legCurrency)}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Profit/Loss: somma dei P/L delle 4 gambe{hasSavedGP ? ' + GP calcolatrice' : ''}</p>
            </TooltipContent>
          </Tooltip>
      </div>
      <CollapsibleContent>
        <div className="ml-7 mt-2 p-3 rounded-lg border border-border/50 bg-muted/30 space-y-4">
          {/* Spreads side by side: PUT on left, CALL on right */}
          <div className="grid grid-cols-2 gap-4">
            {/* Put Spread - Vertical: sold on top, bought on bottom */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">PUT SPREAD</p>
              <div className="flex flex-col gap-2 text-sm">
                {/* Sold Put - on top */}
                <div className="p-2 rounded bg-background/50 border border-border/30">
                  <div className="flex justify-between items-center">
                    <Badge variant="outline" className="text-xs text-green-500 border-green-500">V</Badge>
                    <Badge variant="outline" className="text-xs">{soldPut.strike_price} {formatExpiryMMY(soldPut.expiry_date)}</Badge>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs">Prezzo: {formatCurrency(soldPut.current_price || 0, legCurrency)}</span>
                    <span className="text-xs text-muted-foreground">
                      PMC: {formatCurrency(soldPut.avg_cost || 0, legCurrency)}
                    </span>
                  </div>
                </div>
                {/* Bought Put - on bottom */}
                <div className="p-2 rounded bg-background/50 border border-border/30">
                  <div className="flex justify-between items-center">
                    <Badge variant="outline" className="text-xs text-red-500 border-red-500">A</Badge>
                    <Badge variant="outline" className="text-xs">{boughtPut.strike_price} {formatExpiryMMY(boughtPut.expiry_date)}</Badge>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs">Prezzo: {formatCurrency(boughtPut.current_price || 0, legCurrency)}</span>
                    <span className="text-xs text-muted-foreground">
                      PMC: {formatCurrency(boughtPut.avg_cost || 0, legCurrency)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Call Spread - Vertical: sold on top, bought on bottom */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">CALL SPREAD</p>
              <div className="flex flex-col gap-2 text-sm">
                {/* Sold Call - on top */}
                <div className="p-2 rounded bg-background/50 border border-border/30">
                  <div className="flex justify-between items-center">
                    <Badge variant="outline" className="text-xs text-green-500 border-green-500">V</Badge>
                    <Badge variant="outline" className="text-xs">{soldCall.strike_price} {formatExpiryMMY(soldCall.expiry_date)}</Badge>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs">Prezzo: {formatCurrency(soldCall.current_price || 0, legCurrency)}</span>
                    <span className="text-xs text-muted-foreground">
                      PMC: {formatCurrency(soldCall.avg_cost || 0, legCurrency)}
                    </span>
                  </div>
                </div>
                {/* Bought Call - on bottom */}
                <div className="p-2 rounded bg-background/50 border border-border/30">
                  <div className="flex justify-between items-center">
                    <Badge variant="outline" className="text-xs text-red-500 border-red-500">A</Badge>
                    <Badge variant="outline" className="text-xs">{boughtCall.strike_price} {formatExpiryMMY(boughtCall.expiry_date)}</Badge>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs">Prezzo: {formatCurrency(boughtCall.current_price || 0, legCurrency)}</span>
                    <span className="text-xs text-muted-foreground">
                      PMC: {formatCurrency(boughtCall.avg_cost || 0, legCurrency)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Summary */}
          <div className="pt-2 border-t border-border/30 flex justify-between text-sm">
            <span className="text-muted-foreground">Profit/Loss:</span>
            <span className={`font-semibold ${isPositivePL ? 'text-green-500' : 'text-red-500'}`}>
              {formatCurrency(totalPL, legCurrency)}
            </span>
          </div>
        </div>
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
  const combinedPL = (hasSavedGP ? savedPremium.net_per_share : 0) + marketValuePositions;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div 
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
        className="grid grid-cols-[1.25rem_minmax(10rem,1fr)_4rem_12rem_3.5rem_9rem_4rem_4.5rem_6rem_5rem] gap-3 items-center p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors min-w-[850px]"
      >
          {/* Colonna 1: Chevron */}
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          
          {/* Colonna 2: Underlying */}
          <span className="font-medium truncate">{underlying}</span>
          
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
                    hasSavedGP
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
                <p>Calcola gain potenziale</p>
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
          
          {/* Colonna 8: Prezzo Sottostante */}
          <div className="text-right flex items-center justify-end">
            {hasUnderlyingPrice ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-sm text-muted-foreground cursor-help" onClick={(e) => e.stopPropagation()}>
                      PS: {formatCurrency(underlyingPrice, legCurrency)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Prezzo Sottostante</p>
                  </TooltipContent>
                </Tooltip>
                {shouldShowStaleIndicator(underlyingPrices[underlying]) && (
                  <StalePriceIndicator ticker={underlyingPrices[underlying]?.ticker} />
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">-</span>
            )}
          </div>
          
          {/* Colonna 9: P/L */}
          <div className="text-right">
            <span className={`text-sm ${combinedPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {formatCurrency(combinedPL, legCurrency)}
            </span>
          </div>
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
              className={`text-xs shrink-0 cursor-help ${!hasUnderlyingPrice ? 'bg-muted border-muted-foreground/50 text-muted-foreground' : isITM ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-primary/20 border-primary/50 text-primary'}`}
              onClick={(e) => e.stopPropagation()}
            >
              {!hasUnderlyingPrice ? '-' : isITM ? 'ITM' : 'OTM'}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>{!hasUnderlyingPrice ? 'Prezzo sottostante non disponibile' : isITM ? (isCall ? 'In The Money: il sottostante è sopra lo strike' : 'In The Money: il sottostante è sotto lo strike') : (isCall ? 'Out of The Money: il sottostante è sotto lo strike' : 'Out of The Money: il sottostante è sopra lo strike')}</p>
          </TooltipContent>
        </Tooltip>
        {hasOverride && <OverrideBadge />}
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <MoveOptionMenu 
          option={option} 
          availableStocks={stockPositions} 
          currentCategory="other" 
        />
        <span className="text-sm text-muted-foreground">
          {Math.abs(option.quantity)} × 100
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-sm text-muted-foreground cursor-help" onClick={(e) => e.stopPropagation()}>
               PMC: {formatCurrency(option.avg_cost || 0, getOptionCurrency(option))}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Prezzo Medio di Carico Opzione</p>
          </TooltipContent>
        </Tooltip>
        <span className="font-semibold text-sm">
          {formatCurrency(option.current_price || 0, getOptionCurrency(option))}
        </span>
      </div>
    </div>
  );
}

function OtherStrategyRow({ otherStrategy }: { otherStrategy: OtherStrategyPosition }) {
  const [isOpen, setIsOpen] = useState(false);
  const { option, underlying } = otherStrategy;
  
  const isCall = option.option_type === 'call';
  const isPut = option.option_type === 'put';
  const isBought = option.quantity > 0;
  
  // Calculate ITM/OTM
  const strikePrice = option.strike_price || 0;
  const underlyingPrice = underlying?.current_price || 0;
  const hasUnderlyingPrice = underlyingPrice > 0;
  
  let isITM = false;
  if (hasUnderlyingPrice) {
    if (isCall) {
      isITM = strikePrice < underlyingPrice;
    } else if (isPut) {
      isITM = strikePrice > underlyingPrice;
    }
  }
  
  const typeLabel = isCall ? 'CALL' : isPut ? 'PUT' : 'OPT';
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div 
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
        className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors"
      >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <Badge 
              className={`text-xs shrink-0 ${isBought ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-green-500 text-white hover:bg-green-600'}`}
            >
              {isBought ? 'A' : 'V'}
            </Badge>
            <span className="font-medium truncate">{formatOptionDescription(option)}</span>
            <Badge 
              variant={!hasUnderlyingPrice ? "secondary" : isITM ? "destructive" : "default"} 
              className="text-xs shrink-0"
            >
              {!hasUnderlyingPrice ? '-' : isITM ? 'ITM' : 'OTM'}
            </Badge>
            <span className="text-xs text-muted-foreground">{typeLabel}</span>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {hasUnderlyingPrice && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-muted-foreground cursor-help" onClick={(e) => e.stopPropagation()}>
                    PS: {formatCurrency(underlyingPrice, getOptionCurrency(option))}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Prezzo Sottostante</p>
                </TooltipContent>
              </Tooltip>
            )}
            <span className="text-sm text-muted-foreground">
              {Math.abs(option.quantity)} × 100
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm text-muted-foreground cursor-help" onClick={(e) => e.stopPropagation()}>
                  PMC: {formatCurrency(option.avg_cost || 0, getOptionCurrency(option))}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Prezzo Medio di Carico Opzione</p>
              </TooltipContent>
            </Tooltip>
            <span className="font-semibold text-sm">
              {formatCurrency(option.current_price || 0, getOptionCurrency(option))}
            </span>
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

function NakedPutRow({ nakedPut, stockPositions, getOverrideForPosition, underlyingPrices }: { nakedPut: NakedPutPosition } & RowPropsWithPrices) {
  const [isOpen, setIsOpen] = useState(false);
  const { option, underlying, contracts } = nakedPut;
  
  const hasOverride = !!getOverrideForPosition(option.id);
  
  // Calculate ITM/OTM status for PUT options
  // PUT is ITM when underlying price < strike price (you can sell at higher than market)
  // PUT is OTM when underlying price > strike price
  const strikePrice = option.strike_price || 0;
  // Get underlying price from live Yahoo data (updated every 5 min by cron)
  const underlyingPrice = (option.underlying ? underlyingPrices[option.underlying]?.price : 0) || 0;
  const hasUnderlyingPrice = underlyingPrice > 0;
  const isITM = hasUnderlyingPrice && underlyingPrice < strikePrice;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div 
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
        className="grid grid-cols-[1.25rem_2rem_minmax(8rem,1fr)_2rem_3rem_2rem_2rem_6rem_4.5rem_5rem_7rem] gap-2 items-center p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors min-w-[800px]"
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
          <span className="font-medium truncate">{formatOptionDescription(option)}</span>
          
          {/* Col 4: OptionStrat */}
          <OptionStratButton url={option.underlying && underlyingPrices[option.underlying]?.ticker ? buildNakedPutUrl(underlyingPrices[option.underlying].ticker, option) : null} />
          
          {/* Col 5: ITM/OTM */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge 
                variant="outline"
                className={`text-xs cursor-help ${!hasUnderlyingPrice ? 'bg-muted border-muted-foreground/50 text-muted-foreground' : isITM ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-primary/20 border-primary/50 text-primary'}`}
                onClick={(e) => e.stopPropagation()}
              >
                {!hasUnderlyingPrice ? '-' : isITM ? 'ITM' : 'OTM'}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>{!hasUnderlyingPrice ? 'Prezzo sottostante non disponibile' : isITM ? 'In The Money: il sottostante è sotto lo strike' : 'Out of The Money: il sottostante è sopra lo strike'}</p>
            </TooltipContent>
          </Tooltip>
          
          {/* Col 6: Override Badge */}
          <div className="flex items-center">
            {hasOverride && <OverrideBadge />}
          </div>
          
          {/* Col 7: Menu */}
          <MoveOptionMenu 
            option={option} 
            availableStocks={stockPositions} 
            currentCategory="naked_put" 
          />
          
          {/* Col 7: PS */}
          <div className="text-right flex items-center justify-end">
            {hasUnderlyingPrice ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-sm text-muted-foreground cursor-help truncate" onClick={(e) => e.stopPropagation()}>
                      PS: {formatCurrency(underlyingPrice, getOptionCurrency(option))}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Prezzo Sottostante</p>
                  </TooltipContent>
                </Tooltip>
                {option.underlying && shouldShowStaleIndicator(underlyingPrices[option.underlying]) && (
                  <StalePriceIndicator ticker={underlyingPrices[option.underlying]?.ticker} />
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">-</span>
            )}
          </div>
          
          {/* Col 8: Contratti */}
          <span className="text-sm text-muted-foreground text-right">
            {contracts} × 100
          </span>
          
          {/* Col 9: PMC */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm text-muted-foreground text-right cursor-help truncate" onClick={(e) => e.stopPropagation()}>
                {formatCurrency(option.avg_cost || 0, getOptionCurrency(option))}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Prezzo Medio di Carico Opzione</p>
            </TooltipContent>
          </Tooltip>
          
          {/* Col 10: Prezzo */}
          <div className="flex items-center gap-1 justify-end whitespace-nowrap">
            <span className="font-semibold text-sm">
              {formatCurrency(option.current_price || 0, getOptionCurrency(option))}
            </span>
            {shouldShowOptionStaleIndicator(option, option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined) && (
              <StalePriceIndicator ticker={option.underlying ? underlyingPrices[option.underlying]?.ticker : undefined} />
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
        className="grid grid-cols-[1.25rem_2rem_minmax(8rem,1fr)_2rem_3rem_2rem_2rem_6rem_4.5rem_5rem_8rem] gap-2 items-center p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors min-w-[800px]"
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
          <span className="font-medium truncate">{formatOptionDescription(option)}</span>
          
          {/* Col 4: OptionStrat */}
          <OptionStratButton url={option.underlying && underlyingPrices[option.underlying]?.ticker ? buildLeapCallUrl(underlyingPrices[option.underlying].ticker, option) : null} />
          
          {/* Col 5: Gain/Loss Badge (G green if price > avg cost, L red if price < avg cost) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge 
                variant="outline"
                className={`text-xs cursor-help ${!hasValidPrices ? 'bg-muted border-muted-foreground/50 text-muted-foreground' : isInGain ? 'bg-green-500/20 border-green-500/50 text-green-400' : 'bg-red-500/20 border-red-500/50 text-red-400'}`}
                onClick={(e) => e.stopPropagation()}
              >
                {!hasValidPrices ? '-' : isInGain ? 'G' : 'L'}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>{!hasValidPrices ? 'Prezzi non disponibili' : isInGain ? 'In Gain: la Leap sta guadagnando' : 'Loss: la Leap sta perdendo'}</p>
            </TooltipContent>
          </Tooltip>
          
          {/* Col 6: Override Badge */}
          <div className="flex items-center">
            {hasOverride && <OverrideBadge />}
          </div>
          
          {/* Col 7: Menu */}
          <MoveOptionMenu 
            option={option} 
            availableStocks={stockPositions} 
            currentCategory="leap_call" 
          />
          
          {/* Col 7: PS */}
          <div className="text-right flex items-center justify-end">
            {hasUnderlyingPrice ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-sm text-muted-foreground cursor-help truncate" onClick={(e) => e.stopPropagation()}>
                      PS: {formatCurrency(underlyingPrice, getOptionCurrency(option))}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Prezzo Sottostante</p>
                  </TooltipContent>
                </Tooltip>
                {option.underlying && shouldShowStaleIndicator(underlyingPrices[option.underlying]) && (
                  <StalePriceIndicator ticker={underlyingPrices[option.underlying]?.ticker} />
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">-</span>
            )}
          </div>
          
          {/* Col 8: Contratti */}
          <span className="text-sm text-muted-foreground text-right">
            {contracts} × 100
          </span>
          
          {/* Col 9: PMC */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm text-muted-foreground text-right cursor-help truncate" onClick={(e) => e.stopPropagation()}>
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
