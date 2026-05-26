import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, Link2, DollarSign, PieChart, Globe } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useState } from 'react';
import { normalizeUnderlying } from '@/hooks/useUnderlyingMappings';

interface DiagnosticSection {
  title: string;
  description: string;
  icon: React.ElementType;
  iconColor: string;
  items: string[];
  tabLink?: string;
}

export function ResolutionDiagnostics() {
  // Fetch all data in parallel
  const { data, isLoading } = useQuery({
    queryKey: ['admin-diagnostics'],
    queryFn: async () => {
      const [positionsRes, mappingsRes, pricesRes, isinRes] = await Promise.all([
        supabase.from('positions').select('underlying, isin, asset_type, currency').not('underlying', 'is', null),
        supabase.from('underlying_mappings').select('underlying, ticker'),
        supabase.from('underlying_prices').select('ticker'),
        supabase.from('isin_mappings').select('isin, sector'),
      ]);

      return {
        positions: positionsRes.data ?? [],
        mappings: mappingsRes.data ?? [],
        prices: pricesRes.data ?? [],
        isinMappings: isinRes.data ?? [],
      };
    },
    staleTime: 60 * 1000,
  });

  const sections = useMemo<DiagnosticSection[]>(() => {
    if (!data) return [];

    const { positions, mappings, prices, isinMappings } = data;

    // Unique underlyings from derivative positions
    // NOTA: usiamo lo stesso filtro asset_type del Ticker Manager per coerenza.
    const derivativeUnderlyings = new Set(
      positions
        .filter(p => 
          p.underlying && 
          ['OPTION', 'WARRANT', 'derivative'].includes(p.asset_type as string)
        )
        .map(p => p.underlying as string)
    );

    // Mapping lookup — usa la normalizzazione canonica (stessa del Ticker Manager)
    // per evitare falsi positivi su suffissi societari (INC, CORP, HOLDINGS, ...).
    const mappedUnderlyings = new Set(mappings.map(m => normalizeUnderlying(m.underlying)));
    const mappedTickers = new Set(mappings.map(m => m.ticker));

    // Price lookup
    const pricedTickers = new Set(prices.map(p => p.ticker));

    // ISIN lookup
    const isinWithSector = new Set(
      isinMappings.filter(m => m.sector).map(m => m.isin)
    );

    // 1. Underlying senza mapping (causano edge function AI lenta)
    const noMapping = [...derivativeUnderlyings].filter(u => !mappedUnderlyings.has(normalizeUnderlying(u))).sort();

    // 2. Underlying con mapping ma senza prezzo
    const noPrice = mappings
      .filter(m => derivativeUnderlyings.has(m.underlying) && !pricedTickers.has(m.ticker))
      .map(m => `${m.underlying} → ${m.ticker}`)
      .sort();

    // 3. ISIN senza settore (rallentano Risk Analyzer)
    const uniqueIsins = new Set(
      positions
        .filter(p => p.isin && (p.asset_type === 'stock' || p.asset_type === 'etf'))
        .map(p => p.isin as string)
    );
    const noSector = [...uniqueIsins].filter(isin => !isinWithSector.has(isin)).sort();

    // 4. Posizioni in valuta non-EUR (esposizione valutaria)
    const nonEurCurrencies = new Set(
      positions
        .filter(p => p.currency && p.currency !== 'EUR' && (p.asset_type === 'stock' || p.asset_type === 'etf'))
        .map(p => p.currency as string)
    );

    return [
      {
        title: 'Underlying senza mapping',
        description: 'Causano chiamate AI lente nella edge function (~3-4s ciascuno). Aggiungere un mapping manuale nel tab Ticker per risolvere.',
        icon: Link2,
        iconColor: 'text-red-500',
        items: noMapping,
        tabLink: 'tickers',
      },
      {
        title: 'Mapping senza prezzo',
        description: 'Il mapping esiste ma il cron non ha ancora recuperato il prezzo. Si risolve automaticamente al prossimo ciclo.',
        icon: DollarSign,
        iconColor: 'text-amber-500',
        items: noPrice,
      },
      {
        title: 'ISIN senza settore',
        description: 'Rallentano la risoluzione settoriale nel Risk Analyzer. Aggiungere il settore nel tab Settori.',
        icon: PieChart,
        iconColor: 'text-purple-500',
        items: noSector,
        tabLink: 'sectors',
      },
      {
        title: 'Valute esposizione',
        description: 'Valute diverse da EUR presenti nel portafoglio. Informativo, non causa rallentamenti.',
        icon: Globe,
        iconColor: 'text-blue-500',
        items: [...nonEurCurrencies].sort(),
      },
    ];
  }, [data]);

  if (isLoading) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Analisi in corso...</span>
        </CardContent>
      </Card>
    );
  }

  const totalIssues = sections.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <CardTitle>Diagnostica Strumenti</CardTitle>
          <Badge variant="secondary">{totalIssues} problemi</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {sections.map((section) => (
          <DiagnosticSectionCard key={section.title} section={section} />
        ))}
      </CardContent>
    </Card>
  );
}

function DiagnosticSectionCard({ section }: { section: DiagnosticSection }) {
  const [open, setOpen] = useState(false);
  const { title, description, icon: Icon, iconColor, items } = section;

  return (
    <div className="border border-border rounded-lg p-3">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full text-left hover:bg-muted/30 rounded px-1 -mx-1 transition-colors">
          <Icon className={`w-4 h-4 ${iconColor} shrink-0`} />
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <Badge variant={items.length > 0 ? 'destructive' : 'secondary'} className="text-xs">
            {items.length}
          </Badge>
          <span className="text-xs text-muted-foreground ml-auto">
            {open ? '▲' : '▼'}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="text-xs text-muted-foreground mt-2 mb-2">{description}</p>
          {items.length === 0 ? (
            <p className="text-xs text-green-500">✓ Nessun problema rilevato</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {items.map((item, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {item}
                </Badge>
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
