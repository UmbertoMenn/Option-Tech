

## Fix: Delete dei premi Covered Call cancella tutti i record dello stesso ticker

### Problema identificato

Il database contiene **un solo record** per GOOGL (`C320_2026-04-21`), nonostante l'utente dichiari di avere salvato dati per entrambe le Covered Call. La causa piu' probabile e' nel metodo `deletePremium` in `useCoveredCallPremiums.ts`:

```typescript
// Riga 105 - BUG: cancella TUTTI i record con lo stesso ticker
.delete().eq('portfolio_id', portfolioId).eq('ticker', ticker.toUpperCase())
```

Quando l'utente clicca "Cancella dati" su una Covered Call GOOGL, il sistema cancella **tutti** i record GOOGL, non solo quello specifico (es. strike 320 Apr/26). Questo spiega perche' il secondo record non e' presente: e' stato cancellato dalla reset del primo, o viceversa.

### Soluzione

**File: `src/hooks/useCoveredCallPremiums.ts`**

1. Modificare `deleteMutation` per accettare sia `ticker` che `optionSymbol` e filtrare su entrambi:

```typescript
const deleteMutation = useMutation({
  mutationFn: async ({ ticker, optionSymbol }: { ticker: string; optionSymbol: string }) => {
    if (!portfolioId) throw new Error('No portfolio selected');
    const { error } = await supabase
      .from('covered_call_premiums')
      .delete()
      .eq('portfolio_id', portfolioId)
      .eq('ticker', ticker.toUpperCase())
      .eq('option_symbol', optionSymbol);
    if (error) throw error;
  },
  ...
});
```

2. Aggiornare il return per esporre il nuovo tipo:

```typescript
deletePremium: deleteMutation.mutateAsync,
// Firma cambia da (ticker: string) a ({ ticker, optionSymbol })
```

**File: `src/components/derivatives/CallPremiumCalculatorDialog.tsx`**

3. Aggiornare `handleReset` per passare anche `optionSymbol`:

```typescript
const handleReset = async () => {
  if (ticker && confirm('Cancellare tutti i dati salvati?')) {
    await deletePremium({ ticker, optionSymbol });
    // ...reset state
  }
};
```

### Impatto

- Il fix preserva i dati di ogni Covered Call individuale durante le operazioni di reset
- Nessun impatto su Iron Condor, Double Diagonal o Altre Strategie (usano `optionSymbol` distinti per tipo)
- L'utente dovra' ri-salvare i dati per la seconda Covered Call GOOGL dopo il fix

