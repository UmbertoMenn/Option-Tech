

## Mascherare il numero di conto hardcoded e rimuovere il commento

### Cosa fare

**File: `src/components/dashboard/FileUploader.tsx`**

1. Sostituire il numero di conto completo `'0652278918440'` con una versione mascherata che contiene solo le 4 cifre centrali e l'ultima cifra: `'*****2789*****0'` → in pratica confrontare solo le posizioni 5-8 (4 cifre centrali) e l'ultima cifra del numero di conto proveniente dal file Excel.

2. Cambiare la logica di confronto: invece di `===` diretto, usare una funzione che verifica se le 4 cifre centrali e l'ultima cifra corrispondono al pattern parziale memorizzato.

3. Rimuovere il commento `// MauroG`.

### Implementazione

```typescript
// Pattern: { userId: [{ mid: '2789', last: '0' }] }
const EXCLUDED_CASH_PATTERNS: Record<string, { mid: string; last: string }[]> = {
  '7515bcc7-11b3-42c0-927d-4b2526f3a2b4': [{ mid: '2789', last: '0' }],
};

function matchesExcludedAccount(accountId: string, patterns: { mid: string; last: string }[]): boolean {
  return patterns.some(p => {
    const midStart = Math.floor((accountId.length - p.mid.length) / 2);
    const mid = accountId.slice(midStart, midStart + p.mid.length);
    return mid === p.mid && accountId.endsWith(p.last);
  });
}
```

Nel parsing della liquidità, il filtro `excludedCashAccounts.includes(accountId)` diventa `matchesExcludedAccount(accountId, patterns)`.

### File modificati
- `src/components/dashboard/FileUploader.tsx` — pattern parziale + rimozione commento
- `src/lib/excelParser.ts` — adattare il filtro per accettare pattern invece di ID completi (se il confronto avviene lì)

