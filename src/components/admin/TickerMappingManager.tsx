import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, RefreshCw, Trash2, Loader2, Plus, Search, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { useUnderlyingMappings } from '@/hooks/useUnderlyingMappings';

export function TickerMappingManager() {
  const { allMappings, unresolvedQuery, upsertMapping, deleteMapping, refetch } = useUnderlyingMappings();
  
  // State for unresolved ticker inputs
  const [unresolvedInputs, setUnresolvedInputs] = useState<Record<string, string>>({});
  const [savingUnderlying, setSavingUnderlying] = useState<string | null>(null);
  
  // State for new manual mapping
  const [newUnderlying, setNewUnderlying] = useState('');
  const [newTicker, setNewTicker] = useState('');
  
  // State for search
  const [searchQuery, setSearchQuery] = useState('');
  
  // State for delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const unresolvedUnderlyings = unresolvedQuery.data || [];
  const mappings = allMappings.data || [];
  
  // Filter mappings by search
  const filteredMappings = mappings.filter(m => 
    m.underlying.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.ticker.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Handle save unresolved mapping
  const handleSaveUnresolved = async (underlying: string) => {
    const ticker = unresolvedInputs[underlying]?.trim().toUpperCase();
    if (!ticker) {
      toast.error('Inserisci un ticker valido');
      return;
    }
    
    setSavingUnderlying(underlying);
    
    try {
      await upsertMapping.mutateAsync({ underlying, ticker });
      toast.success(`Mapping salvato: ${underlying} → ${ticker}`);
      
      // Clear input
      setUnresolvedInputs(prev => {
        const updated = { ...prev };
        delete updated[underlying];
        return updated;
      });
    } catch (error) {
      // Error already handled by mutation
    } finally {
      setSavingUnderlying(null);
    }
  };

  // Handle add new manual mapping
  const handleAddManualMapping = async () => {
    const underlying = newUnderlying.trim();
    const ticker = newTicker.trim().toUpperCase();
    
    if (!underlying || !ticker) {
      toast.error('Inserisci sia l\'underlying che il ticker');
      return;
    }
    
    try {
      await upsertMapping.mutateAsync({ underlying, ticker });
      toast.success(`Mapping aggiunto: ${underlying} → ${ticker}`);
      setNewUnderlying('');
      setNewTicker('');
    } catch (error) {
      // Error already handled by mutation
    }
  };

  // Handle delete mapping
  const handleDeleteMapping = async (id: string) => {
    setDeletingId(id);
    
    try {
      await deleteMapping.mutateAsync(id);
      toast.success('Mapping eliminato');
    } catch (error) {
      // Error already handled by mutation
    } finally {
      setDeletingId(null);
    }
  };

  // Get source display name
  const getSourceLabel = (source: string | null) => {
    switch (source) {
      case 'admin-override':
        return 'Admin';
      case 'yahoo':
        return 'Yahoo';
      case 'fetch-underlying-prices':
        return 'Auto';
      case 'manual-alert-config':
        return 'Manuale';
      default:
        return source || 'N/D';
    }
  };

  const isLoading = allMappings.isLoading || unresolvedQuery.isLoading;
  const isRefetching = allMappings.isRefetching || unresolvedQuery.isRefetching;

  return (
    <div className="space-y-6">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link2 className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Gestione Mapping Ticker</h2>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => refetch()}
          disabled={isRefetching}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
          Aggiorna
        </Button>
      </div>

      {/* Unresolved underlyings */}
      {unresolvedUnderlyings.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <CardTitle className="text-base">
                Ticker Non Risolti ({unresolvedUnderlyings.length})
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Questi sottostanti non hanno un ticker associato. Inserisci il ticker corretto per abilitare gli avvisi di distanza.
            </p>
            
            <div className="space-y-2">
              {unresolvedUnderlyings.map(underlying => (
                <div key={underlying} className="flex items-center gap-3 p-2 rounded-lg bg-background/50">
                  <span className="text-sm min-w-[200px] truncate font-medium">
                    {underlying}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <Input
                    placeholder="Ticker (es. AAPL)"
                    value={unresolvedInputs[underlying] || ''}
                    onChange={e => setUnresolvedInputs(prev => ({ 
                      ...prev, 
                      [underlying]: e.target.value.toUpperCase() 
                    }))}
                    className="flex-1 h-9"
                  />
                  <Button
                    size="sm"
                    onClick={() => handleSaveUnresolved(underlying)}
                    disabled={savingUnderlying === underlying || !unresolvedInputs[underlying]?.trim()}
                  >
                    {savingUnderlying === underlying ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Salva'
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Existing mappings */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              📋 Mapping Esistenti
              <Badge variant="secondary">{mappings.length}</Badge>
            </CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Cerca..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9 h-9 w-[200px]"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredMappings.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              {searchQuery ? 'Nessun mapping trovato' : 'Nessun mapping configurato'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead>Underlying</TableHead>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Sorgente</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMappings.map(mapping => (
                  <TableRow key={mapping.id} className="border-border hover:bg-background-tertiary">
                    <TableCell className="font-medium truncate max-w-[200px]">
                      {mapping.underlying}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">
                        {mapping.ticker}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant="secondary" 
                        className={
                          mapping.source === 'admin-override' 
                            ? 'bg-primary/10 text-primary' 
                            : ''
                        }
                      >
                        {getSourceLabel(mapping.source)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteMapping(mapping.id)}
                        disabled={deletingId === mapping.id}
                        className="text-destructive hover:text-destructive"
                      >
                        {deletingId === mapping.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add manual mapping */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Aggiungi Mapping Manuale
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Input
              placeholder="Nome underlying (es. NVIDIA CORP)"
              value={newUnderlying}
              onChange={e => setNewUnderlying(e.target.value)}
              className="flex-1"
            />
            <span className="text-muted-foreground">→</span>
            <Input
              placeholder="Ticker"
              value={newTicker}
              onChange={e => setNewTicker(e.target.value.toUpperCase())}
              className="w-[120px]"
            />
            <Button
              onClick={handleAddManualMapping}
              disabled={!newUnderlying.trim() || !newTicker.trim() || upsertMapping.isPending}
            >
              {upsertMapping.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Aggiungi'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
