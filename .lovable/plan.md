

## Fix classificazione per configurazione + splitting azioni in slot da 100

### Problema 1: Accenture e altre posizioni non rispettano la configurazione salvata

**Root cause**: In Step 0.5, il matching tra `config.underlying` e `d.underlying` usa `normalizeForMatching` su entrambi i lati. Se il wizard salva l'underlying come (ad esempio) `"ACCENTURE PLC"` ma la posizione ha `underlying: "ACCENTURE"` (o viceversa), dopo la normalizzazione (che rimuove "PLC") dovrebbero matchare. Tuttavia, ci sono due problemi:

1. Il wizard salva `underlying` dal primo derivativo nel gruppo (`strategy.positions.find(p => p.asset_type === 'derivative')?.underlying`). Se un derivativo ha `underlying: null` e usa `.description` come fallback, la normalizzazione potrebbe divergere.

2. **Bug critico**: nel case `derisking_covered_call` con `is_synthetic`, se ci sono 2 sold puts (una deep ITM sintetica e una regolare), `remaining.find(d => d.option_type === 'put' && d.quantity < 0)` prende la prima a caso — potrebbe prendere quella sbagliata. Inoltre, se non ci sono bought puts (perché la configurazione non prevedeva protezione), la call finisce in `syntheticCoveredCalls` ma se `is_synthetic` non è correttamente salvato/letto, finisce in `coveredCalls` standard.

**Fix**: Rendere Step 0.5 robusto — tutte le posizioni di un underlying con config salvata DEVONO finire nella categoria configurata, senza eccezioni.

#### Modifiche in `src/lib/derivativeStrategies.ts` — Step 0.5:

- **Logica `derisking_covered_call` con `is_synthetic`**: selezionare la sold PUT sintetica come quella con lo strike più basso (deep ITM = strike molto basso per una PUT venduta). Se ci sono bought puts → `deRiskingCoveredCalls`. Se non ce ne sono → `syntheticCoveredCalls`. 
- **Fallback**: qualunque posizione rimasta per quell'underlying viene aggiunta come gamba aggiuntiva nella stessa strategia, NON in "altre strategie".
- Aggiungere log di debug per tracciare ogni step del matching.

### Problema 2: Splitting azioni in slot da 100

L'utente vuole poter assegnare 100 azioni Apple a una strategia e 100 a un'altra. Attualmente il pool mostra "APPLE (200 azioni)" come singola voce.

#### Modifiche in `src/components/derivatives/StrategyConfigWizard.tsx`:

**A. Generazione slot virtuali nel pool**

Nel `useMemo` che calcola `allAvailable`, per ogni posizione stock/ETF con `quantity >= 200`, generare slot virtuali da 100 azioni ciascuno:

```typescript
// Per ogni stock con qty >= 200, creare slot da 100
const virtualPositions: Position[] = [];
for (const stock of stocks) {
  if (stock.quantity >= 200) {
    const slots = Math.floor(stock.quantity / 100);
    for (let i = 0; i < slots; i++) {
      virtualPositions.push({
        ...stock,
        id: `${stock.id}__slot_${i}`,  // ID virtuale
        quantity: 100,
      });
    }
    // Slot per il resto (se qty non è multiplo di 100)
    const remainder = stock.quantity % 100;
    if (remainder > 0) {
      virtualPositions.push({
        ...stock,
        id: `${stock.id}__slot_${slots}`,
        quantity: remainder,
      });
    }
  } else {
    virtualPositions.push(stock);
  }
}
```

**B. Label slot**: `positionLabel` mostrerà "APPLE (100 azioni) [1/2]", "APPLE (100 azioni) [2/2]"

**C. Salvataggio**: in `handleSave`, quando si cerca `linked_stock_id`, usare l'ID originale (rimuovendo il suffisso `__slot_N`) e salvarlo. Il campo `linked_stock_id` punterà sempre alla posizione reale.

**D. Impatto su categorizzazione**: Nessuna modifica necessaria in `derivativeStrategies.ts` perché il `linked_stock_id` punta già allo stock reale. La differenza è solo nella configurazione: l'utente può ora assegnare sottoinsiemi di azioni a strategie diverse.

### File da modificare

1. `src/lib/derivativeStrategies.ts` — Fix Step 0.5 per rispettare rigorosamente la configurazione salvata
2. `src/components/derivatives/StrategyConfigWizard.tsx` — Splitting azioni in slot da 100, label aggiornate, fix salvataggio

