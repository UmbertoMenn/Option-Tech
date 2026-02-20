

## Simulatore / Backtester di Strategie in Opzioni con Massive.com

### Panoramica
Nuova pagina `/simulator` (solo admin) che scarica automaticamente prezzi storici del sottostante e delle opzioni da Massive.com, calcola la volatilita implicita (incluso smile/skew) e il tasso risk-free, permette di costruire strategie multi-gamba con regole di aggiustamento automatico, e visualizza i risultati con grafici interattivi.

---

### 1. Prerequisiti

**API Key**: salvare la Massive.com API key come secret `MASSIVE_API_KEY` nelle Edge Functions.

**Edge Function proxy**: una singola edge function `massive-proxy` che funge da proxy per tutte le chiamate API a massive.com, evitando di esporre la API key al frontend.

---

### 2. Struttura File

**Nuovi file:**

| File | Scopo |
|------|-------|
| `supabase/functions/massive-proxy/index.ts` | Proxy per le API di massive.com (stock bars, option contracts, option bars, snapshots) |
| `src/lib/blackScholes.ts` | Black-Scholes pricing, Greeks, inverse BS (Newton-Raphson per calcolo IV) |
| `src/lib/backtestEngine.ts` | Motore di backtest day-by-day con supporto aggiustamenti automatici |
| `src/lib/adjustmentRules.ts` | Regole di aggiustamento preset e custom per le strategie |
| `src/lib/ivSurface.ts` | Costruzione della superficie di volatilita (smile/skew per strike e scadenza) |
| `src/lib/massiveApi.ts` | Client-side API wrapper per chiamare la edge function massive-proxy |
| `src/pages/Simulator.tsx` | Pagina principale del simulatore |
| `src/components/simulator/TickerSelector.tsx` | Selezione ticker + date range, pulsante fetch dati |
| `src/components/simulator/StrategyBuilder.tsx` | Builder strategia con preset e gambe custom |
| `src/components/simulator/AdjustmentRuleEditor.tsx` | Editor regole di aggiustamento (preset + custom) |
| `src/components/simulator/IVSurfaceChart.tsx` | Visualizzazione superficie IV (smile/skew) |
| `src/components/simulator/BacktestChart.tsx` | Grafico evoluzione P/L nel tempo |
| `src/components/simulator/BacktestResults.tsx` | Stats riassuntive e log degli aggiustamenti |
| `src/components/simulator/GreeksChart.tsx` | Evoluzione Greeks nel tempo |

**File modificati:**

| File | Modifica |
|------|----------|
| `src/App.tsx` | Aggiunta route `/simulator` (lazy, solo admin) |
| `supabase/config.toml` | Aggiunta `[functions.massive-proxy]` con `verify_jwt = false` |

---

### 3. Edge Function: `massive-proxy`

Proxy autenticato per le API Massive.com. Supporta 4 operazioni:

| Operazione | Endpoint Massive.com | Scopo |
|---|---|---|
| `stock-bars` | `GET /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}` | Prezzi storici giornalieri del sottostante |
| `option-contracts` | `GET /v3/reference/options/contracts?underlying_ticker={ticker}&expiration_date={date}` | Lista contratti opzioni per scadenza |
| `option-bars` | `GET /v2/aggs/ticker/{optionsTicker}/range/1/day/{from}/{to}` | Prezzi storici EOD delle singole opzioni |
| `option-chain` | `GET /v3/snapshot/options/{ticker}?expiration_date={date}` | Snapshot catena opzioni (IV, Greeks, prezzi) |

L'edge function:
- Verifica che il chiamante sia admin (via `getClaims` + check `user_roles`)
- Legge `MASSIVE_API_KEY` da `Deno.env`
- Supporta paginazione automatica (segue `next_url`)
- Gestisce rate limiting con retry

---

### 4. Black-Scholes Engine (`src/lib/blackScholes.ts`)

Funzioni:

- `cdf(x)`: distribuzione normale cumulativa (Abramowitz-Stegun)
- `pdf(x)`: densita di probabilita normale
- `bsPrice(S, K, T, r, sigma, type)`: prezzo teorico call/put
- `bsDelta`, `bsGamma`, `bsTheta`, `bsVega`: Greeks
- `impliedVolatility(marketPrice, S, K, T, r, type)`: **calcolo IV inverso** con Newton-Raphson (max 100 iterazioni, tolleranza 1e-6). Partenza da sigma=0.3, con fallback bisection se Newton diverge

---

### 5. Superficie di Volatilita (`src/lib/ivSurface.ts`)

Costruisce la IV surface da dati reali di mercato:

```text
Interface IVPoint {
  strike: number
  expiry: string      // YYYY-MM-DD
  iv: number          // implied volatility calcolata
  optionType: 'call' | 'put'
}

Interface IVSurface {
  points: IVPoint[]
  getIV(strike: number, expiry: string, type: 'call' | 'put'): number
}
```

