# Manuales en PDF

Los PDFs de `docs/pdf/` salen de los HTML de esta carpeta. Para regenerarlos
después de editar un HTML:

```bash
node docs/pdf/fuente/construir.mjs
```

Con un argumento arma sólo los que lo contienen: `node docs/pdf/fuente/construir.mjs supervisor`.
Necesita Google Chrome instalado (si está en otro lugar, `CHROME=/ruta/al/binario`).

- `estilo.css` — el diseño común: portada, capítulos, cajas, tablas, leyendas.
- `{{i:nombre}}` en un HTML inserta un ícono de lucide, los mismos que usa la app.
- `img/` — las capturas. Salieron de una base local con datos de julio y agosto
  2026 y **nombres ficticios** de agentes y clientes. Si una pantalla cambia, la
  captura hay que rehacerla.

Los manuales en Markdown (`docs/*.md`) son la versión corta y la que se lee en el
repositorio. Si cambia algo del sistema, conviene actualizar las dos.
