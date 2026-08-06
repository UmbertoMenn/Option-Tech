/**
 * Testi esplicativi della configurazione Short Put.
 * Tenuti separati dal componente: descrivono le regole del motore, non la UI.
 */

export const SECTION_HELP = {
  basket: `Titoli su cui vendere le PUT e periodo di simulazione.

Ogni titolo ha una posizione indipendente, con un numero fisso di contratti che non cambia mai (nemmeno nei roll). La cassa invece è unica per tutto il portafoglio: i premi di tutti i titoli confluiscono nello stesso saldo.

Il capitale iniziale è il punto di partenza dell'equity curve e la base su cui si calcolano P&L % e drawdown. Non blocca collaterale: al momento non c'è vincolo di margine.`,

  entry: `Come viene scelta la PUT quando non c'è posizione aperta.

Si vende sempre sulla scadenza mensile (terzo venerdì) più vicina che abbia almeno i DTE minimi richiesti. Se nessuno strike soddisfa i criteri, l'ingresso viene rimandato al giorno dopo e riprovato.`,

  execution: `A quale prezzo vengono eseguite le operazioni e quanto costano.

È la voce che più influenza il realismo del backtest: eseguire tutto a metà spread produce risultati sistematicamente più belli del vero.`,

  downside: `Cosa fare quando il sottostante scende verso lo strike venduto.

Sono previsti 4 roll gestiti, ciascuno con la propria regola di premio. A ogni roll il motore cerca uno strike più basso del precedente e comunque OTM (sotto il prezzo corrente), sulla scadenza mensile successiva più vicina che permetta di centrare il premio netto richiesto. Tra i candidati validi sceglie il più basso, cioè il più difensivo.

Premio netto = (incasso della nuova PUT − costo per chiudere quella vecchia) ÷ nuovo nozionale.

Esauriti i 4 roll, la posizione non viene mai assegnata volontariamente: alla scadenza, se è ancora ITM, si rolla sullo stesso strike alla mensile successiva, e si continua così finché una scadenza chiude OTM. Lo stesso roll viene anticipato prima della scadenza se il valore temporale scende sotto lo spread (rischio di assegnazione anticipata sulle americane).`,

  upside: `Cosa fare quando il sottostante sale e lo strike venduto resta troppo lontano.

Se la posizione è sulla prima scadenza, si rolla verso l'alto. Se invece è su una scadenza lontana (ci si è finiti con i roll in discesa), si rientra sulla prima scadenza.

In entrambi i casi la gestione si attiva solo su un recupero reale: dopo un roll in discesa il prezzo deve tornare sopra il livello che aveva al momento di quel roll. Senza questo vincolo, siccome i roll in discesa scelgono strike molto lontani dal prezzo, il trigger di distanza scatterebbe subito e si rimbalzerebbe tra discesa e salita bruciando spread.`,
} as const;