- Per ogni scadenza mensile nel periodo: scarica tutti i contratti + prezzi EOD
- Per ogni contratto: calcola la IV inversa dal prezzo EOD usando `impliedVolatility()`
- Filtra contratti illiquidi (volume < 10 o spread > 50% del mid)
- Costruisce griglia strike x scadenza
- Interpolazione bilineare per strike/scadenze intermedie
- Gestisce lo **smile/skew**: la IV varia per strike (put OTM hanno IV piu alta)

**Tasso Risk-Free**: derivato dalla put-call parity sui contratti ATM. Formula: `r = (1/T) * ln((C - P + K * e^(-rT)) / S)`. Se non calcolabile, default 4.5%.

---

### 6. Motore di Backtest (`src/lib/backtestEngine.ts`)

```text
Interface BacktestLeg {
  type: 'call' | 'put' | 'stock'
  strike: number
  quantity: number        // + long, - short
  entryDate: string
  expiryDate: string      // terzo venerdi del mese (calcolato con thirdFriday())
  entryPrice: number      // prezzo BS calcolato all'entry
}

Interface AdjustmentLog {
  date: string
  description: string
  legsRemoved: BacktestLeg[]
  legsAdded: BacktestLeg[]
  cost: number            // costo netto dell'aggiustamento
}

Interface BacktestConfig {
  legs: BacktestLeg[]
  priceData: { date: string; close: number }[]
  ivSurface: IVSurface
  riskFreeRate: number
  adjustmentRules: AdjustmentRule[]
}

Interface BacktestDayResult {
  date: string
  underlyingPrice: number
  totalValue: number
  totalPL: number
  adjustments: AdjustmentLog[]
  legs: { legIndex, price, value, delta, gamma, theta, vega, iv }[]
}
```

Logica giorno per giorno:
1. Legge prezzo sottostante
2. Per ogni gamba attiva: calcola T residuo, ottiene IV dalla superficie, calcola prezzo BS e Greeks
3. **Verifica regole di aggiustamento** (in ordine di priorita):
   - Se una condizione e soddisfatta, esegue l'azione corrispondente
   - Aggiorna le gambe attive
   - Logga l'aggiustamento
4. Calcola P/L cumulativo (somma valori gambe - somma costi apertura - costi aggiustamenti)
5. Alla scadenza: intrinsic value + esercizio/scadenza automatica

---

### 7. Regole di Aggiustamento (`src/lib/adjustmentRules.ts`)

```text
Interface AdjustmentRule {
  id: string
  name: string
  condition: AdjustmentCondition
  action: AdjustmentAction
  priority: number        // ordine di valutazione
  maxTriggers: number     // max volte che puo scattare (0 = illimitato)
  cooldownDays: number    // giorni di pausa dopo trigger
}

Interface AdjustmentCondition {
  type: 'price_near_barrier' | 'delta_threshold' | 'days_to_expiry' | 'pl_threshold' | 'custom'
  // Per price_near_barrier:
  legType?: 'sold_put' | 'sold_call' | 'bought_put' | 'bought_call'
  distancePct?: number    // es. 5% = scatta quando il prezzo e al 5% dallo strike
  direction?: 'approaching' | 'breached'
  // Per delta_threshold:
  deltaMin?: number
  deltaMax?: number
  // Per days_to_expiry:
  maxDays?: number
  // Per pl_threshold:
  plPct?: number          // es. -20% = stop loss
}

Interface AdjustmentAction {
  type: 'roll_strike' | 'roll_expiry' | 'close_leg' | 'add_leg' | 'close_all' | 'compound'
  // Per roll_strike:
  rollDistancePct?: number   // es. -10 = rolla lo strike del 10% piu lontano
  keepSameExpiry?: boolean
  // Per roll_expiry:
  rollMonths?: number        // es. 1 = rolla al mese successivo
  // Per add_leg:
  newLeg?: Partial<BacktestLeg>
  // Per compound:
  subActions?: AdjustmentAction[]  // azioni multiple (es. rolla put + aggiusta call)
}
```

**Preset per strategia:**

| Strategia | Regola | Condizione | Azione |
|---|---|---|---|
| Iron Condor | Difesa put | Prezzo vicino a sold put (-5%) | Rolla sold put strike -10%, aggiusta bought put |
| Iron Condor | Difesa call | Prezzo vicino a sold call (+5%) | Rolla sold call strike +10%, aggiusta bought call |
| Iron Condor | Roll scadenza | 5 DTE | Chiudi tutto, riapri con stessa struttura al mese dopo |
| Covered Call | Roll up/out | Prezzo sopra sold call | Rolla call a strike superiore, stessa o prossima scadenza |
| Cash-Secured Put | Roll down/out | Prezzo sotto sold put (-5%) | Rolla put a strike inferiore, prossima scadenza |
| Double Diagonal | Ricentra | Prezzo fuori dal range centrale | Chiudi gambe near-term, riapertura centrate sul nuovo prezzo |
| Tutte | Stop loss | P/L < -X% | Chiudi tutte le posizioni |
| Tutte | Take profit | P/L > +X% | Chiudi tutte le posizioni |

