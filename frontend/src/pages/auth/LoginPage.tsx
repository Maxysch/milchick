import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { cardClass, inputClass, primaryButtonClass } from '../shared';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recuperando, setRecuperando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  // Manda el enlace para elegir una contraseña nueva. Siempre responde lo mismo
  // exista o no el correo, para no revelar quién tiene cuenta.
  const recuperar = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    setLoading(false);
    if (err && (err.status === 429 || /rate|limit|seconds/i.test(err.message))) {
      setError('Se mandaron demasiados correos. Esperá un rato o pedile el enlace a un administrador.');
      return;
    }
    setEnviado(true);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    navigate('/');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className={`${cardClass} w-full max-w-md`}>
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Ingresar</h1>
          <p className="mt-2 text-sm text-gray-500">Accedé al sistema de presentismo y preliquidación.</p>
        </div>

        {recuperando ? (
          <form className="space-y-4" onSubmit={recuperar}>
            <p className="text-sm text-gray-600">Escribí tu email y te mandamos un enlace para elegir una contraseña nueva.</p>
            <div>
              <label htmlFor="email-recuperar" className="mb-1 block text-sm font-medium text-gray-700">Email</label>
              <input id="email-recuperar" className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            {enviado ? (
              <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
                Si ese email está registrado, te llega un enlace en unos minutos. Si no llega, pedíselo a un administrador.
              </p>
            ) : null}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button className={`${primaryButtonClass} w-full`} type="submit" disabled={loading}>
              {loading ? 'Enviando...' : 'Enviar enlace'}
            </button>
            <button type="button" className="w-full text-sm text-blue-600 hover:text-blue-700" onClick={() => { setRecuperando(false); setEnviado(false); setError(null); }}>
              Volver a ingresar
            </button>
          </form>
        ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nombre@empresa.com"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Contraseña</label>
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button className={`${primaryButtonClass} w-full`} type="submit" disabled={loading}>
            {loading ? 'Ingresando...' : 'Iniciar sesión'}
          </button>
          <button type="button" className="w-full text-sm text-blue-600 hover:text-blue-700" onClick={() => { setRecuperando(true); setError(null); }}>
            ¿Olvidaste tu contraseña?
          </button>
        </form>
        )}
      </div>
    </div>
  );
}
