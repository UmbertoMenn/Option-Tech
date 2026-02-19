
## Briefing server-side basato su strategy_cache

### Obiettivo
Riscrivere `supabase/functions/daily-briefing/index.ts` in modo che calcoli le sezioni di monitoraggio direttamente dal database, senza dipendere da `monitoring_snapshot` (che richiede l'app aperta).

### File modificato
**`supabase/functions/daily-briefing/index.ts`**

### Logica: nuova funzione `computeSectionsFromCache()`

Per ogni portfolio, legge 3 tabelle:
- `strategy_cache` -- strategie gia categorizzate dal frontend (include override)
- `underlying_prices` -- prezzi aggiornati ogni 5 min dal cron
- `positions` -- per quantita stock (uncovered calls) e current_price/avg_cost (LEAP)

Replica esattamente le 8 sezioni di `DerivativesSummaryCard.tsx`:

**1. Call non coperte** (righe 127-219 del frontend)
- Per ogni underlying in strategy_cache, somma call vendute e comprate da tutte le strategie
- Per le stock da `positions`, calcola `floor(shares/100)`
- Se `net_sold_calls > covered_contracts` --> uncovered

**2. Covered Call ITM** (righe 222-239)
- `strategy_cache` dove `strategy_type = 'Covered Call'`
- Se `underlying_price > sold_call_strike` --> ITM

**3. Double Diagonal OOR** (righe 242-285)
- `strategy_cache` dove `strategy_type IN ('Double Diagonal', 'Alternative Double Diagonal')`
- Se `price < sold_put_strike OR price > sold_call_strike` --> OOR

**4. Iron Condor OOR** (righe 288-307)
- `strategy_cache` dove `strategy_type = 'Iron Condor'`
- Se `price < sold_put_strike OR price > sold_call_strike` --> OOR

**5. Naked Put ITM** (righe 310-328)
- `strategy_cache` dove `strategy_type = 'Naked Put'`
- Se `price < sold_put_strike` --> ITM

**6. LEAP Call in Gain** (righe 331-348)
- `strategy_cache` dove `strategy_type = 'LEAP Call'`
- Legge la posizione da `positions` tramite `position_ids[0]`
- Se `current_price > avg_cost` --> in Gain

**7. Call da rivendere** (righe 351-377)
- Per ogni stock, calcola `floor(quantity/100)`
- Sottrae le Covered Call gia vendute su quel sottostante
- Se `available >= 1` --> da rivendere

**8. Altre Strategie OOR/OOB** (righe 380-435)
- Filtra strategy_cache per tutti i tipi non gia coperti sopra, escludendo 'Alternative Double Diagonal'
- Per Short Strangle: OOR se prezzo fuori da sold_put..sold_call
- Per Put Spread / Diagonal Put Spread: OOR se prezzo < sold_put_strike
- Per Call Spread / Diagonal Call Spread: OOR se prezzo > sold_call_strike
- Per altri tipi (es. "Altre Strategie"): OOB se somma market_value delle posizioni < 0

### Fallback
1. Prima controlla `monitoring_snapshot` (come oggi): se ha dati < 48h, li usa
2. Se `monitoring_snapshot` e vuoto/vecchio, usa `computeSectionsFromCache()`
3. Se anche `strategy_cache` e vuoto, salta il portfolio con log

### Formato output sezioni
Identico a quello salvato dal frontend:

```text
{
  title: "Covered Call",
  emoji: "amber",
  badge: "ITM",
  items: ["AAPL $180 x2", "MSFT $420 x1"]
}
```

### Matching underlying -> ticker per le sezioni
Usa il campo `ticker` gia presente in `strategy_cache` (popolato dal frontend con la stessa logica di `resolveTicker`). Per le stock positions, usa `positions.ticker`.

### Matching uncovered calls
Il frontend usa `getCanonicalKey` / `normalizeForMatching` per matchare stock con opzioni. Server-side, il match avviene tramite il campo `ticker` in `strategy_cache` confrontato con `positions.ticker`, che e gia normalizzato.

### Cosa NON cambia
- Formattazione messaggi Telegram/Email
- Guard DST 11:00 italiane
- Logica admin/notifiche
- Parametro `force: true` per test
- Il frontend continua a salvare in `monitoring_snapshot` e `strategy_cache`
