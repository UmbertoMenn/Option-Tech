

## Due fix: notifiche admin sempre attive + chiavi strategia stabili

### Fix 1: Admin riceve SEMPRE le notifiche di tutti gli utenti

**Problema**: L'admin riceve le copie delle notifiche degli utenti solo se i **propri** toggle (email/telegram) sono attivi. Se l'admin disattiva il toggle Telegram, non riceve piu nessuna copia Telegram degli avvisi degli altri utenti.

**Richiesta**: L'admin deve ricevere SEMPRE email e Telegram per gli avvisi di TUTTI gli utenti, indipendentemente dai propri toggle. I toggle dell'admin controllano solo le notifiche dei propri avvisi personali.

**File: `supabase/functions/send-notification/index.ts`**

Nella sezione admin (righe 370-392), rimuovere le condizioni sui toggle:

```
// DA (riga 371):
if (admin.notify_email && admin.email) {

// A:
if (admin.email) {

// DA (riga 382):
if (admin.notify_telegram && admin.telegram_chat_id) {

// A:
if (admin.telegram_chat_id) {
```

Inoltre va corretto un bug presente: `priceLabel` e dichiarato due volte (righe duplicate) sia in `sendEmail` che in `sendTelegram`. Verra rimossa la duplicazione.

---

### Fix 2: Chiavi strategia stabili dopo upload Excel

**Problema**: Le `strategy_key` nella cache usano gli UUID delle posizioni (es. `cc_07b5c724-...`). Quando si carica un nuovo Excel, tutte le posizioni vengono ricreate con nuovi UUID, quindi le chiavi cambiano e gli `alert_states` esistenti non corrispondono piu -- il sistema re-invia tutte le notifiche.

**Soluzione**: Generare chiavi deterministiche basate su caratteristiche stabili della posizione:

| Strategia | Chiave attuale | Chiave nuova |
|---|---|---|
| Covered Call | `cc_{uuid}` | `cc_{underlying}_{strike}_{YYYYMM}` |
| Naked Put | `np_{uuid}` | `np_{underlying}_{strike}_{YYYYMM}` |
| Iron Condor | `ic_{uuid1}_{uuid2}` | `ic_{underlying}_{putStrike}_{callStrike}_{YYYYMM}` |
| Double Diagonal | `dd_{uuid1}_{uuid2}` | `dd_{underlying}_{putStrike}_{callStrike}_{YYYYMM}` |
| LEAP Call | `leap_{uuid}` | `leap_{underlying}_{strike}_{YYYYMM}` |
| Altre Strategie | `other_{uuids}` | `other_{underlying}_{sortedStrikes}_{YYYYMM}` |

**File: `src/lib/strategyCache.ts`**

Aggiungere una funzione helper per formattare l'expiry:
```typescript
function formatExpiryKey(expiry: string | null | undefined): string {
  if (!expiry) return 'noexp';
  const d = new Date(expiry);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}
```

Modificare ogni `strategy_key`:
- Riga 74: `cc_${cc.option.id}` diventa `cc_${underlying}_${cc.option.strike_price || 0}_${formatExpiryKey(cc.option.expiry_date)}`
- Riga 96: `np_${np.option.id}` diventa `np_${underlying}_${np.option.strike_price || 0}_${formatExpiryKey(np.option.expiry_date)}`
- Riga 117: `ic_${ic.soldPut.id}_${ic.soldCall.id}` diventa `ic_${ic.underlying}_${ic.soldPut.strike_price || 0}_${ic.soldCall.strike_price || 0}_${formatExpiryKey(ic.soldCall.expiry_date)}`
- Riga 137: `dd_${dd.soldPut.id}_${dd.soldCall.id}` diventa `dd_${dd.underlying}_${dd.soldPut.strike_price || 0}_${dd.soldCall.strike_price || 0}_${formatExpiryKey(dd.soldCall.expiry_date)}`
- Riga 160: `leap_${lc.option.id}` diventa `leap_${underlying}_${lc.option.strike_price || 0}_${formatExpiryKey(lc.option.expiry_date)}`
- Riga 229: `other_${positionIds.sort().join('_')}` diventa `other_${gs.underlying}_${[soldPutStrike, soldCallStrike].filter(Boolean).sort().join('_')}_${formatExpiryKey(soldCallExpiry || soldPutExpiry)}`

Dopo il deploy sara necessario un reset una tantum degli alert states (il sistema si ri-allinea al primo ciclo di check-alerts).

### File coinvolti
1. `supabase/functions/send-notification/index.ts` -- condizioni admin + fix doppia dichiarazione priceLabel
2. `src/lib/strategyCache.ts` -- chiavi deterministiche

