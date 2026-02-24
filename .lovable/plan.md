

## Conferma: la logica di esclusione protezioni è mantenuta

Sì, il piano mantiene integralmente la logica di esclusione protezioni definita precedentemente. La funzione `filterAndCalculatePutPremiums` già implementata in `src/lib/orderFileParser.ts` viene richiamata nel `onDrop` del dialog e applica:

1. **Simboli senza vendite** → esclusi (protezione pura comprata)
2. **Simboli con vendite ma scadenza anomala** (> 6 mesi oltre la mediana) → esclusi (protezione LEAP comprata e poi rivenduta)
3. **Tutti gli altri** (vendita sola, rolling sell→buy→sell) → inclusi come premi PUT legittimi

Questa funzione è già stata scritta e deployata nel messaggio precedente. Il nuovo piano la riutilizza tal quale dentro il `CallPremiumCalculatorDialog` — non la rimuove né la modifica. Il flusso è:

```text
Excel caricato
  │
  ├─ filterAndCalculateCallPremiums(orders, ticker, price) → callOrders
  │
  └─ filterAndCalculatePutPremiums(orders, ticker, referenceExpiry) → putOrders
       │
       ├─ buy-only PUT → ESCLUSE (protezioni)
       ├─ scadenza anomala → ESCLUSE (protezioni chiuse)
       └─ naked put / rolling → INCLUSE
```

Il toggle nel dialog decide solo se sommare `putOrders` (già filtrate) alle `callOrders` per il calcolo `net_per_share`. Le protezioni non arrivano mai a quel punto.

Nessuna modifica necessaria al piano — la logica è preservata.

