import { useAuth } from '@/contexts/AuthContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TrendingUp, LogOut, Settings, ArrowLeft, TrendingDown, Shield, Target, ChevronDown, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Position } from '@/types/portfolio';
import { useMemo, useState } from 'react';
import { 
  categorizeDerivatives, 
  formatOptionDescription,
  CoveredCallPosition,
  LongPutPosition,
  IronCondorPosition,
  StrategyPosition 
} from '@/lib/derivativeStrategies';
import { formatCurrency, formatPercentage } from '@/lib/formatters';

export function Derivatives() {
  const { user, isAdmin, signOut } = useAuth();
  const { portfolio, positions, isLoading } = usePortfolio();
  const [deRiskingOpen, setDeRiskingOpen] = useState(false);
  const [ironCondorOpen, setIronCondorOpen] = useState(true);

  const derivatives = useMemo(() => 
    positions.filter(p => p.asset_type === 'derivative'),
    [positions]
  );

  const categories = useMemo(() => 
    categorizeDerivatives(derivatives, positions),
    [derivatives, positions]
  );

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
              <Button variant="ghost" size="icon" asChild>
                <Link to="/">
                  <ArrowLeft className="w-5 h-5" />
                </Link>
              </Button>
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
        {/* Section 1: Covered Call */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              <CardTitle className="text-xl">Covered Call</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              CALL vendute con sottostante in portafoglio
            </p>
          </CardHeader>
          <CardContent>
            {categories.coveredCalls.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Shield className="w-10 h-10 mx-auto mb-3 opacity-20" />
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
        </Card>

        {/* Section 2: Protezioni - Long PUT (Collapsible) */}
        <Collapsible open={deRiskingOpen} onOpenChange={setDeRiskingOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-primary" />
                    <CardTitle className="text-xl">Protezioni - Long PUT</CardTitle>
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
                    <p className="text-sm">Nessuna protezione Long PUT presente</p>
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

        {/* Section 4: Strategie */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-primary" />
              <CardTitle className="text-xl">Strategie</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              Opzioni singole e strategie combinate
            </p>
          </CardHeader>
          <CardContent>
            {categories.strategies.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Target className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Nessuna strategia presente</p>
              </div>
            ) : (
              <div className="space-y-1">
                {categories.strategies.map((strategy, index) => (
                  <StrategyRow key={index} strategy={strategy} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
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
              <p className="font-medium">
                {option.expiry_date ? new Date(option.expiry_date).toLocaleDateString('it-IT') : '-'}
              </p>
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

function LongPutRow({ longPut }: { longPut: LongPutPosition }) {
  const [isOpen, setIsOpen] = useState(false);
  const { option, underlying, contracts } = longPut;
  
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
              <p className="font-medium">
                {option.expiry_date ? new Date(option.expiry_date).toLocaleDateString('it-IT') : '-'}
              </p>
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
  
  // Format expiry as MMM/YY (e.g., JAN/26)
  const formatExpiryShort = (date: string) => {
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const d = new Date(date);
    const month = months[d.getMonth()];
    const year = d.getFullYear().toString().slice(-2);
    return `${month}/${year}`;
  };
  
  const expiryFormatted = expiryDate ? formatExpiryShort(expiryDate) : '-';
  
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
                  <span className="text-muted-foreground text-xs">Venduta (V)</span>
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
                  <span className="text-muted-foreground text-xs">Comprata (C)</span>
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
                  <span className="text-muted-foreground text-xs">Venduta (V)</span>
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
                  <span className="text-muted-foreground text-xs">Comprata (C)</span>
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

function StrategyRow({ strategy }: { strategy: StrategyPosition }) {
  const [isOpen, setIsOpen] = useState(false);
  const position = strategy.positions[0];
  if (!position) return null;
  
  const profitLoss = position.profit_loss || 0;
  const isProfitable = profitLoss >= 0;
  const isSold = position.quantity < 0;
  
  const getStrategyBadgeVariant = () => {
    switch (strategy.strategyType) {
      case 'naked_put':
      case 'naked_call':
        return 'destructive';
      case 'long_call':
      case 'long_put':
        return 'default';
      default:
        return 'secondary';
    }
  };
  
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
            <span className="font-medium truncate">{formatOptionDescription(position)}</span>
            <Badge variant={getStrategyBadgeVariant()} className="text-xs shrink-0">
              {strategy.description}
            </Badge>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <span className="text-sm text-muted-foreground">
              {Math.abs(position.quantity)} {isSold ? 'V' : 'C'}
            </span>
            <div className={`flex items-center gap-1 ${isProfitable ? 'text-green-500' : 'text-red-500'}`}>
              {isProfitable ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              <span className="font-semibold text-sm">{formatCurrency(profitLoss, 'USD')}</span>
            </div>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-7 mt-2 p-3 rounded-lg border border-border/50 bg-muted/30 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Tipo</p>
              <p className="font-medium">{position.option_type?.toUpperCase() || '-'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Strike</p>
              <p className="font-medium">${position.strike_price || '-'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Scadenza</p>
              <p className="font-medium">
                {position.expiry_date ? new Date(position.expiry_date).toLocaleDateString('it-IT') : '-'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Valore</p>
              <p className="font-medium">{formatCurrency(position.market_value || 0, 'USD')}</p>
            </div>
          </div>
          {position.profit_loss_pct !== null && (
            <div className="text-xs text-muted-foreground">
              P/L: {formatPercentage(position.profit_loss_pct)}
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
