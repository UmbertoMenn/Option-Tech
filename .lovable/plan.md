

# Piano: Correzione Risoluzione Ticker e Salvataggio Override

## Problema Identificato

Ci sono **due problemi distinti** che causano ticker non risolti e errori di salvataggio:

### Problema 1: Mismatch Chiavi di Ricerca

L'edge function normalizza i nomi prima di salvarli nel database:
```
"ADOBE INC" → normalizza → "ADOBE" → salva come chiave
```

Ma il frontend cerca con il nome **originale**:
```
cerca "ADOBE INC" → non trova perché la chiave è "ADOBE"
```

**Esempi nel database:**
- Chiave salvata: `ADOBE`, `NETFLIX`, `TESLA`
- Nome nel portafoglio: `ADOBE INC`, `NETFLIX INC`, `TESLA INC`

### Problema 2: RLS Blocca Salvataggio

La tabella `underlying_mappings` ha solo policy SELECT:
```sql
-- Policy esistente:
Anyone can read underlying mappings (SELECT)

-- Policy mancante:
INSERT/UPDATE per utenti autenticati
```

---

## Soluzione

### Parte 1: Normalizzare le Chiavi di Ricerca nel Frontend

Modificare `useUnderlyingPrices.ts` per normalizzare i nomi prima della query:

```typescript
// Funzione di normalizzazione (stessa dell'edge function)
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bINC\b/g, '')
    .replace(/\bCORP\b/g, '')
    .replace(/\bLTD\b/g, '')
    .replace(/\bLLC\b/g, '')
    .replace(/\bPLC\b/g, '')
    .replace(/\bCO\b/g, '')
    .replace(/\bTHE\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Nella query:
const normalizedUnderlyings = uniqueUnderlyings.map(u => normalizeName(u));
const { data: mappings } = await supabase
  .from('underlying_mappings')
  .select('underlying, ticker')
  .in('underlying', normalizedUnderlyings);

// Mappare i risultati ai nomi originali
const underlyingToTicker: Record<string, string> = {};
for (const original of uniqueUnderlyings) {
  const normalized = normalizeName(original);
  const mapping = mappings?.find(m => m.underlying === normalized);
  if (mapping) {
    underlyingToTicker[original] = mapping.ticker; // Usa chiave originale
  }
}
```

### Parte 2: Aggiungere Policy RLS per Salvataggio

```sql
CREATE POLICY "Authenticated users can upsert underlying mappings"
  ON public.underlying_mappings
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
```

---

## File da Modificare

| File | Modifica |
|------|----------|
| `src/hooks/useUnderlyingPrices.ts` | Aggiungere normalizzazione nomi prima della query |
| Database (migrazione) | Aggiungere policy RLS INSERT/UPDATE |

---

## Flusso Corretto Dopo le Modifiche

```text
1. Portafoglio contiene: "ADOBE INC"
2. Hook normalizza: "ADOBE INC" → "ADOBE"
3. Query cerca: WHERE underlying IN ('ADOBE')
4. Trova mapping: ADOBE → ADBE
5. Restituisce con chiave originale: { "ADOBE INC": { ticker: "ADBE", ... } }
```

---

## Risultato Atteso

- I ticker saranno risolti correttamente anche quando i nomi nel portafoglio hanno suffissi (INC, CORP, etc.)
- Gli utenti potranno salvare mapping manuali dal dialog "Gestione Avvisi"
- La cache dei mapping sarà consistente tra frontend e backend

