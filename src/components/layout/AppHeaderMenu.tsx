import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { TrendingUp, Menu, ShieldAlert, Settings, Sun, Moon, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { PortfolioSelector } from '@/components/portfolio/PortfolioSelector';

interface AppHeaderMenuProps {
  includePortfolioSelector?: boolean;
}

export function AppHeaderMenu({ includePortfolioSelector = true }: AppHeaderMenuProps) {
  const { isAdmin, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" asChild className="shrink-0">
        <Link to="/">
          <TrendingUp className="w-4 h-4" />
          <span className="ml-2">Dashboard</span>
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0">
            <Menu className="w-4 h-4 mr-2" />
            Menù
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {includePortfolioSelector && (
            <>
              <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
                <div className="w-full"><PortfolioSelector /></div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={() => navigate('/derivatives')}>
            <TrendingUp className="w-4 h-4 mr-2" />
            Strategie Derivati
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/risk-analyzer')}>
            <ShieldAlert className="w-4 h-4 mr-2" />
            Risk Analyzer
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/risk-simulator')}>
            <ShieldAlert className="w-4 h-4 mr-2" />
            Risk Simulator
          </DropdownMenuItem>
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
    </div>
  );
}

export default AppHeaderMenu;
