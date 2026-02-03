

# Piano: Correzione Recupero Prezzi Sottostanti (Case-Insensitive)

## Problema Identificato

Il sistema non recupera il prezzo di AppLovin perché:

1. **Query case-sensitive**: Il database ha la mappatura "APPLOVIN CORP" → "APP" (corretta, inserita manualmente), ma la ricerca usa `eq('underlying', 'AppLovin Corp')` che non trova match perché il case è diverso

2. **Ticker AI errato**: Quando il cache miss avviene, l'AI inferisce "APPW" (ticker errato) invece di "APP"

3. **Mappature duplicate**: Nel database esistono ora:
   - "APPLOVIN CORP" → "APP" ✅ (manuale)
   - "APPLOVIN" → "APP" ✅ (manuale)
   - "AppLovin Corp" → "APPW" ❌ (AI errato)

---

## Soluzione Dinamica

### Strategia
1. Modificare la ricerca nel database per essere **case-insensitive** usando `ilike`
2. Normalizzare sempre l'underlying prima di salvarlo nel cache
3. Aggiungere validazione del ticker via Yahoo Finance prima di salvarlo

---

## Modifiche File

### File: `supabase/functions/fetch-underlying-prices/index.ts`

#### 1. Modificare `checkUnderlyingMappingsCache` per ricerca case-insensitive

```typescript
async function checkUnderlyingMappingsCache(
  supabase: any,
  underlying: string
): Promise<string | null> {
  try {
    // Try exact match first
    let { data, error } = await supabase
      .from('underlying_mappings')
      .select('ticker')
      .eq('underlying', underlying)
      .single();
    
    if (data?.ticker) {
      console.log(`Cache hit (exact) for "${underlying}": ${data.ticker}`);
      return data.ticker;
    }
    
    // Try case-insensitive match
    const normalized = normalizeName(underlying);
    const { data: iData } = await supabase
      .from('underlying_mappings')
      .select('ticker, underlying')
      .ilike('underlying', `%${normalized.split(' ')[0]}%`)
      .limit(5);
    
    if (iData && iData.length > 0) {
      // Find best match using normalized comparison
      for (const row of iData) {
        if (normalizeName(row.underlying) === normalized) {
          console.log(`Cache hit (normalized) for "${underlying}": ${row.ticker}`);
          return row.ticker;
        }
      }
    }
  } catch {
    // No cached mapping
  }
  return null;
}
```

#### 2. Aggiungere validazione ticker Yahoo Finance

Prima di salvare un ticker inferito dall'AI, verificare che sia valido:

```typescript
// Validate ticker before saving (check it returns a valid price)
async function validateTicker(ticker: string): Promise<boolean> {
  const priceResult = await fetchYahooPrice(ticker);
  return priceResult !== null && priceResult.price > 0;
}
```

#### 3. Modificare il flusso principale per validare prima di salvare

```typescript
// Step 3: Try AI inference
if (!ticker) {
  const aiTicker = await inferTickerWithAI(underlying);
  
  // Validate AI-inferred ticker before accepting it
  if (aiTicker) {
    const isValid = await validateTicker(aiTicker);
    if (isValid) {
      ticker = aiTicker;
      console.log(`AI ticker "${aiTicker}" validated successfully for "${underlying}"`);
    } else {
      console.log(`AI ticker "${aiTicker}" failed validation for "${underlying}"`);
    }
  }
}
```

#### 4. Salvare con underlying normalizzato

```typescript
// Save to cache using NORMALIZED underlying for consistency
if (ticker) {
  const normalizedUnderlying = normalizeName(underlying);
  await saveToUnderlyingMappingsCache(supabase, normalizedUnderlying, ticker);
}
```

---

## Pulizia Database

Dopo il deploy, pulire il mapping errato:

```sql
DELETE FROM underlying_mappings 
WHERE underlying = 'AppLovin Corp' AND ticker = 'APPW';
```

---

## Flusso Corretto Post-Fix

1. Frontend invia "AppLovin Corp"
2. Query esatta: no match
3. Query normalizzata: trova "APPLOVIN CORP" → "APP" ✅
4. Fetch Yahoo Finance con ticker "APP"
5. Ritorna prezzo corretto

---

## Benefici della Soluzione

| Aspetto | Prima | Dopo |
|---------|-------|------|
| Case sensitivity | ❌ "AppLovin Corp" ≠ "APPLOVIN CORP" | ✅ Match normalizzato |
| Ticker errati | ❌ Salvati senza validazione | ✅ Validati via Yahoo prima del salvataggio |
| Duplicati | ❌ Mappature multiple per stesso underlying | ✅ Underlying normalizzato |
| Robustezza | ❌ Dipende dal case esatto | ✅ Dinamico e case-insensitive |

---

## Riepilogo Modifiche

| Componente | Modifica |
|------------|----------|
| `checkUnderlyingMappingsCache` | Aggiunta ricerca case-insensitive con `ilike` e confronto normalizzato |
| Nuovo `validateTicker` | Funzione per validare ticker via Yahoo Finance |
| Flusso principale | Validazione ticker AI prima del salvataggio |
| Salvataggio cache | Usa underlying normalizzato per coerenza |
| Database | Pulizia mapping errato "AppLovin Corp" → "APPW" |

