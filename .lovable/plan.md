

## Fix matching: usare ticker tramite underlying_mappings

### Problema
Il server matcha stock e strategie tramite `getMatchingKey(description)` vs `getMatchingKey(underlying)`, ma queste stringhe provengono da fonti diverse:

| Stock description | Normalizza a | Strategy underlying | Normalizza a | Match? |
|---|---|---|---|---|
| AZ.SOUNDHOUND AI INC-A | SOUNDHOUND AI A | SoundHound AI Inc | SOUNDHOUND AI | NO |
| AZ.PALANTIR TECHNOLOGIES INC-A | PALANTIR TECHNOLOGIES A | Palantir Technologies Inc. | PALANTIR TECHNOLOGIES | NO |
| AZ.NEBIUS GROUP N V | NEBIUS GROUP N V | Nebius Group NV | NEBIUS GROUP | NO |
| NOVO NORDISK A/S ADR-EACH... | NOVO NORDISK A S EACH... | Novo Nordisk AS | NOVO NORDISK AS | NO |

Il frontend non ha questo problema perche usa `cc.underlying.description` (la description dello STOCK) per entrambi i lati del match.

### Soluzione: match per ticker via underlying_mappings

La tabella `underlying_mappings` mappa gia le description agli ticker (es. "ALPHABET INC-CL A" -> "GOOGL", "SOUNDHOUND AI INC-A" non c'e ma "SoundHound AI Inc" -> "SOUN").

Approccio:
1. Caricare `underlying_mappings` nel server
2. Per ogni stock, risolvere il ticker dalla description (rimuovendo prefisso "AZ.", cercando match esatto o normalizzato)
3. Per ogni strategy in `strategy_cache`, usare il campo `ticker` gia presente
4. Matchare per ticker nelle sezioni 1 e 7

### Modifiche in `supabase/functions/daily-briefing/index.ts`

**Aggiungere** funzione `resolveStockTicker()`:
- Riceve la description dello stock e la mappa underlying_mappings
- Rimuove prefisso "AZ."
- Cerca match diretto nella mappa
- Se non trovato, cerca match normalizzato (normalizeName simile a useUnderlyingPrices.ts)
- Restituisce il ticker o null

**Modificare** `computeSectionsFromCache()`:
- Caricare `underlying_mappings` (SELECT underlying, ticker) all'inizio
- Costruire una mappa description -> ticker

**Sezione 1 (Call non coperte)**: cambiare la chiave di aggregazione
- Per le stock: `key = resolveStockTicker(stock.description, mappings) || getMatchingKey(stock.description)`
- Per le strategie: `key = s.ticker || getMatchingKey(s.underlying)`
- Il match avviene per ticker quando disponibile, con fallback alla normalizzazione attuale

**Sezione 7 (Call da rivendere)**: stesso cambio
- stockKey usa `resolveStockTicker` 
- CC strategy key usa `s.ticker`

### Cosa NON cambia
- Le sezioni 2-6 e 8 non usano matching stock/strategie
- Le funzioni normalizeForMatching, getCanonicalKey, getMatchingKey restano come fallback
- Il display ticker nei messaggi di output resta invariato

### Risultato atteso
Tutti i match avverranno per ticker (es. "SOUN", "PLTR", "NBIS", "NVO") eliminando completamente i falsi positivi da normalizzazione incoerente delle description.

