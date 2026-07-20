import { DepositEntry } from '@/types/deposits';
import { FullSnapshot } from '@/lib/fullSnapshot';
import { HistoricalDataEntry } from '@/types/historicalData';
import { Position } from '@/types/portfolio';
import { calculateTimeWeightedAverage } from '@/lib/timeWeightedAverage';
import { getCanonicalTickerKey } from '@/lib/tickerIdentity';
import { splitOptionPremium, AttributionPriceSource } from '@/lib/optionTradeAttribution';

export type AttributionCategory =
  | 'option_time'
  | 'option_intrinsic'
  | 'stock'
  | 'etf'
  | 'bond'
  | 'gp'
  | 'commodity'
  | 'cash'
  | 'unclassified'
  /**
   * Differenza esplicita tra il P/L del Netting e la somma delle componenti.
   * Non rappresenta un rendimento: serve a non nascondere dati mancanti o
   * movimenti che il ledger non riesce ancora a ricostruire.
   */
  | 'reconciliation_gap';

export const ATTRIBUTION_CATEGORIES: AttributionCategory[] = [
  'option_time',
  'option_intrinsic',
  'stock',
  'etf',
  'bond',
  'gp',
  'commodity',
  'cash',
  'unclassified',
  'reconciliation_gap',
];

export const ATTRIBUTION_LABELS: Record<AttributionCategory, string> = {
  option_time: 'Valore temporale opzioni',
  option_intrinsic: 'Intrinseco opzioni',
  stock: 'Azioni',
  etf: 'ETF',
  bond: 'Obbligazioni',
  gp: 'Gestione patrimoniale',
  commodity: 'Materie prime',
  cash: 'Liquidità / costi',
  unclassified: 'Non attribuito',
  reconciliation_gap: 'Residuo da verificare',
};

export interface AttributionTradeRow {
  basis_key: string;
  trade_date: string;
  side: string;
  quantity: number;
  price: number;
  kind?: string | null;
  asset_type?: string | null;
  underlying_key?: string | null;
  option_type?: 'call' | 'put' | null;
  strike?: number | null;
  expiry_date?: string | null;
  currency?: string | null;
  exchange_rate?: number | null;
  gross_eur?: number | null;
  commission_eur?: number | null;
  underlying_price?: number | null;
  intrinsic_per_share?: number | null;
  time_value_per_share?: number | null;
  attribution_price_source?: AttributionPriceSource | null;
}

export interface InternalTransferRow {
  debit_date: string;
  credit_date: string;
  amount_eur: number;
  from_gp: boolean;
  to_gp: boolean;
}

export interface AttributionItem {
  category: AttributionCategory;
  label: string;
  startValue: number;
  endValue: number;
  netFlows: number;
  amount: number;
  percent: number | null;
  status: 'calculated' | 'partial' | 'unavailable' | 'no_activity';
  reason: string;
}

export interface AttributionCoverage {
  optionMarks: number;
  optionMarksWithoutSpot: number;
  exactOptionTrades: number;
  proxyOptionTrades: number;
  missingOptionTrades: number;
  tradesInPeriod: number;
  internalTransfersInPeriod: number;
  startDetailGap: number;
  endDetailGap: number;
  uncoveredPositionChanges: AttributionCategory[];
}

export interface PerformanceAttributionResult {
  startDate: string;
  endDate: string;
  totalPL: number;
  totalPercent: number | null;
  averageBalance: number;
  startTotal: number;
  endTotal: number;
  externalFlows: number;
  items: AttributionItem[];
  coverage: AttributionCoverage;
  warnings: string[];
}

type Values = Record<AttributionCategory, number>;

const emptyValues = (): Values => Object.fromEntries(
  ATTRIBUTION_CATEGORIES.map(category => [category, 0]),
) as Values;

function historicalValue(entry: HistoricalDataEntry): number {
  return Number(entry.netting_total || 0);
}

