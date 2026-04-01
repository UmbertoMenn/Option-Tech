import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Lock, User, ArrowLeft, CheckCircle } from 'lucide-react';
import { IronCondorIcon } from '@/components/ui/iron-condor-icon';
import { toast } from 'sonner';

export function AuthForm() {
  const { signIn } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotUsername, setForgotUsername] = useState('');
  const [resetRequested, setResetRequested] = useState(false);
  
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!forgotUsername.trim()) {
      toast.error('Inserisci il tuo nome utente');
      return;
    }
    
    setLoading(true);
    
    try {
      const response = await supabase.functions.invoke('generate-reset-link', {
        body: {
          username: forgotUsername.trim(),
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Errore durante l\'invio');
      }

      setResetRequested(true);
    } catch (error: any) {
      console.error('Error sending reset request:', error);
      // Always show success to prevent username enumeration
      setResetRequested(true);
    }
    
    setLoading(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    const { error } = await signIn(loginUsername, loginPassword);
    
    if (error) {
      toast.error('Errore di login', {
        description: 'Nome utente o password non validi',
      });
    }
    
    setLoading(false);
  };

  // Forgot Password View
  if (showForgotPassword) {
    // Show success message after request
    if (resetRequested) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="w-full max-w-md space-y-8">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-primary/10 border border-primary/20 mb-4">
                <CheckCircle className="w-8 h-8 text-primary" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">Richiesta Inviata</h1>
              <p className="text-muted-foreground">
                La richiesta di reset password è stata inviata all'amministratore. 
                Verrai contattato per il reset della password.
              </p>
            </div>

            <Card className="border-border/50 bg-card/80 backdrop-blur">
              <CardContent className="pt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setResetRequested(false);
                    setForgotUsername('');
                  }}
                  className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Torna al login
                </button>
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-primary/10 border border-primary/20 mb-4">
              <User className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Reset Password</h1>
            <p className="text-muted-foreground">Inserisci il tuo nome utente per richiedere il reset</p>
          </div>

          <Card className="border-border/50 bg-card/80 backdrop-blur">
            <CardContent className="pt-6">
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="forgot-username">Nome utente</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="forgot-username"
                      type="text"
                      placeholder="mario_rossi"
                      value={forgotUsername}
                      onChange={(e) => setForgotUsername(e.target.value)}
                      className="pl-10 bg-background-secondary border-border"
                      required
                    />
                  </div>
                </div>
                
                <Button 
                  type="submit" 
                  className="w-full bg-primary hover:bg-primary-glow transition-all hover:shadow-glow-primary"
                  disabled={loading}
                >
                  {loading ? 'Invio in corso...' : 'Richiedi reset password'}
                </Button>
                
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(false)}
                  className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Torna al login
                </button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-primary/10 border border-primary/20 mb-4">
            <IronCondorIcon size={32} className="text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Option Tech</h1>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur">
          <CardContent className="pt-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-username">Nome utente</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="login-username"
                    type="text"
                    placeholder="mario_rossi"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    className="pl-10 bg-background-secondary border-border"
                    required
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="pl-10 bg-background-secondary border-border"
                    required
                  />
                </div>
              </div>
              
              <Button 
                type="submit" 
                className="w-full bg-primary hover:bg-primary-glow transition-all hover:shadow-glow-primary"
                disabled={loading}
              >
                {loading ? 'Accesso in corso...' : 'Accedi'}
              </Button>
              
              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="w-full text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                Password dimenticata?
              </button>
            </form>
          </CardContent>
        </Card>
        
        <p className="text-center text-xs text-muted-foreground">
          Accedendo accetti i termini di servizio e la privacy policy.
        </p>
      </div>
    </div>
  );
}
