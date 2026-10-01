import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { cardClass, inputClass, primaryButtonClass } from '../shared';

const MINIMO = 8;

/**
 * Donde cae el agente al abrir el enlace para crear su contraseña. El enlace
 * trae una sesión de recuperación en la URL; con ella puede fijar la nueva.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [estado, setEstado] = useState<'esperando' | 'listo' | 'invalido' | 'guardada'>('esperando');
  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Un enlace vencido o ya usado vuelve con el error en la URL
    if (/error(_code|_description)?=/.test(window.location.hash)) {
      setEstado('invalido');
      return;
    }
    const { data: sub } = supabase.auth.onAuthStateChange((evento, sesion) => {
      if (sesion && (evento === 'PASSWORD_RECOVERY' || evento === 'SIGNED_IN')) setEstado('listo');
    });
    void supabase.auth.getSession().then(({ data }) => { if (data.session) setEstado('listo'); });
    // Si en unos segundos no hay sesión, el enlace no sirve
    const espera = setTimeout(() => setEstado((e) => (e === 'esperando' ? 'invalido' : e)), 5000);
    return () => { sub.subscription.unsubscribe(); clearTimeout(espera); };
  }, []);

  const guardar = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (password.length < MINIMO) { setError(`La contraseña debe tener al menos ${MINIMO} caracteres.`); return; }
    if (password !== repetida) { setError('Las dos contraseñas no coinciden.'); return; }
    setGuardando(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setGuardando(false);
    if (err) {
      setError(/same|different/i.test(err.message) ? 'Elegí una contraseña distinta a la anterior.' : err.message);
      return;
    }
    setEstado('guardada');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className={`${cardClass} w-full max-w-md`}>
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Crear tu contraseña</h1>
        </div>

        {estado === 'esperando' ? <p className="text-center text-sm text-gray-500">Verificando el enlace...</p> : null}

        {estado === 'invalido' ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-gray-700">El enlace venció o ya se usó. Cada enlace sirve una sola vez y dura una hora.</p>
            <p className="text-sm text-gray-500">Pedile uno nuevo a quien administra el sistema.</p>
            <Link to="/login" className="inline-block text-sm text-blue-600 hover:text-blue-700">Ir a ingresar</Link>
          </div>
        ) : null}

        {estado === 'listo' ? (
          <form className="space-y-4" onSubmit={guardar}>
            <p className="text-center text-sm text-gray-500">Elegí la contraseña con la que vas a entrar.</p>
            <div>
              <label htmlFor="nueva" className="mb-1 block text-sm font-medium text-gray-700">Contraseña nueva</label>
              <input id="nueva" className={inputClass} type="password" autoComplete="new-password" value={password}
                onChange={(e) => setPassword(e.target.value)} required />
              <p className="mt-1 text-xs text-gray-500">Al menos {MINIMO} caracteres.</p>
            </div>
            <div>
              <label htmlFor="repetida" className="mb-1 block text-sm font-medium text-gray-700">Repetila</label>
              <input id="repetida" className={inputClass} type="password" autoComplete="new-password" value={repetida}
                onChange={(e) => setRepetida(e.target.value)} required />
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button className={`${primaryButtonClass} w-full`} type="submit" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar contraseña'}
            </button>
          </form>
        ) : null}

        {estado === 'guardada' ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-gray-700">Listo, ya tenés tu contraseña. La próxima vez entrás con tu email y esa contraseña.</p>
            <button type="button" className={`${primaryButtonClass} w-full`} onClick={() => navigate('/')}>Entrar</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
