import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, UserPlus, Shield, Trash2, Users, ShieldCheck, Loader2, PieChart, Briefcase, Link2, Menu, TrendingUp, ShieldAlert, LogOut, Bell, Stethoscope, KeyRound, Copy, Check } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { IronCondorIcon } from '@/components/ui/iron-condor-icon';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { formatDate } from '@/lib/formatters';
import { SectorMappingManager } from './SectorMappingManager';
import { PortfolioManager } from './PortfolioManager';
import { TickerMappingManager } from './TickerMappingManager';
import { AdminNotificationSettings } from './AdminNotificationSettings';
import { ResolutionDiagnostics } from './ResolutionDiagnostics';

interface UserWithRole {
  id: string;
  username: string | null;
  full_name: string | null;
  created_at: string;
  isAdmin: boolean;
}

function generatePassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function AdminPanel() {
  const { isAdmin, user, signOut } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newUserUsername, setNewUserUsername] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserName, setNewUserName] = useState('');
  
  // Delete confirmation state
  const [userToDelete, setUserToDelete] = useState<UserWithRole | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Reset password state
  const [resetPasswordUser, setResetPasswordUser] = useState<UserWithRole | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    if (isAdmin) {
      loadUsers();
    }
  }, [isAdmin]);

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  async function loadUsers() {
    setLoading(true);
    try {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      const { data: adminRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin');

      if (rolesError) throw rolesError;

      const adminUserIds = new Set(adminRoles?.map(r => r.user_id) || []);

      const usersWithRoles: UserWithRole[] = (profiles || []).map(profile => ({
        id: profile.user_id,
        username: (profile as any).username || profile.email?.replace('@internal.local', '') || null,
        full_name: profile.full_name,
        created_at: profile.created_at,
        isAdmin: adminUserIds.has(profile.user_id),
      }));

      setUsers(usersWithRoles);
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Errore caricamento utenti');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleAdmin(userId: string, currentlyAdmin: boolean) {
    try {
      if (currentlyAdmin) {
        await supabase
          .from('user_roles')
          .delete()
          .eq('user_id', userId)
          .eq('role', 'admin');
        toast.success('Ruolo admin rimosso');
      } else {
        await supabase
          .from('user_roles')
          .insert({ user_id: userId, role: 'admin' });
        toast.success('Ruolo admin aggiunto');
      }
      loadUsers();
    } catch (error) {
      toast.error('Errore aggiornamento ruolo');
    }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    
    try {
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: { username: newUserUsername, password: newUserPassword, full_name: newUserName },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Utente creato!');
      setShowAddDialog(false);
      setNewUserUsername('');
      setNewUserPassword('');
      setNewUserName('');
      
      setTimeout(loadUsers, 1000);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Errore sconosciuto';
      toast.error('Errore creazione utente', { description: errorMessage });
    }
  }

  async function handleDeleteUser() {
    if (!userToDelete) return;
    
    setIsDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-delete-user', {
        body: { userId: userToDelete.id },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Utente eliminato con successo', {
        description: `${userToDelete.full_name || userToDelete.username} è stato rimosso`,
      });
      
      setUserToDelete(null);
      loadUsers();
    } catch (error: unknown) {
      console.error('Delete error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Errore sconosciuto';
      toast.error('Errore eliminazione utente', { description: errorMessage });
    } finally {
      setIsDeleting(false);
    }
  }

  function openResetPassword(targetUser: UserWithRole) {
    const pwd = generatePassword();
    setResetPasswordUser(targetUser);
    setGeneratedPassword(pwd);
    setResetDone(false);
    setPasswordCopied(false);
  }

  async function handleResetPassword() {
    if (!resetPasswordUser) return;
    
    setIsResetting(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-reset-password', {
        body: { userId: resetPasswordUser.id, newPassword: generatedPassword },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResetDone(true);
      toast.success('Password reimpostata con successo');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Errore sconosciuto';
      toast.error('Errore reset password', { description: errorMessage });
    } finally {
      setIsResetting(false);
    }
  }

  async function copyPassword() {
    await navigator.clipboard.writeText(generatedPassword);
    setPasswordCopied(true);
    setTimeout(() => setPasswordCopied(false), 2000);
  }

  const canDeleteUser = (targetUser: UserWithRole) => targetUser.id !== user?.id;
  const displayName = (u: UserWithRole) => u.full_name || u.username || 'N/A';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background-secondary/50 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 shrink-0">
              <div className="p-2 rounded-lg bg-primary/10">
                <IronCondorIcon size={24} className="text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Option Tech</h1>
                <p className="text-xs text-muted-foreground hidden sm:block">Gestione utenti e iscrizioni</p>
              </div>
            </div>

            {/* Mobile: Indice dropdown */}
            <div className="sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Indice <Menu className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => navigate('/')}>
                    <ArrowLeft className="w-4 h-4 mr-2" /> Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/derivatives')}>
                    <TrendingUp className="w-4 h-4 mr-2" /> Strategie Derivati
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/risk-analyzer')}>
                    <ShieldAlert className="w-4 h-4 mr-2" /> Risk Analyzer
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowAddDialog(true)}>
                    <UserPlus className="w-4 h-4 mr-2" /> Aggiungi Utente
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={signOut}>
                    <LogOut className="w-4 h-4 mr-2" /> Esci
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            
            {/* Desktop: full button bar */}
            <div className="hidden sm:flex items-center gap-2">
              <Button variant="outline" size="sm" asChild className="shrink-0">
                <Link to="/">
                  <ArrowLeft className="w-4 h-4" />
                  <span className="ml-2">Dashboard</span>
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="shrink-0">
                <Link to="/derivatives">
                  <TrendingUp className="w-4 h-4" />
                  <span className="ml-2">Strategie Derivati</span>
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="shrink-0">
                <Link to="/risk-analyzer">
                  <ShieldAlert className="w-4 h-4" />
                  <span className="ml-2">Risk Analyzer</span>
                </Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={signOut} className="shrink-0">
                <LogOut className="w-4 h-4" />
                <span className="ml-2">Esci</span>
              </Button>
              
              <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogTrigger asChild>
                  <Button className="bg-primary hover:bg-primary-glow">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Aggiungi Utente
                  </Button>
                </DialogTrigger>
              <DialogContent className="bg-card border-border">
                <DialogHeader>
                  <DialogTitle>Nuovo Utente</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleAddUser} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome completo</Label>
                    <Input
                      id="name"
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                      className="bg-background-secondary border-border"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="username">Nome utente</Label>
                    <Input
                      id="username"
                      type="text"
                      placeholder="mario_rossi"
                      value={newUserUsername}
                      onChange={(e) => setNewUserUsername(e.target.value)}
                      className="bg-background-secondary border-border"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      className="bg-background-secondary border-border"
                      minLength={6}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full bg-primary hover:bg-primary-glow">
                    Crea Utente
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="users" className="space-y-6">
          <TabsList className="bg-background-secondary border border-border">
            <TabsTrigger value="users" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Users className="w-4 h-4 mr-2" />
              Utenti
            </TabsTrigger>
            <TabsTrigger value="portfolios" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Briefcase className="w-4 h-4 mr-2" />
              Portafogli
            </TabsTrigger>
            <TabsTrigger value="sectors" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <PieChart className="w-4 h-4 mr-2" />
              Settori
            </TabsTrigger>
            <TabsTrigger value="tickers" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Link2 className="w-4 h-4 mr-2" />
              Ticker
            </TabsTrigger>
            <TabsTrigger value="notifications" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Bell className="w-4 h-4 mr-2" />
              Notifiche
            </TabsTrigger>
            <TabsTrigger value="diagnostics" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Stethoscope className="w-4 h-4 mr-2" />
              Diagnostica
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <Card className="border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <div className="flex items-center gap-3">
                  <Users className="w-5 h-5 text-muted-foreground" />
                  <CardTitle>Utenti Registrati</CardTitle>
                  <Badge variant="secondary">{users.length}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Caricamento...
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border hover:bg-background-tertiary">
                        <TableHead>Utente</TableHead>
                        <TableHead>Username</TableHead>
                        <TableHead>Registrato</TableHead>
                        <TableHead>Ruolo</TableHead>
                        <TableHead className="text-right">Azioni</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((targetUser) => (
                        <TableRow key={targetUser.id} className="border-border hover:bg-background-tertiary">
                          <TableCell className="font-medium">
                            {targetUser.full_name || 'Nome non impostato'}
                            {targetUser.id === user?.id && (
                              <Badge variant="outline" className="ml-2 text-xs">Tu</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {targetUser.username || '—'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(targetUser.created_at)}
                          </TableCell>
                          <TableCell>
                            {targetUser.isAdmin ? (
                              <Badge className="bg-warning/10 text-warning border-warning/30">
                                <ShieldCheck className="w-3 h-3 mr-1" />
                                Admin
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Utente</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openResetPassword(targetUser)}
                                disabled={targetUser.id === user?.id}
                                title="Reset Password"
                              >
                                <KeyRound className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggleAdmin(targetUser.id, targetUser.isAdmin)}
                                disabled={targetUser.id === user?.id}
                              >
                                <Shield className="w-4 h-4 mr-1" />
                                {targetUser.isAdmin ? 'Rimuovi Admin' : 'Rendi Admin'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-loss hover:text-loss"
                                onClick={() => setUserToDelete(targetUser)}
                                disabled={!canDeleteUser(targetUser)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="portfolios">
            <PortfolioManager />
          </TabsContent>

          <TabsContent value="sectors">
            <SectorMappingManager />
          </TabsContent>

          <TabsContent value="tickers">
            <TickerMappingManager />
          </TabsContent>

          <TabsContent value="notifications">
            <AdminNotificationSettings />
          </TabsContent>

          <TabsContent value="diagnostics">
            <ResolutionDiagnostics />
          </TabsContent>
        </Tabs>
      </main>

      {/* Delete Confirmation Dialog */}
      {userToDelete && (
        <Dialog open onOpenChange={(open) => !open && setUserToDelete(null)}>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-loss">Conferma Eliminazione</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Stai per eliminare definitivamente l'utente <strong className="text-foreground">{displayName(userToDelete)}</strong>.
                <br /><br />
                Questa azione eliminerà anche tutti i dati associati (portfolio, posizioni, depositi, dati storici).
                <br /><br />
                <strong>Questa azione non può essere annullata.</strong>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button 
                variant="outline" 
                onClick={() => setUserToDelete(null)}
                disabled={isDeleting}
              >
                Annulla
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleDeleteUser}
                disabled={isDeleting}
                className="bg-loss hover:bg-loss/90"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Eliminazione...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Elimina Utente
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Reset Password Dialog */}
      {resetPasswordUser && (
        <Dialog open onOpenChange={(open) => !open && setResetPasswordUser(null)}>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="w-5 h-5" />
                Reset Password
              </DialogTitle>
              <DialogDescription>
                {resetDone
                  ? `La password di ${displayName(resetPasswordUser)} è stata reimpostata. Comunicala all'utente.`
                  : `Reimposta la password per ${displayName(resetPasswordUser)}.`
                }
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nuova password</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={generatedPassword}
                    onChange={(e) => setGeneratedPassword(e.target.value)}
                    className="bg-background-secondary border-border font-mono"
                    readOnly={resetDone}
                  />
                  <Button variant="outline" size="icon" onClick={copyPassword}>
                    {passwordCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setResetPasswordUser(null)}>
                {resetDone ? 'Chiudi' : 'Annulla'}
              </Button>
              {!resetDone && (
                <Button
                  onClick={handleResetPassword}
                  disabled={isResetting || !generatedPassword}
                  className="bg-primary hover:bg-primary-glow"
                >
                  {isResetting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Reset in corso...
                    </>
                  ) : (
                    'Reimposta Password'
                  )}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
