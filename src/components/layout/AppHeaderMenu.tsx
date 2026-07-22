import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { TrendingUp, Menu, ShieldAlert, Settings, Sun, Moon, LogOut, LineChart, LayoutDashboard, FlaskConical, History, BarChart3 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { PortfolioSelector } from '@/components/portfolio/PortfolioSelector';
import { HistoricalViewDialog } from '@/components/historical/HistoricalViewDialog';

interface AppHeaderMenuProps {
  includePortfolioSelector?: boolean;
}

export function AppHeaderMenu({ includePortfolioSelector = true }: AppHeaderMenuProps) {
  const { isAdmin, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { isHistoricalView, exitHistoricalView } = usePortfolioContext();
  const [historicalDialogOpen, setHistoricalDialogOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname === '/';

  return (
    <div className="flex items-center gap-2">
      {!isDashboard && (
        <Button variant="outline" size="sm" asChild className="shrink-0">
          <Link to="/">
            <LayoutDashboard className="w-4 h-4" />
            <span className="ml-2">Dashboard</span>
          </Link>
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0 min-w-[140px]">
            <Menu className="w-4 h-4 mr-2" />
            Menù
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {includePortfolioSelector && (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider">
                Portafoglio
              </DropdownMenuLabel>
              <div className="px-2 py-1.5">
                <PortfolioSelector fullWidth />
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={() => navigate('/')}>
            <LayoutDashboard className="w-4 h-4 mr-2" />
            Dashboard
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/derivatives')}>
            <TrendingUp className="w-4 h-4 mr-2" />
            Strategie Derivati
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/risk-analyzer')}>
            <ShieldAlert className="w-4 h-4 mr-2" />
            Risk Analyzer
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/risk-simulator')}>
            <FlaskConical className="w-4 h-4 mr-2" />
            Stress Lab
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/option-analyzer')}>
            <LineChart className="w-4 h-4 mr-2" />
            Option Analyzer
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem onClick={() => navigate('/backtesting')}>
              <BarChart3 className="w-4 h-4 mr-2" />
              Backtesting
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {isHistoricalView ? (
            <DropdownMenuItem onClick={exitHistoricalView}>
              <History className="w-4 h-4 mr-2" />
              Esci da Visualizzazione Storica
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setHistoricalDialogOpen(true)}>
              <History className="w-4 h-4 mr-2" />
              Visualizzazione Storica
            </DropdownMenuItem>
          )}
          {isAdmin && (
            <DropdownMenuItem onClick={() => navigate('/admin')}>
              <Settings className="w-4 h-4 mr-2" />
              Admin
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun className="w-4 h-4 mr-2" /> : <Moon className="w-4 h-4 mr-2" />}
            {theme === 'dark' ? 'Tema chiaro' : 'Tema scuro'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={signOut}>
            <LogOut className="w-4 h-4 mr-2" />
            Esci
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <HistoricalViewDialog open={historicalDialogOpen} onOpenChange={setHistoricalDialogOpen} />
    </div>
  );
}

export default AppHeaderMenu;
