
# Piano: Correggere Calcoli Top Holdings Consolidate

## Problemi Identificati

### 1. Bug nel Matching dei Nomi (CRITICO)

La funzione `isSameHolding()` in `src/lib/sectorExposure.ts` non gestisce il prefisso "AZ." presente nelle descrizioni stock italiane:

| Fonte | Nome | Normalizzato Attuale |
|-------|------|---------------------|
| Stock | `AZ.ALIBABA GROUP HOLDING LTD` | `azalibaba group holding ltd` |
| Naked PUT | `ALIBABA GROUP HOLDING LTD` | `alibaba group holding ltd` |

Risultato: vengono create **due entry separate** invece di aggregare i dati.

**Evidenza**: Nella sezione Naked PUT, Alibaba mostra €27.986 (corretto), ma nella Top 10 Holdings il badge PUT mostra €17.419 (errato).

### 2. Limite Hardcoded a 10 Holdings

L'utente ha richiesto di mostrare **tutti** i titoli sui quali è esposto, non solo la top 10.

**File**: `src/lib/sectorExposure.ts` linea 623: `.slice(0, limit)` con `limit=10`

### 3. Top Holdings ETF Non Funzionanti

I dati `top_holdings` salvati nel database contengono allocazioni geografiche ("Japan", "Other") invece di nomi di aziende. Lo scraping di justETF non estrae correttamente le holdings aziendali.

**Evidenza**: Query database mostra:
```json
"top_holdings": [{"name": "Other", "percentage": 37.15}, {"name": "Japan", "percentage": 5.41}]
```

### 4. Badge ETF Mancante

L'utente ha richiesto di mostrare un badge ETF come per Stock e PUT, ma a causa del problema #3 l'esposizione ETF è sempre 0.

## Correzioni Richieste

### Correzione 1: Normalizzazione Nomi con Prefisso "AZ."

**File**: `src/lib/sectorExposure.ts`

```typescript
function normalizeHoldingName(name: string): string {
  // Rimuovi prefisso "AZ." comune nelle descrizioni stock italiane
  let normalized = name.replace(/^AZ\./i, '').trim();
  return normalizeForMatching(normalized);
}
```

### Correzione 2: Rimuovere Limite 10 Holdings

**File**: `src/lib/sectorExposure.ts` (linea 623)

Modificare il parametro `limit` per mostrare tutti i titoli con esposizione > 0.

**File**: `src/components/risk/EquityExposureView.tsx` (linea 69)

```typescript
// Prima: calculateConsolidatedTopHoldings(analysis, etfAllocations, { includeProtections }, 10);
// Dopo: nessun limite (o limite molto alto)
const consolidatedHoldings = useMemo(() => {
  return calculateConsolidatedTopHoldings(analysis, etfAllocations, { includeProtections }, 100);
}, [analysis, etfAllocations, includeProtections]);
```

Aggiornare anche il titolo della card: "Holdings Consolidate" invece di "Top 10 Holdings Consolidate".

### Correzione 3: Migliorare Scraping Top Holdings ETF

**File**: `supabase/functions/fetch-etf-allocation/index.ts`

Il problema è che i metodi di scraping HTML per le top holdings falliscono e non c'è un fallback AI come per i settori.

Aggiungere una funzione `fetchETFTopHoldingsWithAI()` simile a `fetchETFSectorsWithAI()`:

```typescript
async function fetchETFTopHoldingsWithAI(
  isin: string,
  etfName: string
): Promise<TopHolding[]> {
  // Usa Lovable AI per ottenere le top 10-15 holdings dell'ETF
  const prompt = `For the ETF "${etfName}" (ISIN: ${isin}), provide the top 10 holdings with their approximate percentage weights...`;
  // ...
}
```

Chiamare questa funzione quando `topHoldings.length === 0` prima di salvare nel database.

### Correzione 4: Badge ETF nella UI

Il badge ETF è già implementato (linea 768), ma non viene mostrato perché `holding.etfExposure === 0`.

Questo si risolverà automaticamente con la Correzione 3.

## File da Modificare

| File | Modifica |
|------|----------|
| `src/lib/sectorExposure.ts` | Correggere `normalizeHoldingName()` per gestire "AZ." |
| `src/lib/sectorExposure.ts` | Rimuovere o aumentare limite holdings |
| `src/components/risk/EquityExposureView.tsx` | Aggiornare chiamata e titolo sezione |
| `supabase/functions/fetch-etf-allocation/index.ts` | Aggiungere fallback AI per top holdings |
| Database | Pulire cache `etf_allocations.top_holdings` errate |

## Calcoli Attesi per Alibaba (dopo le correzioni)

| Componente | Formula | Valore |
|------------|---------|--------|
| Stock | 100 × $175.66 / 1.197 | €14.678 |
| PUT 165 | 165 × 1 × 100 / 1.197 | €13.784 |
| PUT 170 | 170 × 1 × 100 / 1.197 | €14.202 |
| **Totale PUT** | — | **€27.986** |
| **Totale Consolidato** | Stock + PUT | **€42.664** |

## Sequenza di Implementazione

1. **Prima**: Correggere `normalizeHoldingName()` per matching corretto
2. **Seconda**: Rimuovere limite 10 holdings
3. **Terza**: Implementare fallback AI per top holdings ETF
4. **Quarta**: Pulire cache database con holdings errate
5. **Quinta**: Testare i calcoli con dati reali
