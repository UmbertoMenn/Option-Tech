import { useAuth } from '@/contexts/AuthContext';
import { usePortfolio } from '@/hooks/usePortfolio';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, LogOut, Settings, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DerivativePosition } from '@/types/portfolio';

export function Derivatives() {
  const { user, isAdmin, signOut } = useAuth();
  const { portfolio, positions, isLoading } = usePortfolio();

  const derivatives = positions.filter(p => p.asset_type === 'derivative') as DerivativePosition[];

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
                  {portfolio?.name}
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
            <CardTitle className="text-xl">Covered Call / De-Risking Covered Call</CardTitle>
          </CardHeader>
          <CardContent>
            {derivatives.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>Nessuna strategia Covered Call presente</p>
                <p className="text-sm">Carica le posizioni per visualizzare le strategie</p>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <p>Sezione in attesa di configurazione</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 2: Strategie */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-xl">Strategie</CardTitle>
          </CardHeader>
          <CardContent>
            {derivatives.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>Nessuna strategia presente</p>
                <p className="text-sm">Carica le posizioni per visualizzare le strategie</p>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <p>Sezione in attesa di configurazione</p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
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
