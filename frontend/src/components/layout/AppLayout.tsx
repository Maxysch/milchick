import { NavLink, Outlet } from 'react-router-dom';
import {
  Users,
  Building2,
  Calendar,
  Clock,
  AlertCircle,
  BarChart3,
  Settings,
  LogOut,
  Home,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { cn } from '../../lib/utils';

const navItems = [
  { to: '/', icon: Home, label: 'Inicio' },
  { to: '/agents', icon: Users, label: 'Agentes' },
  { to: '/clients', icon: Building2, label: 'Clientes' },
  { to: '/schedules', icon: Calendar, label: 'Esquemas' },
  { to: '/clock-entries', icon: Clock, label: 'Marcaciones' },
  { to: '/exceptions', icon: AlertCircle, label: 'Excepciones' },
  { to: '/normalization', icon: Settings, label: 'Normalización' },
  { to: '/pre-settlements', icon: BarChart3, label: 'Preliquidación' },
];

export default function AppLayout() {
  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900">Milchick</h1>
          <p className="text-sm text-gray-500">Control de presentismo</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-200">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 w-full transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
