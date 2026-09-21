import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { FullSnapshot } from '@/lib/fullSnapshot';
import { AttributionTradeRow, InternalTransferRow } from '@/lib/performanceAttribution';
import { Position } from '@/types/portfolio';
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';
import { DerivativeOverride } from '@/types/derivativeOverrides';
import { GPHoldingRow } from '@/hooks/useGPHoldings';
import { MovementUploadRecord, StoredMovementRow } from '@/lib/movementAttribution';
import { MovementKind, MovementSource } from '@/lib/movementLedger';
import { AttributionPriceSource } from '@/lib/optionTradeAttribution';

interface AttributionSourceData {
  snapshots: FullSnapshot[];
  trades: AttributionTradeRow[];
  internalTransfers: InternalTransferRow[];
  movements: StoredMovementRow[];
  movementUploads: MovementUploadRecord[];
}

interface MovementDbRow {
  row_key: string;
  source: MovementSource;
  account_id: string;
  scope: 'portfolio' | 'gp';
  kind: MovementKind;
  effective_date: string;
  booking_date: string | null;
  value_date: string | null;
  operation_date: string | null;
  causale: string | null;
  causale_description: string | null;
  operation_id: string | null;
  description: string | null;
  isin: string | null;
  descriptor: string | null;
  underlying_ticker: string | null;
  option_type: 'call' | 'put' | null;
  strike: number | string | null;
  expiry_date: string | null;
  position_side: 'short' | 'long' | null;
  quantity: number | string | null;
  price: number | string | null;
  currency: string | null;
  exchange_rate: number | string | null;
  gross_eur: number | string | null;
  accrued_eur: number | string | null;
  net_eur: number | string | null;
  commission_eur: number | string | null;
  fx_commission_eur: number | string | null;
  tax_eur: number | string | null;
  bolli_eur: number | string | null;
  unexplained_charge_eur: number | string | null;
  period_start: string | null;
  period_end: string | null;
  underlying_key: string | null;
  underlying_price: number | string | null;
  intrinsic_per_share: number | string | null;
  time_value_per_share: number | string | null;
  attribution_price_source: AttributionPriceSource | null;
  manual_time_value_per_share: number | string | null;
}

const num = (value: number | string | null | undefined): number => Number(value ?? 0) || 0;
const numOrNull = (value: number | string | null | undefined): number | null =>
  value == null || value === '' ? null : Number(value);

function decodeMovement(row: MovementDbRow): StoredMovementRow {
  return {
    source: row.source,
    rowKey: row.row_key,
    accountId: row.account_id,
    scope: row.scope,
    kind: row.kind,
    effectiveDate: row.effective_date,
    bookingDate: row.booking_date,
    valueDate: row.value_date,
    operationDate: row.operation_date,
    causale: row.causale ?? '',
    causaleDescription: row.causale_description,
    operationId: row.operation_id,
    description: row.description ?? '',
    isin: row.isin,
    descriptor: row.descriptor,
    underlyingTicker: row.underlying_ticker,
    optionType: row.option_type,
    strike: numOrNull(row.strike),
    expiryDate: row.expiry_date,
    positionSide: row.position_side,
    quantity: numOrNull(row.quantity),
    price: numOrNull(row.price),
    currency: row.currency ?? 'EUR',
    exchangeRate: numOrNull(row.exchange_rate),
    grossEur: num(row.gross_eur),
    accruedEur: num(row.accrued_eur),
    netEur: num(row.net_eur),
    commissionEur: num(row.commission_eur),
    fxCommissionEur: num(row.fx_commission_eur),
    taxEur: num(row.tax_eur),
    bolliEur: num(row.bolli_eur),
    unexplainedChargeEur: num(row.unexplained_charge_eur),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    underlyingKey: row.underlying_key,
    underlyingPrice: numOrNull(row.underlying_price),
    intrinsicPerShare: numOrNull(row.intrinsic_per_share),
    timeValuePerShare: numOrNull(row.time_value_per_share),
    attributionPriceSource: row.attribution_price_source,
    manualTimeValuePerShare: numOrNull(row.manual_time_value_per_share),
  };
}

