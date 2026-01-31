
# Piano: Riconoscimento ADR e Alias per Matching Opzioni

## Problema Identificato

Dopo aver analizzato il database, ho trovato due casi distinti:

### Caso 1: NETEASE
| Tipo | Descrizione |
|------|-------------|
| Azione | `AZ.NETEASE INC-ADR` |
| Opzione underlying | `NETEASE INC` |

Il suffisso `-ADR` non viene rimosso durante la normalizzazione, quindi il matching fallisce.

### Caso 2: PINDUODUO
| Tipo | Descrizione |
|------|-------------|
| Azione | `AZ.PDD HOLDINGS INC` |
| Opzione underlying | `PINDUODUO INC` |

Sono la stessa società (Pinduoduo ha fatto rebranding in PDD Holdings nel 2023), ma hanno nomi completamente diversi.

---

## Soluzione Proposta

### Modifica 1: Rimuovere suffisso `-ADR` nella normalizzazione

**File**: `src/lib/derivativeStrategies.ts`
**Funzione**: `normalizeForMatching` (riga 594-603)

Aggiungere la rimozione del suffisso `-ADR` nella regex dei suffissi comuni:

```typescript
function normalizeForMatching(text: string): string {
  return text
    .toUpperCase()
    .replace(/^AZ\./i, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    // Aggiunto: ADR ai suffissi da rimuovere
    .replace(/\b(INC|CORP|CORPORATION|LTD|LIMITED|CLASS\s*[A-Z]?|COMMON|STOCK|DEL|OHIO|CA|THE|ADR)\b/gi, '')
    .trim();
}
```

Questo risolverà automaticamente:
- `NETEASE INC-ADR` → `NETEASE`
- `NETEASE INC` → `NETEASE`
- Qualsiasi altro ADR con lo stesso pattern

### Modifica 2: Aggiungere alias PINDUODUO ↔ PDD HOLDINGS

**File**: `src/lib/derivativeStrategies.ts`
**Costante**: `SPECIAL_ALIASES` (riga 587-589)

Aggiungere l'equivalenza esplicita:

```typescript
const SPECIAL_ALIASES: Record<string, string[]> = {
  ALPHABET: ['GOOGL', 'GOOG', 'GOOGLE', 'ALPHABET', 'ALPHABET INC', 'ALPHABET CLASS'],
  PDD: ['PDD', 'PINDUODUO', 'PDD HOLDINGS', 'PINDUODUO INC', 'PDD HOLDINGS INC'],
};
```

---

## Risultato Atteso

| Opzione | Azione | Match Attuale | Match Nuovo |
|---------|--------|---------------|-------------|
| NETEASE INC OPTION CALL 145 | AZ.NETEASE INC-ADR | ❌ No | ✅ Sì |
| PINDUODUO INC OPTION CALL 110 | AZ.PDD HOLDINGS INC | ❌ No | ✅ Sì |

Le opzioni verranno ora correttamente associate alle rispettive azioni, permettendo:
- Classificazione come Covered Call (se vendute)
- Classificazione come Protezione (se PUT comprate)
- Visualizzazione corretta del prezzo sottostante (PS:...)

---

## Riepilogo Tecnico

| Elemento | Dettaglio |
|----------|-----------|
| File da modificare | `src/lib/derivativeStrategies.ts` |
| Righe interessate | 587-589 (SPECIAL_ALIASES), 594-603 (normalizeForMatching) |
| Tipo di modifica | Aggiunta suffisso ADR + nuovo alias PDD/PINDUODUO |
| Impatto | Matching automatico per tutti gli ADR e per Pinduoduo/PDD |

---

## Note Aggiuntive

Questa soluzione è estensibile: se in futuro ci fossero altri casi di rebranding (es. Facebook → Meta), basterà aggiungere una riga a `SPECIAL_ALIASES`.
