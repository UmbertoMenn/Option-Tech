/**
 * Caricamento dei file movimenti (cash + titoli) nella card "Scomposizione
 * Rendimento". Scrive SOLO il ledger dedicato `portfolio_movements` (più il
 * registro dei file e, per i giroconti cash ↔ GP, `internal_transfer_ledger`):
 * non tocca posizioni, PMC, riacquisti call né versamenti.
 *
 * Idempotente: chiave naturale per riga (vedi movementLedger.ts), upsert su
 * (portfolio_id, row_key). Ricaricare lo stesso file o file sovrapposti non
 * duplica nulla.
 */
import { supabase } from '@/integrations/supabase/client';
import { FlussiParseOptions } from '@/lib/flussiCsvParser';
import { MovementLedgerRow, MovementSource, parseMovementFile } from '@/lib/movementLedger';
import { fetchDynamicAliases } from '@/lib/costBasisStore';
import { getCanonicalTickerKey } from '@/lib/tickerIdentity';
import { fetchHistoricalUnderlyingPrices, splitOptionPremium } from '@/lib/optionTradeAttribution';
import { getPortfolioParseOptions } from '@/lib/portfolioUpload';

export interface MovementFileSummary {
  fileName: string;
  source: MovementSource;
  periodStart: string | null;
  periodEnd: string | null;
  rows: number;
  newRows: number;
  excludedByAccountRule: number;
  excludedByPositionRule: number;
}

export interface MovementIngestResult {
  files: MovementFileSummary[];
  rejectedFiles: string[];
  warnings: string[];
}

/** Regole di perimetro del titolare del portafoglio (funziona anche in vista admin). */
export async function resolveParseOptionsForPortfolio(portfolioId: string): Promise<FlussiParseOptions> {
  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('user_id')
    .eq('id', portfolioId)
    .maybeSingle();
  const userId = (portfolio as { user_id?: string } | null)?.user_id;
  if (!userId) return getPortfolioParseOptions(undefined);
  const { data: profile } = await supabase
    .from('profiles')
    .select('username, email')
    .eq('user_id', userId)
    .maybeSingle();
  const username = (profile?.username || profile?.email?.replace('@internal.local', '') || '')
    .trim()
    .toLowerCase();
  return getPortfolioParseOptions(userId, username);
}

interface Enrichment {
  underlying_key: string | null;
  underlying_price: number | null;
  intrinsic_per_share: number | null;
  time_value_per_share: number | null;
  attribution_price_source: string | null;
}

async function enrichRows(rows: MovementLedgerRow[], warnings: string[]): Promise<Map<MovementLedgerRow, Enrichment>> {
  const enrichment = new Map<MovementLedgerRow, Enrichment>();
  const dynamicAliases = await fetchDynamicAliases();
  const optionKey = (ticker: string) => getCanonicalTickerKey({ rawTicker: ticker }, { dynamicAliases });

  const optionRows = rows.filter(row =>
    row.scope === 'portfolio'
    && !!row.underlyingTicker
    && (row.kind === 'buy' || row.kind === 'sell' || row.kind === 'option_exercise'),
  );
  const prices = await fetchHistoricalUnderlyingPrices(
    optionRows.map(row => ({
      underlyingTicker: row.underlyingTicker as string,
      tradeDate: row.operationDate || row.effectiveDate,
    })),
    optionKey,
  );

  let missing = 0;
  for (const row of rows) {
    if (row.underlyingTicker) {
      const key = optionKey(row.underlyingTicker);
      const historical = prices.get(`${key}|${row.operationDate || row.effectiveDate}`);
      const spot = Number(historical?.close_price || 0);
      let intrinsic: number | null = null;
      let time: number | null = null;
      if (spot > 0 && row.optionType && row.strike != null && (row.kind === 'buy' || row.kind === 'sell')) {
        const split = splitOptionPremium(row.optionType, row.strike, Number(row.price || 0), spot);
        intrinsic = split.intrinsicPerShare;
        time = split.timeValuePerShare;
      }
      if (optionRows.includes(row) && !(spot > 0)) missing += 1;
      enrichment.set(row, {
        underlying_key: key,
        underlying_price: spot > 0 ? spot : null,
        intrinsic_per_share: intrinsic,
        time_value_per_share: time,
        attribution_price_source: historical?.source ?? (optionRows.includes(row) ? 'missing' : null),
      });
    } else if (row.source === 'titoli' && row.isin) {
      enrichment.set(row, {
        underlying_key: getCanonicalTickerKey({ description: row.description, isin: row.isin }, { dynamicAliases }),
        underlying_price: null,
        intrinsic_per_share: null,
        time_value_per_share: null,
        attribution_price_source: null,
      });
    }
  }
  if (missing > 0) {
    warnings.push(`${missing} movimenti opzione senza prezzo storico del sottostante: split intrinseco/tempo stimato dagli snapshot`);
  }
  return enrichment;
}

