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
  StrategyPosition 
} from '@/lib/derivativeStrategies';
import { formatCurrency, formatPercentage } from '@/lib/formatters';

export function Derivatives() {
  const { user, isAdmin, signOut } = useAuth();
  const { portfolio, positions, isLoading } = usePortfolio();
  const [deRiskingOpen, setDeRiskingOpen] = useState(false);

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

        {/* Section 2: Protezioni - LONG PUT (Collapsible) */}
        <Collapsible open={deRiskingOpen} onOpenChange={setDeRiskingOpen}>
          <Card className="border-border bg-card">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-primary" />
                    <CardTitle className="text-xl">Protezioni - LONG PUT</CardTitle>
                    <Badge variant="secondary" className="text-xs">0</Badge>
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
                <div className="text-center py-6 text-muted-foreground">
                  <p className="text-sm">Nessuna protezione LONG PUT presente</p>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 3: Strategie */}
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
                  PS: {formatCurrency(underlyingPrice)}
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
                  PMC: {formatCurrency(underlying.avg_cost || 0)}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Prezzo Medio di Carico</p>
              </TooltipContent>
            </Tooltip>
            <span className="font-semibold text-sm">
              {formatCurrency(option.current_price || 0)}
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
              <p className="font-medium">{formatCurrency(option.current_price || 0)}</p>
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
              <span className="font-semibold text-sm">{formatCurrency(profitLoss)}</span>
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
              <p className="font-medium">{formatCurrency(position.market_value || 0)}</p>
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
