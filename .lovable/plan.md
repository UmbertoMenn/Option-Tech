
# Piano: Correzione Bug Rinomina Portfolio

## Problema Identificato

Quando l'admin rinomina un portfolio (suo o di un altro utente), il nome non si aggiorna nell'interfaccia.

### Causa Root

Nel `renameMutation.onSuccess` (riga 215-217), viene invalidata solo la query `['portfolios']`, ma **non** la query `['admin-view-portfolio', selectedId]`.

```typescript
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ['portfolios'] });  // ✅ Invalida portfolio propri
  // ❌ MANCA: invalidare 'admin-view-portfolio'
  toast.success('Portfolio rinominato');
},
```

Quando si visualizza il portfolio in admin mode, i dati vengono da `adminPortfolioQuery` che usa una query key diversa: `['admin-view-portfolio', selectedId]`. Questa cache non viene invalidata, quindi l'UI mostra il vecchio nome.

---

## Soluzione

Aggiungere l'invalidazione della query `admin-view-portfolio` nel callback `onSuccess` di `renameMutation`.

### Modifica in `src/contexts/PortfolioContext.tsx`

**Righe 215-218** - Aggiungere invalidazione:

```typescript
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ['portfolios'] });
  queryClient.invalidateQueries({ queryKey: ['admin-view-portfolio'] }); // NEW
  toast.success('Portfolio rinominato');
},
```

Usando solo `['admin-view-portfolio']` senza il selectedId, verranno invalidate TUTTE le query che iniziano con quella key, garantendo che qualsiasi portfolio visualizzato in admin mode venga aggiornato.

---

## File da Modificare

| File | Modifica |
|------|----------|
| `src/contexts/PortfolioContext.tsx` | Aggiungere `queryClient.invalidateQueries({ queryKey: ['admin-view-portfolio'] })` in `renameMutation.onSuccess` (riga 216) |

---

## Verifica Post-Fix

1. Login come admin
2. Andare nel selettore portfolio e hover su "Portfolio Principale"
3. Cliccare sull'icona matita per rinominare
4. Inserire un nuovo nome (es: "PTF Admin Rinominato")
5. Cliccare "Salva"
6. Verificare che il nome si aggiorni immediatamente nel selettore
