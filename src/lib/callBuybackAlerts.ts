/**
 * Valutazione degli avvisi sulle "call da rivendere".
 *
 * Il G/P potenziale di una call riacquistata è (prezzo di mercato − prezzo di
 * riacquisto): si guadagna se il premio RISALE, perché la si rivende a più di
 * quanto è costato chiuderla. La soglia è espressa in % sul premio pagato.
 *
 * Due livelli, con avviso separato:
 *  - TRANCHE: il singolo lotto, col proprio prezzo di riacquisto;
 *  - CALL:    tutte le tranche aperte della stessa call (underlying+strike+
 *             scadenza), sulla media ponderata per quantità dei prezzi.
 *
 * Le due direzioni sono indipendenti (gain +X% e loss −Y%), entrambe espresse
 * come magnitudini positive.
 *
 * Funzioni pure: nessun accesso a rete o DB, così la stessa logica è testabile
 * e resta identica tra UI (anteprima) ed edge function (check-alerts).
 */

export interface BuybackTranche {
  id: string;
  underlying: string;
  strike: number;
  expiry_date: string;
  quantity: number;
  buyback_price: number;
  market_price: number | null;
}

export type CallBuybackAlertScope = 'tranche' | 'call';
export type CallBuybackAlertDirection = 'gain' | 'loss';
export type CallBuybackAlertMode = 'gain_pct' | 'price';
export type CallBuybackPriceDirection = 'above' | 'below';

export interface CallBuybackAlertConfig {
  id: string;
  portfolio_id: string;
  scope: CallBuybackAlertScope;
  buyback_id: string | null;
  underlying: string;
  strike: number;
  expiry_date: string;
  /** Assente sui record precedenti alla migration: equivale a gain_pct. */
  alert_mode?: CallBuybackAlertMode;
  gain_threshold_pct: number | null;
  loss_threshold_pct: number | null;
  price_direction?: CallBuybackPriceDirection | null;
  price_target?: number | null;
  enabled: boolean;
  cooldown_minutes: number;
}

/**
 * Prezzo di mercato NOTO?
 *
 * Una call scaduta vale zero per davvero (il premio è perso): il G/P è −100%
 * ed è un dato reale. Una call viva senza market_price è invece un dato
 * MANCANTE: valutarla come zero farebbe scattare qualunque soglia di perdita
 * solo perché il cron non è ancora passato.
 */
export function isMarketPriceKnown(t: BuybackTranche, todayISO: string): boolean {
  if (t.expiry_date < todayISO) return true;
  return t.market_price != null;
}

/** Prezzo di mercato effettivo: zero se scaduta, altrimenti quello rilevato. */
export function effectivePrice(t: BuybackTranche, todayISO: string): number {
  if (t.expiry_date < todayISO) return 0;
  return t.market_price ?? 0;
}

/** Chiave di aggregazione di una call: sottostante + strike + scadenza. */
export function callKey(t: { underlying: string; strike: number; expiry_date: string }): string {
  return `${t.underlying.toUpperCase()}|${t.strike}|${t.expiry_date}`;
}

export interface GainEvaluation {
  /** Premio di riferimento: prezzo della tranche, o media ponderata sulla call. */
  referencePrice: number;
  marketPrice: number;
  quantity: number;
  /** (mercato − riferimento) / riferimento × 100. */
  gainPct: number;
}

/**
 * Media ponderata per quantità dei prezzi di riacquisto.
 * Le quantità non positive sono ignorate (tranche già chiuse).
 */
export function weightedAverageBuybackPrice(tranches: BuybackTranche[]): number {
  let weighted = 0;
  let qty = 0;
  for (const t of tranches) {
    if (t.quantity <= 0) continue;
    weighted += t.buyback_price * t.quantity;
    qty += t.quantity;
  }
  return qty > 0 ? weighted / qty : 0;
}

/**
 * Valuta il G/P% di un insieme di tranche della STESSA call.
 * Restituisce null se il prezzo di mercato non è noto o il premio di
 * riferimento è nullo (divisione per zero: una call riacquistata a zero non ha
 * una percentuale sul premio pagato).
 */
export function evaluateGain(tranches: BuybackTranche[], todayISO: string): GainEvaluation | null {
  const open = tranches.filter(t => t.quantity > 0);
  if (open.length === 0) return null;
  if (!open.every(t => isMarketPriceKnown(t, todayISO))) return null;

  const referencePrice = weightedAverageBuybackPrice(open);
  if (referencePrice <= 0) return null;

  // Tutte le tranche della stessa call condividono il prezzo di mercato; si usa
  // la prima nota per robustezza rispetto a righe disallineate.
  const marketPrice = effectivePrice(open[0], todayISO);
  const quantity = open.reduce((s, t) => s + t.quantity, 0);
  const gainPct = ((marketPrice - referencePrice) / referencePrice) * 100;

  return { referencePrice, marketPrice, quantity, gainPct };
}

