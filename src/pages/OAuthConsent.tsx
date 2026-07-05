import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AuthForm } from "@/components/auth/AuthForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IronCondorIcon } from "@/components/ui/iron-condor-icon";

// La superficie `supabase.auth.oauth` è in beta e non tipizzata: wrapper minimale.
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{
    data: {
      client?: { name?: string; client_id?: string };
      redirect_url?: string;
      redirect_to?: string;
      scopes?: string[];
    } | null;
    error: { message: string } | null;
  }>;
  approveAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string; redirect_to?: string } | null;
    error: { message: string } | null;
  }>;
  denyAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string; redirect_to?: string } | null;
    error: { message: string } | null;
  }>;
};

function getOAuthApi(): OAuthApi | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (supabase.auth as any).oauth;
  return api ?? null;
}

export default function OAuthConsent() {
  const { user, loading } = useAuth();
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<Awaited<
    ReturnType<OAuthApi["getAuthorizationDetails"]>
  >["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Se l'utente non è ancora autenticato, salviamo la URL corrente e mostriamo il login.
  useEffect(() => {
    if (!loading && !user) {
      sessionStorage.setItem(
        "oauth_next",
        window.location.pathname + window.location.search,
      );
    }
  }, [loading, user]);

  useEffect(() => {
    let active = true;
    if (!user) return;
    if (!authorizationId) {
      setError("Parametro authorization_id mancante");
      return;
    }
    const api = getOAuthApi();
    if (!api) {
      setError("Supabase OAuth non disponibile in questo client");
      return;
    }
    (async () => {
      const { data, error } = await api.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [user, authorizationId]);

  async function decide(approve: boolean) {
    const api = getOAuthApi();
    if (!api) return;
    setBusy(true);
    const { data, error } = approve
      ? await api.approveAuthorization(authorizationId)
      : await api.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      return setError("Nessun redirect restituito dall'authorization server.");
    }
    window.location.href = target;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Caricamento…</p>
      </div>
    );
  }

  if (!user) {
    // Il pathname corrente è già stato salvato in sessionStorage.
    // AppRoutes leggerà `oauth_next` dopo il login e ci riporterà qui.
    return <AuthForm />;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 space-y-3">
            <h1 className="text-xl font-semibold">Impossibile completare l'autorizzazione</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Caricamento richiesta di autorizzazione…</p>
      </div>
    );
  }

  const clientName = details.client?.name ?? "un'app esterna";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-primary/10 border border-primary/20 mb-2">
            <IronCondorIcon size={32} className="text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Autorizza {clientName}</h1>
          <p className="text-sm text-muted-foreground">
            {clientName} sta chiedendo di accedere a Option Tech come te. Potrà utilizzare
            gli strumenti MCP esposti dall'app (lettura portafogli, posizioni e strategie).
          </p>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur">
          <CardContent className="pt-6 space-y-3">
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => decide(true)}
            >
              Approva
            </Button>
            <Button
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={() => decide(false)}
            >
              Rifiuta
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
