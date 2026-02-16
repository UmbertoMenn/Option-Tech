

## Premi Covered Call: separare per posizione, non per ticker

### Problema

La tabella `covered_call_premiums` usa la chiave `(portfolio_id, ticker)`. Se hai due Covered Call AAPL (es. strike 220 e strike 230), il salvataggio del premio su una viene mostrato identico anche sull'altra, perche' entrambe le righe fanno `getPremiumByTicker("AAPL")` e ottengono lo stesso record.

### Soluzione

Aggiungere un campo `option_symbol` alla tabella per distinguere i premi per singola posizione opzionaria. La chiave univoca diventa `(portfolio_id, ticker, option_symbol)`.

### Struttura del messaggio

Ogni riga Covered Call avra' il suo calcolo indipendente. La calcolatrice filtrera' gli ordini per lo specifico simbolo opzione (es. `AAPLG6C220`) oltre che per il ticker.

### Dettaglio tecnico

**1. Migrazione database**

```sql
-- Aggiungere colonna option_symbol (nullable per retrocompatibilita')
ALTER TABLE covered_call_premiums
  ADD COLUMN option_symbol text;

-- Popolare i record esistenti con un valore di default
UPDATE covered_call_premiums SET option_symbol = '' WHERE option_symbol IS NULL;

-- Rendere NOT NULL dopo il populate
ALTER TABLE covered_call_premiums
  ALTER COLUMN option_symbol SET NOT NULL,
  ALTER COLUMN option_symbol SET DEFAULT '';

-- Sostituire il vincolo univoco
DROP INDEX IF EXISTS covered_call_premiums_portfolio_id_ticker_key;
CREATE UNIQUE INDEX covered_call_premiums_portfolio_ticker_symbol_key
  ON covered_call_premiums (portfolio_id, ticker, option_symbol);
```

**2. `src/hooks/useCoveredCallPremiums.ts`**

- Aggiungere `option_symbol` all'interfaccia `CoveredCallPremium` e a `UpsertPremiumData`
- Modificare `getPremiumByTicker` in `getPremiumByTickerAndSymbol(ticker, optionSymbol)` che cerca la corrispondenza su entrambi i campi
- Aggiornare l'upsert per includere `option_symbol` nel payload e nel `onConflict: 'portfolio_id,ticker,option_symbol'`
- Aggiornare `deleteOrphanedMutation` per lavorare con la nuova chiave composita

**3. `src/pages/Derivatives.tsx`**

- In `CoveredCallRow`: ricavare il simbolo dell'opzione (es. `option.symbol` o dal campo descrizione) e passarlo alla calcolatrice e alla lookup del premio
- Cambiare `getPremiumByTicker(ticker)` in `getPremiumByTickerAndSymbol(ticker, optionSymbol)`
- Passare `optionSymbol` come prop al `CallPremiumCalculatorDialog`

**4. `src/components/derivatives/CallPremiumCalculatorDialog.tsx`**

- Aggiungere prop `optionSymbol: string`
- Usare `optionSymbol` nel salvataggio e nel caricamento dei dati
- Il filtro ordini nel file Excel puo' restare invariato (filtra gia' per ticker)

**5. `src/lib/strategyCache.ts`**

- Aggiornare la logica di cleanup `deleteOrphanedPremiums` per passare anche i simboli opzione attivi

### File da modificare

| Risorsa | Modifica |
|---|---|
| Database (migrazione SQL) | Aggiungere `option_symbol`, aggiornare vincolo univoco |
| `src/hooks/useCoveredCallPremiums.ts` | Aggiungere `option_symbol` a interfacce, upsert, lookup, delete |
| `src/pages/Derivatives.tsx` | Passare `optionSymbol` alla calcolatrice e alla lookup |
| `src/components/derivatives/CallPremiumCalculatorDialog.tsx` | Ricevere e usare `optionSymbol` |
| `src/lib/strategyCache.ts` | Aggiornare cleanup orfani con chiave composita |

### Retrocompatibilita'

I record esistenti avranno `option_symbol = ''` e continueranno a funzionare. Alla prossima apertura della calcolatrice per una specifica CC, il sistema creera' un nuovo record con il simbolo opzione corretto. Il vecchio record con `option_symbol = ''` potra' essere rimosso dal cleanup automatico.

