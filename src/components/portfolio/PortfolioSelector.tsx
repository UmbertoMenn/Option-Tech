import { useState } from 'react';
import { usePortfolioContext, AGGREGATED_PORTFOLIO_ID, AGGREGATED_USER_PREFIX, isAnyAggregatedId } from '@/contexts/PortfolioContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminPortfolios } from '@/hooks/useAdminPortfolios';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronDown, Plus, Pencil, Trash2, Briefcase, Check, Users, X, User, Layers } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';

interface PortfolioSelectorProps {
  fullWidth?: boolean;
}

export function PortfolioSelector({ fullWidth = false }: PortfolioSelectorProps = {}) {
  const { isAdmin, user } = useAuth();
  const {
    portfolios,
    selectedPortfolio,
    selectPortfolio,
    createPortfolio,
    deletePortfolio,
    renamePortfolio,
    isLoading,
    isAdminMode,
    isAggregatedView,
    exitAdminMode,
    setAdminViewPortfolio,
  } = usePortfolioContext();
  const { otherUsers } = useAdminPortfolios();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [targetPortfolio, setTargetPortfolio] = useState<{ id: string; name: string } | null>(null);

  // Derived
  const myAggregatedId = user ? `${AGGREGATED_USER_PREFIX}${user.id}` : null;
  const showMyAggregate = portfolios.length > 1 && myAggregatedId;

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createPortfolio(newName.trim());
    setNewName('');
    setCreateDialogOpen(false);
  };

  const handleRename = async () => {
    if (!newName.trim() || !targetPortfolio) return;
    await renamePortfolio(targetPortfolio.id, newName.trim());
    setNewName('');
    setTargetPortfolio(null);
    setRenameDialogOpen(false);
  };

  const handleDelete = async () => {
    if (!targetPortfolio) return;
    await deletePortfolio(targetPortfolio.id);
    setTargetPortfolio(null);
    setDeleteDialogOpen(false);
  };

  const openRenameDialog = (portfolio: { id: string; name: string }) => {
    setTargetPortfolio(portfolio);
    setNewName(portfolio.name);
    setRenameDialogOpen(true);
  };

  const openDeleteDialog = (portfolio: { id: string; name: string }) => {
    setTargetPortfolio(portfolio);
    setDeleteDialogOpen(true);
  };

  if (isLoading) {
    return (
      <Button variant="outline" size="sm" disabled className="min-w-[180px]">
        <Briefcase className="w-4 h-4 mr-2" />
        Caricamento...
      </Button>
    );
  }

  // Get display name for selector
  const getDisplayName = () => {
    if (isAggregatedView) {
      // Check if it's a per-user aggregate (own or client)
      const selectedId = selectedPortfolio?.id || '';
      if (selectedId === AGGREGATED_PORTFOLIO_ID) return 'Aggregato - Tutti';
      return selectedPortfolio?.name || 'Il Mio Aggregato';
    }
    if (isAdminMode && selectedPortfolio) return `👤 ${selectedPortfolio.name}`;
    return selectedPortfolio?.name || 'Seleziona Portfolio';
  };

  return (
    <>
      <div className={`flex items-center gap-2 ${fullWidth ? 'w-full' : ''}`}>
        {/* Exit admin mode button */}
        {(isAdminMode || isAggregatedView) && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-warning shrink-0"
            onClick={exitAdminMode}
            title="Esci dalla modalità admin"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="outline" 
              size="sm" 
              className={`${fullWidth ? 'w-full' : 'min-w-[180px]'} justify-between ${(isAdminMode || isAggregatedView) ? 'border-warning text-warning' : ''}`}
            >
              <span className="flex items-center gap-2 truncate min-w-0">
                {isAggregatedView ? (
                  <Layers className="w-4 h-4 shrink-0" />
                ) : (
                  <Briefcase className="w-4 h-4 shrink-0" />
                )}
                <span className={`truncate ${fullWidth ? 'max-w-[140px]' : 'max-w-[120px]'}`}>
                  {getDisplayName()}
                </span>
              </span>
              <ChevronDown className="w-4 h-4 ml-2 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[280px] max-h-[400px] overflow-y-auto">
            {/* Global aggregated option for admin */}
            {isAdmin && (
              <>
                <DropdownMenuItem
                  className="flex items-center gap-2 cursor-pointer bg-background-secondary"
                  onSelect={(e) => {
                    e.preventDefault();
                    selectPortfolio(AGGREGATED_PORTFOLIO_ID);
                  }}
                >
                  {selectedPortfolio?.id === AGGREGATED_PORTFOLIO_ID && <Check className="w-4 h-4 text-warning shrink-0" />}
                  {selectedPortfolio?.id !== AGGREGATED_PORTFOLIO_ID && <div className="w-4 h-4 shrink-0" />}
                  <Users className="w-4 h-4 text-warning" />
                  <span className="font-medium text-warning">Aggregato - Tutti gli Utenti</span>
                </DropdownMenuItem>
              </>
            )}

            {/* My aggregate (for any user with 2+ portfolios) */}
            {showMyAggregate && (
              <DropdownMenuItem
                className="flex items-center gap-2 cursor-pointer"
                onSelect={(e) => {
                  e.preventDefault();
                  selectPortfolio(myAggregatedId!);
                }}
              >
                {selectedPortfolio?.id === myAggregatedId ? (
                  <Check className="w-4 h-4 text-primary shrink-0" />
                ) : (
                  <div className="w-4 h-4 shrink-0" />
                )}
                <Layers className="w-4 h-4 text-primary" />
                <span className="font-medium text-primary">Il Mio Aggregato</span>
              </DropdownMenuItem>
            )}

            {(isAdmin || showMyAggregate) && <DropdownMenuSeparator />}
            
            {portfolios.map((portfolio) => (
              <DropdownMenuItem
                key={portfolio.id}
                className="flex items-center justify-between group cursor-pointer"
                onSelect={(e) => {
                  e.preventDefault();
                  selectPortfolio(portfolio.id);
                }}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {portfolio.id === selectedPortfolio?.id && !isAggregatedView && !isAdminMode && (
                    <Check className="w-4 h-4 text-primary shrink-0" />
                  )}
                  {(portfolio.id !== selectedPortfolio?.id || isAggregatedView || isAdminMode) && (
                    <div className="w-4 h-4 shrink-0" />
                  )}
                  <span className="truncate">{portfolio.name}</span>
                  {portfolio.total_value && portfolio.total_value > 0 && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {formatCurrency(portfolio.total_value)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 ml-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      openRenameDialog(portfolio);
                    }}
                  >
                    <Pencil className="w-3 h-3" />
                  </Button>
                  {portfolios.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDeleteDialog(portfolio);
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={() => {
                setNewName('');
                setCreateDialogOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Nuovo Portfolio
            </DropdownMenuItem>
            {/* Client portfolios section (admin only) */}
            {isAdmin && otherUsers.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider">
                  Portafogli Clienti
                </DropdownMenuLabel>
                {otherUsers.map((client) => {
                  const clientAggId = `${AGGREGATED_USER_PREFIX}${client.userId}`;
                  const hasMultiple = client.portfolios.length > 1;
                  return (
                    <div key={client.userId}>
                      <DropdownMenuLabel className="text-xs font-medium py-1">
                        {client.name || client.email}
                        {client.name && (
                          <span className="text-muted-foreground font-normal ml-1">({client.email})</span>
                        )}
                      </DropdownMenuLabel>
                      {/* Per-client aggregate */}
                      {hasMultiple && (
                        <DropdownMenuItem
                          className="flex items-center gap-2 cursor-pointer pl-6"
                          onSelect={(e) => {
                            e.preventDefault();
                            setAdminViewPortfolio(clientAggId, client.userId);
                          }}
                        >
                          {selectedPortfolio?.id === clientAggId ? (
                            <Check className="w-4 h-4 text-warning shrink-0" />
                          ) : (
                            <Layers className="w-3 h-3 text-muted-foreground shrink-0" />
                          )}
                          <span className="font-medium">Aggregato</span>
                        </DropdownMenuItem>
                      )}
                      {client.portfolios.map((p) => (
                        <DropdownMenuItem
                          key={p.id}
                          className="flex items-center justify-between cursor-pointer pl-6"
                          onSelect={(e) => {
                            e.preventDefault();
                            setAdminViewPortfolio(p.id, client.userId);
                          }}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {p.id === selectedPortfolio?.id && isAdminMode ? (
                              <Check className="w-4 h-4 text-warning shrink-0" />
                            ) : (
                              <User className="w-3 h-3 text-muted-foreground shrink-0" />
                            )}
                            <span className="truncate">{p.name}</span>
                          </div>
                          {p.total_value && p.total_value > 0 && (
                            <span className="text-xs text-muted-foreground ml-2">
                              {formatCurrency(p.total_value)}
                            </span>
                          )}
                        </DropdownMenuItem>
                      ))}
                    </div>
                  );
                })}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuovo Portfolio</DialogTitle>
            <DialogDescription>
              Crea un nuovo portfolio vuoto. Potrai poi caricare i dati tramite Excel.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="portfolio-name">Nome Portfolio</Label>
              <Input
                id="portfolio-name"
                placeholder="Es: Portafoglio Trading"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Annulla
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim()}>
              Crea
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rinomina Portfolio</DialogTitle>
            <DialogDescription>
              Inserisci un nuovo nome per il portfolio.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rename-portfolio">Nome</Label>
              <Input
                id="rename-portfolio"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Annulla
            </Button>
            <Button onClick={handleRename} disabled={!newName.trim()}>
              Salva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare il portfolio?</AlertDialogTitle>
            <AlertDialogDescription>
              Stai per eliminare "{targetPortfolio?.name}". Questa azione eliminerà anche tutte le posizioni, depositi e dati storici associati. Non può essere annullata.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Elimina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