function toDbRow(portfolioId: string, row: MovementLedgerRow, extra?: Enrichment) {
  return {
    portfolio_id: portfolioId,
    row_key: row.rowKey,
    source: row.source,
    account_id: row.accountId,
    scope: row.scope,
    kind: row.kind,
    effective_date: row.effectiveDate,
    booking_date: row.bookingDate,
    value_date: row.valueDate,
    operation_date: row.operationDate,
    causale: row.causale,
    causale_description: row.causaleDescription,
    operation_id: row.operationId,
    description: row.description,
    isin: row.isin,
    descriptor: row.descriptor,
    underlying_ticker: row.underlyingTicker,
    option_type: row.optionType,
    strike: row.strike,
    expiry_date: row.expiryDate,
    position_side: row.positionSide,
    quantity: row.quantity,
    price: row.price,
    currency: row.currency,
    exchange_rate: row.exchangeRate,
    gross_eur: row.grossEur,
    accrued_eur: row.accruedEur,
    net_eur: row.netEur,
    commission_eur: row.commissionEur,
    fx_commission_eur: row.fxCommissionEur,
    tax_eur: row.taxEur,
    bolli_eur: row.bolliEur,
    unexplained_charge_eur: row.unexplainedChargeEur,
    period_start: row.periodStart,
    period_end: row.periodEnd,
    underlying_key: extra?.underlying_key ?? null,
    underlying_price: extra?.underlying_price ?? null,
    intrinsic_per_share: extra?.intrinsic_per_share ?? null,
    time_value_per_share: extra?.time_value_per_share ?? null,
    attribution_price_source: extra?.attribution_price_source ?? null,
    updated_at: new Date().toISOString(),
  };
}

async function countRows(portfolioId: string, source: MovementSource): Promise<number> {
  const { count, error } = await supabase
    .from('portfolio_movements' as never)
    .select('id', { count: 'exact', head: true })
    .eq('portfolio_id', portfolioId)
    .eq('source', source);
  if (error) throw new Error(`Lettura movimenti non riuscita: ${error.message}`);
  return count ?? 0;
}

export async function ingestMovementFiles(portfolioId: string, files: File[]): Promise<MovementIngestResult> {
  const result: MovementIngestResult = { files: [], rejectedFiles: [], warnings: [] };
  const options = await resolveParseOptionsForPortfolio(portfolioId);

  for (const file of files) {
    const text = await file.text();
    const parsed = parseMovementFile(text, options);
    if (!parsed.source) {
      result.rejectedFiles.push(file.name);
      continue;
    }

    const enrichment = parsed.source === 'titoli'
      ? await enrichRows(parsed.rows, result.warnings)
      : new Map<MovementLedgerRow, Enrichment>();
    const dbRows = parsed.rows.map(row => toDbRow(portfolioId, row, enrichment.get(row)));

    const before = await countRows(portfolioId, parsed.source);
    for (let i = 0; i < dbRows.length; i += 200) {
      const { error } = await supabase
        .from('portfolio_movements' as never)
        .upsert(dbRows.slice(i, i + 200) as never[], { onConflict: 'portfolio_id,row_key' });
      if (error) throw new Error(`Salvataggio movimenti non riuscito: ${error.message}`);
    }
    const after = await countRows(portfolioId, parsed.source);

    if (parsed.periodStart && parsed.periodEnd) {
      const { error: uploadErr } = await supabase
        .from('portfolio_movement_uploads' as never)
        .upsert([{
          portfolio_id: portfolioId,
          source: parsed.source,
          period_start: parsed.periodStart,
          period_end: parsed.periodEnd,
          file_name: file.name,
          rows_total: parsed.rows.length,
          uploaded_at: new Date().toISOString(),
        }] as never[], { onConflict: 'portfolio_id,source,period_start,period_end' });
      if (uploadErr) result.warnings.push(`Registro file non aggiornato: ${uploadErr.message}`);
    }

    // Giroconti cash ↔ GP: travasi interni, servono a depurare il contributo GP.
    if (parsed.source === 'cash') {
      const pairs = parsed.gpTransferPairs;
      const transfers = pairs.map(([debit, credit]) => {
        const amount = Math.abs(debit.netEur);
        const debitDate = debit.valueDate || debit.effectiveDate;
        const creditDate = credit.valueDate || credit.effectiveDate;
        return {
          portfolio_id: portfolioId,
          // Stesso formato del vecchio ingest CSV: un file già elaborato allora non si duplica.
          transfer_key: [
            debit.operationId || '-',
            credit.operationId || '-',
            debit.accountId,
            credit.accountId,
            debitDate,
            creditDate,
            amount.toFixed(2),
            debit.scope === 'gp' ? 'GP_OUT' : 'GP_IN',
          ].join('|'),
          debit_date: debitDate,
          credit_date: creditDate,
          amount_eur: amount,
          from_gp: debit.scope === 'gp',
          to_gp: credit.scope === 'gp',
        };
      });
      if (transfers.length > 0) {
        const { error: transferErr } = await supabase
          .from('internal_transfer_ledger' as never)
          .upsert(transfers as never[], { onConflict: 'portfolio_id,transfer_key', ignoreDuplicates: true });
        if (transferErr) result.warnings.push(`Giroconti GP non registrati: ${transferErr.message}`);
      }
    }

    result.files.push({
      fileName: file.name,
      source: parsed.source,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      rows: parsed.rows.length,
      newRows: Math.max(0, after - before),
      excludedByAccountRule: parsed.excludedByAccountRule,
      excludedByPositionRule: parsed.excludedByPositionRule,
    });
  }

  return result;
}

/**
 * Imposta (o azzera con null) il premio temporale per azione di una
 * compravendita di opzioni. La colonna non fa parte del payload di ingest,
 * quindi ricaricare i file non la sovrascrive.
 */
export async function saveManualTimeValue(
  portfolioId: string,
  rowKey: string,
  timeValuePerShare: number | null,
): Promise<void> {
  if (timeValuePerShare != null && (!Number.isFinite(timeValuePerShare) || timeValuePerShare < 0)) {
    throw new Error('Premio temporale non valido');
  }
  const { error } = await supabase
    .from('portfolio_movements' as never)
    .update({ manual_time_value_per_share: timeValuePerShare, updated_at: new Date().toISOString() } as never)
    .eq('portfolio_id', portfolioId)
    .eq('row_key', rowKey);
  if (error) throw new Error(`Salvataggio premio temporale non riuscito: ${error.message}`);
}
