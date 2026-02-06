

# Piano: Aggiungere Indicatore Prezzo Non Aggiornato a Tutte le Strategie Derivati

## Obiettivo
Mostrare il triangolino rosso lampeggiante (`StalePriceIndicator`) accanto al Prezzo Sottostante (PS) in **tutte** le righe delle strategie derivati, non solo in alcune.

---

## Situazione Attuale

| Componente | Mostra PS | Ha StalePriceIndicator |
|------------|-----------|------------------------|
| `NakedPutRow` | Si | Si |
| `LeapCallRow` | Si | Si |
| `GroupedOtherStrategyRow` | Si | Si |
| `CoveredCallRow` | Si | **NO** |
| `LongPutRow` | Si | **NO** |
| `IronCondorRow` | No | **NO** |
| `DoubleDiagonalRow` | No | **NO** |
| `OtherStrategyRow` | Si | **NO** |

---

## Modifiche da Implementare

### 1. CoveredCallRow
- **Problema**: Usa il prezzo dal portafoglio (`underlying.current_price`) ma non ha accesso a `underlyingPrices` per controllare `isStale`
- **Soluzione**: 
  - Aggiungere `underlyingPrices` come prop
  - Aggiungere il controllo `isStale` usando `option.underlying` come chiave
  - Inserire `<StalePriceIndicator />` dopo il prezzo PS

### 2. LongPutRow
- **Problema**: Stessa situazione di CoveredCallRow
- **Soluzione**: 
  - Aggiungere `underlyingPrices` come prop
  - Aggiungere `<StalePriceIndicator />` quando `isStale` e true

### 3. IronCondorRow
- **Problema**: Ha gia `underlyingPrices` ma NON mostra il prezzo sottostante nella riga
- **Soluzione**: 
  - Aggiungere una colonna per mostrare PS con il prezzo e l'indicatore stale
  - Aggiornare il layout della griglia per includere la nuova colonna

### 4. DoubleDiagonalRow
- **Problema**: Come IronCondorRow, non mostra PS
- **Soluzione**: 
  - Aggiungere colonna PS con indicatore stale
  - Aggiornare layout griglia

### 5. OtherStrategyRow
- **Problema**: Non riceve `underlyingPrices` come prop
- **Soluzione**: 
  - Aggiungere `underlyingPrices` come prop
  - Aggiungere `<StalePriceIndicator />` 

---

## Dettaglio Tecnico

### Modifica Interface Props

```typescript
interface CoveredCallRowProps extends RowPropsWithPrices {  // Cambiato da RowProps
  coveredCall: CoveredCallPosition;
  totalContractsForUnderlying: number;
}
```

### Pattern di Implementazione (esempio per CoveredCallRow)

```tsx
// Ottenere info sulla freshness del prezzo
const priceData = option.underlying ? underlyingPrices[option.underlying] : null;
const isStale = priceData?.isStale ?? false;

// Nel render del PS (Col 7)
<div className="text-right flex items-center justify-end">
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="text-sm text-muted-foreground cursor-help truncate">
        PS: {formatCurrency(underlyingPrice, 'USD')}
      </span>
    </TooltipTrigger>
    <TooltipContent>
      <p>Prezzo Sottostante</p>
    </TooltipContent>
  </Tooltip>
  {isStale && <StalePriceIndicator />}
</div>
```

---

## File da Modificare

| File | Modifica |
|------|----------|
| `src/pages/Derivatives.tsx` | Aggiungere props e indicatori a 5 componenti |

---

## Riepilogo Modifiche per Componente

1. **CoveredCallRow**: + prop `underlyingPrices`, + indicatore stale
2. **LongPutRow**: + prop `underlyingPrices`, + indicatore stale
3. **IronCondorRow**: + colonna PS con prezzo e indicatore stale
4. **DoubleDiagonalRow**: + colonna PS con prezzo e indicatore stale
5. **OtherStrategyRow**: + prop `underlyingPrices`, + indicatore stale

Queste modifiche garantiranno una visualizzazione coerente dell'indicatore di prezzo non aggiornato su tutte le strategie derivati.