function positionValue(position: Position): number {
  return Number(position.snapshot_market_value ?? position.market_value ?? 0);
}

function canonicalPositionKey(position: Position): string {
  return getCanonicalTickerKey({
    rawTicker: position.ticker,
    underlyingName: position.underlying,
    description: position.description,
    isin: position.isin,
  });
}

function snapshotCategoryQuantities(snapshot: FullSnapshot): Map<AttributionCategory, Map<string, number>> {
  const result = new Map<AttributionCategory, Map<string, number>>();
  const add = (category: AttributionCategory, key: string, quantity: number) => {
    const values = result.get(category) ?? new Map<string, number>();
    values.set(key, (values.get(key) ?? 0) + quantity);
    result.set(category, values);
  };

  for (const position of snapshot.positions) {
    const canonical = canonicalPositionKey(position) || position.isin || position.description;
    const optionSuffix = position.asset_type === 'derivative'
      ? `:${position.option_type ?? '?'}:${position.strike_price ?? '?'}:${position.expiry_date ?? '?'}`
      : '';
    const key = `${canonical}${optionSuffix}`;
    if (position.asset_type === 'derivative') {
      add('option_time', key, Number(position.quantity || 0));
      add('option_intrinsic', key, Number(position.quantity || 0));
      continue;
    }
    const category = position.asset_type as AttributionCategory;
    add(category in emptyValues() ? category : 'unclassified', key, Number(position.quantity || 0));
  }
  return result;
}

function mapsDiffer(left: Map<string, number>, right: Map<string, number>): boolean {
  const keys = new Set([...left.keys(), ...right.keys()]);
  return [...keys].some(key => Math.abs((left.get(key) ?? 0) - (right.get(key) ?? 0)) > 1e-8);
}

function resolveSnapshotSpot(
  option: Position,
  snapshot: FullSnapshot,
  frozen: Record<string, number>,
): number | null {
  const directCandidates = [option.underlying, option.ticker, canonicalPositionKey(option)]
    .filter((value): value is string => !!value);
  for (const candidate of directCandidates) {
    const price = Number(frozen[candidate]);
    if (price > 0) return price;
  }

  const optionKey = canonicalPositionKey(option);
  const linked = snapshot.positions.find(position =>
    (position.asset_type === 'stock' || position.asset_type === 'etf')
    && canonicalPositionKey(position) === optionKey,
  );
  const linkedPrice = Number(linked?.snapshot_price ?? linked?.current_price ?? 0);
  if (linkedPrice > 0) return linkedPrice;

  for (const [key, rawPrice] of Object.entries(frozen)) {
    const canonical = getCanonicalTickerKey({ rawTicker: key, underlyingName: key, description: key });
    if (canonical === optionKey && Number(rawPrice) > 0) return Number(rawPrice);
  }
  return null;
}

export function buildSnapshotAttributionValues(
  snapshot: FullSnapshot,
  historical: HistoricalDataEntry,
): { values: Values; optionMarks: number; optionMarksWithoutSpot: number } {
  const values = emptyValues();
  let optionMarks = 0;
  let optionMarksWithoutSpot = 0;
  const frozen = (historical.snapshot_underlying_prices ?? {}) as Record<string, number>;

  for (const position of snapshot.positions) {
    if (position.asset_type !== 'derivative') {
      const category = position.asset_type as AttributionCategory;
      if (category in values) values[category] += positionValue(position);
      else values.unclassified += positionValue(position);
      continue;
    }

    optionMarks += 1;
    const premium = Number(position.snapshot_price ?? position.current_price ?? 0);
    const quantity = Number(position.quantity || 0);
    const exchangeRate = Number(position.exchange_rate || 1) > 0
      ? Number(position.exchange_rate)
      : 1;
    const signedMarketValue = premium * quantity * 100 / exchangeRate;
    const spot = resolveSnapshotSpot(position, snapshot, frozen);
    if (!spot || !position.option_type || position.strike_price == null) {
      optionMarksWithoutSpot += 1;
      values.unclassified += signedMarketValue;
      continue;
    }
    const split = splitOptionPremium(
      position.option_type,
      Number(position.strike_price),
      premium,
      spot,
    );
    values.option_intrinsic += split.intrinsicPerShare * quantity * 100 / exchangeRate;
    values.option_time += split.timeValuePerShare * quantity * 100 / exchangeRate;
  }

  const alignedGp = snapshot.gp_holdings.filter(holding =>
    !holding.price_date || holding.price_date <= snapshot.snapshot_date,
  );
  values.gp += alignedGp.reduce((sum, holding) => sum + Number(holding.market_value || 0), 0);
  values.cash += Number(snapshot.cash_value || 0);

  return { values, optionMarks, optionMarksWithoutSpot };
}