L'admin puo modificare i parametri (soglie, distanze) di ogni preset e aggiungere regole custom.

---

### 8. Componenti UI

#### TickerSelector
- Input ticker (es. "PLTR")
- Date picker per periodo backtest (start/end)
- Pulsante "Carica Dati" che chiama massive-proxy per:
  1. Scaricare prezzi sottostante
  2. Scaricare catena opzioni per ogni scadenza mensile nel periodo
  3. Calcolare superficie IV
  4. Calcolare tasso risk-free
- Progress bar durante il caricamento
- Anteprima: grafico prezzi + grafico superficie IV

#### StrategyBuilder
- L'admin seleziona la data di ingresso (entro il periodo caricato)
- Definisce la strategia per **distanza dal prezzo corrente**:
  - "Vendi put a -10% dal prezzo" -> calcola lo strike automaticamente
  - "Compra put a -15% dal prezzo" -> idem
  - "Vendi call a +10%" / "Compra call a +15%"
  - "Acquista 100 azioni sottostante"
- Preset rapidi: Iron Condor (-10%/-15%/+10%/+15%), Covered Call, ecc.
- Il sistema calcola automaticamente il prezzo di apertura delle opzioni usando BS + IV dalla superficie
- Scadenza: terzo venerdi del mese selezionato (dropdown mesi disponibili)
- Anteprima payoff a scadenza

#### AdjustmentRuleEditor
- Lista regole attive con drag & drop per riordinare priorita
- Per ogni regola: card con condizione (dropdown + parametri) e azione (dropdown + parametri)
- Preset caricabili per strategia (es. "Carica preset Iron Condor")
- Pulsante "Aggiungi regola custom"
- Preview testuale: "Se il prezzo scende al 5% dalla put venduta (strike 85), rolla la put a strike -10% (76.5)"

#### IVSurfaceChart
- Grafico a linee: una linea per scadenza, asse X = strike, asse Y = IV
- Mostra lo smile/skew reale calcolato dai dati di mercato
- Toggle per mostrare/nascondere singole scadenze
- Evidenzia gli strike della strategia corrente

#### BacktestChart
- Area chart P/L con verde/rosso sopra/sotto zero
- Overlay prezzo sottostante (asse Y secondario)
- **Marker verticali** sulle date degli aggiustamenti (linee tratteggiate con tooltip)
- Brush per zoom
- Tooltip: data, prezzo, P/L, dettaglio gambe attive

#### GreeksChart
- 4 linee: Delta, Gamma, Theta, Vega totali
- Toggle per mostrare/nascondere
- Marker aggiustamenti

#### BacktestResults
- Stats cards: P/L finale, Max Drawdown, numero aggiustamenti, costo aggiustamenti, Sharpe-like ratio
- **Log aggiustamenti**: tabella con data, descrizione, gambe chiuse, gambe aperte, costo netto
- Payoff a scadenza finale

---

### 9. Flusso Operativo

```text
1. Admin va su /simulator
2. Inserisce ticker (es. PLTR) e periodo (es. 2024-01-01 / 2024-12-31)
3. Clicca "Carica Dati" -> edge function scarica da massive.com
4. Sistema calcola superficie IV + risk-free rate
5. Admin seleziona strategia (es. Iron Condor) con distanze barriere
6. Sistema calcola prezzi opzioni con BS + IV reale
7. Admin configura regole aggiustamento (preset IC + eventuali custom)
8. Clicca "Esegui Backtest"
9. Motore itera giorno per giorno, applica regole, produce risultati
10. Grafici e stats si popolano
```

---

### 10. Route e Accesso

- Route `/simulator` in App.tsx, lazy loaded
- Accessibile solo admin (check `isAdmin` da `useAuth()`)
- Link nella navbar (Derivatives, Dashboard)

---

### 11. Calcolo Scadenze Mensili

Riusa `thirdFriday()` e `optionsExpirationDate()` gia presenti in `src/lib/optionStratUrl.ts`. Queste funzioni verranno esportate per essere riusate nel backtester.

---

### 12. Limitazioni v1

- Solo ticker US (massive.com copre solo il mercato US)
- Nessuna persistenza database (tutto in-memory)
- Un solo sottostante per simulazione
- Nessuna gestione dividendi (potrebbe essere aggiunta in v2)
- Max 2 anni di storico (piano gratuito massive.com)
- IV flat per tutte le gambe dello stesso tipo/strike/scadenza (no interpolazione temporale intra-giorno)

