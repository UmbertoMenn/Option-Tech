import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Portfolio } from '@/types/portfolio';
import { toast } from 'sonner';

const SELECTED_PORTFOLIO_KEY = 'selectedPortfolioId';

interface PortfolioContextType {
  portfolios: Portfolio[];
  selectedPortfolio: Portfolio | null;
  selectPortfolio: (id: string) => void;
  createPortfolio: (name: string) => Promise<void>;
  deletePortfolio: (id: string) => Promise<void>;
  renamePortfolio: (id: string, name: string) => Promise<void>;
  isLoading: boolean;
}

const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined);

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    return localStorage.getItem(SELECTED_PORTFOLIO_KEY);
  });
  const [hasInitialized, setHasInitialized] = useState(false);

  // Fetch all portfolios for the user - ordered by last_updated DESC
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

  const portfolios = portfoliosQuery.data || [];

  // Reset quando user cambia (logout/login)
  useEffect(() => {
    if (!user) {
      setSelectedId(null);
      setHasInitialized(false);
    }
  }, [user]);

  // Auto-selezione robusta - PRIORITÀ: selectedId attuale > localStorage > fallback
  useEffect(() => {
    if (portfoliosQuery.isLoading || portfoliosQuery.isFetching) return;
    if (portfolios.length === 0) return;
    
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
      // Fallback: primo della lista (ordine deterministico)
      const fallbackId = portfolios[0].id;
      setSelectedId(fallbackId);
      localStorage.setItem(SELECTED_PORTFOLIO_KEY, fallbackId);
    }
    
    setHasInitialized(true);
  }, [portfolios, portfoliosQuery.isLoading, portfoliosQuery.isFetching, selectedId, hasInitialized]);

  const selectedPortfolio = portfolios.find(p => p.id === selectedId) || null;

  const selectPortfolio = useCallback((id: string) => {
    setSelectedId(id);
    localStorage.setItem(SELECTED_PORTFOLIO_KEY, id);
    // Invalidate position-related queries when switching portfolio
    queryClient.invalidateQueries({ queryKey: ['positions'] });
    queryClient.invalidateQueries({ queryKey: ['deposits'] });
    queryClient.invalidateQueries({ queryKey: ['historicalData'] });
    queryClient.invalidateQueries({ queryKey: ['derivativeOverrides'] });
  }, [queryClient]);

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
