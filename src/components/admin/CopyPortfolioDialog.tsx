import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Copy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Portfolio } from '@/types/portfolio';
import { useQueryClient } from '@tanstack/react-query';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { useAuth } from '@/contexts/AuthContext';

interface UserOption {
  userId: string;
  email: string;
  name: string | null;
}

interface CopyPortfolioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourcePortfolio: Portfolio | null;
  users: UserOption[];
  onSuccess: () => void;
}

export function CopyPortfolioDialog({
  open,
  onOpenChange,
  sourcePortfolio,
  users,
  onSuccess,
}: CopyPortfolioDialogProps) {
  const queryClient = useQueryClient();
  const { selectPortfolio } = usePortfolioContext();
  const { user } = useAuth();
  const [targetUserId, setTargetUserId] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [isCopying, setIsCopying] = useState(false);

  const handleCopy = async () => {
    if (!sourcePortfolio || !targetUserId) return;

    setIsCopying(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-copy-portfolio', {
        body: {
          sourcePortfolioId: sourcePortfolio.id,
          targetUserId,
          newPortfolioName: newName.trim() || undefined,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const targetUser = users.find(u => u.userId === targetUserId);
      toast.success('Portfolio copiato con successo!', {
        description: `Copiato su ${targetUser?.name || targetUser?.email}`,
      });

      // Invalidate portfolio list so the new one appears in the selector
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });

      // If copied to self (admin), auto-select the new portfolio
      if (targetUserId === user?.id && data?.newPortfolioId) {
        selectPortfolio(data.newPortfolioId);
      }

      onSuccess();
      onOpenChange(false);
      setTargetUserId('');
      setNewName('');
    } catch (error) {
      console.error('Copy error:', error);
      toast.error('Errore nella copia', {
        description: error instanceof Error ? error.message : 'Errore sconosciuto',
      });
    } finally {
      setIsCopying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="w-5 h-5" />
            Copia Portfolio su Utente
          </DialogTitle>
          <DialogDescription>
            Copia "{sourcePortfolio?.name}" su un altro utente. Verranno copiati tutti i dati: posizioni, depositi, dati storici e override.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="target-user">Utente Destinatario</Label>
            <Select value={targetUserId} onValueChange={setTargetUserId}>
              <SelectTrigger className="bg-background-secondary border-border">
                <SelectValue placeholder="Seleziona utente..." />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.userId} value={user.userId}>
                    {user.name || user.email}
                    {user.name && <span className="text-muted-foreground ml-2 text-xs">({user.email})</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-name">Nome Portfolio (opzionale)</Label>
            <Input
              id="new-name"
              placeholder={`Copia di ${sourcePortfolio?.name || 'Portfolio'}`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-background-secondary border-border"
            />
            <p className="text-xs text-muted-foreground">
              Se vuoto, verrà usato "Copia di {sourcePortfolio?.name}"
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCopying}>
            Annulla
          </Button>
          <Button
            onClick={handleCopy}
            disabled={!targetUserId || isCopying}
            className="bg-primary hover:bg-primary-glow"
          >
            {isCopying ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Copia in corso...
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-2" />
                Copia Portfolio
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
