import { lazy, Suspense, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PortfolioProvider } from "@/contexts/PortfolioContext";
import { AuthForm } from "@/components/auth/AuthForm";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DisclaimerDialog } from "@/components/auth/DisclaimerDialog";
import { toast } from "sonner";

// Lazy load heavy components to improve FCP
const Dashboard = lazy(() => import("@/components/dashboard/Dashboard").then(m => ({ default: m.Dashboard })));
const AdminPanel = lazy(() => import("@/components/admin/AdminPanel").then(m => ({ default: m.AdminPanel })));
const Derivatives = lazy(() => import("@/pages/Derivatives").then(m => ({ default: m.Derivatives })));
const RiskAnalyzer = lazy(() => import("@/pages/RiskAnalyzer").then(m => ({ default: m.RiskAnalyzer })));
const ResetPassword = lazy(() => import("@/pages/ResetPassword").then(m => ({ default: m.ResetPassword })));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

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

function AppRoutes() {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(
    () => sessionStorage.getItem('disclaimerAccepted') === 'true'
  );

  const handleAcceptDisclaimer = () => {
    sessionStorage.setItem('disclaimerAccepted', 'true');
    setDisclaimerAccepted(true);
    toast.success('Benvenuto!');
  };

  // Allow reset-password route even when not logged in
  if (location.pathname === '/reset-password') {
    return (
      <Suspense fallback={<PageLoader />}>
        <ResetPassword />
      </Suspense>
    );
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
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={
            <ErrorBoundary title="Errore nel caricamento della dashboard">
              <Dashboard />
            </ErrorBoundary>
          } />
          <Route path="/derivatives" element={<Derivatives />} />
          <Route path="/risk-analyzer" element={<RiskAnalyzer />} />
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </PortfolioProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
