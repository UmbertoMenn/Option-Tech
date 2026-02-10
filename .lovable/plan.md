

## Gestione festivi USA nella data di scadenza opzioni

### Regola

Quando il 3o venerdi del mese cade in un giorno festivo USA:
- **Solo venerdi festivo** -> la scadenza si sposta al **giovedi** (giorno prima)
- **Giovedi E venerdi festivi** -> la scadenza si sposta al **lunedi** (giorno dopo)

### Modifica tecnica

**File: `src/lib/optionStratUrl.ts`**

1. Aggiungere una lista di festivi USA che possono cadere di venerdi (o giovedi+venerdi), calcolati dinamicamente per anno. I festivi rilevanti del mercato azionario USA sono:
   - New Year's Day (1 gennaio, o venerdi prima se cade di sabato)
   - MLK Day (3o lunedi di gennaio) - mai di venerdi, irrilevante
   - Presidents' Day (3o lunedi di febbraio) - mai di venerdi, irrilevante
   - Good Friday (venerdi prima di Pasqua) - SEMPRE di venerdi
   - Memorial Day (ultimo lunedi di maggio) - mai di venerdi, irrilevante
   - Juneteenth (19 giugno)
   - Independence Day (4 luglio)
   - Labor Day (1o lunedi di settembre) - mai di venerdi, irrilevante
   - Thanksgiving (4o giovedi di novembre) + Black Friday (giorno dopo, mercato chiude presto ma NON e' festivo pieno)
   - Christmas (25 dicembre)

2. Creare funzione `isUSMarketHoliday(date: Date): boolean` che verifica se una data e' un giorno di chiusura del mercato USA.

3. Modificare `thirdFriday` (o creare `adjustForHolidays`) per applicare la logica:
   ```typescript
   function optionsExpirationDate(year: number, month: number): Date {
     const tf = thirdFriday(year, month);
     const thursday = new Date(tf);
     thursday.setDate(tf.getDate() - 1);

     if (isUSMarketHoliday(tf)) {
       if (isUSMarketHoliday(thursday)) {
         // Both Thu+Fri are holidays -> Monday after
         const monday = new Date(tf);
         monday.setDate(tf.getDate() + 3);
         return monday;
       }
       // Only Friday is holiday -> Thursday before
       return thursday;
     }
     return tf;
   }
   ```

4. Aggiornare `formatExpiry` per usare `optionsExpirationDate` al posto di `thirdFriday`.

### Festivi da includere (funzioni di calcolo)

- **Good Friday**: calcolato dall'algoritmo di Pasqua (Computus), sottraendo 2 giorni dalla domenica di Pasqua
- **Festivi a data fissa** (1 gen, 19 giu, 4 lug, 25 dic): se cadono di sabato si osservano il venerdi prima; se di domenica il lunedi dopo
- **Thanksgiving**: 4o giovedi di novembre (il venerdi dopo NON e' festivo ufficiale del mercato, ma il mercato chiude alle 13:00 - le opzioni scadono comunque normalmente)

### Note
- Il caso piu' comune e' **Good Friday** che cade il 3o venerdi di aprile in alcuni anni
- La lista dei festivi viene generata dinamicamente per qualsiasi anno, non hardcoded

