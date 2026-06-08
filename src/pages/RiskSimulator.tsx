import { Card, CardContent } from '@/components/ui/card';
import { Activity } from 'lucide-react';
import { AppHeaderMenu } from '@/components/layout/AppHeaderMenu';

export function RiskSimulator() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background-secondary/50 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Activity className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-lg font-bold">Risk Simulator</h1>
          </div>
          <AppHeaderMenu />
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        <Card className="border-border bg-card">
          <CardContent className="py-16 text-center text-muted-foreground">
            <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Risk Simulator in arrivo.</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

export default RiskSimulator;
