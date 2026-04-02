

## Fix: alert Covered Call anche per De-Risking Covered Call

### Problema

Le De-Risking Covered Call non vengono mai salvate nella `strategy_cache` (file `strategyCache.ts`), quindi la Edge Function `check-alerts` non le vede mai. Servono due modifiche:

### Correzioni

#### 1. `src/lib/strategyCache.ts` — salvare le De-Risking CC nel cache

Dopo la sezione "1. Covered Calls" (riga 87), aggiungere una sezione per `categories.deRiskingCoveredCalls`. Per ogni De-Risking CC:
- `strategy_type`: `'De-Risking Covered Call'`
- `strategy_key`: `dcc_${underlying}_${strike}_${expiryKey}`
- `sold_call_strike`: dallo strike della call venduta (`dcc.coveredCall.option.strike_price`)
- `sold_call_expiry`: dalla scadenza della call venduta
- `position_ids`: includere l'option ID della call venduta, la protection put, e l'eventuale synthetic put
- Gli altri campi (`sold_put_strike`, `bought_put_strike`, ecc.) restano `null`

#### 2. `supabase/functions/check-alerts/index.ts` — estendere il blocco Covered Call

Alla riga 451, cambiare la condizione da:
```
if (strategyType === 'Covered Call')
```
a:
```
if (strategyType === 'Covered Call' || strategyType === 'De-Risking Covered Call')
```

Anche il `mapStrategyTypeToCategory` (riga 248-255) va aggiornato per mappare `'De-Risking Covered Call'` → `'covered_call'`, così il filtro override funziona correttamente.

I messaggi degli alert useranno il `strategyType` reale (es. "La De-Risking Covered Call è ITM") per distinguere visivamente il tipo.

### Risultato
- Le De-Risking CC vengono salvate nel cache come qualsiasi altra strategia
- La Edge Function le monitora con la stessa logica di distanza e ITM delle Covered Call standard
- I messaggi indicano chiaramente se l'alert è per una CC o una De-Risking CC

