

## Test briefing Telegram con parametro force

### Problema
La funzione `daily-briefing` ha un guard `isItalianNoon()` che blocca l'esecuzione fuori dalle 12:00 italiane. Per testare serve un modo per bypassarlo.

### Modifiche

**File: `supabase/functions/daily-briefing/index.ts`**

Aggiungere il supporto per un parametro `force` nel body della richiesta. Se `force === true`, il guard orario viene saltato:

```typescript
const body = await req.json().catch(() => ({}));
const force = body?.force === true;

if (!force && !isItalianNoon()) {
  return new Response(JSON.stringify({ skipped: true, reason: "not_italian_noon" }), ...);
}
```

Dopo il deploy, invocazione manuale con `{ "force": true }` per generare e inviare il briefing su Telegram immediatamente.

### Cosa cambia
- Aggiunta lettura parametro `force` dal body della richiesta
- Se `force = true`, il guard orario viene ignorato

### Cosa NON cambia
- Il cron job continua a funzionare normalmente (non invia body, quindi `force` e sempre `false`)
- Nessuna modifica alla logica di generazione del briefing

