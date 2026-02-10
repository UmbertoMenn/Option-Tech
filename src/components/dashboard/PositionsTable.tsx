import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Position, AssetType, ASSET_TYPE_LABELS } from '@/types/portfolio';
import { formatCurrency, formatPercentage, formatProfitLoss, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight, ExternalLink } from 'lucide-react';

interface PositionsTableProps {
  positions: Position[];
}

const assetTabs: { value: AssetType | 'all'; label: string }[] = [
  { value: 'all', label: 'Tutte' },
  { value: 'bond', label: 'Obbligazioni' },
  { value: 'stock', label: 'Azioni' },
  { value: 'etf', label: 'ETF' },
  { value: 'derivative', label: 'Derivati' },
  { value: 'commodity', label: 'Commodities' },
];

export function PositionsTable({ positions }: PositionsTableProps) {
  const [selectedTab, setSelectedTab] = useState<AssetType | 'all'>('all');
  const [sortConfig, setSortConfig] = useState<{ key: keyof Position; direction: 'asc' | 'desc' }>({ key: 'description', direction: 'asc' });

  const filteredPositions = selectedTab === 'all' 
    ? positions 
    : positions.filter(p => p.asset_type === selectedTab);

  const sortedPositions = [...filteredPositions].sort((a, b) => {
    const aVal = a[sortConfig.key];
    const bVal = b[sortConfig.key];
    
    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;
    
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
    }
    
    return sortConfig.direction === 'asc' 
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal));
  });

  const handleSort = (key: keyof Position) => {
    setSortConfig(prev => ({
      key,
      direction: prev?.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const SortIcon = ({ columnKey }: { columnKey: keyof Position }) => {
    if (sortConfig?.key !== columnKey) return null;
    return sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />;
  };

  return (
    <div className="space-y-4">
      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as AssetType | 'all')}>
        <TabsList className="bg-background-tertiary border border-border">
          {assetTabs.map(tab => {
            const count = tab.value === 'all' 
              ? positions.length 
              : positions.filter(p => p.asset_type === tab.value).length;
            
            if (count === 0 && tab.value !== 'all') return null;
            
            return (
              <TabsTrigger 
                key={tab.value} 
                value={tab.value}
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                {tab.label}
                <Badge variant="secondary" className="ml-2 text-xs">
                  {count}
                </Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* Link to Derivatives Strategies */}
      {selectedTab === 'derivative' && (
        <div className="flex flex-wrap gap-2 items-center">
          <Button
            variant="default"
            size="sm"
            asChild
          >
            <Link to="/derivatives">
              <ExternalLink className="w-4 h-4 mr-2" />
              Visualizza Strategie
            </Link>
          </Button>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table min-w-[900px]">
            <thead>
              <tr>
                <th className="cursor-pointer hover:bg-background-secondary" onClick={() => handleSort('description')}>
                  <div className="flex items-center gap-1">
                    Titolo <SortIcon columnKey="description" />
                  </div>
                </th>
                <th>Tipo</th>
                <th className="text-center">Valuta</th>
                <th className="text-right">Cambio</th>
                <th className="text-right cursor-pointer hover:bg-background-secondary" onClick={() => handleSort('quantity')}>
                  <div className="flex items-center justify-end gap-1">
                    Quantità <SortIcon columnKey="quantity" />
                  </div>
                </th>
                <th className="text-right">Prezzo</th>
                <th className="text-right cursor-pointer hover:bg-background-secondary" onClick={() => handleSort('avg_cost')}>
                  <div className="flex items-center justify-end gap-1">
                    PMC <SortIcon columnKey="avg_cost" />
                  </div>
                </th>
                <th className="text-right cursor-pointer hover:bg-background-secondary" onClick={() => handleSort('market_value')}>
                  <div className="flex items-center justify-end gap-1">
                    Controvalore <SortIcon columnKey="market_value" />
                  </div>
                </th>
                <th className="text-right cursor-pointer hover:bg-background-secondary" onClick={() => handleSort('profit_loss')}>
                  <div className="flex items-center justify-end gap-1">
                    P/L <SortIcon columnKey="profit_loss" />
                  </div>
                </th>
                <th className="text-right">Peso</th>
              </tr>
            </thead>
            <tbody>
              {sortedPositions.map((position, index) => (
                <tr 
                  key={position.id || index}
                  className="animate-fade-in"
                  style={{ animationDelay: `${index * 20}ms` }}
                >
                  <td>
                    <div className="max-w-[300px]">
                      <p className="font-medium truncate">{position.description}</p>
                      {position.isin && (
                        <p className="text-xs text-muted-foreground font-mono">{position.isin}</p>
                      )}
                      {position.option_type && position.strike_price && (
                        <div className="flex items-center gap-2 mt-1">
                          <Badge 
                            variant="outline" 
                            className={position.option_type === 'call' ? 'border-profit text-profit' : 'border-loss text-loss'}
                          >
                            {position.option_type.toUpperCase()} {position.strike_price}
                          </Badge>
                          {position.expiry_date && (
                            <span className="text-xs text-muted-foreground">
                              Exp: {formatDate(position.expiry_date)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <Badge variant="secondary" className="text-xs">
                      {ASSET_TYPE_LABELS[position.asset_type]}
                    </Badge>
                  </td>
                  <td className="text-center font-mono text-muted-foreground">
                    {position.currency || '-'}
                  </td>
                  <td className="text-right font-mono text-muted-foreground">
                    {position.exchange_rate ? position.exchange_rate.toFixed(4) : '-'}
                  </td>
                  <td className="text-right font-mono">
                    {position.quantity.toLocaleString('it-IT')}
                  </td>
                  <td className="text-right font-mono text-muted-foreground">
                    {position.current_price ? formatCurrency(position.current_price, position.currency) : '-'}
                  </td>
                  <td className="text-right font-mono text-muted-foreground">
                    {position.avg_cost ? formatCurrency(position.avg_cost, position.currency) : '-'}
                  </td>
                  <td className="text-right font-mono font-medium">
                    {position.market_value ? formatCurrency(position.market_value) : '-'}
                  </td>
                  <td className="text-right">
                    {position.profit_loss !== undefined && position.profit_loss !== null ? (
                      <div className="flex items-center justify-end gap-1">
                        {position.profit_loss >= 0 ? (
                          <ArrowUpRight className="w-4 h-4 text-profit" />
                        ) : (
                          <ArrowDownRight className="w-4 h-4 text-loss" />
                        )}
                        <span className={`font-mono ${position.profit_loss >= 0 ? 'text-profit' : 'text-loss'}`}>
                          {formatProfitLoss(position.profit_loss)}
                        </span>
                      </div>
                    ) : '-'}
                  </td>
                  <td className="text-right font-mono text-muted-foreground">
                    {position.weight_pct ? `${position.weight_pct.toFixed(1)}%` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}