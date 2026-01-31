
# Piano: Giacenza Media Ponderata nel Tempo + Data Excel

## Panoramica

Implementare un calcolo della giacenza media **ponderato nel tempo**, dove ogni livello di saldo viene pesato per la durata in cui è rimasto invariato. Inoltre, estrarre automaticamente la data dal file Excel e mostrare i versamenti nel periodo sotto la card Giacenza Media.

## Formula Giacenza Media Ponderata

**Esempio dall'utente:**
- Valore iniziale: 100.000 euro (1 anno fa)
- Versamento: 100.000 euro (dopo 9 mesi)
- Periodo totale: 12 mesi

**Calcolo:**
```
Giacenza Media = 100.000 x (9/12) + 200.000 x (3/12)
               = 100.000 x 0,75 + 200.000 x 0,25
               = 75.000 + 50.000
               = 125.000 euro
```

**Formula generale:**
```
Giacenza Media = Somma(Saldo_i x Giorni_i) / Giorni_totali
```

## Flusso Dati

```text
Excel Upload --> Estrae data header --> Salva snapshot_date in portfolios
                                                    |
                                                    v
Data Storica selezionata --> Filtra deposits nel periodo --> Lista versamenti ordinata
                                                    |
                                                    v
                                            Calcola pesi temporali
                                                    |
                                                    v
Patrimonio Card (mostra data) <-- Giacenza Media (con versamenti sotto)
```

## Modifiche Previste

### 1. Database: Nuova colonna `snapshot_date`

Aggiungere colonna per salvare la data estratta dall'Excel.

```sql
ALTER TABLE portfolios ADD COLUMN snapshot_date DATE;
```

### 2. Tipo Portfolio

Aggiornare l'interfaccia per includere il nuovo campo `snapshot_date`.

### 3. Parser Excel: Estrazione data

Aggiungere logica per cercare la data nelle prime righe del file Excel:
- Pattern come "POSIZIONE AL DD/MM/YYYY"
- Pattern come "DATA: DD/MM/YYYY"
- Numeri seriali Excel (40000-50000)

Restituire `snapshotDate` insieme a `positions` e `cashValue`.

### 4. FileUploader: Salvataggio data

Salvare `snapshot_date` nel portfolio durante l'upload Excel.

### 5. Dashboard: Passare deposits a StatsCards

Aggiungere nuova prop `allDeposits` per passare l'array completo dei versamenti.

### 6. StatsCards: Calcolo ponderato e UI

Implementare la funzione `calculateTimeWeightedAverage`:

```typescript
function calculateTimeWeightedAverage(
  startDate: Date,          // Data storica selezionata
  endDate: Date,            // Data Excel (snapshot_date)
  initialValue: number,     // Valore storico
  deposits: DepositEntry[]  // Versamenti
): number {
  const totalDays = differenceInDays(endDate, startDate);
  if (totalDays <= 0) return initialValue;
  
  // Filtra e ordina versamenti nel periodo
  const depositsInPeriod = deposits
    .filter(d => {
      const date = new Date(d.deposit_date);
      return date > startDate && date <= endDate;
    })
    .sort((a, b) => 
      new Date(a.deposit_date).getTime() - new Date(b.deposit_date).getTime()
    );
  
  if (depositsInPeriod.length === 0) {
    return initialValue;
  }
  
  // Calcolo ponderato
  let weightedSum = 0;
  let currentBalance = initialValue;
  let previousDate = startDate;
  
  for (const deposit of depositsInPeriod) {
    const depositDate = new Date(deposit.deposit_date);
    const daysAtThisBalance = differenceInDays(depositDate, previousDate);
    
    weightedSum += currentBalance * daysAtThisBalance;
    currentBalance += deposit.amount;
    previousDate = depositDate;
  }
  
  // Ultimo periodo
  const finalDays = differenceInDays(endDate, previousDate);
  weightedSum += currentBalance * finalDays;
  
  return weightedSum / totalDays;
}
```

### 7. UI Aggiornata

**Card Patrimonio Totale:**
```
+--------------------+
| Patrimonio Totale  |
| 200.000,00 euro    |
| al 30/01/2026      |   <-- Data dall'Excel
+--------------------+
```

**Card Giacenza Media:**
```
+--------------------+
| Giacenza Media     |
| 125.000,00 euro    |
| Versamenti: 100.000|   <-- Stile leggero (non grassetto)
+--------------------+
```

## Riepilogo File da Modificare

| File | Modifica |
|:-----|:---------|
| **Database** | Nuova colonna `snapshot_date` in `portfolios` |
| **src/types/portfolio.ts** | Aggiunta proprieta `snapshot_date` |
| **src/lib/excelParser.ts** | Funzione `extractSnapshotDate` + export nel risultato |
| **src/components/dashboard/FileUploader.tsx** | Salvataggio `snapshot_date` nel portfolio |
| **src/components/dashboard/Dashboard.tsx** | Passaggio `allDeposits` a StatsCards |
| **src/components/dashboard/StatsCards.tsx** | Nuova prop `allDeposits`, funzione ponderata, UI con data e versamenti |

## Dettagli Tecnici

### Estrazione Data Excel

Pattern supportati nel parser:
```typescript
const datePatterns = [
  /POSIZIONE\s+AL\s+(\d{2})[\/\-](\d{2})[\/\-](\d{4})/i,
  /DATA[:\s]+(\d{2})[\/\-](\d{2})[\/\-](\d{4})/i,
  /(\d{2})[\/\-](\d{2})[\/\-](\d{4})/,
];

// Numeri seriali Excel (40000-50000)
if (typeof cell === 'number' && cell > 40000 && cell < 50000) {
  const date = new Date((cell - 25569) * 86400 * 1000);
}
```

### Gestione Edge Cases

1. **Nessuna data storica selezionata:** Giacenza = 0, card dimmed
2. **Nessun versamento nel periodo:** Giacenza = Valore storico
3. **Data Excel mancante:** Usa data odierna come fallback
4. **Modifica manuale:** L'utente puo sempre sovrascrivere con l'icona matita

### Dipendenze

Utilizzeremo `date-fns` (gia installato) per:
- `differenceInDays` - calcolo giorni tra date
- `parseISO` - parsing date ISO

### Esempio Calcolo Dettagliato

```text
Data inizio: 01/01/2025 (valore: 100.000 euro)
Versamento: 01/10/2025 (+100.000 euro)
Data fine: 01/01/2026

Calcolo:
- Periodo 1: 01/01 -> 01/10 = 273 giorni a 100.000 euro
- Periodo 2: 01/10 -> 01/01 = 92 giorni a 200.000 euro
- Totale: 365 giorni

Giacenza = (100.000 x 273 + 200.000 x 92) / 365
         = (27.300.000 + 18.400.000) / 365
         = 45.700.000 / 365
         = 125.205 euro
```
