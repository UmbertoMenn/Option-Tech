
# Piano: Correzioni Calcolatrice Premi CALL

## Problemi Identificati

### 1. Bug Parsing Numeri
Il file Excel ha formato italiano con virgole come separatori decimali (es. `8,4` = 8.40 USD). Il parser HTML attuale non gestisce correttamente questo formato, risultando in valori gonfiati (es. 8,4 diventa 84).

### 2. Dati Mancanti
- **Data prima operazione**: non viene estratta dal file (colonna "Data Validità")
- **Rendimento %**: non calcolato
- **Rendimento % annualizzato**: non calcolato

### 3. UI da Migliorare
- I dati sintetici piu importanti (Netto Unitario, Rendimento %) non sono in evidenza
- Troppi dati visibili subito, meglio una struttura gerarchica
- Manca la possibilita di rimuovere singole operazioni

---

## Soluzione

### 1. Correzione Parser (`src/lib/orderFileParser.ts`)

**Modifiche alla funzione `parseHtmlTable`:**
- Gestione corretta del formato italiano dei numeri (virgola come decimale)
- Estrazione della colonna "Data Validità" per ogni ordine

**Nuovi campi in `ParsedOrder`:**
```typescript
interface ParsedOrder {
  // campi esistenti...
  validityDate?: string; // Data Validita in formato DD/MM/YYYY
}
```

**Nuove metriche in `PremiumMetrics`:**
```typescript
interface PremiumMetrics {
  // campi esistenti...
  firstOperationDate: string | null;    // Data operazione piu vecchia
  yieldPct: number;                      // Rendimento % = netPerShare / underlyingPrice
  annualizedYieldPct: number;            // Rendimento annualizzato
}
```

### 2. Nuova Interfaccia Utente (`CallPremiumCalculatorDialog.tsx`)

**Layout dopo upload:**

```text
+------------------------------------------+
|  Calcola Premi CALL                      |
|  Sottostante: ALIBABA (BABA)             |
+------------------------------------------+
|  [📄 file.xls caricato]  [🗑 Rimuovi]     |
+------------------------------------------+
|                                          |
|  METRICHE PRINCIPALI (sempre visibili)   |
|  +------------------------------------+  |
|  |  Netto Unitario                    |  |
|  |  $12,45                            |  |
|  +------------------------------------+  |
|  |  Rendimento      |  Annualizzato   |  |
|  |  7,8%            |  42,3%          |  |
|  +------------------------------------+  |
|                                          |
|  📊 Altri dati                    [▼]    |
|  +------------------------------------+  |
|  | Lordo Premi:        $1.250,00      |  |
|  | Commissioni:        -$120,00       |  |
|  | Netto Commissioni:  $1.130,00      |  |
|  | Lordo Unitario:     $13,89         |  |
|  | Prima operazione:   08/09/2025     |  |
|  | Costo transazione:  [10] USD       |  |
|  +------------------------------------+  |
|                                          |
|  📋 Operazioni (9)                [▼]    |
|  +------------------------------------+  |
|  | Op | Simbolo      | Qtà | Prz | 🗑 |  |
|  | V  | BABAH6C165   | 1   | 8,40| X |  |
|  | A  | BABAU6C190   | 1   |12,80| X |  |
|  | ...                               |  |
|  +------------------------------------+  |
|                                          |
|  [Chiudi]                                |
+------------------------------------------+
```

**Funzionalita:**
- Metriche principali sempre visibili in alto (Netto Unitario, Rendimento %)
- "Altri dati" in sezione collassabile (Accordion)
- Tabella operazioni con pulsante rimozione per ogni riga
- Ricalcolo automatico quando si rimuove un'operazione

### 3. Passaggio Prezzo Sottostante

Il dialog necessita del prezzo corrente del sottostante per calcolare il rendimento %. Verra aggiunta una nuova prop:

```typescript
interface CallPremiumCalculatorDialogProps {
  // props esistenti...
  underlyingPrice: number; // Prezzo corrente del sottostante
}
```

Nel componente `CoveredCallRow`, passare:
```tsx
<CallPremiumCalculatorDialog
  // props esistenti...
  underlyingPrice={underlying.current_price || 0}
/>
```

---

## Formule di Calcolo

| Metrica | Formula |
|---------|---------|
| Netto Unitario | `(Lordo Premi - Commissioni) / (Contratti × 100)` |
| Rendimento % | `Netto Unitario / Prezzo Sottostante × 100` |
| Giorni trascorsi | `Data oggi - Data prima operazione` |
| Rendimento Annualizzato | `Rendimento % × (365 / Giorni trascorsi)` |

---

## File da Modificare

| File | Modifiche |
|------|-----------|
| `src/lib/orderFileParser.ts` | Correzione parsing numeri italiani, estrazione data, nuove metriche |
| `src/components/derivatives/CallPremiumCalculatorDialog.tsx` | Nuova UI con layout gerarchico, rimozione operazioni |
| `src/pages/Derivatives.tsx` | Passaggio `underlyingPrice` al dialog |

---

## Verifica Calcoli

Con il file fornito (BABA), filtrando solo CALL eseguiti:

| Operazione | Simbolo | Prz Medio | Qtà | Valore |
|------------|---------|-----------|-----|--------|
| Vendita | BABAH6C165 | 8,40 | 1 | +840 |
| Acquisto | BABAU6C190 | 12,80 | 1 | -1.280 |
| Vendita | BABAU6C190 | 22,80 | 1 | +2.280 |
| Acquisto | BABAM6C180 | 22,20 | 1 | -2.220 |
| Vendita | BABAM6C180 | 14,95 | 1 | +1.495 |
| Acquisto | BABAJ6C170 | 13,95 | 1 | -1.395 |
| Vendita | BABAJ6C170 | 15,80 | 1 | +1.580 |
| Acquisto | BABAG6C165 | 12,85 | 1 | -1.285 |
| Vendita | BABAG6C165 | 10,40 | 1 | +1.040 |
| Acquisto | BABAF6C160 | 7,40 | 1 | -740 |
| Vendita | BABAF6C160 | 2,30 | 1 | +230 |
| Vendita | BABAZ5C165 | 3,30 | 1 | +330 |
| Acquisto | BABAZ5C170 | 2,12 | 1 | -212 |
| Vendita | BABAZ5C170 | 4,60 | 1 | +460 |
| Vendita | BABAX5C165 | 1,90 | 1 | +190 |

**Totale Netto**: +1.313 USD (somma algebrica)
**Prima operazione**: 12/11/2025 (data piu vecchia tra le CALL)

