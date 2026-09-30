// Arma los PDFs de los manuales a partir de los HTML de esta carpeta.
//
//   node docs/pdf/fuente/construir.mjs            (todos)
//   node docs/pdf/fuente/construir.mjs agente     (los que contengan "agente")
//
// Necesita Google Chrome instalado. Los íconos salen de lucide-react, los
// mismos que usa la app. Las capturas están en img/ (ver LEEME.md).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const ICONOS = join(RAIZ, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons');
const SALIDA = join(AQUI, '..');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const MANUALES = ['manual-agente', 'manual-supervisor', 'manual-admin', 'como-se-calcula'];
const filtro = process.argv[2];

const cache = new Map();
function icono(nombre, clase = 'i') {
  if (!cache.has(nombre)) {
    const txt = readFileSync(join(ICONOS, `${nombre}.mjs`), 'utf8');
    const m = txt.match(/const __iconNode = (\[[\s\S]*?\]);/);
    if (!m) throw new Error(`No encontré el ícono ${nombre}`);
    const nodos = Function(`return ${m[1]}`)();
    cache.set(nombre, nodos.map(([tag, attrs]) =>
      `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join(''));
  }
  return `<svg class="${clase}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${cache.get(nombre)}</svg>`;
}

// {{i:clock}} o {{i:clock:clase}}
const armar = (html) => html.replace(/\{\{i:([a-z0-9-]+)(?::([a-z0-9 -]+))?\}\}/g, (_, n, c) => icono(n, c ? `i ${c}` : 'i'));

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function chrome() {
  const perfil = mkdtempSync(join(tmpdir(), 'manuales-'));
  const proceso = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9555', `--user-data-dir=${perfil}`,
    '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
  let destino;
  for (let i = 0; i < 100 && !destino; i++) {
    try { destino = (await (await fetch('http://127.0.0.1:9555/json/list')).json()).find((t) => t.type === 'page'); } catch { /* arrancando */ }
    if (!destino) await esperar(150);
  }
  if (!destino) throw new Error('Chrome no arrancó');
  const ws = new WebSocket(destino.webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
  let id = 0;
  const pendientes = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pendientes.has(m.id)) {
      const { ok, ko } = pendientes.get(m.id);
      pendientes.delete(m.id);
      m.error ? ko(new Error(m.error.message)) : ok(m.result);
    }
  };
  const send = (method, params = {}) => {
    const i = ++id;
    ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((ok, ko) => pendientes.set(i, { ok, ko }));
  };
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
  await send('Page.enable');
  const cerrar = async () => {
    ws.close();
    const salio = new Promise((ok) => proceso.once('exit', ok));
    proceso.kill();
    await salio;
    rmSync(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  return { send, ev, cerrar };
}

const c = await chrome();
try {
  for (const nombre of MANUALES.filter((m) => !filtro || m.includes(filtro))) {
    const temporal = join(AQUI, `_${nombre}.html`);
    writeFileSync(temporal, armar(readFileSync(join(AQUI, `${nombre}.html`), 'utf8')));
    await c.send('Page.navigate', { url: pathToFileURL(temporal).href });
    // Que carguen la fuente y todas las imágenes antes de imprimir
    for (let i = 0; i < 200; i++) {
      const listo = await c.ev(`document.readyState === 'complete' && [...document.images].every((i) => i.complete)`);
      if (listo) break;
      await esperar(100);
    }
    await c.ev('document.fonts.ready.then(() => true)');
    await esperar(300);
    const rotas = await c.ev(`[...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src'))`);
    if (rotas.length) console.log(`  ⚠ ${nombre}: imágenes que no cargaron: ${rotas.join(', ')}`);
    const { data } = await c.send('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      generateDocumentOutline: true,
      generateTaggedPDF: true,
    });
    writeFileSync(join(SALIDA, `${nombre}.pdf`), Buffer.from(data, 'base64'));
    unlinkSync(temporal);
    console.log(`  ✓ ${nombre}.pdf`);
  }
} finally {
  await c.cerrar();
}
