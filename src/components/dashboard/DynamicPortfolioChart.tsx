import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PortfolioDonutChart } from '@/components/dashboard/PortfolioDonutChart';
import { AssetAllocationLegend } from '@/components/dashboard/AssetAllocationLegend';
import { PortfolioSummary, Portfolio, Position } from '@/types/portfolio';
import { NettingResult, NettingBreakdownItem, getBreakdownForViewMode } from '@/hooks/useDerivativeNetting';
import { DerivativeOverride } from '@/types/derivativeOverrides';
import { ViewMode } from './ViewModeSelector';
import { Upload, ChevronDown, ChevronUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip as RechartsTooltip } from 'recharts';
import { formatEUR } from '@/lib/formatters';
import { useMemo, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface DynamicPortfolioChartProps {
  summary: PortfolioSummary | null;
  portfolio: Portfolio | null;
  positions: Position[];
  netting: NettingResult;
  viewMode: ViewMode;
  overrides?: DerivativeOverride[];
}

// ─── Waterfall helpers ────────────────────────────────────────
interface WaterfallBar {
  name: string;
  base: number;     // invisible base
  value: number;     // visible bar height
  total: number;     // running total (for tooltip)
  fill: string;
  isTotal: boolean;
  details?: { ticker: string; value: number; strike?: number; expiry?: string }[];
}

const COLOR_BASE = 'hsl(var(--muted-foreground))';
const COLOR_COST = 'hsl(0, 72%, 51%)';      // red
const COLOR_GAIN = 'hsl(142, 71%, 45%)';     // green
const COLOR_TOTAL = 'hsl(217, 91%, 60%)';    // blue

function buildWaterfallData(
  baseValue: number,
  items: NettingBreakdownItem[],
  finalValue: number,
): WaterfallBar[] {
  const bars: WaterfallBar[] = [];

  // Start with assets bar (from 0)
  bars.push({
    name: 'Valore Assets',
    base: 0,
    value: baseValue,
    total: baseValue,
    fill: COLOR_BASE,
    isTotal: false,
  });

  let running = baseValue;

  for (const item of items) {
    const absValue = Math.abs(item.value);
    const isNegative = item.value < 0;
    const barBase = isNegative ? running - absValue : running;

    bars.push({
      name: item.label,
      base: barBase,
      value: absValue,
      total: running + item.value,
      fill: isNegative ? COLOR_COST : COLOR_GAIN,
      isTotal: false,
      details: item.details.map(d => ({
        ticker: d.ticker,
        value: d.value,
        strike: d.strike,
        expiry: d.expiry,
      })),
    });

    running += item.value;
  }

  // Final total bar
  bars.push({
    name: 'Valore Nettato',
    base: 0,
    value: finalValue,
    total: finalValue,
    fill: COLOR_TOTAL,
    isTotal: true,
  });

  return bars;
}

// ─── Custom Tooltip ───────────────────────────────────────────
function WaterfallTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const bar: WaterfallBar = payload[0]?.payload;
  if (!bar) return null;

  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg p-3 max-w-xs">
      <p className="font-semibold text-sm text-foreground mb-1">{bar.name}</p>
      <p className="text-sm text-foreground">
        {bar.isTotal ? 'Totale: ' : 'Impatto: '}
        <span className={bar.fill === COLOR_COST ? 'text-red-400' : bar.fill === COLOR_GAIN ? 'text-green-400' : 'text-blue-400'}>
          {formatEUR(bar.isTotal ? bar.total : (bar.fill === COLOR_COST ? -bar.value : bar.value))}
        </span>
      </p>
      {bar.details && bar.details.length > 0 && (
        <div className="mt-2 border-t border-border pt-2 space-y-0.5">
          {bar.details
            .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
            .slice(0, 5)
            .map((d, i) => (
              <div key={i} className="flex justify-between text-xs gap-3">
                <span className="text-muted-foreground truncate">
                  {d.ticker}
                  {d.strike ? ` @${d.strike}` : ''}
                </span>
                <span className={d.value < 0 ? 'text-red-400' : 'text-green-400'}>
                  {formatEUR(d.value)}
                </span>
              </div>
            ))}
          {bar.details.length > 5 && (
            <p className="text-xs text-muted-foreground italic">+{bar.details.length - 5} altre...</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Waterfall Chart ──────────────────────────────────────────
function NettingWaterfallChart({
  baseValue,
  items,
  finalValue,
}: {
  baseValue: number;
  items: NettingBreakdownItem[];
  finalValue: number;
}) {
  const data = useMemo(() => buildWaterfallData(baseValue, items, finalValue), [baseValue, items, finalValue]);
  const chartHeight = Math.max(200, data.length * 40 + 20);

  return (
    <div className="w-full" style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ left: 10, right: 70, top: 5, bottom: 5 }}
          barCategoryGap="20%"
        >
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis
            type="category"
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            width={150}
          />
          <RechartsTooltip content={<WaterfallTooltip />} cursor={false} />
          {/* Invisible base bar */}
          <Bar dataKey="base" stackId="waterfall" fill="transparent" barSize={24} isAnimationActive={false} />
          {/* Visible value bar */}
          <Bar dataKey="value" stackId="waterfall" barSize={24} radius={[0, 3, 3, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Top Costose ──────────────────────────────────────────────
function TopCostlyPositions({ items }: { items: NettingBreakdownItem[] }) {
  const [isOpen, setIsOpen] = useState(false);

  const topPositions = useMemo(() => {
    const all = items.flatMap(item =>
      item.details.map(d => ({
        ...d,
        category: item.label,
      }))
    );
    return all
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 5);
  }, [items]);

  if (topPositions.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full justify-center py-2">
        <span>Top posizioni più costose</span>
        {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-1 px-4 pb-2">
          {topPositions.map((pos, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-foreground truncate">{pos.ticker}</span>
                {pos.strike && (
                  <span className="text-muted-foreground">@{pos.strike}</span>
                )}
                {pos.expiry && (
                  <span className="text-muted-foreground">
                    {new Date(pos.expiry).toLocaleDateString('it-IT', { month: 'short', year: '2-digit' })}
                  </span>
                )}
              </div>
              <span className={pos.value < 0 ? 'text-red-400 font-medium' : 'text-green-400 font-medium'}>
                {formatEUR(pos.value)}
              </span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Main Component ───────────────────────────────────────────
const CHART_TITLES: Record<ViewMode, string> = {
  base: 'Composizione Portafoglio (Derivati esclusi)',
  netting_total: 'Valore Portafoglio (Netting Totale Derivati)',
  netting_ex_cc: 'Valore Portafoglio (Netting ex. Covered Call)',
  netting_ex_cc_np: 'Valore Portafoglio (Netting ex. Covered Call e Naked Put OTM)',
};

export function DynamicPortfolioChart({ summary, portfolio, positions, netting, viewMode, overrides = [] }: DynamicPortfolioChartProps) {

  const { items: breakdownItems, finalValue } = useMemo(() => {
    if (viewMode === 'base' || !summary) return { items: [], finalValue: 0 };
    return getBreakdownForViewMode(
      netting.breakdown,
      viewMode as 'netting_total' | 'netting_ex_cc' | 'netting_ex_cc_np',
      positions,
      summary,
      overrides,
    );
  }, [viewMode, netting.breakdown, positions, summary, overrides]);

  const renderChart = () => {
    if (viewMode === 'base') {
      if (summary && positions.length > 0) {
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <PortfolioDonutChart summary={summary} portfolio={portfolio} />
            <AssetAllocationLegend summary={summary} />
          </div>
        );
      }
      return (
        <div className="text-center py-12 text-muted-foreground">
          <Upload className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Nessuna posizione presente</p>
          <p className="text-sm">Carica un file Excel per iniziare</p>
        </div>
      );
    }

    // Netting views — waterfall
    const descriptions: Record<string, string> = {
      netting_total: 'Valorizzazione del portafoglio complessivo, al quale abbiamo sommato e sottratto il valore di rivendita e riacquisto di tutte le posizioni in derivati in portafoglio.',
      netting_ex_cc: 'Valorizzazione del portafoglio complessivo, al quale abbiamo sommato e sottratto il valore di rivendita e riacquisto di tutte le posizioni in derivati in portafoglio, escluse le covered call OTM. Per le Covered Call ITM si sottrae il valore intrinseco.',
      netting_ex_cc_np: 'Come il Netting ex. Covered Call, ma esclude anche il costo di riacquisto delle Naked PUT OTM. Per le Naked Put ITM si sottrae il valore intrinseco.',
    };

    return (
      <div className="flex flex-col">
        <NettingWaterfallChart
          baseValue={summary?.totalValue ?? 0}
          items={breakdownItems}
          finalValue={finalValue}
        />

        <div className="mt-1 text-center">
          <p className="text-2xl font-bold text-blue-500">
            {formatEUR(finalValue)}
          </p>
        </div>

        <TopCostlyPositions items={breakdownItems} />

        <p className="text-xs text-muted-foreground px-4 mt-2 leading-relaxed">
          {descriptions[viewMode] ?? ''}
        </p>
      </div>
    );
  };

  return (
    <Card className="lg:col-span-2 border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg text-center">{CHART_TITLES[viewMode]}</CardTitle>
      </CardHeader>
      <CardContent>
        {renderChart()}
      </CardContent>
    </Card>
  );
}
