
# Piano: Supporto Versamenti e Prelievi

## Obiettivo
Modificare la sezione "Versamenti" per supportare esplicitamente sia versamenti (importi positivi) che prelievi (importi negativi), migliorando l'UX e le etichette.

## Analisi Impatto

### Cosa GIÀ funziona
La logica attuale supporta già importi negativi:
- `parseValue()` in `DepositsSection.tsx` gestisce numeri negativi
- `totalDeposits = reduce((sum, d) => sum + d.amount, 0)` somma correttamente positivi e negativi
- I calcoli in `StatsCards.tsx`, `PerformanceEvolutionChart.tsx` e `YearlyReturnChart.tsx` usano la somma dei depositi senza distinzione di segno

### Cosa va modificato
Solo le etichette UI e l'esperienza utente del form.

## Modifiche Tecniche

### 1. File: `src/components/dashboard/DepositsSection.tsx`

**Modifiche etichette:**
- Titolo sezione: `"Versamenti"` → `"Versamenti e prelievi"`
- Etichetta salvati: `"Versamenti salvati"` → `"Movimenti salvati"`
- Titolo modifica: `"Modifica versamento"` → `"Modifica movimento"`
- Titolo nuovo: `"Nuovo versamento"` → `"Nuovo movimento"`
- Bottone: `"Aggiungi versamento"` → `"+ Aggiungi movimento"`

**Miglioramento form input:**
- Aggiungere pulsanti rapidi per selezionare il tipo di movimento (Versamento/Prelievo)
- Se l'utente seleziona "Prelievo", il segno viene gestito automaticamente
- Placeholder aggiornato: `"es. 5.000"` (il segno è determinato dal tipo selezionato)

**Visualizzazione lista:**
- Già mostra `+` per positivi e nessun prefisso per negativi, i negativi hanno già il `-`
- Colore già differenziato: verde per positivi, rosso per negativi

### 2. File: `src/hooks/useDeposits.ts`

**Modifiche messaggi toast:**
- `"Versamento salvato!"` → `"Movimento salvato!"`
- `"Versamento eliminato"` → `"Movimento eliminato"`

### 3. File: `src/components/dashboard/StatsCards.tsx`

**Modifiche etichette:**
- Il subtext della giacenza media mostra `"Versamenti: €X"` → Modificare in `"Movimenti: €X"` per essere più generico
- Oppure se negativo mostrare `"Prelievi netti: €X"` e se positivo `"Versamenti netti: €X"`

## Struttura UI Aggiornata del Form

```text
┌─────────────────────────────────────────┐
│ Nuovo movimento                         │
├─────────────────────────────────────────┤
│ Tipo movimento:                         │
│ ┌─────────────┐  ┌─────────────┐        │
│ │ Versamento  │  │  Prelievo   │        │
│ │    (+)      │  │    (-)      │        │
│ └─────────────┘  └─────────────┘        │
├─────────────────────────────────────────┤
│ Data: [date picker]                     │
├─────────────────────────────────────────┤
│ Importo (€): [input numerico]           │
├─────────────────────────────────────────┤
│ Descrizione: [input opzionale]          │
├─────────────────────────────────────────┤
│ [Annulla]  [Salva]                      │
└─────────────────────────────────────────┘
```

## Logica Tipo Movimento

Nuovo stato nel form:
```typescript
const [movementType, setMovementType] = useState<'deposit' | 'withdrawal'>('deposit');
```

Al salvataggio:
```typescript
const handleSave = () => {
  const absAmount = Math.abs(parseValue(formAmount));
  const finalAmount = movementType === 'withdrawal' ? -absAmount : absAmount;
  // ...save con finalAmount
};
```

In modifica, determinare il tipo dal segno:
```typescript
const startEdit = (entry: DepositEntry) => {
  setMovementType(entry.amount >= 0 ? 'deposit' : 'withdrawal');
  setFormAmount(Math.abs(entry.amount).toString());
  // ...
};
```

## File da Modificare

| File | Modifiche |
|------|-----------|
| `src/components/dashboard/DepositsSection.tsx` | Etichette + pulsanti tipo movimento + logica segno |
| `src/hooks/useDeposits.ts` | Messaggi toast |
| `src/components/dashboard/StatsCards.tsx` | Subtext giacenza media |

## Vantaggi

1. **UX migliorata**: L'utente non deve ricordarsi di inserire il segno negativo
2. **Chiarezza**: Distinzione visiva tra versamenti e prelievi
3. **Retrocompatibilità**: I dati esistenti continuano a funzionare
4. **Nessuna modifica database**: Il campo `amount` può già essere negativo
