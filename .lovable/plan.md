

# Piano: Fix Sector Resolution per Stock e Derivati

## Problemi Identificati

L'analisi ha rivelato **tre problemi distinti** che causano la classificazione "Other":

| Problema | File | Causa |
|----------|------|-------|
| 1. Alphabet, CACI non risolti | `useSectorMappings.ts` | L'edge function viene chiamata ma non trova i settori (possibile problema AI) |
| 2. Derivati tutti in "Other" | `sectorExposure.ts` | Usano solo `getStockSector()` statico, ignorano `sectorMappings` |
| 3. Sottostanti derivati non raccolti | `RiskAnalyzer.tsx` | Solo `stockDetails` viene passato a `fetchSectorMappings` |

### Dati dal Database

```
Alphabet (US02079K3059): NON ESISTE in isin_mappings → Mai risolto
CACI (US1271903049): sector = null, source = unknown → AI ha fallito
Derivati: Usano "underlying" (nome) ma sectorExposure usa solo STOCK_SECTORS statico
```

---

## Soluzione Completa

### Modifica 1: Raccogliere Anche i Sottostanti Derivati

**File**: `src/pages/RiskAnalyzer.tsx`

Estendere `stocksForSectorMapping` per includere anche i nomi dei sottostanti derivati:

```typescript
// Estrarre sottostanti da TUTTI i tipi di posizione
const stocksForSectorMapping = useMemo(() => {
  const stocks: Array<{ isin: string; description: string }> = [];
  const names: string[] = [];  // Per derivati senza ISIN
  const seen = new Set<string>();
  
  // 1. Stock diretti (con ISIN)
  for (const stock of analysis.stockDetails) {
    if (stock.isin && !seen.has(stock.isin)) {
      seen.add(stock.isin);
      if (!ETF_PATTERN.test(stock.underlying)) {
        stocks.push({ isin: stock.isin, description: stock.underlying });
      }
    }
  }
  
  // 2. Naked PUTs (solo nome)
  for (const np of analysis.nakedPutDetails) {
    if (!seen.has(np.underlying)) {
      seen.add(np.underlying);
      names.push(np.underlying);
    }
  }
  
  // 3. Leap CALLs (solo nome)
  for (const lc of analysis.leapCallDetails) {
    if (!seen.has(lc.underlying)) {
      seen.add(lc.underlying);
      names.push(lc.underlying);
    }
  }
  
  // 4. Strategie (solo nome)
  for (const strat of analysis.strategyDetails) {
    if (!seen.has(strat.underlying)) {
      seen.add(strat.underlying);
      names.push(strat.underlying);
    }
  }
  
  return { stocks, names };
}, [analysis]);
```

### Modifica 2: `sectorExposure.ts` - Usare Mapping Dinamici per Derivati

**File**: `src/lib/sectorExposure.ts`

Modificare le funzioni per i derivati per usare prima i mapping dinamici:

```typescript
// Nuova funzione helper per trovare settore con fallback
function getStockSectorWithMapping(
  name: string, 
  sectorMappings: Record<string, SectorMapping>,
  isin?: string
): string {
  // 1. Try by ISIN from dynamic mapping
  if (isin && sectorMappings[isin]?.sector) {
    return normalizeSectorName(sectorMappings[isin].sector);
  }
  
  // 2. Try to find by ticker in sectorMappings
  const normalizedName = name.toUpperCase();
  for (const [mappingIsin, mapping] of Object.entries(sectorMappings)) {
    if (mapping.ticker && normalizedName.includes(mapping.ticker.toUpperCase())) {
      return normalizeSectorName(mapping.sector);
    }
    // Also match by description
    if (normalizedName.includes(mapping.ticker?.toUpperCase() || '')) {
      return normalizeSectorName(mapping.sector);
    }
  }
  
  // 3. Fallback to static mapping
  return getStockSector(name);
}

// In calculateSectorExposure, usare questa funzione per i derivati:
// Naked PUTs
for (const np of analysis.nakedPutDetails) {
  const sector = getStockSectorWithMapping(np.underlying, sectorMappings);
  // ...
}

// Leap CALLs
for (const lc of analysis.leapCallDetails) {
  const sector = getStockSectorWithMapping(lc.underlying, sectorMappings);
  // ...
}

// Strategies
for (const strat of analysis.strategyDetails) {
  const sector = getStockSectorWithMapping(strat.underlying, sectorMappings);
  // ...
}
```

