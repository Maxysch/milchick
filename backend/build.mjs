// Compila el backend a un único archivo en `dist/`.
//
// No alcanza con `tsc`: `@milchick/shared` se publica como TypeScript crudo
// (su package.json apunta a `src/index.ts`), así que el JavaScript que emitía
// `tsc` dejaba un `import '@milchick/shared'` que Node no sabe resolver y el
// proceso ni siquiera arrancaba. esbuild lo mete adentro del bundle.
//
// El resto de las dependencias quedan afuera: las instala el host con
// `npm install`, y así el bundle no toca código de terceros.
import { rmSync } from 'node:fs';
import { build } from 'esbuild';

import pkg from './package.json' with { type: 'json' };

const external = Object.keys(pkg.dependencies ?? {}).filter(
  (dep) => !dep.startsWith('@milchick/')
);

// tsc dejaba un archivo por módulo; sin limpiar, los viejos quedan al lado
// del bundle nuevo y confunden a cualquiera que mire `dist/`
rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external,
});

console.log(`✅ dist/index.js — ${external.length} dependencias externas`);
