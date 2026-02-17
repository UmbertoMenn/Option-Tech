

## Fix strutturale: Netting mancante per Naked Put senza sottostante in portafoglio

### Problema identificato

Il bug e' strutturale e riguarda **tutti i naked put il cui sottostante non e' presente come azione nel portafoglio** (AMD, CoreWeave, UnitedHealth, Alibaba, Constellation Energy per MatteoC). Solo Progressive funziona perche' ha 100 azioni PGR in portafoglio.

**Causa radice**: il hook `useDerivativeNetting` determina se una naked put e' ITM o OTM usando `nakedPut.underlying?.snapshot_price`, dove `underlying` e' lo stock in portafoglio. Quando lo stock non esiste (underlying = null), il prezzo e' 0 e succedono due cose:

1. **Nel calcolo base** (righe 147-150): la posizione finisce nella categoria `np_itm` per fallback, anche se potrebbe essere OTM. Questo significa che non esiste mai la categoria `np_otm` per queste posizioni, rispondendo alla domanda "perche' nel netting totale non c'e' il costo riacquisto PUT OTM".

2. **In `getBreakdownForViewMode`** per "Netting ex CC e NP" (righe 290-303): il sistema ricalcola il valore intrinseco, ma siccome `underlyingPrice = 0`, la condizione `underlyingPrice > 0 && strike >= underlyingPrice` e' falsa, e la posizione viene **silenziosamente rimossa** dal breakdown. Solo Progressive sopravvive perche' ha lo stock (snapshot_price = 204.53).

### Soluzione

Il netting hook non ha accesso ai prezzi dei sottostanti dalla tabella `underlying_prices` (usata solo dalla pagina Strategie Derivati). Bisogna fornire questi prezzi al sistema di netting.

### Modifiche

#### 1. `src/components/dashboard/Dashboard.tsx`

- Importare e chiamare `useUnderlyingPrices` con la lista di underlyings dei derivati
- Passare i prezzi al hook `useDerivativeNetting` e a `DynamicPortfolioChart`

```typescript
// Estrarre gli underlyings dai derivati
const derivativeUnderlyings = useMemo(() => 
  positions.filter(p => p.asset_type === 'derivative')
    .map(p => p.underlying || p.description)
    .filter(Boolean),
  [positions]
);
const { prices: underlyingPrices } = useUnderlyingPrices(derivativeUnderlyings);

const netting = useDerivativeNetting(positions, summary, overrides, underlyingPrices);
```

#### 2. `src/hooks/useDerivativeNetting.ts` -- `useDerivativeNetting`

- Aggiungere parametro opzionale `underlyingPrices?: Record<string, {price: number}>`
- Nel loop dei derivati (riga 130), quando `nakedPut.underlying` e' null, cercare il prezzo in `underlyingPrices` usando la chiave dell'underlying del derivato
- Determinare correttamente ITM vs OTM usando il prezzo reale del sottostante
- Risultato: le naked put finiranno nella categoria corretta (`np_itm` o `np_otm`)

```typescript
} else if (nakedPut) {
  const strikePrice = derivative.strike_price ?? 0;
  // Usa il prezzo dello stock se disponibile, altrimenti cerca in underlyingPrices
  let underlyingPrice = nakedPut.underlying?.snapshot_price ?? nakedPut.underlying?.current_price ?? 0;
  if (underlyingPrice <= 0 && underlyingPrices) {
    const key = derivative.underlying || derivative.description || '';
    underlyingPrice = underlyingPrices[key]?.price ?? 0;
  }
  // ... resto della logica ITM/OTM (invariata)
}
```

#### 3. `src/hooks/useDerivativeNetting.ts` -- `getBreakdownForViewMode`

- Aggiungere parametro `underlyingPrices?: Record<string, {price: number}>`
- Nel blocco `np_itm` (riga 284-316), quando `npEntry.underlying` e' null, cercare il prezzo in `underlyingPrices`
- Stesso approccio per la determinazione del valore intrinseco

```typescript
// Per ogni naked put ITM
const strike = npEntry.option.strike_price ?? 0;
let underlyingPrice = npEntry.underlying?.snapshot_price ?? npEntry.underlying?.current_price ?? 0;
if (underlyingPrice <= 0 && underlyingPrices) {
  const key = npEntry.option.underlying || npEntry.option.description || '';
  underlyingPrice = underlyingPrices[key]?.price ?? 0;
}
if (underlyingPrice > 0 && strike >= underlyingPrice) {
  // Calcola intrinseco normalmente
}
```

#### 4. `src/components/dashboard/DynamicPortfolioChart.tsx`

- Accettare il nuovo prop `underlyingPrices` e passarlo a `getBreakdownForViewMode`

```typescript
const { items: breakdownItems, finalValue } = useMemo(() => {
  if (viewMode === 'base' || !summary) return { items: [], finalValue: 0 };
  return getBreakdownForViewMode(
    netting.breakdown,
    viewMode as ...,
    positions,
    summary,
    overrides,
    underlyingPrices, // nuovo parametro
  );
}, [viewMode, netting.breakdown, positions, summary, overrides, underlyingPrices]);
```

### Risultato atteso

Con i dati attuali di MatteoC e i prezzi sottostanti dalla tabella `underlying_prices`:

| Sottostante | Strike | Prezzo Sottostante | Stato | Categoria |
|---|---|---|---|---|
| AMD | 240 | 207.32 | OTM | np_otm |
| Alibaba | 155 | 155.73 | OTM | np_otm |
| Constellation | 280 | 288.43 | OTM | np_otm |
| CoreWeave 85 | 85 | 96.04 | OTM | np_otm |
| CoreWeave 125 | 125 | 96.04 | ITM | np_itm |
| Progressive | 220 | 204.53 | ITM | np_itm |
| UNH 320 | 320 | 293.19 | ITM | np_itm |
| UNH 430 | 430 | 293.19 | ITM | np_itm |

- **Netting Totale**: mostra sia `np_itm` che `np_otm` come categorie separate
- **Netting ex CC e NP**: mostra `np_itm (intrinseco)` per CoreWeave 125, Progressive, UNH 320 e UNH 430 con il valore intrinseco calcolato; le OTM sono escluse

### Nota sulla data policy

La Dashboard usa normalmente i valori snapshot per coerenza con i report. Per i sottostanti senza azioni in portafoglio, non esiste nessun valore snapshot disponibile. L'unica fonte possibile e' la tabella `underlying_prices` (aggiornata dal cron). Questo e' l'approccio gia' usato dalla pagina Strategie Derivati.

### File modificati

| File | Modifica |
|---|---|
| `src/hooks/useDerivativeNetting.ts` | Aggiungere parametro `underlyingPrices` a `useDerivativeNetting` e `getBreakdownForViewMode`; usarlo come fallback per il prezzo sottostante |
| `src/components/dashboard/Dashboard.tsx` | Importare `useUnderlyingPrices`, estrarre underlyings dai derivati, passare prezzi al netting e al chart |
| `src/components/dashboard/DynamicPortfolioChart.tsx` | Accettare e propagare `underlyingPrices` a `getBreakdownForViewMode` |

