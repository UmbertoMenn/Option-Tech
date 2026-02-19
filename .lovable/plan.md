

## Recupero dati storici nella calcolatrice premi

### Contesto
Quando una gamba cambia (roll, cambio strike/scadenza), la chiave `option_symbol` cambia e la calcolatrice si apre vuota. I dati vecchi restano nel database ma non sono piu visibili.

### Modifica

**File: `src/hooks/useCoveredCallPremiums.ts`**

Aggiungere una funzione helper `getPremiumsByTicker(ticker: string)` che restituisce **tutti** i record per quel ticker (indipendentemente dall'`option_symbol`), ordinati per `updated_at` decrescente. Questa funzione e gia parzialmente presente come `getPremiumByTicker` ma restituisce solo il primo match -- servira una versione che restituisca un array.

**File: `src/components/derivatives/CallPremiumCalculatorDialog.tsx`**

1. Nel `useEffect` che carica i dati salvati (righe 69-80), se non viene trovato un match esatto per `(ticker, optionSymbol)`, cercare tutti i record storici per lo stesso ticker usando `getPremiumsByTicker`.

2. Se esistono record storici (ma nessuno corrisponde all'`optionSymbol` corrente), mostrare un **banner informativo** sopra la zona di upload con:
   - Messaggio: "Trovati dati storici per questo ticker"
   - Un **Select dropdown** con le opzioni disponibili, ciascuna identificata dal proprio `option_symbol` e data dell'ultima modifica
   - Il formato di ogni opzione sara: `"{option_symbol} — aggiornato il {data}"` (es. `"C200_2025-03-21 — aggiornato il 15/02/2025"`)

3. Quando l'utente seleziona un vecchio record:
   - Caricare gli ordini (`orders_json`), il costo transazione e le metriche dal record selezionato
   - Marcare i dati come "unsaved changes" (`hasUnsavedChanges = true`) in modo che il salvataggio li associ alla **nuova** chiave `optionSymbol` corrente
   - Mostrare un toast di conferma: "Dati importati da {vecchio option_symbol}"

4. Il banner scompare una volta che ci sono dati caricati (sia da selezione storica che da upload file).

### Dettaglio tecnico

**`useCoveredCallPremiums.ts`** -- nuova funzione esposta:
```text
getPremiumsByTicker(ticker: string): CoveredCallPremium[]
  -> filtra premiums per ticker (case-insensitive)
  -> ordina per updated_at DESC
```

**`CallPremiumCalculatorDialog.tsx`** -- nuove variabili di stato:
```text
historicalPremiums: CoveredCallPremium[]  -- record storici disponibili per il ticker
showHistoricalPicker: boolean             -- true se la calcolatrice e vuota ma ci sono dati storici
```

**Logica nel useEffect (righe 69-80)**:
```text
SE match esatto (ticker, optionSymbol) trovato:
  -> carica normalmente (comportamento attuale)
ALTRIMENTI:
  -> cerca tutti i record per ticker
  -> SE ce ne sono > 0:
    -> popola historicalPremiums
    -> showHistoricalPicker = true
```

**UI del banner** (posizionato tra l'header del dialog e la zona upload):
```text
Alert (variant info):
  icona: History
  testo: "Dati storici disponibili per {ticker}"
  Select con le opzioni
  Bottone "Importa" per confermare la selezione
```

### Comportamento dopo l'importazione
- I dati importati vengono trattati come "nuovi" rispetto alla chiave corrente
- Il salvataggio (bottone "Salva") li salvera con il nuovo `option_symbol`
- Il vecchio record nel DB **non viene cancellato** (l'utente puo decidere di farlo manualmente con Reset se vuole)

