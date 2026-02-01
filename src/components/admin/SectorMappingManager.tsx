import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { PieChart, Save, Search, RefreshCw, Loader2, Check, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

// GICS Sector standard
const GICS_SECTORS = [
  'Technology',
  'Financials',
  'Healthcare',
  'Consumer Discretionary',
  'Consumer Staples',
  'Industrials',
  'Energy',
  'Materials',
  'Utilities',
  'Real Estate',
  'Communication Services',
  'ETF',
] as const;

interface IsinMapping {
  isin: string;
  ticker: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  description: string;
  hasMapping: boolean;
}

export function SectorMappingManager() {
  const [mappings, setMappings] = useState<IsinMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showOnlyMissing, setShowOnlyMissing] = useState(true);
  const [pendingChanges, setPendingChanges] = useState<Record<string, string>>({});
  const [savingIsins, setSavingIsins] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadMappings();
  }, []);

  async function loadMappings() {
    setLoading(true);
    try {
      // 1. Carica TUTTI gli ISIN stock dalle posizioni
      const { data: positions, error: posError } = await supabase
        .from('positions')
        .select('isin, description')
        .eq('asset_type', 'stock')
        .not('isin', 'is', null);

      if (posError) throw posError;

      // 2. Carica i mapping esistenti
      const { data: existingMappings, error: mapError } = await supabase
        .from('isin_mappings')
        .select('*');

      if (mapError) throw mapError;

      // 3. Combina: mostra tutti gli ISIN stock con info mapping se disponibile
      const uniqueIsins = [...new Set(positions?.map(p => p.isin).filter(Boolean) || [])] as string[];
      
      const combined: IsinMapping[] = uniqueIsins.map(isin => {
        const mapping = existingMappings?.find(m => m.isin === isin);
        const position = positions?.find(p => p.isin === isin);
        return {
          isin,
          description: position?.description || '',
          ticker: mapping?.ticker || null,
          sector: mapping?.sector || null,
          industry: mapping?.industry || null,
          exchange: mapping?.exchange || null,
          hasMapping: !!mapping,
        };
      });
      
      // Ordina per ticker (se presente) o descrizione
      combined.sort((a, b) => {
        const aKey = a.ticker || a.description;
        const bKey = b.ticker || b.description;
        return aKey.localeCompare(bKey);
      });

      setMappings(combined);
    } catch (error) {
      console.error('Error loading mappings:', error);
      toast.error('Errore caricamento mappature');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSector(isin: string) {
    const newSector = pendingChanges[isin];
    if (!newSector) return;

    setSavingIsins(prev => new Set(prev).add(isin));
    
    try {
      // Trova il mapping corrente per ottenere ticker se presente
      const currentMapping = mappings.find(m => m.isin === isin);
      
      // UPSERT per creare o aggiornare il record
      const { error } = await supabase
        .from('isin_mappings')
        .upsert({ 
          isin,
          ticker: currentMapping?.ticker || currentMapping?.description?.split(' ')[0] || isin,
          sector: newSector,
          source: 'manual',
          last_verified_at: new Date().toISOString()
        }, { onConflict: 'isin' });

      if (error) throw error;

      // Update local state
      setMappings(prev => prev.map(m => 
        m.isin === isin ? { ...m, sector: newSector, hasMapping: true } : m
      ));
      
      // Clear pending change
      setPendingChanges(prev => {
        const updated = { ...prev };
        delete updated[isin];
        return updated;
      });

      toast.success(`Settore salvato: ${newSector}`);
    } catch (error) {
      console.error('Error saving sector:', error);
      toast.error('Errore salvataggio settore');
    } finally {
      setSavingIsins(prev => {
        const updated = new Set(prev);
        updated.delete(isin);
        return updated;
      });
    }
  }

  async function handleAutoPopulate() {
    toast.info('Avvio popolamento automatico settori...');
    
    try {
      const { data, error } = await supabase.functions.invoke('update-prices-cron', {
        body: { mode: 'update-sectors' }
      });

      if (error) throw error;

      toast.success('Popolamento automatico completato', {
        description: 'Ricarico la lista...'
      });
      
      await loadMappings();
    } catch (error) {
      console.error('Error auto-populating:', error);
      toast.error('Errore popolamento automatico');
    }
  }

  const handleSectorChange = (isin: string, sector: string) => {
    setPendingChanges(prev => ({ ...prev, [isin]: sector }));
  };

  // Filter mappings
  const filteredMappings = mappings.filter(m => {
    const matchesSearch = !searchQuery || 
      m.ticker?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.isin.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.description?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesMissingFilter = !showOnlyMissing || !m.sector;
    
    return matchesSearch && matchesMissingFilter;
  });

  const missingSectorCount = mappings.filter(m => !m.sector).length;
  const totalCount = mappings.length;

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <PieChart className="w-5 h-5 text-muted-foreground" />
          <CardTitle>Gestione Settori</CardTitle>
          <Badge variant="secondary">{totalCount} titoli</Badge>
          {missingSectorCount > 0 && (
            <Badge variant="destructive" className="bg-warning/10 text-warning border-warning/30">
              <AlertCircle className="w-3 h-3 mr-1" />
              {missingSectorCount} senza settore
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleAutoPopulate}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Auto-Popola Yahoo
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={loadMappings}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Cerca per ticker, ISIN o descrizione..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-background-secondary border-border"
            />
          </div>
          <Button
            variant={showOnlyMissing ? "default" : "outline"}
            size="sm"
            onClick={() => setShowOnlyMissing(!showOnlyMissing)}
          >
            {showOnlyMissing ? 'Solo senza settore' : 'Tutti'}
          </Button>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Caricamento...
          </div>
        ) : filteredMappings.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {showOnlyMissing 
              ? 'Tutti i titoli hanno un settore assegnato! 🎉' 
              : 'Nessun risultato trovato'}
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-background-tertiary">
                  <TableHead className="w-[150px]">Ticker</TableHead>
                  <TableHead className="w-[250px]">Descrizione</TableHead>
                  <TableHead className="w-[140px]">ISIN</TableHead>
                  <TableHead>Settore Attuale</TableHead>
                  <TableHead className="w-[200px]">Nuovo Settore</TableHead>
                  <TableHead className="w-[100px] text-right">Azione</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMappings.map((mapping) => {
                  const hasPendingChange = pendingChanges[mapping.isin];
                  const isSaving = savingIsins.has(mapping.isin);
                  
                  return (
                    <TableRow 
                      key={mapping.isin} 
                      className={`border-border hover:bg-background-tertiary ${!mapping.hasMapping ? 'bg-warning/5' : ''}`}
                    >
                      <TableCell className="font-mono font-medium">
                        {mapping.ticker || <span className="text-muted-foreground italic">—</span>}
                      </TableCell>
                      <TableCell className="text-sm max-w-[250px] truncate" title={mapping.description}>
                        {mapping.description || '-'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {mapping.isin}
                      </TableCell>
                      <TableCell>
                        {mapping.sector ? (
                          <Badge variant="secondary" className="bg-primary/10 text-primary">
                            {mapping.sector}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Non assegnato
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={pendingChanges[mapping.isin] || ''}
                          onValueChange={(value) => handleSectorChange(mapping.isin, value)}
                        >
                          <SelectTrigger className="bg-background-secondary border-border">
                            <SelectValue placeholder="Seleziona settore..." />
                          </SelectTrigger>
                          <SelectContent>
                            {GICS_SECTORS.map(sector => (
                              <SelectItem key={sector} value={sector}>
                                {sector}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          disabled={!hasPendingChange || isSaving}
                          onClick={() => handleSaveSector(mapping.isin)}
                          className={hasPendingChange ? 'bg-primary hover:bg-primary-glow' : ''}
                        >
                          {isSaving ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : hasPendingChange ? (
                            <>
                              <Save className="w-4 h-4 mr-1" />
                              Salva
                            </>
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
