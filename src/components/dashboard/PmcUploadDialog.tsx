/**
 * Wizard di caricamento PMC dal vecchio file Excel.
 *
 * I flussi CSV della banca non includono più il prezzo medio di carico: il
 * primo caricamento (e ogni riallineamento successivo) avviene da qui. Il
 * file viene parsato con l'excelParser esistente, i PMC dei titoli (azioni/
 * ETF) vengono salvati nello store persistente stock_cost_basis e applicati
 * subito alle posizioni correnti. Dai movimenti titoli successivi il PMC
 * viene mantenuto aggiornato automaticamente (media ponderata continua).
 */

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { parsePortfolioExcel } from '@/lib/excelParser';
import { syncCostBasisStoreFromPositions, fetchCostBasisStore, positionBasisKey, derivativeBasisKey, fetchDynamicAliases } from '@/lib/costBasisStore';
import { supabase } from '@/integrations/supabase/client';
import { Position } from '@/types/portfolio';

export function PmcUploadDialog({
  portfolioId,
  open,
  onOpenChange,
}: {
  portfolioId: string | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const handleFile = async (file: File | null | undefined) => {
    if (!file || !portfolioId) return;
    setIsProcessing(true);
    try {
      const parsed = await parsePortfolioExcel(file);
      const withPmc = parsed.positions.filter(
        p => (p.asset_type === 'stock' || p.asset_type === 'etf' || p.asset_type === 'derivative')
          && p.avg_cost != null && p.avg_cost > 0,
      );
      if (withPmc.length === 0) {
        toast.error('Nessun PMC trovato nel file', {
          description: 'Il file non contiene prezzi medi di carico. Serve il vecchio file Excel del portafoglio.',
        });
        return;
      }

      // 1. Sincronizza lo store (fonte 'excel')
      const dynamicAliases = await fetchDynamicAliases();
      const { synced } = await syncCostBasisStoreFromPositions(portfolioId, parsed.positions, dynamicAliases);

      // 2. Applica subito alle posizioni correnti in DB (stessa chiave: ISIN
      //    /ticker canonico per azioni-ETF, sottostante+tipo+strike+scadenza
      //    per le opzioni)
      const store = await fetchCostBasisStore(portfolioId);
      const { data: current } = await supabase
        .from('positions')
        .select('id, isin, ticker, description, asset_type, quantity, current_price, underlying, option_type, strike_price, expiry_date')
        .eq('portfolio_id', portfolioId)
        .in('asset_type', ['stock', 'etf', 'derivative']);

      let updated = 0;
      for (const pos of (current || []) as unknown as Pick<Position, 'id' | 'isin' | 'ticker' | 'description' | 'asset_type' | 'quantity' | 'current_price' | 'underlying' | 'option_type' | 'strike_price' | 'expiry_date'>[]) {
        const key = pos.asset_type === 'derivative' ? derivativeBasisKey(pos, dynamicAliases) : positionBasisKey(pos, dynamicAliases);
        if (!key) continue;
        const row = store.get(key);
        if (!row || !(row.pmc > 0)) continue;
        const patch: Record<string, unknown> = { avg_cost: row.pmc };
        if (pos.current_price != null && pos.quantity) {
          if (pos.asset_type === 'derivative') {
            // Quantità firmata (short negative): (prezzo − premio medio) × qtà × 100
            const pl = (pos.current_price - row.pmc) * pos.quantity * 100;
            patch.profit_loss = pl;
            patch.profit_loss_pct = row.pmc !== 0
              ? (pl / (Math.abs(pos.quantity) * 100 * row.pmc)) * 100
              : null;
          } else {
            patch.profit_loss = (pos.current_price - row.pmc) * pos.quantity;
            patch.profit_loss_pct = row.pmc !== 0 ? ((pos.current_price - row.pmc) / row.pmc) * 100 : null;
          }
        }
        const { error } = await supabase.from('positions').update(patch).eq('id', pos.id);
        if (!error) updated += 1;
      }

      await queryClient.invalidateQueries({ queryKey: ['positions'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-view-portfolio'] });

      toast.success('PMC caricati', {
        description: `${synced} titoli salvati nello store, ${updated} posizioni correnti aggiornate. D'ora in poi il PMC si aggiorna dai movimenti titoli.`,
      });
      onOpenChange(false);
    } catch (err) {
      console.error('[PmcUpload] errore:', err);
      toast.error('Caricamento PMC non riuscito', {
        description: err instanceof Error ? err.message : 'errore sconosciuto',
      });
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Carica PMC da file Excel</DialogTitle>
          <DialogDescription>
            I flussi CSV della banca non includono più il prezzo medio di carico.
            Carica il vecchio file Excel del portafoglio per impostare (o riallineare)
            i PMC di azioni, ETF e opzioni aperte. Dai successivi upload dei movimenti titoli il PMC
            viene mantenuto aggiornato automaticamente: gli acquisti ricalcolano la
            media ponderata, le vendite riducono solo la quantità.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={e => handleFile(e.target.files?.[0])}
        />

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isProcessing}>
            Annulla
          </Button>
          <Button onClick={() => fileInputRef.current?.click()} disabled={isProcessing || !portfolioId}>
            {isProcessing
              ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Elaborazione…</>)
              : (<><Upload className="w-4 h-4 mr-2" /> Scegli file Excel</>)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
