

## Fix logica Naked Call e matching nel briefing giornaliero

### Problema identificato

La logica del briefing nella Edge Function `daily-briefing` ha un errore fondamentale nel calcolo delle **Naked Call**: le azioni in portafoglio NON hanno il campo `ticker` compilato (e sempre `null`), hanno solo la descrizione (es. `"AZ.NVIDIA CORP"`). La `strategy_cache` invece ha i ticker risolti (es. `"NVDA"`).

Il risultato: il matching per ticker non funziona mai, e tutte le call vendute risultano scoperte.

### Come funziona il frontend (correttamente)

La card "Posizioni da monitorare" (`DerivativesSummaryCard.tsx`) usa le `categories` gia classificate dal motore di strategie. NON ricalcola la classificazione — la riceve pronta. Per le Naked Call, usa `normalizeForMatching()` sulle descrizioni delle azioni e delle opzioni per trovare corrispondenze.

### Soluzione

Riscrivere completamente la logica Naked Call nella Edge Function usando un approccio ibrido:

1. **Per il matching stock-strategia**: usare la tabella `underlying_mappings` (che contiene la mappatura `underlying_name` -> `ticker`) per risolvere i nomi delle azioni al ticker corretto, lo stesso usato in `strategy_cache`
2. **Inoltre**: applicare la stessa normalizzazione del frontend (rimozione prefisso "AZ.", suffissi corporate, etc.) come fallback

### Dettaglio tecnico

**File: `supabase/functions/daily-briefing/index.ts`**

**1. Aggiungere funzione di normalizzazione** (replica del frontend):
```typescript
function normalizeForMatching(str: string): string {
  return str
    .toUpperCase()
    .replace(/\s+(INC|CORP|LTD|PLC|AG|SA|SPA|ADR|CLASS\s*[A-Z]?)\.?$/gi, '')
    .replace(/^AZ\.\s*/i, '')
    .trim();
}
```

**2. Caricare `underlying_mappings`** dalla tabella per avere la mappatura nome -> ticker:
```typescript
const { data: mappings } = await supabase
  .from('underlying_mappings')
  .select('underlying_name, ticker');
```

**3. Riscrivere la logica Naked Call** nel `buildBriefingSections`:
- Per ogni azione (position con `asset_type === 'stock'`):
  - Normalizzare la descrizione
  - Cercare il ticker corrispondente in `underlying_mappings` (matching fuzzy per nome)
  - Contare le azioni possedute
- Per ogni strategia in `strategy_cache`:
  - Covered Call: conta come 1 sold call per il ticker
  - Iron Condor / Double Diagonal: conta 1 sold + 1 bought (netto 0)
  - LEAP Call: conta come 1 bought call
  - Altre strategie: controlla option_type e quantita dalle posizioni originali
- Il confronto avviene per **ticker risolto**, non per nome grezzo

**4. Aggiungere anche il matching per "Call da rivendere"** con la stessa logica di normalizzazione, dato che soffre dello stesso problema.

### Dati coinvolti (dal database reale)
- Azioni: `ticker = null`, `description = "AZ.NVIDIA CORP"` (qty 100)
- Strategy cache: `ticker = "NVDA"`, `strategy_type = "LEAP Call"`
- Underlying mappings: `underlying_name = "NVIDIA CORP"` -> `ticker = "NVDA"`

### Cosa cambia
- Riscrittura della funzione `buildBriefingSections` in `daily-briefing/index.ts`
- Aggiunta query per `underlying_mappings`
- Aggiunta funzione `normalizeForMatching`
- Logica di matching stock->ticker basata su `underlying_mappings` + normalizzazione

### Cosa NON cambia
- Logica ITM, OOR, OOB per le altre sezioni (usano gia `strategy_cache.ticker` e `underlying_prices` correttamente)
- Nessuna modifica al frontend o ad altre Edge Function
- Nessuna modifica al database
