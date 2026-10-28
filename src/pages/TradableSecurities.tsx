import { ListChecks } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { IronCondorIcon } from '@/components/ui/iron-condor-icon';
import { AppHeaderMenu } from '@/components/layout/AppHeaderMenu';

export function TradableSecurities() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background-secondary/50 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 shrink-0">
              <div className="p-2 rounded-lg bg-primary/10">
                <IronCondorIcon size={24} className="text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Option Tech</h1>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  Titoli tradabili
                </p>
              </div>
            </div>

            <AppHeaderMenu />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold mb-6">Titoli Tradabili</h2>
        <Card className="border-border bg-card">
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <ListChecks className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Nessun titolo configurato.</p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

export default TradableSecurities;