function parseOptionBasisKey(basisKey: string): {
  underlyingKey: string;
  optionType: 'call' | 'put';
  strike: number;
} | null {
  if (!basisKey.startsWith('OPT:')) return null;
  const parts = basisKey.split(':');
  // Formato corrente: OPT:<underlying>:<C|P>:<strike>:<expiry>.
  // L'underlying può contenere ':'; per questo si legge dalla coda.
  if (parts.length < 5) return null;
  const typeIndex = parts.length - 3;
  const type = parts[typeIndex];
  const strike = Number(parts[typeIndex + 1]);
  if ((type !== 'C' && type !== 'P') || !Number.isFinite(strike)) return null;
  return {
    underlyingKey: parts.slice(1, typeIndex).join(':'),
    optionType: type === 'C' ? 'call' : 'put',
    strike,
  };
}

function proxySpot(
  underlyingKey: string,
  tradeDate: string,
  historicalData: HistoricalDataEntry[],
): number | null {
  // Non usare un prezzo futuro per stimare l'intrinseco alla data trade:
  // sarebbe look-ahead bias. Si prende prima l'ultimo snapshot disponibile
  // alla data dell'operazione; solo se non esiste alcun dato precedente si
  // ricorre al primo successivo e la copertura resta segnalata come proxy.
  const prior = historicalData
    .filter(entry => entry.snapshot_date <= tradeDate)
    .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));
  const subsequent = historicalData
    .filter(entry => entry.snapshot_date > tradeDate)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  for (const entry of [...prior, ...subsequent]) {
    const frozen = (entry.snapshot_underlying_prices ?? {}) as Record<string, number>;
    const direct = Number(frozen[underlyingKey]);
    if (direct > 0) return direct;
    for (const [key, rawPrice] of Object.entries(frozen)) {
      if (getCanonicalTickerKey({ rawTicker: key, underlyingName: key, description: key }) === underlyingKey
        && Number(rawPrice) > 0) return Number(rawPrice);
    }
  }
  return null;
}

function categoryForTrade(
  trade: AttributionTradeRow,
  basisCategory: Map<string, AttributionCategory>,
): AttributionCategory {
  const declared = trade.asset_type;
  if (declared && Object.prototype.hasOwnProperty.call(emptyValues(), declared)) {
    return declared as AttributionCategory;
  }
  return basisCategory.get(trade.basis_key) ?? 'unclassified';
}

