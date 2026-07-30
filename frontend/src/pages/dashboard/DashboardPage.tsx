import { Building2, CalendarClock, ClipboardClock, FileClock, LayoutDashboard, ReceiptText, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cardClass, pageTitleClass } from '../shared';

const sections = [
  { title: 'Agentes', description: 'Alta y edición de perfiles.', to: '/agents', icon: Users },
  { title: 'Clientes', description: 'Gestión simple de clientes.', to: '/clients', icon: Building2 },
  { title: 'Esquemas', description: 'Asignación semanal de horarios.', to: '/schedules', icon: CalendarClock },
  { title: 'Marcaciones', description: 'Carga y revisión de fichadas.', to: '/clock-entries', icon: ClipboardClock },
  { title: 'Excepciones', description: 'Vacaciones, ausencias y horas extra.', to: '/exceptions', icon: FileClock },
  { title: 'Preliquidación', description: 'Resumen y detalle por período.', to: '/pre-settlements', icon: ReceiptText },
  { title: 'Normalización', description: 'Vista previa y reglas.', to: '/normalization', icon: LayoutDashboard },
];

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <h1 className={pageTitleClass}>Dashboard</h1>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sections.map(({ title, description, to, icon: Icon }) => (
            <Link
              key={title}
              to={to}
              className={`${cardClass} transition hover:-translate-y-0.5 hover:shadow-md`}
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                <Icon className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
              <p className="mt-2 text-sm text-gray-500">{description}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
