import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CallBuybackRow {
  id: string;
  portfolio_id: string;
  underlying: string;
  descriptor: string;
  strike: number;
  expiry_date: string;
  quantity: number;
  buyback_price: number;
  currency: string;
  exchange_rate: number;
  buyback_date: string;
  market_price: number | null;
  market_price_updated_at: string | null;
  resold_quantity: number;
  resell_price: number | null;
  resell_date: string | null;
  included_in_netting: boolean;
  manually_edited: boolean;
}

/**
 * Riacquisti di call CC/DR-CC ancora aperti (quantità > 0).
 * Il valore di mercato mostrato a video è 0 per le call scadute.
 */
export function useCallBuybacks(portfolioIds: Array<string | null | undefined>) {
  const validPortfolioIds = portfolioIds.filter((id): id is string => !!id);
  const { data: buybacks = [], isLoading } = useQuery({
    queryKey: ['call-buybacks', validPortfolioIds],
    queryFn: async (): Promise<CallBuybackRow[]> => {
      if (validPortfolioIds.length === 0) return [];
      const { data, error } = await supabase
        .from('call_buybacks' as never)
        .select('*')
        .in('portfolio_id', validPortfolioIds)
        .gt('quantity', 0)
        .order('buyback_date', { ascending: false });
      if (error) {
        console.error('[useCallBuybacks] fetch error:', error.message);
        return [];
      }
      return (data || []) as unknown as CallBuybackRow[];
    },
    enabled: validPortfolioIds.length > 0,
    staleTime: 60_000,
  });

  return { buybacks, isLoading };
}

/** Campi editabili a mano di un riacquisto call. market_price resta gestito dal cron. */
export interface CallBuybackEditableFields {
  buyback_price?: number;
  quantity?: number;
  strike?: number;
  expiry_date?: string;
}

/** Dati per l'inserimento manuale di un riacquisto call (call da rivendere). */
export interface ManualCallBuybackInput {
  underlying: string;
  strike: number;
  expiry_date: string;
  quantity: number;
  buyback_price: number;
  currency: string;
  exchange_rate: number;
  buyback_date: string;
}

/**
 * Mutazioni sui riacquisti call: toggle inclusione nel netting e modifica manuale
 * dei campi (prezzo di riacquisto, quantità, strike, scadenza). Ogni modifica ai
 * campi marca la riga come manually_edited=true così il CSV ingest non la
 * sovrascrive più. Il toggle di inclusione NON marca la riga come manuale.
 */
