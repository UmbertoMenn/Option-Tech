import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Briefcase, Copy, ExternalLink, Loader2, ChevronDown, ChevronRight, User, Trash2 } from 'lucide-react';
import { useAdminPortfolios, PortfolioWithOwner } from '@/hooks/useAdminPortfolios';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { useAuth } from '@/contexts/AuthContext';
import { CopyPortfolioDialog } from './CopyPortfolioDialog';
import { useDeletePortfolio } from '@/hooks/useDeletePortfolio';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Portfolio } from '@/types/portfolio';

export function PortfolioManager() {
  const { user } = useAuth();
  const { allPortfolios, adminPortfolios, otherUsers, allRegisteredUsers, isLoading, refetch } = useAdminPortfolios();
  const { setAdminViewPortfolio } = usePortfolioContext();
  const navigate = useNavigate();

  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [portfolioToCopy, setPortfolioToCopy] = useState<Portfolio | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [portfolioToDelete, setPortfolioToDelete] = useState<PortfolioWithOwner | null>(null);
  const { deletePortfolio, isDeleting } = useDeletePortfolio();

  const toggleUserExpanded = (userId: string) => {
    setExpandedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const handleViewPortfolio = (portfolio: PortfolioWithOwner) => {
    setAdminViewPortfolio(portfolio.id, portfolio.user_id);
    navigate('/');
  };

  const handleCopyClick = (portfolio: Portfolio) => {
    setPortfolioToCopy(portfolio);
    setCopyDialogOpen(true);
  };

  const handleDeleteClick = (portfolio: PortfolioWithOwner) => {
    setPortfolioToDelete(portfolio);
  };

  const handleConfirmDelete = async () => {
    if (!portfolioToDelete) return;
    try {
      await deletePortfolio(portfolioToDelete.id);
      setPortfolioToDelete(null);
    } catch (error) {
      // Error già gestito nel hook
    }
  };


  if (isLoading) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="py-8">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            Caricamento portafogli...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Admin's own portfolios - with copy feature */}
      <Card className="border-border bg-card">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Briefcase className="w-5 h-5 text-primary" />
            <CardTitle>I Miei Portafogli</CardTitle>
            <Badge variant="secondary">{adminPortfolios.length}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Puoi copiare questi portafogli su altri utenti
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-background-tertiary">
                <TableHead>Nome</TableHead>
                <TableHead className="text-right">Valore</TableHead>
                <TableHead>Ultimo Agg.</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adminPortfolios.map((portfolio) => (
                <TableRow key={portfolio.id} className="border-border hover:bg-background-tertiary">
                  <TableCell className="font-medium">{portfolio.name}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(portfolio.total_value || 0)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {portfolio.last_updated ? formatDate(portfolio.last_updated) : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyClick(portfolio)}
                      >
                        <Copy className="w-4 h-4 mr-2" />
                        Copia su Utente
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteClick(portfolio as PortfolioWithOwner)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {adminPortfolios.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    Non hai ancora creato portafogli personali
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Other users' portfolios - grouped by user */}
      <Card className="border-border bg-card">
        <CardHeader>
          <div className="flex items-center gap-3">
            <User className="w-5 h-5 text-muted-foreground" />
            <CardTitle>Portafogli Utenti</CardTitle>
            <Badge variant="secondary">
              {allPortfolios.filter(p => p.user_id !== user?.id).length}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Clicca su un portafoglio per visualizzarlo e modificarlo
          </p>
        </CardHeader>
        <CardContent>
          {otherUsers.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              Nessun altro utente con portafogli
            </div>
          ) : (
            <div className="space-y-2">
              {otherUsers.map((userGroup) => (
                <Collapsible
                  key={userGroup.userId}
                  open={expandedUsers.has(userGroup.userId)}
                  onOpenChange={() => toggleUserExpanded(userGroup.userId)}
                >
                  <CollapsibleTrigger asChild>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-background-secondary hover:bg-background-tertiary cursor-pointer">
                      <div className="flex items-center gap-3">
                        {expandedUsers.has(userGroup.userId) ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                        <div>
                          <span className="font-medium">{userGroup.name || userGroup.email}</span>
                          {userGroup.name && (
                            <span className="text-muted-foreground text-sm ml-2">
                              ({userGroup.email})
                            </span>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline">{userGroup.portfolios.length} portfolios</Badge>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-7 mt-2 border-l-2 border-border pl-4">
                      <Table>
                        <TableBody>
                          {userGroup.portfolios.map((portfolio) => (
                            <TableRow
                              key={portfolio.id}
                              className="border-border hover:bg-background-tertiary cursor-pointer"
                              onClick={() => handleViewPortfolio(portfolio)}
                            >
                              <TableCell className="font-medium">
                                {portfolio.name}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(portfolio.total_value || 0)}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {portfolio.last_updated ? formatDate(portfolio.last_updated) : '-'}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCopyClick(portfolio);
                                    }}
                                  >
                                    <Copy className="w-4 h-4 mr-2" />
                                    Copia
                                  </Button>
                                  <Button variant="ghost" size="sm">
                                    <ExternalLink className="w-4 h-4 mr-2" />
                                    Apri
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteClick(portfolio);
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Copy Dialog */}
      <CopyPortfolioDialog
        open={copyDialogOpen}
        onOpenChange={setCopyDialogOpen}
        sourcePortfolio={portfolioToCopy}
        users={allRegisteredUsers}
        onSuccess={refetch}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!portfolioToDelete} onOpenChange={(open) => !open && setPortfolioToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Conferma Eliminazione</DialogTitle>
            <DialogDescription className="space-y-2">
              <span>
                Stai per eliminare il portfolio "<strong>{portfolioToDelete?.name}</strong>"
                {portfolioToDelete?.owner_email && (
                  <> di <strong>{portfolioToDelete.owner_name || portfolioToDelete.owner_email}</strong></>
                )}.
              </span>
              <br />
              <span>
                Verranno eliminati anche tutti i dati associati (posizioni, depositi, dati storici, alert).
              </span>
              <br />
              <span className="text-destructive font-medium">
                Questa azione non può essere annullata.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setPortfolioToDelete(null)}
              disabled={isDeleting}
            >
              Annulla
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Eliminazione...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Elimina Portfolio
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
