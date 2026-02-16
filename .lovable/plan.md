

## Fix: la colonna "Scadenza" non viene trovata nel file Excel

### Problema

Il file Excel degli ordini ha la colonna chiamata **"Data Scadenza"** (non "Scadenza"). Il mapping attuale cerca solo `Scadenza`, `scadenza`, `SCADENZA` e quindi non trova mai la colonna -- risultato: tutti i valori restano `undefined` e la tabella mostra "---".

### Soluzione

Aggiungere le varianti "Data Scadenza" al mapping della colonna `expiryDate`.

### Dettaglio tecnico

**`src/lib/orderFileParser.ts`** -- linea 34

Sostituire:
```typescript
expiryDate: ['Scadenza', 'scadenza', 'SCADENZA'],
```

Con:
```typescript
expiryDate: ['Scadenza', 'scadenza', 'SCADENZA', 'Data Scadenza', 'data scadenza', 'DATA SCADENZA'],
```

Nessun'altra modifica necessaria. Il parser trovera' l'indice corretto e il valore verra' letto e mostrato nella colonna "Scad." della tabella operazioni.

### File da modificare

| File | Modifica |
|---|---|
| `src/lib/orderFileParser.ts` | Aggiungere varianti "Data Scadenza" nel mapping `expiryDate` |

