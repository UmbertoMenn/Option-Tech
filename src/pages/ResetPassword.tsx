import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Lock, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

export function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const verifyToken = async () => {
      // Get token_hash from query parameters (survives Lovable login redirect!)
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get('token_hash');
      const type = params.get('type');

      console.log('Reset password params:', { tokenHash: !!tokenHash, type });

      if (tokenHash && type === 'recovery') {
        try {
          // Verify the OTP token and create a session
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'recovery',
          });

          if (verifyError) {
            console.error('OTP verification error:', verifyError);
            setError('Link di reset non valido o scaduto. Richiedi un nuovo link.');
          } else {
            console.log('OTP verified successfully');
            setError(null);
          }
        } catch (err) {
          console.error('Unexpected error during OTP verification:', err);
          setError('Errore durante la verifica del link.');
        }
        setLoading(false);
        return;
      }

      // Fallback: Check for existing session (in case user refreshes after verification)
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        console.log('Existing session found');
        setLoading(false);
        setError(null);
      } else {
        console.log('No token_hash and no session');
        setLoading(false);
        setError('Link di reset non valido o scaduto. Richiedi un nuovo link.');
      }
    };

    verifyToken();
  }, []);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast.error('Le password non coincidono');
      return;
    }

    if (password.length < 6) {
      toast.error('La password deve essere di almeno 6 caratteri');
      return;
    }

    setSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) {
        toast.error('Errore nel reset della password', {
          description: error.message,
        });
      } else {
        setSuccess(true);
        toast.success('Password aggiornata con successo!');
        
        // Redirect to home after 2 seconds
        setTimeout(() => {
          navigate('/');
        }, 2000);
      }
    } catch (err) {
      toast.error('Errore imprevisto');
    } finally {
      setSubmitting(false);
    }
  };

  // Show loading while checking auth state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Verifica link in corso...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md border-border/50 bg-card/80 backdrop-blur">
          <CardHeader className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-destructive/10 border border-destructive/20 mb-4 mx-auto">
              <Lock className="w-8 h-8 text-destructive" />
            </div>
            <CardTitle>Link non valido</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={() => navigate('/')} 
              className="w-full bg-primary hover:bg-primary-glow"
            >
              Torna al login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md border-border/50 bg-card/80 backdrop-blur">
          <CardHeader className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-success/10 border border-success/20 mb-4 mx-auto">
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
            <CardTitle>Password aggiornata!</CardTitle>
            <CardDescription>Verrai reindirizzato alla home...</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-primary/10 border border-primary/20 mb-4">
            <TrendingUp className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Nuova Password</h1>
          <p className="text-muted-foreground">Inserisci la tua nuova password</p>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur">
          <CardContent className="pt-6">
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">Nuova Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 bg-background-secondary border-border"
                    minLength={6}
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">Minimo 6 caratteri</p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Conferma Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10 bg-background-secondary border-border"
                    minLength={6}
                    required
                  />
                </div>
              </div>
              
              <Button 
                type="submit" 
                className="w-full bg-primary hover:bg-primary-glow transition-all hover:shadow-glow-primary"
                disabled={submitting}
              >
                {submitting ? 'Aggiornamento...' : 'Aggiorna Password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
