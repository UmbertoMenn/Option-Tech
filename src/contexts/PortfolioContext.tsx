import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Portfolio } from '@/types/portfolio';
import { toast } from 'sonner';

const SELECTED_PORTFOLIO_KEY = 'selectedPortfolioId';
const ADMIN_VIEW_USER_KEY = 'adminViewUserId';
const ADMIN_VIEW_PORTFOLIO_KEY = 'adminViewPortfolioId';
const HISTORICAL_VIEW_DATE_KEY = 'historicalViewDate';
const HISTORICAL_VIEW_PORTFOLIO_KEY = 'historicalViewPortfolioId';

export const AGGREGATED_PORTFOLIO_ID = 'AGGREGATED';
export const AGGREGATED_USER_PREFIX = 'AGGREGATED_USER:';

export function isUserAggregatedId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(AGGREGATED_USER_PREFIX);
}

export function getUserIdFromAggregatedId(id: string): string {
  return id.replace(AGGREGATED_USER_PREFIX, '');
}

export function isAnyAggregatedId(id: string | null | undefined): boolean {
  return id === AGGREGATED_PORTFOLIO_ID || isUserAggregatedId(id);
}

interface PortfolioContextType {
  portfolios: Portfolio[];
  selectedPortfolio: Portfolio | null;
  selectPortfolio: (id: string) => void;
  createPortfolio: (name: string) => Promise<void>;
  deletePortfolio: (id: string) => Promise<void>;
  renamePortfolio: (id: string, name: string) => Promise<void>;
  isLoading: boolean;
  isReady: boolean;
  // Admin mode
  isAdminMode: boolean;
  adminViewUserId: string | null;
  setAdminViewPortfolio: (portfolioId: string, ownerUserId: string) => void;
  exitAdminMode: () => void;
  isAggregatedView: boolean;
  selectedPortfolioId: string | null;
  // Visualizzazione storica (portafoglio ad una data passata, sola lettura)
  historicalViewDate: string | null;
  isHistoricalView: boolean;
  enterHistoricalView: (date: string) => void;
  exitHistoricalView: () => void;
}


