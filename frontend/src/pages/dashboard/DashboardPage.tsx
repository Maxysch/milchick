import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardClock,
  Clock,
  DollarSign,
  Users,
} from 'lucide-react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/utils';
import {
  cardClass,
  DashboardSummary,
  ErrorState,
  LoadingState,
  pageTitleClass,
} from '../shared';

function StatCard({
  label,
  value,
  to,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  to: string;
  icon: typeof Users;
  tone?: 'neutral' | 'warn';
}) {
  return (
    <Link to={to} className={`${cardClass} transition hover:-translate-y-0.5 hover:shadow-md`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-gray-500">{label}</div>
          <div
            className={`mt-1 text-3xl font-semibold ${
              tone === 'warn' && Number(value) > 0 ? 'text-amber-600' : 'text-gray-900'
            }`}
          >
            {value}
          </div>
        </div>
        <div
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
            tone === 'warn' && Number(value) > 0
              ? 'bg-amber-100 text-amber-600'
              : 'bg-blue-100 text-blue-600'
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Link>
  );
}

/** Lista de pendientes. Si no hay nada, no ocupa lugar. */
function PendingList({
  title,
  hint,
  items,
  icon: Icon,
  to,
}: {
  title: string;
  hint: string;
  items: { key: string; label: string; detail?: string }[];
  icon: typeof Users;
  to: string;
}) {
  if (items.length === 0) return null;

  return (
    <section className={cardClass}>
      <div className="mb-1 flex items-center gap-2">
        <Icon className="h-5 w-5 text-amber-600" />
        <h2 className="text-base font-semibold text-gray-900">
          {title} <span className="font-normal text-gray-500">({items.length})</span>
        </h2>
      </div>
      <p className="mb-3 text-sm text-gray-500">{hint}</p>
      <ul className="space-y-1">
        {items.slice(0, 8).map((item) => (
          <li key={item.key} className="flex flex-wrap items-baseline gap-2 text-sm">
            <span className="font-medium text-gray-900">{item.label}</span>
            {item.detail ? <span className="text-gray-500">{item.detail}</span> : null}
          </li>
        ))}
      </ul>
      {items.length > 8 ? (
        <p className="mt-2 text-sm text-gray-500">y {items.length - 8} más</p>
      ) : null}
      <Link to={to} className="mt-3 inline-block text-sm text-blue-600 hover:text-blue-700">
        Ir a resolverlo →
      </Link>
    </section>
  );
}

export default function DashboardPage() {
  const summaryQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardSummary>('/dashboard/summary'),
  });

  if (summaryQuery.isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="mx-auto max-w-7xl"><LoadingState message="Cargando..." /></div>
      </div>
    );
  }

  if (summaryQuery.error) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="mx-auto max-w-7xl">
          <ErrorState message={(summaryQuery.error as Error).message} />
        </div>
      </div>
    );
  }

  const s = summaryQuery.data!;
  const nothingPending =
    s.pending_warnings === 0 &&
    s.missing_clock_in_today.length === 0 &&
    s.open_clock_entries.length === 0 &&
    s.agents_without_schedule.length === 0 &&
    s.agents_without_rate.length === 0;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <h1 className={pageTitleClass}>Inicio</h1>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard label="Agentes activos" value={s.active_agents} to="/agents" icon={Users} />
          <StatCard
            label="Preliquidaciones en borrador"
            value={s.draft_settlements}
            to="/pre-settlements"
            icon={DollarSign}
          />
          <StatCard
            label="Desvíos sin revisar"
            value={s.pending_warnings}
            to="/pre-settlements"
            icon={AlertTriangle}
            tone="warn"
          />
        </div>

        {nothingPending ? (
          <section className={cardClass}>
            <p className="text-sm text-gray-600">
              No hay nada pendiente: todos marcaron, no quedan marcaciones abiertas y no
              hay desvíos sin revisar.
            </p>
          </section>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <PendingList
            title="No marcaron hoy"
            hint="Tienen esquema para hoy y todavía no registraron el ingreso."
            icon={Clock}
            to="/clock-entries"
            items={s.missing_clock_in_today.map((a) => ({
              key: a.profile_id,
              label: a.name,
              detail: `entra ${a.starts_at}`,
            }))}
          />

          <PendingList
            title="Marcaciones sin cerrar"
            hint="Marcaron el ingreso y nunca el egreso. Se liquidan igual, pero conviene corregirlas."
            icon={ClipboardClock}
            to="/clock-entries"
            items={s.open_clock_entries.map((e) => ({
              key: `${e.profile_id}-${e.date}`,
              label: e.name,
              detail: `${formatDate(e.date)} desde ${e.clock_in}`,
            }))}
          />

          <PendingList
            title="Agentes sin esquema"
            hint="Sin esquema no se les puede preliquidar: el motor toma las horas de ahí."
            icon={CalendarClock}
            to="/schedules"
            items={s.agents_without_schedule.map((a) => ({ key: a.profile_id, label: a.name }))}
          />

          <PendingList
            title="Agentes sin tarifa"
            hint="Sin tarifa base, la preliquidación les va a dar cero."
            icon={DollarSign}
            to="/agents"
            items={s.agents_without_rate.map((a) => ({ key: a.profile_id, label: a.name }))}
          />
        </div>
      </div>
    </div>
  );
}
