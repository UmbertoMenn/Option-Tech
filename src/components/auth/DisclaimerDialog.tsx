import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

interface DisclaimerDialogProps {
  open: boolean;
  onAccept: () => void;
}

export function DisclaimerDialog({ open, onAccept }: DisclaimerDialogProps) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent
        className="max-w-lg max-h-[90vh] overflow-y-auto"
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl font-bold text-center">
            Informativa
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
              <p>
                Questa App è stata creata per agevolare la gestione ed il monitoraggio di un portafoglio in opzioni.
              </p>
              <p>
                Non è il vangelo e possono esserci errori o classificazioni che l'utente potrebbe non capire o con le quali potrebbe non essere d'accordo.
              </p>
              <p>
                Non sostituisce il normale monitoraggio del proprio portafoglio da parte dell'utente né si sostituisce alla reportistica ufficiale dell'intermediario finanziario dell'utente.
              </p>
              <p>
                Non esula l'utente dalla propria responsabilità nella gestione e monitoraggio del proprio portafoglio.
              </p>
              <p>
                È uno strumento utile che deve essere utilizzato correttamente e con le dovute cautele.
              </p>
              <p className="font-medium text-foreground">
                Proseguendo, confermi di aver capito quanto sopra e di manlevare da qualsiasi responsabilità il titolare del presente sito.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4 sm:justify-center">
          <AlertDialogAction
            onClick={onAccept}
            className="w-full text-base py-6 font-semibold"
          >
            Confermo ed accetto quanto sopra
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
