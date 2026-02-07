

## Fix Bug Critico: check-alerts Edge Function

### Problema Identificato
Nella Edge Function `check-alerts` (linea 204), il codice filtra le posizioni con:
```typescript
const optionPositions = (positions || []).filter(p => p.asset_type === 'option');
```

Ma nel database, le opzioni sono memorizzate con `asset_type = 'derivative'`. 

**Risultato**: Zero opzioni vengono monitorate → Zero avvisi generati.

---

### Soluzione
Modifica singola alla linea 204 di `supabase/functions/check-alerts/index.ts`:

**Da:**
```typescript
const optionPositions = (positions || []).filter(p => p.asset_type === 'option');
```

**A:**
```typescript
const optionPositions = (positions || []).filter(p => p.asset_type === 'derivative');
```

---

### Impatto
Dopo il fix:
- Gli avvisi di distanza (Covered Call, Naked Put) funzioneranno
- Gli avvisi di stato ITM funzioneranno  
- Gli avvisi LEAP gain funzioneranno
- Le notifiche Email e Telegram verranno inviate correttamente

---

### File Modificato
`supabase/functions/check-alerts/index.ts` - Linea 204

