import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Portfolio } from '@/types/portfolio';

export interface PortfolioWithOwner extends Portfolio {
  owner_email: string;
  owner_name: string | null;
}

export function useAdminPortfolios() {
  const { isAdmin, user } = useAuth();

  // Fetch all portfolios with owner info (admin only)
  const allPortfoliosQuery = useQuery({
    queryKey: ['admin-all-portfolios'],
    queryFn: async () => {
      // First get all portfolios
      const { data: portfolios, error: portfoliosError } = await supabase
        .from('portfolios')
        .select('*')
        .order('last_updated', { ascending: false, nullsFirst: false });

      if (portfoliosError) throw portfoliosError;

      // Get all profiles to map user_id -> email/name
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, email, full_name');

      if (profilesError) throw profilesError;

      const profileMap = new Map(
        (profiles || []).map(p => [p.user_id, { email: p.email, name: p.full_name }])
      );

      // Combine data
      const portfoliosWithOwner: PortfolioWithOwner[] = (portfolios || []).map(p => ({
        ...p,
        owner_email: profileMap.get(p.user_id)?.email || 'Email sconosciuta',
        owner_name: profileMap.get(p.user_id)?.name || null,
      })) as PortfolioWithOwner[];

      return portfoliosWithOwner;
    },
    enabled: isAdmin,
  });

  // Get portfolios grouped by user
  const portfoliosByUser = allPortfoliosQuery.data?.reduce((acc, portfolio) => {
    const key = portfolio.user_id;
    if (!acc[key]) {
      acc[key] = {
        userId: key,
        email: portfolio.owner_email,
        name: portfolio.owner_name,
        portfolios: [],
      };
    }
    acc[key].portfolios.push(portfolio);
    return acc;
  }, {} as Record<string, { userId: string; email: string; name: string | null; portfolios: PortfolioWithOwner[] }>) || {};

  // Get admin's own portfolios (for copy feature)
  const adminPortfolios = allPortfoliosQuery.data?.filter(p => p.user_id === user?.id) || [];

  // Get other users (not including current admin)
  const otherUsers = Object.values(portfoliosByUser).filter(u => u.userId !== user?.id);

  return {
    allPortfolios: allPortfoliosQuery.data || [],
    portfoliosByUser,
    adminPortfolios,
    otherUsers,
    isLoading: allPortfoliosQuery.isLoading,
    refetch: allPortfoliosQuery.refetch,
  };
}