/**
 * Direzione scattata per una soglia, o null.
 * Gain e loss sono indipendenti: se entrambe fossero soddisfatte (impossibile
 * con soglie positive) vince il guadagno.
 */
export function triggeredDirection(
  gainPct: number,
  gainThresholdPct: number | null,
  lossThresholdPct: number | null,
): CallBuybackAlertDirection | null {
  if (gainThresholdPct != null && gainThresholdPct > 0 && gainPct >= gainThresholdPct) return 'gain';
  if (lossThresholdPct != null && lossThresholdPct > 0 && gainPct <= -lossThresholdPct) return 'loss';
  return null;
}

/** Valuta l'attraversamento della soglia sul prezzo del sottostante. */
export function isPriceThresholdTriggered(
  currentPrice: number,
  direction: CallBuybackPriceDirection,
  targetPrice: number,
): boolean {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return false;
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) return false;
  return direction === 'above'
    ? currentPrice >= targetPrice
    : currentPrice <= targetPrice;
}

export interface CallBuybackAlertEvaluation {
  config: CallBuybackAlertConfig;
  direction: CallBuybackAlertDirection;
  evaluation: GainEvaluation;
  /** Soglia effettivamente superata, col segno: +X per gain, −Y per loss. */
  thresholdValue: number;
}

/**
 * Raggruppa le tranche aperte per call.
 * Le righe a quantità zero sono già chiuse e non partecipano a nulla.
 */
export function groupTranchesByCall(tranches: BuybackTranche[]): Map<string, BuybackTranche[]> {
  const map = new Map<string, BuybackTranche[]>();
  for (const t of tranches) {
    if (t.quantity <= 0) continue;
    const key = callKey(t);
    const list = map.get(key);
    if (list) list.push(t);
    else map.set(key, [t]);
  }
  return map;
}

/**
 * Valuta tutte le config attive contro le tranche aperte del portafoglio e
 * restituisce solo quelle che hanno superato una soglia.
 *
 * Una config scope='tranche' il cui lotto non è più aperto viene semplicemente
 * ignorata (la riga verrà rimossa a cascata dal DB alla cancellazione).
 */
export function evaluateCallBuybackAlerts(
  configs: CallBuybackAlertConfig[],
  tranches: BuybackTranche[],
  todayISO: string,
): CallBuybackAlertEvaluation[] {
  const byId = new Map(tranches.filter(t => t.quantity > 0).map(t => [t.id, t]));
  const byCall = groupTranchesByCall(tranches);
  const out: CallBuybackAlertEvaluation[] = [];

  for (const config of configs) {
    if (!config.enabled) continue;
    // Le soglie prezzo usano il prezzo del sottostante e vengono valutate dal
    // motore alert; questa funzione pura resta dedicata al G/P del premio.
    if (config.alert_mode === 'price') continue;

    const subject: BuybackTranche[] = config.scope === 'tranche'
      ? (config.buyback_id && byId.has(config.buyback_id) ? [byId.get(config.buyback_id)!] : [])
      : (byCall.get(callKey(config)) ?? []);
    if (subject.length === 0) continue;

    const evaluation = evaluateGain(subject, todayISO);
    if (!evaluation) continue;

    const direction = triggeredDirection(
      evaluation.gainPct,
      config.gain_threshold_pct,
      config.loss_threshold_pct,
    );
    if (!direction) continue;

    out.push({
      config,
      direction,
      evaluation,
      thresholdValue: direction === 'gain'
        ? (config.gain_threshold_pct as number)
        : -(config.loss_threshold_pct as number),
    });
  }

  return out;
}

/** Testo dell'avviso, condiviso tra anteprima UI e messaggio generato dal cron. */
export function formatCallBuybackAlertMessage(ev: CallBuybackAlertEvaluation): string {
  const { config, direction, evaluation } = ev;
  const scopeLabel = config.scope === 'tranche'
    ? `tranche da ${evaluation.quantity}`
    : `${evaluation.quantity} contratti, media ponderata`;
  const verb = direction === 'gain' ? 'guadagna' : 'perde';
  const pct = Math.abs(evaluation.gainPct).toFixed(1);
  return `Call da rivendere ${config.underlying} C ${config.strike}: ${verb} il ${pct}% sul premio pagato `
    + `(riacquisto ${evaluation.referencePrice.toFixed(2)} → mercato ${evaluation.marketPrice.toFixed(2)}, ${scopeLabel})`;
}
