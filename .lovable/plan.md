

## Aggiungere colonna Scadenza nella tabella operazioni del calcolatore premi

### Problema

Nella tabella "Operazioni" del dialog premi Covered Call, non e' visibile la scadenza dell'opzione. L'utente deve dedurla manualmente dal simbolo (es. `BABAH6C165` = Agosto 2026).

### Soluzione

Estrarre mese e anno di scadenza dal simbolo dell'opzione e mostrarlo in una colonna dedicata con formato compatto `MMM/YY` (es. "Aug/26"), coerente con il formato gia' usato nel resto dell'app per le scadenze derivati.

### Dettaglio tecnico

**1. `src/lib/orderFileParser.ts`**

Aggiungere una funzione `extractExpiryFromSymbol(symbol: string): string | null` che:
- Analizza il simbolo con pattern `TICKER + MESE(lettera) + ANNO(cifra) + TIPO + STRIKE`
- Mappa la lettera del mese: A=Jan, B=Feb, C=Mar, D=Apr, E=May, F=Jun, G=Jul, H=Aug, I=Sep, J=Oct, K=Nov, L=Dec
- Restituisce la scadenza in formato `MMM/YY` (es. "Aug/26") o `null` se non riconosciuto

**2. `src/components/derivatives/CallPremiumCalculatorDialog.tsx`**

- Importare `extractExpiryFromSymbol`
- Aggiungere una colonna "Scad." nell'header della tabella operazioni (tra "Simbolo" e "Qta'")
- Mostrare il valore estratto nella cella corrispondente con stile `text-xs text-muted-foreground`

### File da modificare

| File | Modifica |
|---|---|
| `src/lib/orderFileParser.ts` | Nuova funzione `extractExpiryFromSymbol` |
| `src/components/derivatives/CallPremiumCalculatorDialog.tsx` | Colonna "Scad." nella tabella operazioni |
