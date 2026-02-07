

# Piano: Correzione Calcoli e UI Calcolatrice Premi CALL

## Problemi Identificati

### 1. Bug Parsing Numeri
Guardando lo screenshot, il "Netto Unitario" mostra **1.124,50 $** che corrisponde a **1124.50 USD** (formato italiano). Questo valore e troppo alto - dovrebbe essere circa **13,13 $** per un contratto.

**Causa probabile**: I numeri vengono letti correttamente come decimali (es. "8,4" → 8.4), ma il problema e nell'HTML parsing. Alcuni valori potrebbero essere estratti senza la virgola, trasformando "8,4" in "84" invece di "8.4".

### 2. Rendimento Annualizzato = 0%
La funzione `calculatePremiumMetrics` ha questa condizione:
```typescript
if (parseResult.firstOperationDate && yieldPct > 0) {
  // calcola annualizzato
}
```
Se il rendimento e 0 o negativo (cosa impossibile con yield al 645%), il problema e probabilmente nella **data prima operazione** che non viene estratta correttamente.

**Causa probabile**: Le date nel file hanno formato `'DD/MM/YYYY` con apostrofo iniziale (es. `'12/11/2025`). La funzione `parseDateIT` non gestisce questo apostrofo.

### 3. Data Prima Operazione Nascosta
Attualmente la data e visibile solo nella sezione collassabile "Altri dati". L'utente vuole vederla subito sotto ai rendimenti.

---

## Soluzioni

### 1. Correzione Parser HTML (`src/lib/orderFileParser.ts`)

**A. Gestione apostrofi nelle date:**
```typescript
// Rimuovere apostrofi iniziali dai valori
let cellValue = cellMatch[1]
  .replace(/<[^>]*>/g, '')
  .replace(/^'+/, '')  // NUOVO: rimuove apostrofi iniziali
  .replace(/&nbsp;/g, ' ')
  // ...
```

**B. Verifica parsing numeri:**
Aggiungere log dettagliati per debug e assicurarsi che la funzione `parseNumber` gestisca correttamente i numeri con virgola estratti dall'HTML.

**C. Gestione date con apostrofo:**
```typescript
function parseDateIT(value: string): string | null {
  if (!value) return null;
  
  // Rimuovi apostrofi iniziali (comuni nei file Excel italiani)
  const cleaned = value.trim().replace(/^'+/, '');
  // ...
}
```

### 2. Calcolo Rendimento Annualizzato

**Rimuovere condizione `yieldPct > 0`:**
Il rendimento annualizzato deve essere calcolato sempre, anche se il yield e negativo.

```typescript
// PRIMA (bug)
if (parseResult.firstOperationDate && yieldPct > 0) {

// DOPO (corretto)
if (parseResult.firstOperationDate) {
```

### 3. UI - Mostrare Data Prima Operazione

Aggiungere la data sotto ai rendimenti nella sezione sempre visibile:

```text
+------------------------------------------+
|        NETTO UNITARIO                    |
|           13,13 $                        |
|     su 1 contratti (100 azioni)          |
+------------------------------------------+
|   Rendimento      |   Annualizzato       |
|    📊 +7,54%      |     📊 +31,23%       |
+------------------------------------------+
|     📅 Prima operazione: 12/11/2025      |  ← NUOVO
+------------------------------------------+
```

---

## Modifiche File

| File | Modifiche |
|------|-----------|
| `src/lib/orderFileParser.ts` | Gestione apostrofi, fix parsing numeri HTML, debug logging |
| `src/components/derivatives/CallPremiumCalculatorDialog.tsx` | Mostrare data prima operazione sotto i rendimenti |

---

## Dettaglio Tecnico: Parsing HTML

Il problema principale e nel metodo `parseHtmlTable`. Quando legge le celle, alcuni valori numerici con virgola potrebbero essere malformati.

**Debug aggiunto:**
```typescript
console.log('Raw cell value:', cellMatch[1]);
console.log('Cleaned cell value:', cellValue);
```

**Gestione numeri migliorata:**
```typescript
function parseNumber(value: any): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // Rimuovi whitespace e apostrofi
    let cleaned = value.replace(/\s/g, '').replace(/^'+/, '');
    
    // Log per debug
    console.log('parseNumber input:', value, '-> cleaned:', cleaned);
    
    // Italian format: . = thousands, , = decimal
    if (cleaned.includes('.') && cleaned.includes(',')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (cleaned.includes(',')) {
      cleaned = cleaned.replace(',', '.');
    }
    
    const result = parseFloat(cleaned) || 0;
    console.log('parseNumber result:', result);
    return result;
  }
  return 0;
}
```

---

## Verifica Attesa

Dopo le correzioni, con il file BABA:
- **Netto Unitario**: ~13,13 $ (non 1.124,50 $)
- **Rendimento**: ~7,5% (non 645%)
- **Annualizzato**: ~31% (non 0%)
- **Data visibile**: 12/11/2025 sotto i rendimenti

