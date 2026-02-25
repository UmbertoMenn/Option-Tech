

## Piano: Filtro direzione sugli avvisi di distanza

### Il problema

Scenario con Naked Put (strike = 100, soglia distanza = 2%):

```text
Prezzo  Stato ITM    Stato distanza   Cosa succede
─────── ──────────── ──────────────── ──────────────────────────
 105    safe         safe             Tutto ok
  95    → alerted    safe (reset)     Avviso ITM inviato ✓
  90    alerted      safe             Prezzo ancora giù
 101    → safe       safe             ITM si resetta a safe
                                      Distanza = 1% < 2%
                                      Stato dist = safe
                                      → AVVISO SPURIO: "si avvicina allo strike" ✗
```

Il prezzo sta **risalendo** (allontanandosi dal pericolo), ma l'avviso scatta lo stesso perché la state machine non sa da che direzione arriva il prezzo.

### La soluzione (zero modifiche allo schema)

La fix è puramente logica dentro la state machine esistente: **quando uno stato critico (ITM/OOR) passa da `alerted` → `safe`, pre-impostare lo stato di distanza corrispondente a `alerted`** invece che `safe`.

Questo significa che:
- L'avviso di distanza **non scatterà** durante il ritorno dal lato pericoloso
- Lo stato di distanza si resetterà a `safe` **solo quando il prezzo si allontana oltre la soglia** (cioè esce dalla zona di pericolo)
- Solo a quel punto, un **nuovo avvicinamento genuino** potrà generare un avviso

```text
Prezzo  Stato ITM    Stato distanza   Cosa succede (con fix)
─────── ──────────── ──────────────── ──────────────────────────
 105    safe         safe             Tutto ok
  95    → alerted    safe (reset)     Avviso ITM ✓
  90    alerted      safe             Ancora ITM
 101    → safe       → alerted (!)    ITM resettato; distanza PRE-SETTATA
                                      a "alerted" → NESSUN avviso spurio ✓
 104    safe         → safe           Prezzo oltre soglia, distanza resettata
  98    safe         → alerted        Genuino avvicinamento: avviso ✓
```

### Modifiche tecniche

**Unico file: `supabase/functions/check-alerts/index.ts`**

Ci sono 6 punti nel codice dove uno stato critico passa da `alerted` → `safe`. In ognuno di questi, aggiungo un upsert che imposta lo stato di distanza corrispondente a `alerted`:

1. **Covered Call ITM → safe** (riga ~496-500): pre-settare `cc_dist_` a `alerted`
2. **Naked Put ITM → safe** (riga ~607-611): pre-settare `np_dist_` a `alerted`
3. **Iron Condor OOR → safe** (riga ~722-726): pre-settare `ic_put_dist_` e `ic_call_dist_` a `alerted`
4. **Double Diagonal OOR → safe** (riga ~894-898): pre-settare `dd_put_dist_` e `dd_call_dist_` a `alerted`

Inoltre, **rimuovere** i blocchi che resettano la distanza a `safe` quando la posizione è ITM/OOR (righe ~548-558, ~659-669, ~774-784, ~831-841, e i corrispondenti per DD). Questi blocchi sono controproducenti: resettano lo stato di distanza a `safe` durante l'ITM, preparando il terreno per l'avviso spurio al ritorno.

### Esempio di codice per Naked Put

```typescript
// PRIMA (riga ~607-611):
} else if (!isITM && currentState?.current_state === 'alerted') {
  await supabase.from('alert_states')
    .update({ current_state: 'safe' })
    .eq('id', currentState.id);
}

// DOPO:
} else if (!isITM && currentState?.current_state === 'alerted') {
  // Reset ITM state to safe
  await supabase.from('alert_states')
    .update({ current_state: 'safe' })
    .eq('id', currentState.id);
  
  // Pre-set distance state to 'alerted' to suppress spurious alert
  // during recovery from ITM side
  const distPositionKey = `np_dist_${strategy.strategy_key}`;
  await supabase.from('alert_states').upsert({
    user_id: userId,
    portfolio_id: portfolioId,
    position_key: distPositionKey,
    alert_type: ALERT_TYPES.DISTANCE_NAKED_PUT,
    current_state: 'alerted',
    last_alerted_at: new Date().toISOString(),
  }, { onConflict: 'user_id,portfolio_id,position_key,alert_type' });
}
```

E **rimuovere** il blocco "Reset distance alert state to 'safe' when ITM":

```typescript
// RIMUOVERE (riga ~659-669):
} else if (isITM) {
  const distPositionKey = `np_dist_${strategy.strategy_key}`;
  // ... reset to safe ...
}
```

### Riepilogo

| Aspetto | Dettaglio |
|---------|-----------|
| File modificato | `supabase/functions/check-alerts/index.ts` |
| Schema DB | Nessuna modifica |
| Logica | Pre-set distanza a `alerted` al recovery da ITM/OOR |
| Strategia coperte | Covered Call, Naked Put, Iron Condor (PUT+CALL), Double Diagonal (PUT+CALL) |
| Effetto collaterale | L'avviso di distanza scatterà solo per avvicinamenti genuini dal lato sicuro |

