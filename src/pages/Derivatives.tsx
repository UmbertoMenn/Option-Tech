import { useAuth } from '@/contexts/AuthContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, LogOut, Settings, ArrowLeft, TrendingDown, Shield, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Position } from '@/types/portfolio';
import { useMemo } from 'react';
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

      <main className="container mx-auto px-4 py-8 space-y-8">
        {/* Section 1: Covered Call / De-Risking Covered Call */}
        <Card className="border-border bg-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              <CardTitle className="text-xl">Covered Call / De-Risking Covered Call</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              CALL vendute con sottostante in portafoglio
            </p>
          </CardHeader>
          <CardContent>
            {categories.coveredCalls.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Shield className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>Nessuna Covered Call presente</p>
                <p className="text-sm">Le CALL vendute verranno abbinate ai sottostanti posseduti</p>
              </div>
            ) : (
              <div className="space-y-4">
                {categories.coveredCalls.map((cc, index) => (
                  <CoveredCallCard key={index} coveredCall={cc} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 2: Strategie */}
        <Card className="border-border bg-card">
          <CardHeader>
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
              <div className="text-center py-12 text-muted-foreground">
                <Target className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>Nessuna strategia presente</p>
                <p className="text-sm">Le opzioni non coperte appariranno qui</p>
              </div>
            ) : (
              <div className="space-y-4">
                {categories.strategies.map((strategy, index) => (
                  <StrategyCard key={index} strategy={strategy} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function CoveredCallCard({ coveredCall }: { coveredCall: CoveredCallPosition }) {
  const { option, underlying, contractsCovered, sharesCovered, isFullyCovered } = coveredCall;
  const profitLoss = option.profit_loss || 0;
  const isProfitable = profitLoss >= 0;
  
  return (
    <div className="p-4 rounded-lg border border-border bg-background/50 space-y-3">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-lg">
              {formatOptionDescription(option)}
            </span>
            <Badge variant={isFullyCovered ? "default" : "secondary"}>
              {isFullyCovered ? 'Completamente coperta' : 'Parzialmente coperta'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {contractsCovered} contratti × 100 = {sharesCovered} azioni coperte
          </p>
        </div>
        <div className="text-right">
          <div className={`flex items-center gap-1 ${isProfitable ? 'text-green-500' : 'text-red-500'}`}>
            {isProfitable ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            <span className="font-semibold">{formatCurrency(profitLoss)}</span>
          </div>
          {option.profit_loss_pct !== null && (
            <span className="text-xs text-muted-foreground">
              {formatPercentage(option.profit_loss_pct)}
            </span>
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Sottostante</p>
          <p className="font-medium">{underlying.description}</p>
          <p className="text-xs text-muted-foreground">{underlying.quantity} azioni</p>
        </div>
        <div>
          <p className="text-muted-foreground">Strike</p>
          <p className="font-medium">${option.strike_price}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Scadenza</p>
          <p className="font-medium">
            {option.expiry_date ? new Date(option.expiry_date).toLocaleDateString('it-IT') : '-'}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Premio</p>
          <p className="font-medium">{formatCurrency(option.market_value || 0)}</p>
        </div>
      </div>
    </div>
  );
}

function StrategyCard({ strategy }: { strategy: StrategyPosition }) {
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
    <div className="p-4 rounded-lg border border-border bg-background/50 space-y-3">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-lg">
              {formatOptionDescription(position)}
            </span>
            <Badge variant={getStrategyBadgeVariant()}>
              {strategy.description}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {Math.abs(position.quantity)} contratto/i {isSold ? 'venduto/i' : 'comprato/i'}
          </p>
        </div>
        <div className="text-right">
          <div className={`flex items-center gap-1 ${isProfitable ? 'text-green-500' : 'text-red-500'}`}>
            {isProfitable ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            <span className="font-semibold">{formatCurrency(profitLoss)}</span>
          </div>
          {position.profit_loss_pct !== null && (
            <span className="text-xs text-muted-foreground">
              {formatPercentage(position.profit_loss_pct)}
            </span>
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Tipo</p>
          <p className="font-medium">{position.option_type?.toUpperCase() || '-'}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Strike</p>
          <p className="font-medium">${position.strike_price || '-'}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Scadenza</p>
          <p className="font-medium">
            {position.expiry_date ? new Date(position.expiry_date).toLocaleDateString('it-IT') : '-'}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Valore</p>
          <p className="font-medium">{formatCurrency(position.market_value || 0)}</p>
        </div>
      </div>
    </div>
  );
}

function DerivativesSkeleton() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="container mx-auto space-y-8">
        <Skeleton className="h-12 w-64 rounded-lg" />
        <Skeleton className="h-[300px] rounded-lg" />
        <Skeleton className="h-[300px] rounded-lg" />
      </div>
    </div>
  );
}

export default Derivatives;
