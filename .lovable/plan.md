
# Piano: Correzione Definitiva Identificazione ETF e Classificazione Settoriale

## Problemi Identificati

### Problema 1: ETF Non Rilevati (0 ETF analizzati)

**Causa**: In `src/pages/RiskAnalyzer.tsx` (linee 52-66), l'identificazione degli ETF avviene tramite pattern matching sul nome (`ETF_PATTERN.test(stock.underlying)`) invece di usare il flag booleano `stock.isETF` che viene impostato correttamente in `riskCalculator.ts` basandosi su `asset_type === 'etf'`.

**Perche il pattern fallisce**: Nomi ETF abbreviati o non standard (es. "ISHSIII-CORE MSCI WLD") potrebbero non matchare tutti i pattern.

### Problema 2: Azioni con prefisso "AZ." finiscono in "Other"

**Causa**: La funzione `getStockSector()` in `src/lib/sectorExposure.ts` (linee 187-202):
1. Cerca di estrarre il ticker con regex `/^([A-Z]{1,5})(?:\s|$)/` - ma "AZ.APPLE INC" inizia con "AZ." che non e un ticker valido
2. Poi cerca i ticker noti nel nome con `upperName.includes(ticker)` - ma cerca "AAPL" nel nome che contiene "APPLE" (senza la "L")

**Esempio**: `getStockSector("AZ.APPLE INC")` ritorna "Other" perche:
- La regex estrae "AZ" che non e nel STOCK_SECTORS
- La ricerca per "AAPL" nel nome "AZ.APPLE INC" fallisce (il nome contiene "APPLE" non "AAPL")

### Problema 3: Derivati finiscono in "Other"

**Causa**: La funzione `getStockSectorWithMapping()` ha un problema simile:
1. Cerca il ticker `mapping.ticker` nel nome (`upperName.includes(mapping.ticker)`) 
2. Ma il nome e "IREN LTD" e il ticker salvato potrebbe essere "IREN" - questo dovrebbe matchare
3. Il problema e che i `sectorMappings` potrebbero essere vuoti se la risoluzione AI fallisce o non viene chiamata

**Evidenza dal flusso dati**:
- `stocksForSectorMapping` in RiskAnalyzer.tsx raccoglie gli stock da risolvere
- Ma usa `ETF_PATTERN.test(stock.underlying)` per escludere gli ETF, che fallisce
- Quindi potrebbe includere erroneamente ETF come "azioni da risolvere"

---

## Soluzione

### Modifica 1: Usare `stock.isETF` invece del pattern matching (RiskAnalyzer.tsx)

**File**: `src/pages/RiskAnalyzer.tsx`

Linee 52-66 - Sostituire pattern matching con flag booleano:

```typescript
// PRIMA
const etfIsins = useMemo(() => {
  const isins: string[] = [];
  const seen = new Set<string>();
  
  for (const stock of analysis.stockDetails) {
    if (stock.isin && !seen.has(stock.isin)) {
      seen.add(stock.isin);
      if (ETF_PATTERN.test(stock.underlying)) {  // PROBLEMA
        isins.push(stock.isin);
      }
    }
  }
  return isins;
}, [analysis.stockDetails]);

// DOPO
const etfIsins = useMemo(() => {
  const isins: string[] = [];
  const seen = new Set<string>();
  
  for (const stock of analysis.stockDetails) {
    if (stock.isin && !seen.has(stock.isin) && stock.isETF) {  // USA IL FLAG
      seen.add(stock.isin);
      isins.push(stock.isin);
    }
  }
  return isins;
}, [analysis.stockDetails]);
```

Linea 87 - Correggere anche il filtro per sector mapping:

```typescript
// PRIMA
if (!ETF_PATTERN.test(stock.underlying)) {

// DOPO  
if (!stock.isETF) {
```

Rimuovere la definizione di `ETF_PATTERN` (linea 49) se non piu usata.

### Modifica 2: Normalizzare i nomi prima della ricerca settori (sectorExposure.ts)

**File**: `src/lib/sectorExposure.ts`

Modificare `getStockSector()` (linee 187-202) per normalizzare il nome rimuovendo "AZ.":

```typescript
function getStockSector(name: string): string {
  // Normalize: remove AZ. prefix common in Italian brokers
  const normalizedName = name.replace(/^AZ\./i, '').trim();
  
  // Try to extract ticker from name (often first word in uppercase)
  const tickerMatch = normalizedName.match(/^([A-Z]{1,5})(?:\s|$)/);
  if (tickerMatch && STOCK_SECTORS[tickerMatch[1]]) {
    return STOCK_SECTORS[tickerMatch[1]];
  }
  
  // Also check full name for known tickers anywhere
  const upperName = normalizedName.toUpperCase();
  for (const [ticker, sector] of Object.entries(STOCK_SECTORS)) {
    if (upperName.includes(ticker) && ticker.length >= 3) {
      return sector;
    }
  }
  
  return 'Other';
}
```

### Modifica 3: Aggiungere mapping statici per nomi comuni (sectorExposure.ts)

Per gestire casi come "APPLE INC" -> "AAPL", aggiungere un mapping di nomi aziendali:

```typescript
// Mapping da nomi comuni a ticker (per gestire "APPLE INC" -> AAPL)
const COMPANY_NAME_TO_TICKER: Record<string, string> = {
  'APPLE': 'AAPL',
  'NVIDIA': 'NVDA',
  'ALPHABET': 'GOOGL',
  'GOOGLE': 'GOOGL',
  'AMAZON': 'AMZN',
  'MICROSOFT': 'MSFT',
  'META': 'META',
  'TESLA': 'TSLA',
  'INTEL': 'INTC',
  'AMD': 'AMD',
  'ADVANCED MICRO': 'AMD',
  'BROADCOM': 'AVGO',
  'QUALCOMM': 'QCOM',
  'CISCO': 'CSCO',
  'ORACLE': 'ORCL',
  'SALESFORCE': 'CRM',
  'ADOBE': 'ADBE',
  'NETFLIX': 'NFLX',
  'PAYPAL': 'PYPL',
  'VISA': 'V',
  'MASTERCARD': 'MA',
  'JPMORGAN': 'JPM',
  'GOLDMAN': 'GS',
  'BERKSHIRE': 'BRK.B',
  'UNITEDHEALTH': 'UNH',
  'JOHNSON': 'JNJ',
  'PROCTER': 'PG',
  'EXXON': 'XOM',
  'CHEVRON': 'CVX',
  'WALMART': 'WMT',
  'DISNEY': 'DIS',
  'COCA COLA': 'KO',
  'PEPSI': 'PEP',
  'PEPSICO': 'PEP',
  'IREN': 'IREN',
  'MARA': 'MARA',
  'MARATHON': 'MARA',
  'RIOT': 'RIOT',
  'PALANTIR': 'PLTR',
  'COINBASE': 'COIN',
  'MICROSTRATEGY': 'MSTR',
  'COREWEAVE': 'CRWV',
};

function getStockSector(name: string): string {
  // Normalize: remove AZ. prefix
  const normalizedName = name.replace(/^AZ\./i, '').trim();
  const upperName = normalizedName.toUpperCase();
  
  // 1. Try direct ticker match
  const tickerMatch = normalizedName.match(/^([A-Z]{1,5})(?:\s|$)/);
  if (tickerMatch && STOCK_SECTORS[tickerMatch[1]]) {
    return STOCK_SECTORS[tickerMatch[1]];
  }
  
  // 2. Try company name to ticker mapping
  for (const [companyName, ticker] of Object.entries(COMPANY_NAME_TO_TICKER)) {
    if (upperName.includes(companyName)) {
      if (STOCK_SECTORS[ticker]) {
        return STOCK_SECTORS[ticker];
      }
    }
  }
  
  // 3. Check full name for known tickers
  for (const [ticker, sector] of Object.entries(STOCK_SECTORS)) {
    if (upperName.includes(ticker) && ticker.length >= 3) {
      return sector;
    }
  }
  
  return 'Other';
}
```

### Modifica 4: Applicare normalizzazione anche in getStockSectorWithMapping

```typescript
function getStockSectorWithMapping(
  name: string, 
  sectorMappings: Record<string, SectorMapping>,
  isin?: string
): string {
  // 1. Try by ISIN from dynamic mapping
  if (isin && sectorMappings[isin]?.sector) {
    return normalizeSectorName(sectorMappings[isin].sector);
  }
  
  // Normalize name: remove AZ. prefix
  const normalizedName = name.replace(/^AZ\./i, '').trim();
  const upperName = normalizedName.toUpperCase();
  
  // 2. Try by name key (for derivatives)
  if (sectorMappings[`name:${upperName}`]?.sector) {
    return normalizeSectorName(sectorMappings[`name:${upperName}`].sector);
  }
  
  // 3. Try to find by ticker in sectorMappings
  for (const [key, mapping] of Object.entries(sectorMappings)) {
    if (key.startsWith('ticker:') && mapping.ticker && upperName.includes(mapping.ticker.toUpperCase())) {
      return normalizeSectorName(mapping.sector);
    }
    if (!key.startsWith('ticker:') && !key.startsWith('name:') && mapping.ticker) {
      if (upperName.includes(mapping.ticker.toUpperCase()) && mapping.ticker.length >= 2) {
        return normalizeSectorName(mapping.sector);
      }
    }
  }
  
  // 4. Fallback to static mapping (which now handles normalization internally)
  return getStockSector(name);
}
```

---

## Riepilogo Modifiche

| File | Linee | Modifica |
|------|-------|----------|
| `src/pages/RiskAnalyzer.tsx` | 49 | Rimuovere `ETF_PATTERN` non piu usato |
| `src/pages/RiskAnalyzer.tsx` | 57-62 | Usare `stock.isETF` per identificare ETF |
| `src/pages/RiskAnalyzer.tsx` | 87 | Usare `!stock.isETF` per escludere ETF dal sector mapping |
| `src/lib/sectorExposure.ts` | ~180 | Aggiungere `COMPANY_NAME_TO_TICKER` mapping |
| `src/lib/sectorExposure.ts` | 187-202 | Modificare `getStockSector()` con normalizzazione e name mapping |
| `src/lib/sectorExposure.ts` | 206-237 | Modificare `getStockSectorWithMapping()` con normalizzazione |

---

## Risultato Atteso

| Strumento | Prima | Dopo |
|-----------|-------|------|
| ETF (ISHARES, VANGUARD, ecc.) | 0 ETF analizzati | X ETF analizzati (basato su asset_type) |
| AZ.APPLE INC | Other | Technology |
| AZ.ALPHABET IN-CL A | Other | Technology |
| AZ.IREND LTD | Other | Technology (tramite IREN ticker) |
| Naked PUT NVIDIA | Other | Technology |
| Double Diagonal AMD | Other | Technology |

## Prevenzione Future Regressioni

1. Il flag `isETF` e robusto perche deriva da `asset_type` nel database (impostato durante l'import Excel)
2. La normalizzazione "AZ." e centralizzata e applicata in tutti i punti di lookup
3. Il mapping `COMPANY_NAME_TO_TICKER` gestisce le variazioni di nomi comuni
4. I sectorMappings dinamici hanno comunque priorita per override manuali
