import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Sparkles } from 'lucide-react';
import { normalizeConceptName, similarConcepts } from '@milchick/shared';
import { useQuickCreateConcept, type ItemConcept } from '../../lib/concepts';
import { fieldClass } from '../../pages/shared';

// "viáticos" se guarda "Viáticos": el resto, como se escribió
const conMayuscula = (t: string) => t.charAt(0).toLocaleUpperCase('es') + t.slice(1);

type Opcion = { tipo: 'concepto'; c: ItemConcept; parecido?: boolean } | { tipo: 'crear'; nombre: string };

/**
 * Elegir el concepto de un ítem.
 *
 * Se escribe y aparecen los que coinciden y los parecidos —"¿Es alguno de
 * estos?"—, que es lo que evita cargar "Bono" y "bono" como dos cosas. Si no
 * está, "Crear «…»" lo da de alta en el catálogo en el momento, sin salir de la
 * liquidación; queda a revisar en Configuración.
 */
export default function ConceptPicker({
  value,
  concepts,
  onChange,
  placeholder = 'Buscar o crear un concepto',
  className = '',
  revisa = true,
  inputId,
  ariaLabel,
}: {
  /** La clave del concepto elegido */
  value: string | null;
  /** Los que se pueden elegir: activos y no del sistema */
  concepts: ItemConcept[];
  onChange: (c: ItemConcept) => void;
  placeholder?: string;
  className?: string;
  /** Si lo que se crea queda a revisar: sí, salvo que lo cree un administrador */
  revisa?: boolean;
  inputId?: string;
  ariaLabel?: string;
}) {
  const crear = useQuickCreateConcept();
  const elegido = concepts.find((c) => c.key === value) ?? null;
  const [texto, setTexto] = useState(elegido?.name ?? '');
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const lista = useId();
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) setTexto(elegido?.name ?? '');
  }, [elegido?.name, abierto]);

  // Cerrar al hacer clic afuera
  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  const opciones: Opcion[] = useMemo(() => {
    const n = normalizeConceptName(texto);
    const buscando = abierto && n.length > 0 && texto !== elegido?.name;
    if (!buscando) return concepts.map((c) => ({ tipo: 'concepto' as const, c }));

    const coinciden = concepts.filter((c) => normalizeConceptName(c.name).includes(n));
    const parecidos = similarConcepts(texto, concepts, 4).filter((c) => !coinciden.includes(c));
    const exacto = concepts.some((c) => normalizeConceptName(c.name) === n);
    return [
      ...coinciden.map((c) => ({ tipo: 'concepto' as const, c })),
      ...parecidos.map((c) => ({ tipo: 'concepto' as const, c, parecido: true })),
      ...(exacto ? [] : [{ tipo: 'crear' as const, nombre: conMayuscula(texto.trim()) }]),
    ];
  }, [texto, concepts, abierto, elegido?.name]);

  useEffect(() => setActivo(0), [texto]);

  const elegir = async (o: Opcion) => {
    if (o.tipo === 'concepto') {
      onChange(o.c);
      setTexto(o.c.name);
      setAbierto(false);
      return;
    }
    if (o.nombre.length < 2) return;
    const nuevo = await crear.mutateAsync(o.nombre);
    onChange(nuevo);
    setTexto(nuevo.name);
    setAbierto(false);
  };

  const hayParecidos = opciones.some((o) => o.tipo === 'concepto' && o.parecido);

  return (
    <div ref={raiz} className={`relative ${className}`}>
      <div className="relative">
        <input
          id={inputId}
          aria-label={ariaLabel}
          className={`${fieldClass} w-full pr-8`}
          role="combobox"
          aria-expanded={abierto}
          aria-controls={lista}
          aria-autocomplete="list"
          placeholder={placeholder}
          value={texto}
          onFocus={(e) => { setAbierto(true); e.target.select(); }}
          onChange={(e) => { setTexto(e.target.value); setAbierto(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); setActivo((a) => Math.min(a + 1, opciones.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); if (abierto && opciones[activo]) void elegir(opciones[activo]); }
            else if (e.key === 'Escape') { setAbierto(false); setTexto(elegido?.name ?? ''); }
          }}
        />
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      </div>

      {abierto ? (
        <ul id={lista} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full min-w-64 overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg">
          {opciones.map((o, i) => {
            const primeroParecido = o.tipo === 'concepto' && o.parecido && !(opciones[i - 1]?.tipo === 'concepto' && (opciones[i - 1] as { parecido?: boolean }).parecido);
            return (
              <li key={o.tipo === 'concepto' ? o.c.id : 'crear'} role="option" aria-selected={i === activo}>
                {primeroParecido ? (
                  <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-xs font-semibold text-amber-700">
                    <Sparkles className="h-3.5 w-3.5" /> ¿Es alguno de estos?
                  </div>
                ) : null}
                {o.tipo === 'concepto' ? (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActivo(i)}
                    onClick={() => void elegir(o)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left ${i === activo ? 'bg-blue-50 text-blue-900' : 'text-gray-800'}`}
                  >
                    <span className="truncate">{o.c.name}</span>
                    {o.c.key === value ? <Check className="h-4 w-4 flex-none text-blue-600" /> : null}
                  </button>
                ) : (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActivo(i)}
                    onClick={() => void elegir(o)}
                    disabled={crear.isPending || o.nombre.length < 2}
                    className={`mt-1 flex w-full items-start gap-2 border-t border-gray-100 px-3 py-2 text-left ${i === activo ? 'bg-blue-50' : ''}`}
                  >
                    <Plus className="mt-0.5 h-4 w-4 flex-none text-blue-600" />
                    <span>
                      <span className="font-medium text-blue-700">{crear.isPending ? 'Creando…' : `Crear «${o.nombre}»`}</span>
                      <span className="block text-xs text-gray-500">
                        {hayParecidos ? 'Si no es ninguno de los de arriba. ' : ''}
                        {revisa ? 'Queda en el catálogo, a revisar en Configuración.' : 'Queda en el catálogo; sus valores por defecto se cargan en Configuración.'}
                      </span>
                    </span>
                  </button>
                )}
              </li>
            );
          })}
          {opciones.length === 0 ? <li className="px-3 py-2 text-gray-500">No hay conceptos cargados todavía.</li> : null}
        </ul>
      ) : null}

      {crear.error ? <p className="mt-1 text-xs text-red-600">{(crear.error as Error).message}</p> : null}
    </div>
  );
}