/** Tabella non ancora migrata: la card resta funzionante senza movimenti. */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? ''));
}

async function fetchAllMovements(portfolioId: string): Promise<MovementDbRow[]> {
  const pageSize = 1000;
  const rows: MovementDbRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('portfolio_movements' as never)
      .select('*')
      .eq('portfolio_id', portfolioId)
      .order('effective_date', { ascending: true })
      .order('row_key', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
    const page = (data ?? []) as unknown as MovementDbRow[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

interface FullSnapshotRow {
  portfolio_id: string;
  snapshot_date: string;
  positions: unknown;
  strategy_configurations: unknown;
  derivative_overrides: unknown;
  gp_holdings: unknown;
  cash_value: number | null;
  gp_total_value: number | null;
}

function decodeSnapshot(row: FullSnapshotRow): FullSnapshot {
  return {
    portfolio_id: row.portfolio_id,
    snapshot_date: row.snapshot_date,
    positions: (row.positions ?? []) as Position[],
    strategy_configurations: (row.strategy_configurations ?? []) as StrategyConfiguration[],
    derivative_overrides: (row.derivative_overrides ?? []) as DerivativeOverride[],
    gp_holdings: (row.gp_holdings ?? []) as GPHoldingRow[],
    cash_value: Number(row.cash_value ?? 0),
    gp_total_value: row.gp_total_value == null ? null : Number(row.gp_total_value),
  };
}

/**
 * Carica soltanto i dati grezzi necessari al motore di attribuzione.
 * Il calcolo resta puro e testabile in `performanceAttribution.ts`.
 */
export function usePerformanceAttribution(portfolioId: string | null) {
  return useQuery({
    queryKey: ['performance-attribution', portfolioId],
    queryFn: async (): Promise<AttributionSourceData> => {
      if (!portfolioId) {
        return { snapshots: [], trades: [], internalTransfers: [], movements: [], movementUploads: [] };
      }

      const [snapshotsResult, tradesResult, transfersResult, movementRows, uploadsResult] = await Promise.all([
        supabase
          .from('portfolio_full_snapshots')
          .select('portfolio_id,snapshot_date,positions,strategy_configurations,derivative_overrides,gp_holdings,cash_value,gp_total_value')
          .eq('portfolio_id', portfolioId)
          .order('snapshot_date', { ascending: true }),
        supabase
          .from('cost_basis_trades')
          .select('*')
          .eq('portfolio_id', portfolioId)
          .order('trade_date', { ascending: true }),
        supabase
          .from('internal_transfer_ledger' as never)
          .select('debit_date,credit_date,amount_eur,from_gp,to_gp')
          .eq('portfolio_id', portfolioId)
          .order('credit_date', { ascending: true }),
        fetchAllMovements(portfolioId),
        supabase
          .from('portfolio_movement_uploads' as never)
          .select('source,period_start,period_end')
          .eq('portfolio_id', portfolioId),
      ]);

      if (snapshotsResult.error) throw snapshotsResult.error;
      if (tradesResult.error) throw tradesResult.error;
      if (transfersResult.error) throw transfersResult.error;
      if (uploadsResult.error && !isMissingTable(uploadsResult.error)) throw uploadsResult.error;
      const uploads = uploadsResult.error
        ? []
        : ((uploadsResult.data ?? []) as unknown as { source: MovementSource; period_start: string; period_end: string }[]);

      return {
        snapshots: ((snapshotsResult.data ?? []) as unknown as FullSnapshotRow[]).map(decodeSnapshot),
        trades: (tradesResult.data ?? []) as unknown as AttributionTradeRow[],
        internalTransfers: (transfersResult.data ?? []) as unknown as InternalTransferRow[],
        movements: movementRows.map(decodeMovement),
        movementUploads: uploads.map(upload => ({
          source: upload.source,
          periodStart: upload.period_start,
          periodEnd: upload.period_end,
        })),
      };
    },
    enabled: !!portfolioId,
    staleTime: 30_000,
  });
}
