import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PortfolioProvider } from "@/contexts/PortfolioContext";
import { AuthForm } from "@/components/auth/AuthForm";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ScrollArrows } from "@/components/ui/ScrollArrows";
import { DisclaimerDialog } from "@/components/auth/DisclaimerDialog";
import { HistoricalViewBanner } from "@/components/historical/HistoricalViewBanner";
import { toast } from "sonner";
import { ThemeProvider } from "next-themes";

// Lazy load heavy components to improve FCP
const Dashboard = lazy(() => import("@/components/dashboard/Dashboard").then(m => ({ default: m.Dashboard })));
const AdminPanel = lazy(() => import("@/components/admin/AdminPanel").then(m => ({ default: m.AdminPanel })));
const Derivatives = lazy(() => import("@/pages/Derivatives").then(m => ({ default: m.Derivatives })));
const RiskAnalyzer = lazy(() => import("@/pages/RiskAnalyzer").then(m => ({ default: m.RiskAnalyzer })));
const RiskSimulator = lazy(() => import("@/pages/RiskSimulator").then(m => ({ default: m.RiskSimulator })));
const OptionAnalyzer = lazy(() => import("@/pages/OptionAnalyzer").then(m => ({ default: m.OptionAnalyzer })));
const ResetPassword = lazy(() => import("@/pages/ResetPassword").then(m => ({ default: m.ResetPassword })));
const Simulator = lazy(() => import("@/pages/Simulator"));
const Backtesting = lazy(() => import("@/pages/Backtesting"));
const OAuthConsent = lazy(() => import("@/pages/OAuthConsent"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();
const STRATEGY_WIZARD_ACTIVE_KEY = 'strategyConfigWizardActive';

// Minimal loading fallback for lazy components
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-muted-foreground">Caricamento...</p>
      </div>
    </div>
  );
}

function InProgressRouteGuard() {
  const location = useLocation();
  const navigate = useNavigate();
  const lastPathRef = useRef<string>(location.pathname);

  useEffect(() => {
    const prevPath = lastPathRef.current;
    lastPathRef.current = location.pathname;

    const raw = sessionStorage.getItem(STRATEGY_WIZARD_ACTIVE_KEY);
    if (!raw) return;

    // Marker bozza scaduto → pulizia e stop.
    try {
      const active = JSON.parse(raw) as { ts?: number };
      if (!active.ts || Date.now() - active.ts > 4 * 60 * 60 * 1000) {
        sessionStorage.removeItem(STRATEGY_WIZARD_ACTIVE_KEY);
        return;
      }
    } catch {
      sessionStorage.removeItem(STRATEGY_WIZARD_ACTIVE_KEY);
      return;
    }

    // Rimbalzo INVOLONTARIO: eravamo in /derivatives (con config attiva) e qualcosa
    // ci ha spostati su / senza una navigazione esplicita dell'utente. Solo in questo
    // caso riportiamo l'utente al wizard. Una navigazione VOLUTA verso la dashboard
    // (da un altro path, o cliccando un link) NON viene intercettata: l'utente resta
    // libero di muoversi. Il Fix in AuthContext elimina la causa del rimbalzo;
    // questo è solo una rete di sicurezza per i casi residui.
    if (location.pathname === '/' && prevPath === '/derivatives') {
      navigate('/derivatives', { replace: true });
    }
  }, [location.pathname, navigate]);

  return null;
}

function AppRoutes() {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(
    () => sessionStorage.getItem('disclaimerAccepted') === 'true'
  );

  useEffect(() => {
    if (user) {
      const accepted = sessionStorage.getItem('disclaimerAccepted') === 'true';
      setDisclaimerAccepted(accepted);
    }
  }, [user]);

  // Dopo il login (e disclaimer accettato), se c'è un intent OAuth salvato
  // riportiamo l'utente alla pagina di consenso originale.
  useEffect(() => {
    if (!user || !disclaimerAccepted) return;
    const next = sessionStorage.getItem('oauth_next');
    if (!next) return;
    sessionStorage.removeItem('oauth_next');
    if (next.startsWith('/') && !next.startsWith('//')) {
      navigate(next, { replace: true });
    }
  }, [user, disclaimerAccepted, navigate]);

  const handleAcceptDisclaimer = () => {
    sessionStorage.setItem('disclaimerAccepted', 'true');
    setDisclaimerAccepted(true);
    toast.success('Benvenuto!');
  };

  // La pagina di consenso OAuth deve poter renderizzare anche senza sessione:
  // gestisce internamente il login (salva `oauth_next` e mostra AuthForm).
  if (location.pathname === '/.lovable/oauth/consent') {
    return (
      <Suspense fallback={<PageLoader />}>
        <OAuthConsent />
      </Suspense>
    );
  }

  // Reset password is now handled by admin, redirect to login
  if (location.pathname === '/reset-password') {
    return <AuthForm />;
  }

  if (loading) {
    return <PageLoader />;
  }

  if (!user) {
    return <AuthForm />;
  }

  if (!disclaimerAccepted) {
    return <DisclaimerDialog open={true} onAccept={handleAcceptDisclaimer} onDecline={() => signOut()} />;
  }

  return (
    <PortfolioProvider>
      <InProgressRouteGuard />
      <ScrollArrows />
      <HistoricalViewBanner />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={
            <ErrorBoundary title="Errore nel caricamento della dashboard">
              <Dashboard />
            </ErrorBoundary>
          } />
          <Route path="/derivatives" element={
            <ErrorBoundary title="Errore nel caricamento delle strategie derivati">
              <Derivatives />
            </ErrorBoundary>
          } />
          <Route path="/risk-analyzer" element={
            <ErrorBoundary title="Errore nel caricamento del Risk Analyzer">
              <RiskAnalyzer />
            </ErrorBoundary>
          } />
          <Route path="/risk-simulator" element={
            <ErrorBoundary title="Errore nel caricamento dello Stress Lab">
              <RiskSimulator />
            </ErrorBoundary>
          } />
          <Route path="/option-analyzer" element={
            <ErrorBoundary title="Errore nel caricamento dell'Option Analyzer">
              <OptionAnalyzer />
            </ErrorBoundary>
          } />
          <Route path="/admin" element={
            <ErrorBoundary title="Errore nel caricamento del pannello admin">
              <AdminPanel />
            </ErrorBoundary>
          } />
          <Route path="/simulator" element={
            <ErrorBoundary title="Errore nel caricamento del simulatore">
              <Simulator />
            </ErrorBoundary>
          } />
          <Route path="/backtesting" element={
            <ErrorBoundary title="Errore nel caricamento del Backtesting">
              <Backtesting />
            </ErrorBoundary>
          } />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </PortfolioProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" storageKey="option-tech-theme">
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