export function useCallBuybackMutations(portfolioIds: Array<string | null | undefined>) {
  const queryClient = useQueryClient();
  const validPortfolioIds = portfolioIds.filter((id): id is string => !!id);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['call-buybacks', validPortfolioIds] });

  const setIncluded = useMutation({
    mutationFn: async ({ id, included }: { id: string; included: boolean }) => {
      const { error } = await supabase
        .from('call_buybacks' as never)
        .update({ included_in_netting: included, updated_at: new Date().toISOString() } as never)
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const editFields = useMutation({
    mutationFn: async ({ id, fields }: { id: string; fields: CallBuybackEditableFields }) => {
      const patch: Record<string, unknown> = { manually_edited: true, updated_at: new Date().toISOString() };
      if (fields.buyback_price != null) patch.buyback_price = fields.buyback_price;
      if (fields.quantity != null) patch.quantity = fields.quantity;
      if (fields.strike != null) patch.strike = fields.strike;
      if (fields.expiry_date) patch.expiry_date = fields.expiry_date;
      const { error } = await supabase
        .from('call_buybacks' as never)
        .update(patch as never)
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const insertManual = useMutation({
    mutationFn: async ({ portfolioId, row }: { portfolioId: string; row: ManualCallBuybackInput }) => {
      // Descrittore sintetico stabile: evita collisioni con i descrittori banca
      // e mantiene idempotenza sull'unica chiave (portfolio, descriptor, data).
      const descriptor = `MAN-${row.underlying}-${row.strike}-${row.expiry_date}`.toUpperCase().replace(/\s+/g, '');

      // Tranche: la chiave univoca include il prezzo di riacquisto, quindi lo
      // stesso strike/scadenza può essere registrato in più lotti a prezzi
      // diversi. Una tranche identica (stessa data E stesso prezzo) non è un
      // lotto nuovo: si somma la quantità alla riga esistente invece di far
      // fallire l'inserimento con un errore di chiave duplicata.
      const { data: existing, error: readErr } = await supabase
        .from('call_buybacks' as never)
        .select('id, quantity')
        .eq('portfolio_id', portfolioId)
        .eq('descriptor', descriptor)
        .eq('buyback_date', row.buyback_date)
        .eq('buyback_price', row.buyback_price)
        .maybeSingle();
      if (readErr) throw new Error(readErr.message);

      if (existing) {
        const prev = existing as unknown as { id: string; quantity: number };
        const { error: updErr } = await supabase
          .from('call_buybacks' as never)
          .update({
            quantity: Number(prev.quantity || 0) + row.quantity,
            manually_edited: true,
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', prev.id);
        if (updErr) throw new Error(updErr.message);
        return;
      }

      const insert = {
        portfolio_id: portfolioId,
        underlying: row.underlying,
        descriptor,
        strike: row.strike,
        expiry_date: row.expiry_date,
        quantity: row.quantity,
        buyback_price: row.buyback_price,
        currency: row.currency,
        exchange_rate: row.exchange_rate > 0 ? row.exchange_rate : 1,
        buyback_date: row.buyback_date,
        manually_edited: true,
        included_in_netting: true,
      };
      const { error } = await supabase
        .from('call_buybacks' as never)
        .insert(insert as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await supabase
        .from('call_buybacks' as never)
        .delete()
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  return { setIncluded, editFields, insertManual, remove };
}

/** Valore di mercato effettivo: 0 se la call è scaduta. */
export function effectiveMarketPrice(row: CallBuybackRow, todayISO?: string): number {
  const today = todayISO || new Date().toISOString().split('T')[0];
  if (row.expiry_date < today) return 0;
  return row.market_price ?? 0;
}

/**
 * True se il prezzo di mercato è NOTO.
 *
 * Una call scaduta vale zero per davvero (il premio è perso), quindi il suo G/P
 * potenziale è un dato reale: −prezzo di riacquisto × 100 × contratti.
 * Una call NON scaduta senza market_price (cron non ancora passato, oppure
 * catena opzioni non trovata su Yahoo) è invece un dato MANCANTE: trattarla
 * come zero produceva un G/P potenziale falsamente negativo pari all'intero
 * costo di riacquisto, sia sulla riga sia sul totale.
 */
export function hasKnownMarketPrice(row: CallBuybackRow, todayISO?: string): boolean {
  const today = todayISO || new Date().toISOString().split('T')[0];
  if (row.expiry_date < today) return true;
  return row.market_price != null;
}

/** True se la riga va conteggiata nel netting (default: sì). */
function isIncluded(row: CallBuybackRow): boolean {
  return row.included_in_netting !== false;
}

/** Valore di mercato complessivo dei riacquisti aperti INCLUSI, convertito in EUR. */
export function openCallBuybacksValueEUR(rows: CallBuybackRow[], todayISO?: string): number {
  return rows.reduce((total, row) => {
    if (!isIncluded(row)) return total;
    if (!hasKnownMarketPrice(row, todayISO)) return total;
    const exchangeRate = row.exchange_rate > 0 ? row.exchange_rate : 1;
    return total + (effectiveMarketPrice(row, todayISO) * 100 * row.quantity) / exchangeRate;
  }, 0);
}

/**
 * G/P potenziale complessivo (mercato − riacquisto) dei riacquisti aperti
 * INCLUSI e con prezzo di mercato NOTO, convertito in EUR. Le righe senza
 * prezzo di mercato sono escluse invece di pesare come perdita totale.
 */
export function openCallBuybacksGainLossEUR(rows: CallBuybackRow[], todayISO?: string): number {
  return rows.reduce((total, row) => {
    if (!isIncluded(row)) return total;
    if (!hasKnownMarketPrice(row, todayISO)) return total;
    const exchangeRate = row.exchange_rate > 0 ? row.exchange_rate : 1;
    const gainLossPerShare = effectiveMarketPrice(row, todayISO) - row.buyback_price;
    return total + (gainLossPerShare * 100 * row.quantity) / exchangeRate;
  }, 0);
}

/** Quante righe incluse hanno prezzo di mercato mancante (escluse dai totali). */
export function unknownMarketPriceCount(rows: CallBuybackRow[], todayISO?: string): number {
  return rows.filter(r => isIncluded(r) && !hasKnownMarketPrice(r, todayISO)).length;
}
