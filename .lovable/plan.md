## Problema
Quando si archivia un sottostante nel wizard di configurazione strategie, la "Call da rivendere" continua a mostrare lo stock. Il filtro in `monitoringEngine.computeAvailableCalls` non riesce ad agganciare l'archivio perché:

- **Wizard** salva `archived_underlyings.underlying_key` usando `getCanonicalKey(...) || normalizeForMatching(...)` calcolato sul testo del sottostante derivato (es. `"AAPL"` come canonical, oppure `"APPLEINC"` come fallback normalizzato).
- **monitoringEngine** indicizza le azioni con `resolveStockKey` che restituisce il ticker risolto via `underlyingPrices` (es. `"AAPL"`). Il confronto attuale `resolveKey(archivedKey)` + `normalizeForMatching(archivedKey)` spesso non combacia con quel ticker.

## Modifica

**File:** `src/lib/monitoringEngine.ts` — funzione `computeAvailableCalls` (e helper privato).

1. Aggiungere un piccolo helper `computeWizardStockKey(stock: Position)` che replica esattamente la logica del wizard per gli stock:
   - Prova `getCanonicalKey(\`${description} ${ticker}\`)`.
   - Fallback a `getCanonicalKey(description)`.
   - Fallback finale a `normalizeForMatching(\`${description} ${ticker}\`)`.

2. In `computeAvailableCalls`:
   - Costruire `archivedSet = new Set(archivedKeys.map(k => k.trim().toUpperCase()))`.
   - Per ogni `stock`, oltre alle chiavi già usate, calcolare anche `wizardKey = computeWizardStockKey(stock).toUpperCase()` e `getCanonicalKey(stock.description)?.toUpperCase()`.
   - Saltare lo stock se **una qualsiasi** di queste forme è presente in `archivedSet`, oltre ai controlli esistenti (`archivedResolved.has(key) | normalizeForMatching(key) | normalizeForMatching(displayTicker)`).

3. Niente cambi a schema DB, hook, o altre sezioni della monitoring card: l'esistente passaggio di `archivedKeys` da `Derivatives.tsx` → `DerivativesSummaryCard` → `computeMonitoring` resta invariato.

## Verifica
- Build TS pulita.
- Quick manual check: archiviare un ticker con stock posseduto → la riga sparisce immediatamente da "Call da rivendere" nella card Posizioni da monitorare; ripristinandolo, torna a comparire.