import { useAuth } from '@/contexts/AuthContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useDerivativeOverrides } from '@/hooks/useDerivativeOverrides';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TrendingUp, LogOut, Settings, ArrowLeft, TrendingDown, Shield, Target, ChevronDown, ChevronRight, ShieldAlert, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Position } from '@/types/portfolio';
import { useMemo, useState } from 'react';
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
import { formatCurrency, formatPercentage } from '@/lib/formatters';
import { MoveOptionMenu } from '@/components/derivatives/MoveOptionMenu';
import { OverrideBadge } from '@/components/derivatives/OverrideBadge';
import { CreateMultiLegDialog } from '@/components/derivatives/CreateMultiLegDialog';

// Format expiry as MMM/YY (e.g., DIC/27, FEB/26) - Italian months
function formatExpiryMMY(date: string | null | undefined): string {
  if (!date) return '-';
  const months = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
  const d = new Date(date);
  const month = months[d.getMonth()];
  const year = d.getFullYear().toString().slice(-2);
  return `${month}/${year}`;
}

export function Derivatives() {
  const { user, isAdmin, signOut } = useAuth();
  const { portfolio, positions, isLoading } = usePortfolio();
  const { overrides, getUnassignedOptions, getOverrideForPosition, removeOverrideByPositionId } = useDerivativeOverrides();
  const [coveredCallOpen, setCoveredCallOpen] = useState(false);
  const [deRiskingOpen, setDeRiskingOpen] = useState(false);
  const [ironCondorOpen, setIronCondorOpen] = useState(false);
  const [doubleDiagonalOpen, setDoubleDiagonalOpen] = useState(false);
  const [nakedPutsOpen, setNakedPutsOpen] = useState(false);
  const [leapCallsOpen, setLeapCallsOpen] = useState(false);
  const [otherStrategiesOpen, setOtherStrategiesOpen] = useState(false);
  const [createMultiLegOpen, setCreateMultiLegOpen] = useState(false);

  const derivatives = useMemo(() => 
    positions.filter(p => p.asset_type === 'derivative'),
    [positions]
  );

  const categories = useMemo(() => 
    categorizeDerivatives(derivatives, positions, overrides),
    [derivatives, positions, overrides]
  );

  const unassignedOptions = useMemo(() => getUnassignedOptions(), [getUnassignedOptions]);

  if (isLoading) {
    return <DerivativesSkeleton />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background-secondary/50 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <TrendingUp className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Strategie Derivati</h1>
                <p className="text-xs text-muted-foreground">
                  {portfolio?.name} • {derivatives.length} posizioni
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Dashboard
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/risk-analyzer">
                  <ShieldAlert className="w-4 h-4 mr-2" />
                  Risk Analyzer
                </Link>
              </Button>
              {isAdmin && (
                <Button variant="outline" size="sm" asChild>
                  <Link to="/admin">
                    <Settings className="w-4 h-4 mr-2" />
                    Admin
                  </Link>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="w-4 h-4 mr-2" />
                Esci
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
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
                  <div className="space-y-1">
                    {categories.coveredCalls.map((cc, index) => (
                      <CoveredCallRow key={index} coveredCall={cc} />
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
                    <Shield className="w-5 h-5 text-primary" />
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
                  <div className="space-y-1">
                    {categories.longPuts.map((lp, index) => (
                      <LongPutRow key={index} longPut={lp} />
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
                  <div className="space-y-1">
                    {categories.ironCondors.map((ic, index) => (
                      <IronCondorRow key={index} ironCondor={ic} />
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
                    <Target className="w-5 h-5 text-purple-500" />
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
                  <div className="space-y-1">
                    {categories.doubleDiagonals.map((dd, index) => (
                      <DoubleDiagonalRow key={index} doubleDiagonal={dd} />
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
                    <Target className="w-5 h-5 text-primary" />
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
                  <div className="space-y-1">
                    {categories.nakedPuts.map((np, index) => (
                      <NakedPutRow key={index} nakedPut={np} />
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
                    <TrendingUp className="w-5 h-5 text-green-500" />
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
                  <div className="space-y-1">
                    {categories.leapCalls.map((lc, index) => (
                      <LeapCallRow key={index} leapCall={lc} />
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
                    <TrendingDown className="w-5 h-5 text-muted-foreground" />
                    <CardTitle className="text-xl">Altre Strategie</CardTitle>
                    <Badge variant="secondary" className="text-xs">{categories.groupedOtherStrategies.length}</Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-2 h-6 px-2 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCreateMultiLegOpen(true);
                      }}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Crea Strategia
                    </Button>
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
                  <div className="space-y-1">
                    {categories.groupedOtherStrategies.map((group, index) => (
                      <GroupedOtherStrategyRow key={index} group={group} />
                    ))}
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Create Multi-Leg Strategy Dialog */}
        <CreateMultiLegDialog
          open={createMultiLegOpen}
          onOpenChange={setCreateMultiLegOpen}
          availableOptions={unassignedOptions}
        />
      </main>
    </div>
  );
}

function CoveredCallRow({ coveredCall }: { coveredCall: CoveredCallPosition }) {
  const [isOpen, setIsOpen] = useState(false);
  const { option, underlying, contractsCovered } = coveredCall;
  
  // Calculate ITM/OTM status for CALL options
  // ITM: strike < underlying price, OTM: strike >= underlying price
  const strikePrice = option.strike_price || 0;
  const underlyingPrice = underlying.current_price || 0;
  const isITM = strikePrice < underlyingPrice;
  
  // For sold options (quantity < 0), P/L is inverted:
  // If option price drops, seller profits (can buy back cheaper)
  // If option price rises, seller loses (must buy back at higher price)
  const isSold = option.quantity < 0;
  const adjustedProfitLossPct = option.profit_loss_pct !== null && option.profit_loss_pct !== undefined
    ? (isSold ? -option.profit_loss_pct : option.profit_loss_pct)
    : null;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <Badge className="text-xs shrink-0 bg-green-500 text-white hover:bg-green-600">V</Badge>
            <span className="font-medium truncate">{formatOptionDescription(option)}</span>
            <Badge 
              variant={isITM ? "destructive" : "default"} 
              className="text-xs shrink-0"
            >
              {isITM ? 'ITM' : 'OTM'}
            </Badge>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm text-muted-foreground cursor-help">
                  PS: {formatCurrency(underlyingPrice, 'USD')}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Prezzo Sottostante</p>
              </TooltipContent>
            </Tooltip>
            <span className="text-sm text-muted-foreground">
              {contractsCovered} × 100
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm text-muted-foreground cursor-help">
                  PMC: {formatCurrency(option.avg_cost || 0, 'USD')}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Prezzo Medio di Carico Opzione</p>
              </TooltipContent>
            </Tooltip>
            <span className="font-semibold text-sm">
              {formatCurrency(option.current_price || 0, 'USD')}
            </span>
          </div>
        </div>
      </CollapsibleTrigger>
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
              <p className="font-medium">${option.strike_price}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Scadenza</p>
              <p className="font-medium">{formatExpiryMMY(option.expiry_date)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Prezzo Opzione</p>
              <p className="font-medium">{formatCurrency(option.current_price || 0, 'USD')}</p>
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
  );
}

function LongPutRow({ longPut }: { longPut: LongPutPosition }) {
  const [isOpen, setIsOpen] = useState(false);
  const { option, underlying, contracts, isPartial } = longPut;
  
  // Calculate ITM/OTM status for PUT options
  // PUT is ITM when strike > underlying price (you can sell at higher than market)
  // PUT is OTM when strike <= underlying price
  const strikePrice = option.strike_price || 0;
  const underlyingPrice = underlying?.current_price || 0;
  const hasUnderlyingPrice = underlyingPrice > 0;
  const isITM = hasUnderlyingPrice && strikePrice > underlyingPrice;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <Badge className="text-xs shrink-0 bg-red-500 text-white hover:bg-red-600">A</Badge>
            <span className="font-medium truncate">{formatOptionDescription(option)}</span>
            <Badge 
              variant={!hasUnderlyingPrice ? "secondary" : isITM ? "destructive" : "default"} 
              className="text-xs shrink-0"
            >
              {!hasUnderlyingPrice ? '-' : isITM ? 'ITM' : 'OTM'}
            </Badge>
            {isPartial && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-black border-2 border-yellow-400 text-yellow-400 text-xs font-bold cursor-help shrink-0">
                    P!
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Protezione parziale</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {hasUnderlyingPrice && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-muted-foreground cursor-help">
                    PS: {formatCurrency(underlyingPrice, 'USD')}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Prezzo Sottostante</p>
                </TooltipContent>
              </Tooltip>
            )}
            <span className="text-sm text-muted-foreground">
              {contracts} × 100
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm text-muted-foreground cursor-help">
                  PMC: {formatCurrency(option.avg_cost || 0, 'USD')}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Prezzo Medio di Carico Opzione</p>
              </TooltipContent>
            </Tooltip>
            <span className="font-semibold text-sm">
              {formatCurrency(option.current_price || 0, 'USD')}
            </span>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-7 mt-2 p-3 rounded-lg border border-border/50 bg-muted/30 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Sottostante</p>
              <p className="font-medium">{option.underlying || option.description}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Strike</p>
              <p className="font-medium">${option.strike_price}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Scadenza</p>
              <p className="font-medium">{formatExpiryMMY(option.expiry_date)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Prezzo Opzione</p>
              <p className="font-medium">{formatCurrency(option.current_price || 0, 'USD')}</p>
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

function IronCondorRow({ ironCondor }: { ironCondor: IronCondorPosition }) {
  const [isOpen, setIsOpen] = useState(false);
  const { underlying, expiryDate, soldPut, boughtPut, soldCall, boughtCall, contracts } = ironCondor;
  
  const expiryFormatted = formatExpiryMMY(expiryDate);
  
  // Calculate Gain Potenziale = premi incassati - premi pagati
  // Sold options (negative qty) = premium received (avg_cost is positive, so we take it as income)
  // Bought options (positive qty) = premium paid (avg_cost is the cost)
  const premiumReceived = ((soldPut.avg_cost || 0) + (soldCall.avg_cost || 0)) * contracts * 100;
  const premiumPaid = ((boughtPut.avg_cost || 0) + (boughtCall.avg_cost || 0)) * contracts * 100;
  const gainPotenziale = premiumReceived - premiumPaid;
  const isPositiveGP = gainPotenziale >= 0;
  
  // Calculate Max Loss = spread width * 100 * contracts - net premium received
  const putSpreadWidth = (soldPut.strike_price || 0) - (boughtPut.strike_price || 0);
  const callSpreadWidth = (boughtCall.strike_price || 0) - (soldCall.strike_price || 0);
  const maxSpreadWidth = Math.max(putSpreadWidth, callSpreadWidth);
  const maxLoss = (maxSpreadWidth * 100 * contracts) - gainPotenziale;
  
  // Strikes summary
  const putSpread = `${boughtPut.strike_price}/${soldPut.strike_price}`;
  const callSpread = `${soldCall.strike_price}/${boughtCall.strike_price}`;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <span className="font-medium truncate">{underlying}</span>
            <Badge variant="outline" className="text-xs shrink-0 text-amber-500 border-amber-500/50">
              IC
            </Badge>
            <span className="text-xs text-muted-foreground">
              {expiryFormatted}
            </span>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-muted-foreground cursor-help">
                  PUT {putSpread}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Put Spread: Buy ${boughtPut.strike_price} / Sell ${soldPut.strike_price}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-muted-foreground cursor-help">
                  CALL {callSpread}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Call Spread: Sell ${soldCall.strike_price} / Buy ${boughtCall.strike_price}</p>
              </TooltipContent>
            </Tooltip>
            <span className="text-sm text-muted-foreground">
              {contracts} × 100
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={`flex items-center gap-1 cursor-help ${isPositiveGP ? 'text-green-500' : 'text-red-500'}`}>
                  <span className="text-xs text-muted-foreground">GP:</span>
                  <span className="font-semibold text-sm">{formatCurrency(gainPotenziale, 'USD')}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Gain Potenziale: premi incassati - premi pagati</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 cursor-help text-red-500">
                  <span className="text-xs text-muted-foreground">ML:</span>
                  <span className="font-semibold text-sm">{formatCurrency(maxLoss, 'USD')}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Max Loss: perdita massima possibile</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-7 mt-2 p-3 rounded-lg border border-border/50 bg-muted/30 space-y-4">
          {/* Put Spread */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium">PUT SPREAD (Bull Put)</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-2 rounded bg-background/50 border border-border/30">
                <div className="flex justify-between items-center">
                  <Badge className="text-xs bg-green-500 text-white hover:bg-green-600">V</Badge>
                  <Badge variant="outline" className="text-xs">Strike ${soldPut.strike_price}</Badge>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs">Prezzo: {formatCurrency(soldPut.current_price || 0, 'USD')}</span>
                  <span className="text-xs text-muted-foreground">
                    PMC: {formatCurrency(soldPut.avg_cost || 0, 'USD')}
                  </span>
                </div>
              </div>
              <div className="p-2 rounded bg-background/50 border border-border/30">
                <div className="flex justify-between items-center">
                  <Badge className="text-xs bg-red-500 text-white hover:bg-red-600">A</Badge>
                  <Badge variant="outline" className="text-xs">Strike ${boughtPut.strike_price}</Badge>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs">Prezzo: {formatCurrency(boughtPut.current_price || 0, 'USD')}</span>
                  <span className="text-xs text-muted-foreground">
                    PMC: {formatCurrency(boughtPut.avg_cost || 0, 'USD')}
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
                  <Badge className="text-xs bg-green-500 text-white hover:bg-green-600">V</Badge>
                  <Badge variant="outline" className="text-xs">Strike ${soldCall.strike_price}</Badge>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs">Prezzo: {formatCurrency(soldCall.current_price || 0, 'USD')}</span>
                  <span className="text-xs text-muted-foreground">
                    PMC: {formatCurrency(soldCall.avg_cost || 0, 'USD')}
                  </span>
                </div>
              </div>
              <div className="p-2 rounded bg-background/50 border border-border/30">
                <div className="flex justify-between items-center">
                  <Badge className="text-xs bg-red-500 text-white hover:bg-red-600">A</Badge>
                  <Badge variant="outline" className="text-xs">Strike ${boughtCall.strike_price}</Badge>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs">Prezzo: {formatCurrency(boughtCall.current_price || 0, 'USD')}</span>
                  <span className="text-xs text-muted-foreground">
                    PMC: {formatCurrency(boughtCall.avg_cost || 0, 'USD')}
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Summary */}
          <div className="pt-2 border-t border-border/30 flex justify-between text-sm">
            <span className="text-muted-foreground">Gain Potenziale:</span>
            <span className={`font-semibold ${isPositiveGP ? 'text-green-500' : 'text-red-500'}`}>
              {formatCurrency(gainPotenziale, 'USD')}
            </span>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DoubleDiagonalRow({ doubleDiagonal }: { doubleDiagonal: DoubleDiagonalPosition }) {
  const [isOpen, setIsOpen] = useState(false);
  const { underlying, soldExpiryDate, boughtExpiryDate, soldPut, boughtPut, soldCall, boughtCall, contracts } = doubleDiagonal;
  
  const soldExpiryFormatted = formatExpiryMMY(soldExpiryDate);
  const boughtExpiryFormatted = formatExpiryMMY(boughtExpiryDate);
  
  // Calculate Gain Potenziale = premi incassati - premi pagati
  const premiumReceived = ((soldPut.avg_cost || 0) + (soldCall.avg_cost || 0)) * contracts * 100;
  const premiumPaid = ((boughtPut.avg_cost || 0) + (boughtCall.avg_cost || 0)) * contracts * 100;
  const gainPotenziale = premiumReceived - premiumPaid;
  const isPositiveGP = gainPotenziale >= 0;
  
  // Calculate Max Loss
  const putSpreadWidth = (soldPut.strike_price || 0) - (boughtPut.strike_price || 0);
  const callSpreadWidth = (boughtCall.strike_price || 0) - (soldCall.strike_price || 0);
  const maxSpreadWidth = Math.max(putSpreadWidth, callSpreadWidth);
  const maxLoss = (maxSpreadWidth * 100 * contracts) - gainPotenziale;
  
  // Strikes summary
  const putSpread = `${boughtPut.strike_price}/${soldPut.strike_price}`;
  const callSpread = `${soldCall.strike_price}/${boughtCall.strike_price}`;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <span className="font-medium truncate">{underlying}</span>
            <Badge variant="outline" className="text-xs shrink-0 text-purple-500 border-purple-500/50">
              DD
            </Badge>
            <span className="text-xs text-muted-foreground">
              {soldExpiryFormatted} - {boughtExpiryFormatted}
            </span>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-muted-foreground cursor-help">
                  PUT {putSpread}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Put Spread: Buy ${boughtPut.strike_price} / Sell ${soldPut.strike_price}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-muted-foreground cursor-help">
                  CALL {callSpread}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Call Spread: Sell ${soldCall.strike_price} / Buy ${boughtCall.strike_price}</p>
              </TooltipContent>
            </Tooltip>
            <span className="text-sm text-muted-foreground">
              {contracts} × 100
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={`flex items-center gap-1 cursor-help ${isPositiveGP ? 'text-green-500' : 'text-red-500'}`}>
                  <span className="text-xs text-muted-foreground">GP:</span>
                  <span className="font-semibold text-sm">{formatCurrency(gainPotenziale, 'USD')}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Gain Potenziale: premi incassati - premi pagati</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 cursor-help text-red-500">
                  <span className="text-xs text-muted-foreground">ML:</span>
                  <span className="font-semibold text-sm">{formatCurrency(maxLoss, 'USD')}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Max Loss: perdita massima possibile</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CollapsibleTrigger>
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
                    <Badge className="text-xs bg-green-500 text-white hover:bg-green-600">V</Badge>
                    <Badge variant="outline" className="text-xs">{soldPut.strike_price} {formatExpiryMMY(soldPut.expiry_date)}</Badge>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs">Prezzo: {formatCurrency(soldPut.current_price || 0, 'USD')}</span>
                    <span className="text-xs text-muted-foreground">
                      PMC: {formatCurrency(soldPut.avg_cost || 0, 'USD')}
                    </span>
                  </div>
                </div>
                {/* Bought Put - on bottom */}
                <div className="p-2 rounded bg-background/50 border border-border/30">
                  <div className="flex justify-between items-center">
                    <Badge className="text-xs bg-red-500 text-white hover:bg-red-600">A</Badge>
                    <Badge variant="outline" className="text-xs">{boughtPut.strike_price} {formatExpiryMMY(boughtPut.expiry_date)}</Badge>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs">Prezzo: {formatCurrency(boughtPut.current_price || 0, 'USD')}</span>
                    <span className="text-xs text-muted-foreground">
                      PMC: {formatCurrency(boughtPut.avg_cost || 0, 'USD')}
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
                    <Badge className="text-xs bg-green-500 text-white hover:bg-green-600">V</Badge>
                    <Badge variant="outline" className="text-xs">{soldCall.strike_price} {formatExpiryMMY(soldCall.expiry_date)}</Badge>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs">Prezzo: {formatCurrency(soldCall.current_price || 0, 'USD')}</span>
                    <span className="text-xs text-muted-foreground">
                      PMC: {formatCurrency(soldCall.avg_cost || 0, 'USD')}
                    </span>
                  </div>
                </div>
                {/* Bought Call - on bottom */}
                <div className="p-2 rounded bg-background/50 border border-border/30">
                  <div className="flex justify-between items-center">
                    <Badge className="text-xs bg-red-500 text-white hover:bg-red-600">A</Badge>
                    <Badge variant="outline" className="text-xs">{boughtCall.strike_price} {formatExpiryMMY(boughtCall.expiry_date)}</Badge>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs">Prezzo: {formatCurrency(boughtCall.current_price || 0, 'USD')}</span>
                    <span className="text-xs text-muted-foreground">
                      PMC: {formatCurrency(boughtCall.avg_cost || 0, 'USD')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Summary */}
          <div className="pt-2 border-t border-border/30 flex justify-between text-sm">
            <span className="text-muted-foreground">Gain Potenziale:</span>
            <span className={`font-semibold ${isPositiveGP ? 'text-green-500' : 'text-red-500'}`}>
              {formatCurrency(gainPotenziale, 'USD')}
            </span>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function GroupedOtherStrategyRow({ group }: { group: GroupedOtherStrategy }) {
  const [isOpen, setIsOpen] = useState(false);
  const { underlying, options, totalProfitLoss, strategyName } = group;
  
  // Get underlying price from first option that has it
  const underlyingPrice = options[0]?.underlying?.current_price || 0;
  const hasUnderlyingPrice = underlyingPrice > 0;
  
  // Count calls and puts
  const callCount = options.filter(o => o.option.option_type === 'call').length;
  const putCount = options.filter(o => o.option.option_type === 'put').length;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <span className="font-medium truncate">{underlying}</span>
            {strategyName && (
              <Badge variant="outline" className="text-xs shrink-0 border-primary text-primary">
                {strategyName}
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs shrink-0">
              {options.length} gambe
            </Badge>
            <span className="text-xs text-muted-foreground">
              {callCount > 0 && `${callCount} CALL`}
              {callCount > 0 && putCount > 0 && ' • '}
              {putCount > 0 && `${putCount} PUT`}
            </span>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {hasUnderlyingPrice && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-muted-foreground cursor-help">
                    PS: {formatCurrency(underlyingPrice, 'USD')}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Prezzo Sottostante</p>
                </TooltipContent>
              </Tooltip>
            )}
            <span className={`font-semibold text-sm ${totalProfitLoss >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {formatCurrency(totalProfitLoss, 'USD')}
            </span>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-7 mt-2 space-y-2">
          {options.map((os, idx) => (
            <GroupedOptionLegRow key={idx} otherStrategy={os} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function GroupedOptionLegRow({ otherStrategy }: { otherStrategy: OtherStrategyPosition }) {
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
  
  const optionTypeLabel = isCall ? 'CALL' : isPut ? 'PUT' : 'OPT';
  
  return (
    <div className="flex items-center justify-between p-2 rounded-lg border border-border/50 bg-muted/30">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Badge 
          className={`text-xs shrink-0 w-5 justify-center ${isBought ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-green-500 text-white hover:bg-green-600'}`}
        >
          {isBought ? 'A' : 'V'}
        </Badge>
        <span className="text-sm">{optionTypeLabel}</span>
        <span className="font-medium text-sm">${option.strike_price}</span>
        <span className="text-xs text-muted-foreground">{formatExpiryMMY(option.expiry_date)}</span>
        <Badge 
          variant={!hasUnderlyingPrice ? "secondary" : isITM ? "destructive" : "default"} 
          className="text-xs shrink-0"
        >
          {!hasUnderlyingPrice ? '-' : isITM ? 'ITM' : 'OTM'}
        </Badge>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <span className="text-sm text-muted-foreground">
          {Math.abs(option.quantity)} × 100
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-sm text-muted-foreground cursor-help">
              PMC: {formatCurrency(option.avg_cost || 0, 'USD')}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Prezzo Medio di Carico Opzione</p>
          </TooltipContent>
        </Tooltip>
        <span className="font-semibold text-sm">
          {formatCurrency(option.current_price || 0, 'USD')}
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
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors">
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
                  <span className="text-sm text-muted-foreground cursor-help">
                    PS: {formatCurrency(underlyingPrice, 'USD')}
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
                <span className="text-sm text-muted-foreground cursor-help">
                  PMC: {formatCurrency(option.avg_cost || 0, 'USD')}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Prezzo Medio di Carico Opzione</p>
              </TooltipContent>
            </Tooltip>
            <span className="font-semibold text-sm">
              {formatCurrency(option.current_price || 0, 'USD')}
            </span>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-7 mt-2 p-3 rounded-lg border border-border/50 bg-muted/30 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Sottostante</p>
              <p className="font-medium">{option.underlying || option.description}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Strike</p>
              <p className="font-medium">${option.strike_price}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Scadenza</p>
              <p className="font-medium">{formatExpiryMMY(option.expiry_date)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Prezzo Opzione</p>
              <p className="font-medium">{formatCurrency(option.current_price || 0, 'USD')}</p>
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

function NakedPutRow({ nakedPut }: { nakedPut: NakedPutPosition }) {
  const [isOpen, setIsOpen] = useState(false);
  const { option, underlying, contracts } = nakedPut;
  
  // Calculate ITM/OTM status for PUT options
  // PUT is ITM when underlying price < strike price (you can sell at higher than market)
  // PUT is OTM when underlying price > strike price
  const strikePrice = option.strike_price || 0;
  const underlyingPrice = underlying?.current_price || 0;
  const hasUnderlyingPrice = underlyingPrice > 0;
  const isITM = hasUnderlyingPrice && underlyingPrice < strikePrice;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <Badge className="text-xs shrink-0 bg-green-500 text-white hover:bg-green-600">V</Badge>
            <span className="font-medium truncate">{formatOptionDescription(option)}</span>
            <Badge 
              variant={!hasUnderlyingPrice ? "secondary" : isITM ? "destructive" : "default"} 
              className="text-xs shrink-0"
            >
              {!hasUnderlyingPrice ? '-' : isITM ? 'ITM' : 'OTM'}
            </Badge>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {hasUnderlyingPrice && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-muted-foreground cursor-help">
                    PS: {formatCurrency(underlyingPrice, 'USD')}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Prezzo Sottostante</p>
                </TooltipContent>
              </Tooltip>
            )}
            <span className="text-sm text-muted-foreground">
              {contracts} × 100
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm text-muted-foreground cursor-help">
                  PMC: {formatCurrency(option.avg_cost || 0, 'USD')}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Prezzo Medio di Carico Opzione</p>
              </TooltipContent>
            </Tooltip>
            <span className="font-semibold text-sm">
              {formatCurrency(option.current_price || 0, 'USD')}
            </span>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-7 mt-2 p-3 rounded-lg border border-border/50 bg-muted/30 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Sottostante</p>
              <p className="font-medium">{option.underlying || option.description}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Strike</p>
              <p className="font-medium">${option.strike_price}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Scadenza</p>
              <p className="font-medium">{formatExpiryMMY(option.expiry_date)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Prezzo Opzione</p>
              <p className="font-medium">{formatCurrency(option.current_price || 0, 'USD')}</p>
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

function LeapCallRow({ leapCall }: { leapCall: LeapCallPosition }) {
  const [isOpen, setIsOpen] = useState(false);
  const { option, underlying, contracts } = leapCall;
  
  // Calculate ITM/OTM status for CALL options
  const strikePrice = option.strike_price || 0;
  const underlyingPrice = underlying?.current_price || 0;
  const hasUnderlyingPrice = underlyingPrice > 0;
  const isITM = hasUnderlyingPrice && strikePrice < underlyingPrice;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 cursor-pointer transition-colors">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <Badge className="text-xs shrink-0 bg-red-500 text-white hover:bg-red-600">A</Badge>
            <span className="font-medium truncate">{formatOptionDescription(option)}</span>
            <Badge 
              variant={!hasUnderlyingPrice ? "secondary" : isITM ? "destructive" : "default"} 
              className="text-xs shrink-0"
            >
              {!hasUnderlyingPrice ? '-' : isITM ? 'ITM' : 'OTM'}
            </Badge>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {hasUnderlyingPrice && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-muted-foreground cursor-help">
                    PS: {formatCurrency(underlyingPrice, 'USD')}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Prezzo Sottostante</p>
                </TooltipContent>
              </Tooltip>
            )}
            <span className="text-sm text-muted-foreground">
              {contracts} × 100
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm text-muted-foreground cursor-help">
                  PMC: {formatCurrency(option.avg_cost || 0, 'USD')}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Prezzo Medio di Carico Opzione</p>
              </TooltipContent>
            </Tooltip>
            <span className="font-semibold text-sm">
              {formatCurrency(option.current_price || 0, 'USD')}
            </span>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-7 mt-2 p-3 rounded-lg border border-border/50 bg-muted/30 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Sottostante</p>
              <p className="font-medium">{option.underlying || option.description}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Strike</p>
              <p className="font-medium">${option.strike_price}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Scadenza</p>
              <p className="font-medium">{formatExpiryMMY(option.expiry_date)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Prezzo Opzione</p>
              <p className="font-medium">{formatCurrency(option.current_price || 0, 'USD')}</p>
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
