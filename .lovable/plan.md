

## Fix: Distanza minima strike in roll_up_positive + Continuita operazioni dopo roll_down

### Bug 1: Distanza minima strike mancante nel roll_up_positive

Nella configurazione "Rollo su scadenza successiva con strike piu alto, solo se la differenza e positiva", manca il campo per configurare la distanza minima del nuovo strike dal prezzo corrente del sottostante.

Attualmente `executeApproachRule` (riga 303) calcola il nuovo strike come `S * (1 + activationPct / 100)`, riusando la distanza di attivazione. Serve un campo dedicato.

**Modifiche:**

- **`src/lib/adjustmentRules.ts`**: aggiungere `rollUpMinDistancePct: number` a `ApproachRule`, default 5. Questo campo definisce la distanza minima % dal sottostante per il nuovo strike durante un roll up.
- **`src/components/simulator/AdjustmentRuleEditor.tsx`**: aggiungere input "Distanza min strike" dentro il blocco `roll_up_positive` (dopo i campi USD/%), identico a quelli gia presenti nel profit rule.
- **`src/lib/backtestEngine.ts`**: in `executeApproachRule`, usare `approachRule.rollUpMinDistancePct` al posto di `approachRule.activationPct` per calcolare `newStrike`:
  ```text
  const newStrike = roundStrike(S * (1 + approachRule.rollUpMinDistancePct / 100), strikeStep);
  ```
  Anche per `roll_up_always`, usare lo stesso campo cosi il nuovo strike rispetta sempre una distanza configurabile.

### Bug 2: Nessuna operazione dopo roll_down su stessa scadenza

Dopo un roll down sulla prima scadenza (stessa scadenza, strike piu basso), il motore non genera piu operazioni. Le cause sono:

1. **Nessun handler di scadenza per `wait_and_sell`**: nella profit rule, se `action === 'wait_and_sell'`, la funzione ritorna `null` con il commento "handled at expiry", ma alla scadenza NON c'e nessun codice che usa `profitRule.newCallBarrierPct`. Il leg scade e `sellNewCallAfterExpiry` usa una barriera hardcoded del 5%.

2. **`sellNewCallAfterExpiry` usa barriera hardcoded**: riga 391, `S * 1.05` e fisso. Dovrebbe usare una barriera configurata. Se il profit rule e `wait_and_sell`, usare `profitRule.newCallBarrierPct`. Se l'approach rule e `do_nothing`, usare `approachRule.newCallBarrierPct`. Altrimenti usare `approachRule.rollUpMinDistancePct`.

3. **Profit rule non riparte dopo roll_down**: dopo il roll_down sulla prima scadenza, la nuova leg ha lo stesso `expiryDate`. Il prezzo BS della nuova opzione (strike piu basso, piu vicino a ATM) e alto, quindi il `gainPct` parte da ~0% e potrebbe non raggiungere mai `profitPct` prima della scadenza. Alla scadenza, il leg scade correttamente e `sellNewCallAfterExpiry` si attiva. Ma se `findNextExpiry` non trova una scadenza successiva (dati troppo corti), la strategia si interrompe silenziosamente.

**Fix**: migliorare `sellNewCallAfterExpiry` per usare la barriera corretta in base alle regole configurate, e aggiungere log/handling se non ci sono scadenze disponibili. Inoltre, garantire che `allExpiries` venga calcolato con un margine di qualche mese oltre la fine dei dati per non perdere le ultime scadenze.

### Dettaglio tecnico

| File | Modifica |
|------|----------|
| `src/lib/adjustmentRules.ts` | Aggiungere `rollUpMinDistancePct: number` a `ApproachRule`, default 5 |
| `src/components/simulator/AdjustmentRuleEditor.tsx` | Aggiungere input "Distanza min strike" nel blocco `roll_up_positive` |
| `src/lib/backtestEngine.ts` | Usare `rollUpMinDistancePct` in `executeApproachRule`; fix `sellNewCallAfterExpiry` per usare barriera configurata; estendere `allExpiries` di 3 mesi oltre fine dati |

### Modifiche dettagliate

**adjustmentRules.ts**:
```text
export interface ApproachRule {
  ...
  rollUpMinDistancePct: number;  // NUOVO: distanza min % del nuovo strike dal prezzo
}

// default:
rollUpMinDistancePct: 5,
```

**backtestEngine.ts - executeApproachRule**:
```text
// PRIMA:
const newStrike = roundStrike(S * (1 + approachRule.activationPct / 100), strikeStep);
// DOPO:
const newStrike = roundStrike(S * (1 + approachRule.rollUpMinDistancePct / 100), strikeStep);
```

**backtestEngine.ts - sellNewCallAfterExpiry**:
```text
// PRIMA:
const newStrike = roundStrike(S * 1.05, ccRules.strikeStep);
// DOPO:
const barrierPct = ccRules.profitRule.action === 'wait_and_sell'
  ? ccRules.profitRule.newCallBarrierPct
  : ccRules.approachRule.rollUpMinDistancePct;
const newStrike = roundStrike(S * (1 + barrierPct / 100), ccRules.strikeStep);
```

**backtestEngine.ts - allExpiries range**:
```text
// PRIMA: calcola solo fino all'ultima barra
const allExpiries = getMonthlyExpiries(priceData[0].date, priceData[last].date);
// DOPO: estende di 3 mesi per garantire continuita
const endDate = new Date(priceData[last].date);
endDate.setMonth(endDate.getMonth() + 3);
const allExpiries = getMonthlyExpiries(priceData[0].date, formatDate(endDate));
```

**AdjustmentRuleEditor.tsx**: aggiungere campo dentro `roll_up_positive`:
```text
<div className="flex items-center gap-1">
  <Label>Distanza min strike</Label>
  <Input value={rules.approachRule.rollUpMinDistancePct} ... />
  <span>%</span>
</div>
```