export const FIELD_HELP = {
  // Paniere e periodo
  ticker: 'Simbolo del sottostante su cui vendere le PUT.',
  contracts:
    'Numero di contratti venduti su questo titolo. Resta fisso per tutta la simulazione, anche dopo i roll. Ogni contratto vale 100 azioni: il nozionale è strike × contratti × 100.',
  startDate: 'Primo giorno della simulazione. Il primo ingresso avviene da questa data in poi.',
  endDate:
    'Ultimo giorno della simulazione. Le posizioni con scadenza successiva restano aperte e vengono valorizzate al mid nell\'equity finale.',
  capital:
    'Capitale di partenza. Serve come base per P&L %, drawdown e curva equity. Non viene bloccato come collaterale.',

  // Ingresso
  strikeMode: `Criterio di scelta dello strike.

• Distanza: prende lo strike più alto che sia almeno alla distanza % richiesta sotto il prezzo. Ignora il premio.
• Premio %: prende lo strike il cui premio, rapportato al nozionale, cade nella tolleranza attorno al target. Ignora la distanza.
• Entrambe: devono valere tutti e due i vincoli. Più selettivo: se nessuno strike li soddisfa entrambi, l'ingresso salta e si riprova il giorno dopo.`,
  distancePct:
    'Distanza minima dello strike sotto il prezzo corrente. Con 5% e sottostante a 100, lo strike deve essere ≤ 95. Più è alta, più la PUT è lontana dai soldi e più basso il premio.',
  minDte:
    'Giorni minimi alla scadenza. Se la mensile più vicina ne ha meno, si passa a quella successiva. Serve a non vendere opzioni troppo a ridosso della scadenza, dove il gamma esplode.',
  premiumTargetPct:
    'Premio desiderato in percentuale del nozionale (strike × contratti × 100). Con target 2% e strike 95, si cerca un premio di circa 1,90 per azione.',
  premiumToleranceP:
    'Quanto ci si può discostare dal premio target, in punti percentuali. Con target 2% e tolleranza 0,75 sono accettati premi tra 1,25% e 2,75%. Tolleranze strette rendono più frequenti i giorni senza ingresso.',
  timeRollAtDte:
    'Sotto questi giorni alla scadenza, in assenza di altri trigger, la posizione viene rollata sulla mensile successiva usando i criteri di ingresso (solo se a credito). Impostare 0 per tenere sempre fino a scadenza.',

  // Esecuzione
  fillModel: `Prezzo a cui si assume di eseguire.

• Natural: si vende al bid e si compra all'ask. È l'ipotesi prudente, paghi tutto lo spread.
• Mid: tutto a metà spread. Ottimistico, utile per isolare l'effetto della strategia dai costi.
• Mid + slippage: parte dal mid e si sposta verso il lato sfavorevole della quota impostata sotto.`,
  slippage:
    'Quanta parte del mezzo spread si paga, in percentuale, quando il modello di fill è "Mid + slippage". 0 equivale al mid puro, 100 equivale al natural.',
  commission:
    'Commissione per singolo contratto e per singola gamba. Un roll intraday ne conta due (chiusura + apertura); un roll a scadenza una sola, perché la vecchia gamba si estingue per settlement.',

  // Discesa
  downTrigger:
    'Quanto vicino deve arrivare il prezzo allo strike perché scatti il roll. Con 0% il roll parte quando il prezzo tocca lo strike. Con 2% parte prima, quando il prezzo è ancora il 2% sopra. Valori alti rendono la gestione più reattiva e anticipata.',
  maxMonths:
    'Quanto lontano si può spingere la nuova scadenza rispetto a oggi. Il motore parte sempre dalla mensile successiva più vicina e si allontana solo se serve a raggiungere il premio richiesto.',
  rollTarget:
    'Premio netto richiesto per questo roll, in percentuale del nuovo nozionale. Netto significa al lordo del costo di ricopertura della PUT che si sta chiudendo. Valori più bassi sui roll successivi rendono la gestione più facile da eseguire man mano che la situazione si deteriora.',
  rollTolerance:
    'Scostamento ammesso dal premio target di questo roll, in punti percentuali. Tolleranze larghe trovano quasi sempre uno strike valido; tolleranze strette possono lasciare il roll ineseguibile, e in quel caso il motore riprova ai giorni successivi.',

  // Salita
  upTrigger:
    'Distanza del prezzo sopra lo strike, in percentuale del prezzo, oltre la quale si considera la posizione troppo lontana e si rolla verso l\'alto. Con 8% e sottostante a 100, scatta quando lo strike è sotto 92.',
  minRecovery:
    'Quanto il prezzo deve superare il livello che aveva all\'ultimo roll in discesa perché la gestione al rialzo si riattivi. Con 0 basta tornare esattamente sopra quel livello. Alzarlo richiede un recupero più convincente prima di rimettersi vicino al prezzo.',
  upMinDistance:
    'Distanza minima del nuovo strike sotto il prezzo corrente nei roll al rialzo. Impedisce di rimettersi troppo vicino ai soldi per inseguire il premio.',
  upMinNet:
    'Premio netto minimo richiesto per il roll al rialzo sulla prima scadenza, in percentuale del nuovo nozionale. Tra gli strike che rispettano distanza e premio, il motore prende il più alto.',
  recoveryTarget:
    'Premio netto target per il rientro sulla prima scadenza quando ci si trova su una scadenza lontana. Chiudere una PUT lontana costa: il netto diventa raggiungibile solo quando quella vecchia si è già sgonfiata.',
  recoveryTolerance:
    'Scostamento ammesso dal premio target di rientro, in punti percentuali.',
} as const;
