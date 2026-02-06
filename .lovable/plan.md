

# Piano: Fix Ticker Resolution + Integrazione UI Notifiche

## ✅ COMPLETATO

### Problema 1: Ticker non trovati - RISOLTO
Il frontend in `useUnderlyingPrices.ts` normalizzava i nomi prima della query, ma il DB conteneva nomi non normalizzati.

**Soluzione implementata**: Ricerca a due step:
1. Prima query con nomi originali (match esatto)
2. Fallback con normalizzazione locale per matching flessibile

### Problema 2: UI Notifiche mancante - RISOLTO
Il componente `NotificationSettings` esisteva ma non era integrato.

**Soluzione implementata**: Aggiunto quinto Tab "Notifiche" in `AlertSettingsDialog.tsx`.

---

## File Modificati

| File | Modifica |
|------|----------|
| `src/hooks/useUnderlyingPrices.ts` | Logica lookup dual-pass (originale + normalizzato) |
| `src/components/derivatives/AlertSettingsDialog.tsx` | Import + Tab "Notifiche" con `NotificationSettings` |