const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined);

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    // Se c'è una vista admin attiva in sessione, ripristina il portfolio admin
    const adminPid = sessionStorage.getItem(ADMIN_VIEW_PORTFOLIO_KEY);
    if (adminPid) return adminPid;
    return localStorage.getItem(SELECTED_PORTFOLIO_KEY);
  });
  const [hasInitialized, setHasInitialized] = useState(false);
  
  // Admin mode state (persistito in sessionStorage per sopravvivere a remount/refresh token)
  const [adminViewUserId, setAdminViewUserId] = useState<string | null>(() => {
    return sessionStorage.getItem(ADMIN_VIEW_USER_KEY);
  });
  const isAdminMode = adminViewUserId !== null && adminViewUserId !== user?.id;
  const isAggregatedView = isAnyAggregatedId(selectedId);

  // Visualizzazione storica: persiste in sessionStorage insieme al portfolio a
  // cui si riferisce, così un refresh la mantiene ma un cambio portafoglio la chiude.
  const [historicalViewDate, setHistoricalViewDate] = useState<string | null>(() => {
    const date = sessionStorage.getItem(HISTORICAL_VIEW_DATE_KEY);
    const pid = sessionStorage.getItem(HISTORICAL_VIEW_PORTFOLIO_KEY);
    const currentPid = sessionStorage.getItem(ADMIN_VIEW_PORTFOLIO_KEY) || localStorage.getItem(SELECTED_PORTFOLIO_KEY);
    if (date && pid && pid === currentPid) return date;
    return null;
  });
  const isHistoricalView = historicalViewDate !== null;

  // Fetch user's own portfolios - ordered by last_updated DESC
  const portfoliosQuery = useQuery({
    queryKey: ['portfolios', user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      const { data, error } = await supabase
        .from('portfolios')
        .select('*')
        .eq('user_id', user.id)
        .order('last_updated', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }); // Ordinamento secondario deterministico
      
      if (error) throw error;
      return data as unknown as Portfolio[];
    },
    enabled: !!user,
    staleTime: 30000, // 30 secondi - riduce refetch che causano race condition
  });

  // Fetch admin view portfolio (when in admin mode viewing another user's portfolio)
  const adminPortfolioQuery = useQuery({
    queryKey: ['admin-view-portfolio', selectedId],
    queryFn: async () => {
      if (!selectedId || isAnyAggregatedId(selectedId)) return null;
      
      const { data, error } = await supabase
        .from('portfolios')
        .select('*')
        .eq('id', selectedId)
        .single();
      
      if (error) throw error;
      return data as unknown as Portfolio;
    },
    enabled: isAdminMode && !!selectedId && !isAnyAggregatedId(selectedId),
  });

  // Admin-only: most recently updated CLIENT portfolio (escluso quello dell'admin),
  // usato come landing iniziale all'apertura dell'app per gli admin.
  const latestClientPortfolioQuery = useQuery({
    queryKey: ['admin-latest-client-portfolio', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, user_id, last_updated, created_at')
        .neq('user_id', user.id)
        .order('last_updated', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; user_id: string } | null;
    },
    enabled: !!user && isAdmin,
    staleTime: 60000,
  });

  const portfolios = portfoliosQuery.data || [];

  // Reset quando user cambia (logout o switch account): scarta selezioni
  // orfane dalla sessione precedente per evitare che vengano usate come base
  // per l'auto-selezione al login successivo.
  const lastUserIdRef = useRef<string | null>(user?.id ?? null);
  useEffect(() => {
    const currentId = user?.id ?? null;
    if (currentId !== lastUserIdRef.current) {
      lastUserIdRef.current = currentId;
      setSelectedId(null);
      setHasInitialized(false);
      setAdminViewUserId(null);
      sessionStorage.removeItem(ADMIN_VIEW_USER_KEY);
      sessionStorage.removeItem(ADMIN_VIEW_PORTFOLIO_KEY);
      sessionStorage.removeItem(HISTORICAL_VIEW_DATE_KEY);
      sessionStorage.removeItem(HISTORICAL_VIEW_PORTFOLIO_KEY);
      // localStorage del portafoglio personale viene rivalutato dall'effetto di
      // auto-selezione: se non appartiene al nuovo utente, verrà scartato lì.
    }
  }, [user?.id]);


  // Auto-selezione robusta - PRIORITÀ: selectedId attuale > localStorage > fallback
  useEffect(() => {
    if (portfoliosQuery.isLoading || portfoliosQuery.isFetching) return;
    
    // Skip auto-selection when in admin mode (viewing another user's portfolio)
    if (adminViewUserId !== null && adminViewUserId !== user?.id) {
      if (!hasInitialized) setHasInitialized(true);
      return;
    }
    
    // ADMIN LANDING: al primo bootstrap, se l'admin non ha già una vista admin attiva
    // in sessionStorage, atterra automaticamente sull'ultimo portafoglio cliente aggiornato.
    if (
      !hasInitialized &&
      isAdmin &&
      !sessionStorage.getItem(ADMIN_VIEW_PORTFOLIO_KEY) &&
      !latestClientPortfolioQuery.isLoading
    ) {
      const latest = latestClientPortfolioQuery.data;
      if (latest) {
        setAdminViewUserId(latest.user_id);
        setSelectedId(latest.id);
        sessionStorage.setItem(ADMIN_VIEW_USER_KEY, latest.user_id);
        sessionStorage.setItem(ADMIN_VIEW_PORTFOLIO_KEY, latest.id);
        queryClient.invalidateQueries({ queryKey: ['positions'] });
        queryClient.invalidateQueries({ queryKey: ['deposits'] });
        queryClient.invalidateQueries({ queryKey: ['historicalData'] });
        queryClient.invalidateQueries({ queryKey: ['derivativeOverrides'] });
        setHasInitialized(true);
        return;
      }
      // Se non ci sono portafogli clienti, prosegue col fallback personale
    }
    
    if (portfolios.length === 0) return;
    
    // Se è selezionato un aggregato, non resettare - è una selezione valida
    if (isAnyAggregatedId(selectedId)) {
      if (!hasInitialized) setHasInitialized(true);
      return;
    }
    
    // PRIMA: verifica se selezione attuale è già valida - se sì, esci subito
    if (selectedId && portfolios.some(p => p.id === selectedId)) {
      if (!hasInitialized) setHasInitialized(true);
      return;
    }
    
    // SOLO se selectedId non valido, prova localStorage
    const savedId = localStorage.getItem(SELECTED_PORTFOLIO_KEY);
    const savedExists = savedId && portfolios.some(p => p.id === savedId);
    
    if (savedExists) {
      setSelectedId(savedId);
      localStorage.setItem(SELECTED_PORTFOLIO_KEY, savedId); // Conferma
    } else {
      // Pulizia localStorage orfano
      if (savedId) {
        console.log('Removing orphan portfolio ID from localStorage:', savedId);
        localStorage.removeItem(SELECTED_PORTFOLIO_KEY);
      }
      // Fallback: primo della lista (ordine deterministico)
      const fallbackId = portfolios[0].id;
      setSelectedId(fallbackId);
      localStorage.setItem(SELECTED_PORTFOLIO_KEY, fallbackId);
    }
    
    setHasInitialized(true);
  }, [portfolios, portfoliosQuery.isLoading, portfoliosQuery.isFetching, selectedId, hasInitialized, adminViewUserId, user?.id, isAdmin, latestClientPortfolioQuery.isLoading, latestClientPortfolioQuery.data, queryClient]);

  // Selected portfolio: use admin query if in admin mode, otherwise use own portfolios
  const selectedPortfolio = isAdminMode 
    ? adminPortfolioQuery.data || null 
    : portfolios.find(p => p.id === selectedId) || null;

  const invalidateHistoricalScopedQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['positions'] });
    queryClient.invalidateQueries({ queryKey: ['strategy-configurations'] });
    queryClient.invalidateQueries({ queryKey: ['derivative-overrides'] });
    queryClient.invalidateQueries({ queryKey: ['gp-holdings'] });
    queryClient.invalidateQueries({ queryKey: ['full-snapshot'] });
  }, [queryClient]);

  const enterHistoricalView = useCallback((date: string) => {
    if (!selectedId || isAnyAggregatedId(selectedId)) return; // solo portafogli singoli
    setHistoricalViewDate(date);
    sessionStorage.setItem(HISTORICAL_VIEW_DATE_KEY, date);
    sessionStorage.setItem(HISTORICAL_VIEW_PORTFOLIO_KEY, selectedId);
    invalidateHistoricalScopedQueries();
  }, [selectedId, invalidateHistoricalScopedQueries]);

  const exitHistoricalView = useCallback(() => {
    setHistoricalViewDate(null);
    sessionStorage.removeItem(HISTORICAL_VIEW_DATE_KEY);
    sessionStorage.removeItem(HISTORICAL_VIEW_PORTFOLIO_KEY);
    invalidateHistoricalScopedQueries();
  }, [invalidateHistoricalScopedQueries]);

  const selectPortfolio = useCallback((id: string) => {
    // Cambio portafoglio → esce dalla vista storica (riferita al portafoglio precedente)
    setHistoricalViewDate(null);
    sessionStorage.removeItem(HISTORICAL_VIEW_DATE_KEY);
    sessionStorage.removeItem(HISTORICAL_VIEW_PORTFOLIO_KEY);
    setSelectedId(id);
    // In admin mode aggiorna la chiave di sessione admin, non lo storage del portfolio personale
    if (adminViewUserId !== null && adminViewUserId !== user?.id) {
      sessionStorage.setItem(ADMIN_VIEW_PORTFOLIO_KEY, id);
    } else {
      localStorage.setItem(SELECTED_PORTFOLIO_KEY, id);
    }
    // Invalidate position-related queries when switching portfolio
    queryClient.invalidateQueries({ queryKey: ['positions'] });
    queryClient.invalidateQueries({ queryKey: ['deposits'] });
    queryClient.invalidateQueries({ queryKey: ['historicalData'] });
    queryClient.invalidateQueries({ queryKey: ['derivativeOverrides'] });
  }, [queryClient, adminViewUserId, user?.id]);

  // Create portfolio mutation
  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!user) throw new Error('Utente non autenticato');
      
      const { data, error } = await supabase
        .from('portfolios')
        .insert({ user_id: user.id, name })
        .select()
        .single();
      
      if (error) throw error;
      return data as unknown as Portfolio;
    },
    onSuccess: (newPortfolio) => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
      selectPortfolio(newPortfolio.id);
      toast.success(`Portfolio "${newPortfolio.name}" creato!`);
    },
    onError: (error) => {
      toast.error('Errore nella creazione', { description: error.message });
    },
  });

  // Delete portfolio mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('portfolios')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return id;
    },
    onSuccess: (deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
      // If deleted was selected, switch to another
      if (selectedId === deletedId) {
        const remaining = portfolios.filter(p => p.id !== deletedId);
        if (remaining.length > 0) {
          selectPortfolio(remaining[0].id);
        } else {
          setSelectedId(null);
          localStorage.removeItem(SELECTED_PORTFOLIO_KEY);
        }
      }
      toast.success('Portfolio eliminato');
    },
    onError: (error) => {
      toast.error('Errore nell\'eliminazione', { description: error.message });
    },
  });

  // Rename portfolio mutation
  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase
        .from('portfolios')
        .update({ name })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
      queryClient.invalidateQueries({ queryKey: ['admin-view-portfolio'] });
      toast.success('Portfolio rinominato');
    },
    onError: (error) => {
      toast.error('Errore nel rinominare', { description: error.message });
    },
  });

  const createPortfolio = async (name: string) => {
    await createMutation.mutateAsync(name);
  };

  const deletePortfolio = async (id: string) => {
    await deleteMutation.mutateAsync(id);
  };

  const renamePortfolio = async (id: string, name: string) => {
    await renameMutation.mutateAsync({ id, name });
  };

  // Admin mode functions
  const setAdminViewPortfolio = useCallback((portfolioId: string, ownerUserId: string) => {
    // Cambio contesto → esce dalla vista storica
    setHistoricalViewDate(null);
    sessionStorage.removeItem(HISTORICAL_VIEW_DATE_KEY);
    sessionStorage.removeItem(HISTORICAL_VIEW_PORTFOLIO_KEY);
    setAdminViewUserId(ownerUserId);
    setSelectedId(portfolioId);
    // Persisti la vista admin in sessionStorage per sopravvivere a remount/refresh token
    sessionStorage.setItem(ADMIN_VIEW_USER_KEY, ownerUserId);
    sessionStorage.setItem(ADMIN_VIEW_PORTFOLIO_KEY, portfolioId);
    // Invalidate queries to fetch data for the new portfolio
    queryClient.invalidateQueries({ queryKey: ['positions'] });
    queryClient.invalidateQueries({ queryKey: ['deposits'] });
    queryClient.invalidateQueries({ queryKey: ['historicalData'] });
    queryClient.invalidateQueries({ queryKey: ['derivativeOverrides'] });
  }, [queryClient]);

  const exitAdminMode = useCallback(() => {
    setHistoricalViewDate(null);
    sessionStorage.removeItem(HISTORICAL_VIEW_DATE_KEY);
    sessionStorage.removeItem(HISTORICAL_VIEW_PORTFOLIO_KEY);
    setAdminViewUserId(null);
    sessionStorage.removeItem(ADMIN_VIEW_USER_KEY);
    sessionStorage.removeItem(ADMIN_VIEW_PORTFOLIO_KEY);
    // Reset to user's own portfolio
    const savedId = localStorage.getItem(SELECTED_PORTFOLIO_KEY);
    if (savedId && portfolios.some(p => p.id === savedId)) {
      setSelectedId(savedId);
    } else if (portfolios.length > 0) {
      setSelectedId(portfolios[0].id);
    }
    queryClient.invalidateQueries({ queryKey: ['positions'] });
    queryClient.invalidateQueries({ queryKey: ['deposits'] });
  }, [portfolios, queryClient]);

  const isReady =
    !!user &&
    hasInitialized &&
    !portfoliosQuery.isLoading &&
    (isAdminMode ? !adminPortfolioQuery.isLoading : true);

  return (
    <PortfolioContext.Provider
      value={{
        portfolios,
        selectedPortfolio,
        selectPortfolio,
        createPortfolio,
        deletePortfolio,
        renamePortfolio,
        isLoading: portfoliosQuery.isLoading,
        isReady,
        // Admin mode
        isAdminMode,
        adminViewUserId,
        setAdminViewPortfolio,
        exitAdminMode,
        isAggregatedView,

        selectedPortfolioId: selectedId,
        historicalViewDate,
        isHistoricalView,
        enterHistoricalView,
        exitHistoricalView,
      }}
    >
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolioContext() {
  const context = useContext(PortfolioContext);
  if (context === undefined) {
    throw new Error('usePortfolioContext must be used within a PortfolioProvider');
  }
  return context;
}
