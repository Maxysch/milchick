/**
 * Conceptos de los ítems: cómo se comparan los nombres.
 *
 * Dos nombres que sólo difieren en mayúsculas, acentos o signos son el mismo
 * concepto: "Bono", "bono" y "BONO." no pueden convivir en el catálogo. La base
 * aplica la misma regla con `concept_normalize` (migración 019); si se cambia
 * una, hay que cambiar la otra.
 */
const ACENTOS: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n',
  à: 'a', è: 'e', ì: 'i', ò: 'o', ù: 'u',
  â: 'a', ê: 'e', î: 'i', ô: 'o', û: 'u',
  ä: 'a', ë: 'e', ï: 'i', ö: 'o',
};

export function normalizeConceptName(nombre: string): string {
  return nombre
    .toLowerCase()
    .replace(/[áéíóúüñàèìòùâêîôûäëïö]/g, (c) => ACENTOS[c] ?? c)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "Bono por cobertura" → "bono_por_cobertura" */
export function conceptKeyFromName(nombre: string): string {
  return normalizeConceptName(nombre).replace(/ /g, '_');
}

function distancia(a: string, b: string): number {
  if (a === b) return 0;
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previo = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardado = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = guardado;
    }
  }
  return fila[b.length];
}

// Palabras que no distinguen un concepto de otro: "Bono x objetivos" y "Bono
// por objetivos" son lo mismo
const RELLENO = new Set(['a', 'al', 'de', 'del', 'el', 'la', 'las', 'los', 'lo', 'por', 'para', 'en', 'y', 'e', 'o', 'u', 'con', 'x']);

const palabrasDe = (n: string) => n.split(' ').filter((p) => p && !RELLENO.has(p));

/** La misma palabra en singular o plural, o con un error de tipeo */
function mismaPalabra(a: string, b: string): boolean {
  if (a === b) return true;
  const [corta, larga] = a.length <= b.length ? [a, b] : [b, a];
  if (corta.length >= 4 && larga.startsWith(corta) && larga.length - corta.length <= 3) return true;
  if (corta.length >= 5) return distancia(a, b) <= (corta.length >= 8 ? 2 : 1);
  return false;
}

/**
 * Los conceptos que se parecen a lo que se está escribiendo, del más parecido
 * al menos. Sirve para ofrecer "¿Es «Bono por objetivos»?" antes de crear uno
 * nuevo, que es lo que más evita duplicados.
 */
export function similarConcepts<T extends { name: string }>(texto: string, conceptos: T[], max = 3): T[] {
  const n = normalizeConceptName(texto);
  if (n.length < 2) return [];
  const palabras = palabrasDe(n);

  const puntaje = (c: T) => {
    const m = normalizeConceptName(c.name);
    if (m === n) return 100;
    if (m.startsWith(n) || n.startsWith(m)) return 85;
    if (m.includes(n) || n.includes(m)) return 75;
    const tolerancia = Math.max(1, Math.floor(Math.max(n.length, m.length) / 6));
    if (distancia(n, m) <= tolerancia) return 80;
    // Las palabras que importan, sin el relleno: cuántas tienen en común
    const otras = palabrasDe(m);
    if (!palabras.length || !otras.length) return 0;
    const comunes = palabras.filter((p) => otras.some((o) => mismaPalabra(p, o))).length;
    return Math.round((comunes / Math.max(palabras.length, otras.length)) * 80);
  };

  return conceptos
    .map((c) => ({ c, p: puntaje(c) }))
    .filter((x) => x.p >= 45)
    .sort((a, b) => b.p - a.p || a.c.name.localeCompare(b.c.name, 'es'))
    .slice(0, max)
    .map((x) => x.c);
}