export function calculatePerformanceAttribution(input: {
  startSnapshot: FullSnapshot;
  endSnapshot: FullSnapshot;
  startHistorical: HistoricalDataEntry;
  endHistorical: HistoricalDataEntry;
  allHistoricalData: HistoricalDataEntry[];
  deposits: DepositEntry[];
  trades: AttributionTradeRow[];
  internalTransfers: InternalTransferRow[];
}): PerformanceAttributionResult {
  const {
    startSnapshot,
    endSnapshot,
    startHistorical,
    endHistorical,
    allHistoricalData,
    deposits,
    trades,
    internalTransfers,
  } = input;
  const startDate = startSnapshot.snapshot_date;
  const endDate = endSnapshot.snapshot_date;
  const start = buildSnapshotAttributionValues(startSnapshot, startHistorical);
  const end = buildSnapshotAttributionValues(endSnapshot, endHistorical);
  const flows = emptyValues();
  const coverage: AttributionCoverage = {
    optionMarks: start.optionMarks + end.optionMarks,
    optionMarksWithoutSpot: start.optionMarksWithoutSpot + end.optionMarksWithoutSpot,
    exactOptionTrades: 0,
    proxyOptionTrades: 0,
    missingOptionTrades: 0,
    tradesInPeriod: 0,
    internalTransfersInPeriod: 0,
    startDetailGap: 0,
    endDetailGap: 0,
    uncoveredPositionChanges: [],
  };
  const tradeCategories = new Set<AttributionCategory>();

  const positionsForBasis = [...startSnapshot.positions, ...endSnapshot.positions];
  const basisCategory = new Map<string, AttributionCategory>();
  const positionByBasis = new Map<string, Position>();
  for (const position of positionsForBasis) {
    if (position.asset_type === 'derivative') continue;
    const category = position.asset_type as AttributionCategory;
    const resolvedCategory = category in emptyValues() ? category : 'unclassified';
    const canonical = canonicalPositionKey(position);
    if (canonical) {
      basisCategory.set(canonical, resolvedCategory);
      positionByBasis.set(canonical, position);
    }
    if (position.isin) {
      basisCategory.set(position.isin.toUpperCase(), resolvedCategory);
      positionByBasis.set(position.isin.toUpperCase(), position);
    }
  }

  for (const trade of trades) {
    if (!(trade.trade_date > startDate && trade.trade_date <= endDate)) continue;
    coverage.tradesInPeriod += 1;
    if (trade.side === 'ASG') {
      // L'assegnazione di una PUT è un trasferimento, non rendimento:
      // la quota fair passa alle azioni e l'intrinseco estingue la passività.
      const assignedPosition = positionByBasis.get(trade.basis_key);
      const category = categoryForTrade(trade, basisCategory);
      tradeCategories.add(category);
      tradeCategories.add('option_intrinsic');
      const quantity = Math.abs(Number(trade.quantity || 0)); // azioni, non contratti
      const strike = Math.abs(Number(trade.strike ?? trade.price ?? 0));
      const exchangeRate = Number(trade.exchange_rate || assignedPosition?.exchange_rate || 1) > 0
        ? Number(trade.exchange_rate || assignedPosition?.exchange_rate || 1)
        : 1;
      const underlyingKey = trade.underlying_key
        ?? (assignedPosition ? canonicalPositionKey(assignedPosition) : trade.basis_key);
      const positionSpot = Number(assignedPosition?.snapshot_price ?? assignedPosition?.current_price ?? 0);
      const spot = Number(trade.underlying_price || 0) > 0
        ? Number(trade.underlying_price)
        : proxySpot(underlyingKey, trade.trade_date, allHistoricalData) ?? positionSpot;
      if (spot > 0 && strike > 0) {
        const intrinsic = Math.max(0, strike - spot);
        const fairValue = Math.max(0, strike - intrinsic);
        flows[category] += fairValue * quantity / exchangeRate;
        flows.option_intrinsic += intrinsic * quantity / exchangeRate;
      } else {
        // Senza spot si conserva la riconciliazione, ma non si inventa la
        // separazione fair/intrinseco: il trasferimento resta non attribuito.
        flows.unclassified += strike * quantity / exchangeRate;
        coverage.missingOptionTrades += 1;
      }
      continue;
    }
    const direction = trade.side === 'ACQ' ? 1 : trade.side === 'VEN' ? -1 : 0;
    if (!direction) continue;
    const quantity = Math.abs(Number(trade.quantity || 0));
    const price = Math.abs(Number(trade.price || 0));
    const exchangeRate = Number(trade.exchange_rate || 1) > 0 ? Number(trade.exchange_rate) : 1;
    const parsedOption = parseOptionBasisKey(trade.basis_key);

    if (parsedOption) {
      tradeCategories.add('option_time');
      tradeCategories.add('option_intrinsic');
      const optionType = trade.option_type ?? parsedOption.optionType;
      const strike = Number(trade.strike ?? parsedOption.strike);
      const underlyingKey = trade.underlying_key ?? parsedOption.underlyingKey;
      let intrinsic = Number(trade.intrinsic_per_share);
      let time = Number(trade.time_value_per_share);
      const persistedSplitValid = Number.isFinite(intrinsic) && intrinsic >= 0
        && Number.isFinite(time) && time >= 0
        && Math.abs(intrinsic + time - price) < 0.01;
      if (persistedSplitValid) {
        const source = trade.attribution_price_source;
        if (source === 'exact_trade_date' || source === 'previous_close') coverage.exactOptionTrades += 1;
        else coverage.proxyOptionTrades += 1;
      } else {
        const spot = Number(trade.underlying_price || 0) > 0
          ? Number(trade.underlying_price)
          : proxySpot(underlyingKey, trade.trade_date, allHistoricalData);
        if (spot > 0) {
          const split = splitOptionPremium(optionType, strike, price, spot);
          intrinsic = split.intrinsicPerShare;
          time = split.timeValuePerShare;
          coverage.proxyOptionTrades += 1;
        } else {
          coverage.missingOptionTrades += 1;
          flows.unclassified += direction * price * quantity * 100 / exchangeRate;
          continue;
        }
      }
      flows.option_intrinsic += direction * intrinsic * quantity * 100 / exchangeRate;
      flows.option_time += direction * time * quantity * 100 / exchangeRate;
      continue;
    }

    const category = categoryForTrade(trade, basisCategory);
    tradeCategories.add(category);
    const gross = Number(trade.gross_eur || 0) > 0
      ? Math.abs(Number(trade.gross_eur))
      : price * quantity / exchangeRate;
    flows[category] += direction * gross;
  }

  for (const transfer of internalTransfers) {
    // La GP varia quando riceve il credito (cash→GP) o quando subisce
    // l'addebito (GP→cash); le due date possono differire per valuta.
    const effectiveDate = transfer.to_gp ? transfer.credit_date : transfer.debit_date;
    if (!(effectiveDate > startDate && effectiveDate <= endDate)) continue;
    coverage.internalTransfersInPeriod += 1;
    const amount = Math.abs(Number(transfer.amount_eur || 0));
    if (transfer.to_gp) flows.gp += amount;
    if (transfer.from_gp) flows.gp -= amount;
  }

  const depositsInPeriod = deposits
    .filter(deposit => deposit.deposit_date > startDate && deposit.deposit_date <= endDate)
    .reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
  const internalFlowsOutsideCash = ATTRIBUTION_CATEGORIES
    .filter(category => category !== 'cash')
    .reduce((sum, category) => sum + flows[category], 0);
  flows.cash = depositsInPeriod - internalFlowsOutsideCash;

  const startValue = historicalValue(startHistorical);
  const endValue = historicalValue(endHistorical);
  const totalPL = endValue - startValue - depositsInPeriod;
  const averageBalance = calculateTimeWeightedAverage(
    new Date(`${startDate}T12:00:00`),
    new Date(`${endDate}T12:00:00`),
    startValue,
    deposits,
  ).average;

  const amounts = emptyValues();
  for (const category of ATTRIBUTION_CATEGORIES) {
    amounts[category] = end.values[category] - start.values[category] - flows[category];
  }
  const attributedTotal = ATTRIBUTION_CATEGORIES
    .filter(category => category !== 'reconciliation_gap')
    .reduce((sum, category) => sum + amounts[category], 0);
  amounts.reconciliation_gap = totalPL - attributedTotal;

  const detailCategories = ATTRIBUTION_CATEGORIES.filter(category => category !== 'reconciliation_gap');
  const startDetailTotal = detailCategories.reduce((sum, category) => sum + start.values[category], 0);
  const endDetailTotal = detailCategories.reduce((sum, category) => sum + end.values[category], 0);
  coverage.startDetailGap = startValue - startDetailTotal;
  coverage.endDetailGap = endValue - endDetailTotal;

  const startQuantities = snapshotCategoryQuantities(startSnapshot);
  const endQuantities = snapshotCategoryQuantities(endSnapshot);
  const positionCategories: AttributionCategory[] = [
    'option_time', 'option_intrinsic', 'stock', 'etf', 'bond', 'commodity', 'unclassified',
  ];
  coverage.uncoveredPositionChanges = positionCategories.filter(category =>
    mapsDiffer(startQuantities.get(category) ?? new Map(), endQuantities.get(category) ?? new Map())
      && !tradeCategories.has(category),
  );

  const gapReasons = (): string[] => {
    const reasons: string[] = [];
    if (Math.abs(coverage.startDetailGap) >= 1) {
      reasons.push(`a T0 il dettaglio differisce dal Netting di ${coverage.startDetailGap.toFixed(0)} €`);
    }
    if (Math.abs(coverage.endDetailGap) >= 1) {
      reasons.push(`a T1 il dettaglio differisce dal Netting di ${coverage.endDetailGap.toFixed(0)} €`);
    }
    if (coverage.uncoveredPositionChanges.length > 0) {
      reasons.push(`variazioni di quantità senza movimenti registrati: ${coverage.uncoveredPositionChanges.map(category => ATTRIBUTION_LABELS[category]).join(', ')}`);
    }
    if (coverage.optionMarksWithoutSpot > 0) {
      reasons.push(`${coverage.optionMarksWithoutSpot} valorizzazioni opzione senza sottostante`);
    }
    if (coverage.missingOptionTrades > 0) {
      reasons.push(`${coverage.missingOptionTrades} movimenti opzione non scomponibili`);
    }
    return reasons;
  };

  const itemStatus = (category: AttributionCategory): Pick<AttributionItem, 'status' | 'reason'> => {
    const activity = Math.abs(start.values[category]) >= 0.01
      || Math.abs(end.values[category]) >= 0.01
      || Math.abs(flows[category]) >= 0.01
      || Math.abs(amounts[category]) >= 0.01;
    if (category === 'reconciliation_gap') {
      const reasons = gapReasons();
      if (Math.abs(amounts[category]) < 0.01) {
        if (reasons.length > 0) {
          return {
            status: 'partial',
            reason: `Quadratura aritmetica completa, ma la copertura dei dati è parziale: ${reasons.join('; ')}.`,
          };
        }
        return { status: 'calculated', reason: 'Quadratura completa: la somma delle classi coincide con il P/L del Netting.' };
      }
      return {
        status: 'unavailable',
        reason: reasons.length > 0
          ? `Non attribuibile: ${reasons.join('; ')}.`
          : 'Non attribuibile: mancano dettagli o movimenti sufficienti per assegnare la differenza a una classe.',
      };
    }
    if (category === 'option_time' || category === 'option_intrinsic') {
      const issues: string[] = [];
      if (coverage.optionMarksWithoutSpot > 0) issues.push(`${coverage.optionMarksWithoutSpot} mark senza prezzo del sottostante`);
      if (coverage.proxyOptionTrades > 0) issues.push(`${coverage.proxyOptionTrades} movimenti valorizzati con prezzo proxy`);
      if (coverage.missingOptionTrades > 0) issues.push(`${coverage.missingOptionTrades} movimenti senza split intrinseco/tempo`);
      if (coverage.uncoveredPositionChanges.includes(category)) issues.push('quantità variate senza movimento registrato');
      if (issues.length > 0) {
        const nothingCouldBeSplit = !activity
          && coverage.optionMarks > 0
          && coverage.optionMarksWithoutSpot === coverage.optionMarks;
        return {
          status: nothingCouldBeSplit ? 'unavailable' : 'partial',
          reason: `${nothingCouldBeSplit ? 'Calcolo non possibile' : 'Calcolo parziale'}: ${issues.join('; ')}.`,
        };
      }
    }
    if (!activity) {
      return { status: 'no_activity', reason: 'Nessuna posizione o movimento per questa classe nel periodo.' };
    }
    if (category === 'unclassified') {
      return { status: 'partial', reason: 'Valori presenti, ma lo strumento o il movimento non è classificabile con i dati disponibili.' };
    }
    if (coverage.uncoveredPositionChanges.includes(category)) {
      return { status: 'partial', reason: 'Calcolo parziale: le quantità sono cambiate tra T0 e T1, ma non risultano movimenti della classe nel ledger.' };
    }
    if (category === 'gp' && coverage.internalTransfersInPeriod === 0 && Math.abs(end.values.gp - start.values.gp) >= 0.01) {
      return { status: 'partial', reason: 'Calcolato assumendo assenza di giroconti GP: nel periodo non risultano trasferimenti interni registrati.' };
    }
    if (averageBalance <= 0) {
      return { status: 'partial', reason: 'Contributo in euro calcolato; percentuale non disponibile perché il patrimonio medio non è positivo.' };
    }
    return { status: 'calculated', reason: 'Calcolato come T1 − T0 − movimenti netti della classe.' };
  };

  const items = ATTRIBUTION_CATEGORIES.map(category => {
    const status = itemStatus(category);
    return {
      category,
      label: ATTRIBUTION_LABELS[category],
      startValue: start.values[category],
      endValue: end.values[category],
      netFlows: flows[category],
      amount: amounts[category],
      percent: averageBalance > 0 ? amounts[category] / averageBalance * 100 : null,
      ...status,
    };
  });

  const warnings: string[] = [];
  if (coverage.optionMarksWithoutSpot > 0) {
    warnings.push(`${coverage.optionMarksWithoutSpot} valorizzazioni opzione senza prezzo sottostante`);
  }
  if (coverage.proxyOptionTrades > 0) {
    warnings.push(`${coverage.proxyOptionTrades} movimenti opzione stimati da uno snapshot, non dal prezzo storico della data trade`);
  }
  if (coverage.missingOptionTrades > 0) {
    warnings.push(`${coverage.missingOptionTrades} movimenti opzione non scomponibili`);
  }
  if (Math.abs(amounts.unclassified) >= 1) {
    warnings.push(`${amounts.unclassified.toFixed(0)} € attribuiti a strumenti non classificati`);
  }
  if (Math.abs(amounts.reconciliation_gap) >= 1) {
    warnings.push(`${amounts.reconciliation_gap.toFixed(0)} € di residuo: Netting, snapshot e movimenti non riconciliano ancora`);
  }
  if (Math.abs(coverage.startDetailGap) >= 1 || Math.abs(coverage.endDetailGap) >= 1) {
    warnings.push('Il dettaglio per classe non coincide con il Netting in almeno uno dei due estremi del periodo');
  }
  if (coverage.uncoveredPositionChanges.length > 0) {
    warnings.push(`Quantità variate senza movimenti registrati: ${coverage.uncoveredPositionChanges.map(category => ATTRIBUTION_LABELS[category]).join(', ')}`);
  }
  if (averageBalance <= 0) {
    warnings.push('Percentuali non calcolabili: il patrimonio medio del periodo non è positivo');
  }

  return {
    startDate,
    endDate,
    totalPL,
    totalPercent: averageBalance > 0 ? totalPL / averageBalance * 100 : null,
    averageBalance,
    startTotal: startValue,
    endTotal: endValue,
    externalFlows: depositsInPeriod,
    items,
    coverage,
    warnings,
  };
}