### Modifica 3: Supporto per Risoluzione per Nome

**File**: `src/hooks/useSectorMappings.ts`

Estendere per supportare anche la risoluzione per nome (per derivati):

```typescript
export interface StockInfo {
  isin?: string;       // Opzionale (per stock diretti)
  description: string; // Sempre presente
}

const fetchMappings = useCallback(async (stocks: StockInfo[]) => {
  // Separare stock con ISIN da quelli con solo nome
  const withIsin = stocks.filter(s => s.isin);
  const withNameOnly = stocks.filter(s => !s.isin);
  
  // 1. Risolvere quelli con ISIN (come prima)
  // ...
  
  // 2. Per quelli con solo nome, cercare nella cache locale STOCK_SECTORS
  // o usare AI se non trovati
  // ...
}, [hasFetched]);
```

### Modifica 4: Edge Function - Supporto Risoluzione per Nome

**File**: `supabase/functions/update-prices-cron/index.ts`

Aggiungere supporto per risolvere settori partendo dal nome descrittivo:

```typescript
if (body.mode === 'resolve-and-get-sectors') {
  const isins = body.isins || [];
  const descriptions = body.descriptions || {};
  const names = body.names || [];  // NUOVO: nomi senza ISIN
  
  // ... gestione ISIN come prima ...
  
  // Gestione nomi (per derivati)
  for (const name of names) {
    // 1. Cercare ticker nella descrizione
    const ticker = extractTickerFromName(name);
    
    // 2. Se trovato, usare AI per settore
    if (ticker) {
      const sectorInfo = await fetchSectorWithAI(ticker, name);
      // Salvare con chiave = nome normalizzato
      results.push({ name, ticker, sector: sectorInfo.sector });
    }
  }
}
```

---

## Flusso Risultante

```text
Utente apre Risk Analyzer → Settori
         │
         ▼
stocksForSectorMapping raccoglie:
├─ Stock con ISIN: [Alphabet, CACI, NVIDIA, ...]
└─ Sottostanti derivati: [IREN LTD, MARA, ...]
         │
         ▼
useSectorMappings chiama edge function con:
├─ isins: [US02079K3059, US1271903049, ...]
├─ descriptions: {US02079K3059: "ALPHABET INC-CL A", ...}
└─ names: ["IREN LTD", "MARA HOLDINGS", ...]  (derivati)
         │
         ▼
Edge function per ogni ISIN/nome:
├─ Yahoo Search → ticker
├─ fetchSectorWithAI(ticker, description) → settore
└─ UPSERT in isin_mappings (o cache temporanea per nomi)
         │
         ▼
sectorExposure usa sectorMappings per TUTTI:
├─ Stock: lookup per ISIN
├─ Derivati: lookup per ticker/nome
└─ Fallback: STOCK_SECTORS statico
         │
         ▼
Risultato: ~95% stock e derivati con settore corretto
```

---

## File da Modificare

| File | Modifiche |
|------|-----------|
| `src/pages/RiskAnalyzer.tsx` | Raccogliere anche sottostanti derivati |
| `src/hooks/useSectorMappings.ts` | Supportare risoluzione per nome + migliorare logging |
| `src/lib/sectorExposure.ts` | Usare sectorMappings anche per derivati |
| `supabase/functions/update-prices-cron/index.ts` | Supportare risoluzione per nome |

---

## Debug Aggiuntivo

Per capire perché Alphabet e CACI non vengono risolti, aggiungeremo logging dettagliato:

```typescript
// In edge function, dopo chiamata AI:
console.log(`AI Response for ${ticker}:`, {
  rawResponse: data.choices?.[0]?.message?.content,
  parsedSector: sectorText,
  isValid: validSectors.includes(sectorText)
});
```

Questo permetterà di vedere esattamente cosa restituisce l'AI e perché il settore non viene salvato.

---

## Risultato Atteso

| Categoria | Prima | Dopo |
|-----------|-------|------|
| Stock diretti | ~50% in Other | <5% in Other |
| Naked PUTs | 100% in Other | Settore corretto |
| Leap CALLs | 100% in Other | Settore corretto |
| Strategie | 100% in Other | Settore corretto |

