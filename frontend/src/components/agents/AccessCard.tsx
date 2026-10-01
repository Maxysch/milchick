import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Link2, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { cardClass, inputClass, primaryButtonClass, secondaryButtonClass } from '../../pages/shared';

/** Un correo que no puede recibir nada: los que se sembraron de prueba */
export const esEmailFicticio = (email: string) => /\.(local|invalid|test|example)$/i.test(email.trim());

/**
 * El acceso de un agente: el email con el que entra y cómo crea su contraseña.
 *
 * Sólo el administrador puede cambiar el email o generar el enlace: es la llave
 * de la cuenta. El enlace no se manda por correo —el servicio de correo de
 * Supabase puede no entregarlo—: se copia y se le pasa al agente por WhatsApp.
 */
export default function AccessCard({ profileId, email, esAdmin }: { profileId: string; email: string; esAdmin: boolean }) {
  const qc = useQueryClient();
  const [nuevo, setNuevo] = useState(email);
  const [link, setLink] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [aMano, setAMano] = useState(false);
  useEffect(() => { setNuevo(email); setLink(null); setAMano(false); }, [email, profileId]);

  const ficticio = esEmailFicticio(email);
  const cambiado = nuevo.trim().toLowerCase() !== email.toLowerCase();

  const cambiarEmail = useMutation({
    mutationFn: () => api.patch(`/profiles/${profileId}/email`, { email: nuevo }),
    onSuccess: async () => {
      setLink(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['profiles'] }),
        qc.invalidateQueries({ queryKey: ['profiles', profileId] }),
      ]);
    },
  });

  const generar = useMutation({
    mutationFn: () => api.post<{ link: string }>(`/profiles/${profileId}/access-link`, { redirect_to: `${window.location.origin}/reset-password` }),
    onSuccess: (r) => { setLink(r.link); setCopiado(false); },
  });

  const copiar = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Sin permiso para el portapapeles: se deja seleccionado para copiar a mano
      document.querySelector<HTMLInputElement>('#enlace-acceso')?.select();
      setAMano(true);
      return;
    }
    setAMano(false);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  };

  return (
    <section className={`${cardClass} space-y-4`}>
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900"><KeyRound className="h-4 w-4" /> Acceso</h2>
        <p className="mt-1 text-sm text-gray-500">El email con el que entra el agente y cómo crea su contraseña.</p>
      </div>

      {ficticio ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" />
          <span><strong>{email}</strong> es un correo de prueba: no recibe nada. Poné el real antes de generar el enlace.</span>
        </div>
      ) : null}

      <div>
        <label htmlFor="email-acceso" className="mb-1 block text-sm font-medium text-gray-700">Email de acceso</label>
        <div className="flex flex-wrap gap-2">
          <input id="email-acceso" className={`${inputClass} min-w-64 flex-1`} type="email" value={nuevo} disabled={!esAdmin}
            onChange={(e) => setNuevo(e.target.value)} />
          {esAdmin ? (
            <button type="button" className={secondaryButtonClass} disabled={!cambiado || cambiarEmail.isPending} onClick={() => cambiarEmail.mutate()}>
              {cambiarEmail.isPending ? 'Cambiando...' : 'Cambiar email'}
            </button>
          ) : null}
        </div>
        {cambiarEmail.error ? <p className="mt-1 text-sm text-red-600">{(cambiarEmail.error as Error).message}</p> : null}
        {cambiarEmail.isSuccess && !cambiado ? <p className="mt-1 text-sm text-green-700">Listo: desde ahora entra con ese email.</p> : null}
      </div>

      {esAdmin ? (
        <div className="border-t border-gray-200 pt-4">
          <h3 className="text-sm font-medium text-gray-900">Contraseña</h3>
          <p className="mt-1 text-sm text-gray-500">
            Generá un enlace, copialo y pasáselo al agente (por ejemplo, por WhatsApp). Al abrirlo elige su propia contraseña.
            Sirve una sola vez y vence en una hora.
          </p>
          <div className="mt-3">
            <button type="button" className={`${primaryButtonClass} inline-flex items-center gap-2`} disabled={generar.isPending || ficticio || cambiado}
              title={ficticio ? 'Primero poné un email real' : cambiado ? 'Primero guardá el cambio de email' : undefined}
              onClick={() => { setAMano(false); generar.mutate(); }}>
              <Link2 className="h-4 w-4" /> {generar.isPending ? 'Generando...' : link ? 'Generar otro enlace' : 'Generar enlace para crear la contraseña'}
            </button>
          </div>
          {generar.error ? <p className="mt-2 text-sm text-red-600">{(generar.error as Error).message}</p> : null}
          {link ? (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
              <div className="flex flex-wrap gap-2">
                <input id="enlace-acceso" className={`${inputClass} min-w-64 flex-1 font-mono text-xs`} readOnly value={link} aria-label="Enlace para crear la contraseña"
                  onFocus={(e) => e.target.select()} />
                <button type="button" className={`${secondaryButtonClass} inline-flex items-center gap-2`} onClick={copiar}>
                  {copiado ? <><Check className="h-4 w-4 text-green-600" /> Copiado</> : <><Copy className="h-4 w-4" /> Copiar</>}
                </button>
              </div>
              {aMano ? <p className="mt-2 text-xs text-amber-700">No pude copiarlo solo: quedó seleccionado, copialo con Ctrl+C (⌘+C en Mac).</p> : null}
              <p className="mt-2 text-xs text-gray-500">Es personal: quien lo abra puede entrar como este agente. Mandáselo solo a él.</p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="border-t border-gray-200 pt-3 text-sm text-gray-500">El email y la contraseña los gestiona un administrador.</p>
      )}
    </section>
  );
}
