import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, X } from 'lucide-react';
import { api } from '../../lib/api';
import { DAY_NAMES, formatBlocks, type TimeBlock } from '../../lib/utils';
import { cardClass, fieldClass, primaryButtonClass } from '../../pages/shared';

interface Suggestion {
  profile_id: string;
  agent: string;
  day_of_week: number;
  current: TimeBlock[];
  suggested: TimeBlock[];
  occurrences: number;
  sample: number;
  dates: string[];
  hoursDelta: number;
  reviewBefore: number;
  reviewAfter: number;
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Esquemas que vienen marcando distinto semana tras semana.
 *
 * Cada uno genera un día a normalizar por semana. Corregir el esquema una vez
 * saca esos días de la bandeja para siempre. La sugerencia sale de lo que se
 * marcó; el horario acordado lo decide una persona, así que se puede ajustar
 * antes de aplicarlo.
 */
function Fila({ s, onDone }: { s: Suggestion; onDone: () => void }) {
  const qc = useQueryClient();
  const [bloques, setBloques] = useState<TimeBlock[]>(s.suggested);
  const [desde, setDesde] = useState(monthStart());
  const aplicar = useMutation({
    mutationFn: () =>
      api.post('/schedules/apply-suggestion', {
        profile_id: s.profile_id, day_of_week: s.day_of_week, blocks: bloques, effective_from: desde,
      }),
    onSuccess: async () => {
      await Promise.all(['schedules', 'schedule-suggestions', 'normalization-queue', 'pre-settlement', 'close']
        .map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onDone();
    },
  });

  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-gray-900">{s.agent} · {DAY_NAMES[s.day_of_week].toLowerCase()}</div>
          <div className="text-sm text-gray-600">
            Esquema {formatBlocks(s.current)} · marcó distinto {s.occurrences} de {s.sample} semanas
          </div>
          <div className="text-xs text-gray-500">
            Con el horario sugerido, los días a normalizar de esas semanas pasan de {s.reviewBefore} a {s.reviewAfter}
            {s.hoursDelta ? ` · ${s.hoursDelta > 0 ? '+' : ''}${String(s.hoursDelta).replace('.', ',')} h por semana` : ''}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {bloques.map((b, i) => (
          <div key={i} className="flex items-center gap-1">
            <input className={`${fieldClass} w-36`} type="time" value={b.start_time}
              onChange={(e) => setBloques(bloques.map((x, j) => (j === i ? { ...x, start_time: e.target.value } : x)))} />
            <span className="text-gray-400">a</span>
            <input className={`${fieldClass} w-36`} type="time" value={b.end_time}
              onChange={(e) => setBloques(bloques.map((x, j) => (j === i ? { ...x, end_time: e.target.value } : x)))} />
          </div>
        ))}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Desde</label>
          <input className={`${fieldClass} w-40`} type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <button type="button" className={`${primaryButtonClass} inline-flex items-center gap-1`}
          disabled={aplicar.isPending} onClick={() => aplicar.mutate()}>
          <Check className="h-4 w-4" /> {aplicar.isPending ? 'Aplicando...' : 'Aplicar'}
        </button>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        El esquema actual se cierra el día anterior y el nuevo rige desde esa fecha: los meses ya liquidados no cambian.
      </p>
      {aplicar.error ? <p className="mt-1 text-sm text-red-600">{(aplicar.error as Error).message}</p> : null}
    </div>
  );
}

export default function ScheduleSuggestions() {
  const [descartadas, setDescartadas] = useState<Set<string>>(new Set());
  const q = useQuery({
    queryKey: ['schedule-suggestions'],
    queryFn: () => api.get<Suggestion[]>('/schedules/suggestions'),
  });
  const visibles = (q.data ?? []).filter((s) => !descartadas.has(`${s.profile_id}|${s.day_of_week}`));
  if (!visibles.length) return null;

  return (
    <section className={`${cardClass} border border-amber-200`}>
      <div className="mb-3 flex items-start gap-3">
        <CalendarClock className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {visibles.length === 1 ? 'Un esquema parece desactualizado' : `${visibles.length} esquemas parecen desactualizados`}
          </h2>
          <p className="text-sm text-gray-600">
            El mismo agente, el mismo día, marca distinto a su esquema casi todas las semanas de las últimas ocho. Eso no
            es una excepción: es el esquema que quedó viejo, y cada semana genera un día a normalizar.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {visibles.map((s) => {
          const k = `${s.profile_id}|${s.day_of_week}`;
          return (
            <div key={k} className="relative">
              <button type="button" className="absolute right-3 top-3 text-gray-400 hover:text-gray-700" title="Ignorar por ahora"
                onClick={() => setDescartadas(new Set([...descartadas, k]))}>
                <X className="h-4 w-4" />
              </button>
              <Fila s={s} onDone={() => setDescartadas(new Set([...descartadas, k]))} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
