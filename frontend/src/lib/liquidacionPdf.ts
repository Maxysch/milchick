import type { PreSettlementDailyLine, PreSettlementDetail } from '../pages/shared';
import { BAND_LABELS, DAY_NAMES, TIER_LABELS, formatCurrency, formatDate, hourLabel } from './utils';

/**
 * La liquidación de un agente en PDF: lo que se le entrega.
 *
 * Lleva el detalle día por día, los conceptos y el neto. No lleva nada interno
 * —avisos, decisiones de la bandeja, notas de los supervisores—: eso no es para
 * el agente. Una liquidación que todavía no se confirmó sale marcada como
 * borrador, porque los importes pueden cambiar.
 *
 * Se arma en el navegador: las librerías se cargan recién al descargar, para no
 * pesar en el resto de la app.
 */

// El PDF usa tipografías estándar (Latin-1): lo que no entra se reemplaza
const limpiar = (t: string) =>
  t
    .replace(/[  ]/g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/→/g, '->')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^ -ÿ]/g, '');

const plata = (n: number) => limpiar(formatCurrency(Number(n) || 0));
const horas = (n: number) => limpiar(Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const EXCEPCIONES: Record<string, string> = {
  vacation: 'Vacaciones',
  paid_leave: 'Licencia paga',
  schedule_change: 'Cambio de jornada',
  extraordinary_coverage: 'Cobertura',
};

/** De dónde salió una línea, dicho para quien la cobra */
function origen(l: PreSettlementDailyLine): string {
  const partes: string[] = [];
  if (l.source === 'exception') partes.push(EXCEPCIONES[l.day_exception?.exception_type ?? ''] ?? 'Excepción');
  else if (l.source === 'overtime') partes.push('Autorizada');
  else if (l.source === 'correction' || l.source === 'manual') partes.push('Ajustada');
  else if (l.source === 'adjustment') partes.push('Ajuste mes anterior');
  else if (l.source === 'compensation') partes.push('Compensación diaria');
  if (l.is_projected && l.source !== 'adjustment') partes.push('Proyectado');
  return partes.join(' · ');
}

const diaCorto = (fecha: string) => {
  const d = new Date(`${fecha}T12:00:00`);
  return `${DAY_NAMES[d.getDay()].slice(0, 3)} ${formatDate(fecha).slice(0, 5)}`;
};

interface Fila {
  dia: string;
  detalle: string;
  cliente: string;
  horas: string;
  valor: string;
  importe: string;
  nota: string;
  /** Número de día, para alternar el fondo por día y no por línea */
  grupo: number;
}

/** Una fila por línea liquidada, y una por cada día que no paga horas pero conviene que se vea */
export function filasPorDia(detail: PreSettlementDetail): Fila[] {
  const porFecha = new Map<string, PreSettlementDailyLine[]>();
  for (const l of detail.daily ?? []) porFecha.set(l.date, [...(porFecha.get(l.date) ?? []), l]);

  const sinHoras = new Map<string, string>();
  for (const d of detail.day_summary ?? []) {
    if (porFecha.has(d.date)) continue;
    if (d.status === 'holiday') sinHoras.set(d.date, 'Feriado no trabajado');
    else if (d.status === 'absence') sinHoras.set(d.date, 'Ausencia');
  }

  const fechas = [...new Set([...porFecha.keys(), ...sinHoras.keys()])].sort();
  const filas: Fila[] = [];
  fechas.forEach((fecha, grupo) => {
    const lineas = porFecha.get(fecha);
    if (!lineas) {
      filas.push({
        dia: diaCorto(fecha), detalle: sinHoras.get(fecha)!, cliente: '', horas: '', valor: '', importe: '',
        nota: sinHoras.get(fecha) === 'Feriado no trabajado' ? 'Se compensa aparte' : 'No se liquidan horas', grupo,
      });
      return;
    }
    lineas.forEach((l, i) => {
      filas.push({
        dia: i === 0 ? diaCorto(fecha) : '',
        detalle: limpiar(hourLabel(l.band, l.tier)),
        cliente: limpiar(((l.clients as { name?: string } | null | undefined)?.name) ?? ''),
        horas: horas(l.hours),
        valor: plata(l.rate_per_hour),
        importe: plata(l.amount),
        nota: limpiar(origen(l)),
        grupo,
      });
    });
  });
  return filas;
}

/** Horas e importe agrupados por banda y tramo, para ver de dónde sale el total */
export function resumenPorTipo(detail: PreSettlementDetail) {
  const grupos = new Map<string, { etiqueta: string; horas: number; importe: number }>();
  for (const l of detail.daily ?? []) {
    const clave = `${l.band}|${l.tier}`;
    const g = grupos.get(clave) ?? { etiqueta: hourLabel(l.band, l.tier), horas: 0, importe: 0 };
    g.horas += Number(l.hours);
    g.importe += Number(l.amount);
    grupos.set(clave, g);
  }
  const orden = Object.keys(BAND_LABELS).flatMap((b) => Object.keys(TIER_LABELS).map((t) => `${b}|${t}`));
  return [...grupos.entries()].sort((a, b) => orden.indexOf(a[0]) - orden.indexOf(b[0])).map(([, g]) => g);
}

const AZUL: [number, number, number] = [30, 64, 175];
const GRIS: [number, number, number] = [107, 114, 128];
const OSCURO: [number, number, number] = [17, 24, 39];

export async function armarLiquidacionPdf(detail: PreSettlementDetail, nombre: string, legajo?: string | null) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ancho = doc.internal.pageSize.getWidth();
  const margen = 10;
  const borrador = detail.status !== 'confirmed';
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // ── Encabezado ──
  doc.setFillColor(...AZUL);
  doc.rect(0, 0, ancho, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold').setFontSize(17).text('Liquidación de honorarios', margen, 11.5);
  doc.setFont('helvetica', 'normal').setFontSize(9.5)
    .text(limpiar(`Período del ${formatDate(detail.period_from)} al ${formatDate(detail.period_to)}`), margen, 18.5);

  doc.setTextColor(...OSCURO);
  doc.setFont('helvetica', 'bold').setFontSize(14).text(limpiar(nombre), margen, 34);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...GRIS)
    .text(limpiar(legajo ? `Legajo ${legajo}` : ''), margen, 39.5);

  let y = 45;
  if (borrador) {
    doc.setFillColor(254, 243, 199).setDrawColor(245, 158, 11).roundedRect(margen, y, ancho - 2 * margen, 11, 1.5, 1.5, 'FD');
    doc.setTextColor(120, 53, 15).setFont('helvetica', 'bold').setFontSize(9).text('BORRADOR - importes provisorios', margen + 3, y + 4.6);
    doc.setFont('helvetica', 'normal').setFontSize(8.5)
      .text('Pueden cambiar hasta que se confirme la liquidación.', margen + 3, y + 8.6);
    y += 15;
  }

  // ── Resumen ──
  const subtotal = (detail.daily ?? []).reduce((s, l) => s + Number(l.amount), 0);
  const totalHoras = (detail.daily ?? []).reduce((s, l) => s + Number(l.hours), 0);
  const conceptos = (detail.items ?? []).reduce((s, i) => s + Number(i.amount), 0);
  const cajas: [string, string][] = [
    ['Horas', horas(totalHoras)],
    ['Honorarios por horas', plata(subtotal)],
    ['Conceptos', plata(conceptos)],
    ['Total a cobrar', plata(detail.total_amount)],
  ];
  const w = (ancho - 2 * margen - 3 * 4) / 4;
  cajas.forEach(([titulo, valor], i) => {
    const x = margen + i * (w + 4);
    const destacada = i === 3;
    doc.setFillColor(...(destacada ? AZUL : ([243, 244, 246] as [number, number, number])));
    doc.roundedRect(x, y, w, 16, 1.5, 1.5, 'F');
    doc.setTextColor(...(destacada ? ([219, 234, 254] as [number, number, number]) : GRIS)).setFont('helvetica', 'normal').setFontSize(8)
      .text(titulo, x + 3, y + 5.5);
    doc.setTextColor(...(destacada ? ([255, 255, 255] as [number, number, number]) : OSCURO)).setFont('helvetica', 'bold').setFontSize(valor.length > 14 ? 10 : 12)
      .text(valor, x + 3, y + 12);
  });
  y += 22;

  const estiloTabla = {
    theme: 'plain' as const,
    styles: { font: 'helvetica', fontSize: 8, cellPadding: { top: 1.6, bottom: 1.6, left: 1.5, right: 1.5 }, textColor: OSCURO, lineColor: [229, 231, 235] as [number, number, number], lineWidth: 0 },
    headStyles: { fillColor: [243, 244, 246] as [number, number, number], textColor: GRIS, fontStyle: 'bold' as const, fontSize: 7.5 },
    margin: { left: margen, right: margen, bottom: 16 },
    showFoot: 'lastPage' as const,
    rowPageBreak: 'avoid' as const,
  };
  const titulo = (texto: string, yy: number) => {
    doc.setTextColor(...OSCURO).setFont('helvetica', 'bold').setFontSize(11).text(texto, margen, yy);
  };

  // ── Horas por tipo ──
  const tipos = resumenPorTipo(detail);
  if (tipos.length) {
    titulo('Horas por tipo', y);
    autoTable(doc, {
      ...estiloTabla,
      startY: y + 2,
      head: [['Tipo de hora', 'Horas', 'Importe']],
      body: tipos.map((t) => [limpiar(t.etiqueta), horas(t.horas), plata(t.importe)]),
      foot: [['Total', horas(totalHoras), plata(subtotal)]],
      footStyles: { fontStyle: 'bold', fillColor: [243, 244, 246] },
      columnStyles: { 1: { halign: 'right', cellWidth: 28 }, 2: { halign: 'right', cellWidth: 38 } },
      didParseCell: (d) => {
        if (d.section !== 'body' && d.column.index > 0) d.cell.styles.halign = 'right';
      },
    });
    y = finalY() + 9;
  }

  // ── Detalle por día ──
  const filas = filasPorDia(detail);
  if (y > 250) { doc.addPage(); y = 16; }
  titulo('Detalle por día', y);
  autoTable(doc, {
    ...estiloTabla,
    startY: y + 2,
    head: [['Día', 'Tipo de hora', 'Cliente', 'Horas', 'Valor hora', 'Importe', 'Nota']],
    body: filas.map((f) => [f.dia, f.detalle, f.cliente, f.horas, f.valor, f.importe, f.nota]),
    foot: [['Total', '', '', horas(totalHoras), '', plata(subtotal), '']],
    footStyles: { fontStyle: 'bold', fillColor: [243, 244, 246] },
    columnStyles: {
      0: { cellWidth: 21 }, 1: { cellWidth: 38 }, 2: { cellWidth: 30 },
      3: { halign: 'right', cellWidth: 14 }, 4: { halign: 'right', cellWidth: 25 }, 5: { halign: 'right', cellWidth: 26 }, 6: { cellWidth: 'auto' },
    },
    didParseCell: (d) => {
      if (d.section === 'head' && [3, 4, 5].includes(d.column.index)) d.cell.styles.halign = 'right';
      if (d.section === 'foot' && [3, 4, 5].includes(d.column.index)) d.cell.styles.halign = 'right';
      if (d.section === 'body') {
        const fila = filas[d.row.index];
        // Fondo alternado por día; las líneas de un mismo día van juntas
        if (fila.grupo % 2 === 1) d.cell.styles.fillColor = [249, 250, 251];
        if (d.column.index === 0) d.cell.styles.fontStyle = 'bold';
        if (d.column.index === 6) d.cell.styles.textColor = GRIS;
        if (!fila.horas && d.column.index === 1) d.cell.styles.textColor = GRIS;
      }
    },
  });
  y = finalY() + 9;

  // ── Conceptos y total ──
  const items = detail.items ?? [];
  if (y > 225) { doc.addPage(); y = 16; }
  titulo('Conceptos y total', y);
  autoTable(doc, {
    ...estiloTabla,
    startY: y + 2,
    head: [['Concepto', 'Detalle', 'Importe']],
    body: items.length
      ? items.map((i) => [limpiar(i.concept_label ?? i.concept), limpiar(i.description ?? ''), plata(i.amount)])
      : [['Sin conceptos adicionales', '', plata(0)]],
    foot: [
      ['Total conceptos', '', plata(conceptos)],
      ['Honorarios por horas', '', plata(subtotal)],
      ['Total a cobrar', '', plata(detail.total_amount)],
    ],
    footStyles: { fontStyle: 'bold', fillColor: [243, 244, 246] },
    columnStyles: { 0: { cellWidth: 62, fontStyle: 'bold' }, 1: { cellWidth: 'auto', textColor: GRIS }, 2: { halign: 'right', cellWidth: 32 } },
    didParseCell: (d) => {
      if (d.section !== 'body' && d.column.index === 2) d.cell.styles.halign = 'right';
      if (d.section === 'foot' && d.row.index === 2) {
        d.cell.styles.fillColor = AZUL;
        d.cell.styles.textColor = [255, 255, 255];
        d.cell.styles.fontSize = 10.5;
        d.cell.styles.cellPadding = { top: 3, bottom: 3, left: 1.5, right: 1.5 };
      }
    },
  });
  y = finalY() + 6;
  if ((detail.daily ?? []).some((l) => l.is_projected && l.source !== 'adjustment')) {
    doc.setTextColor(...GRIS).setFont('helvetica', 'normal').setFontSize(8);
    doc.text(doc.splitTextToSize('Los días marcados como Proyectado todavía no ocurrieron: se pagan según el esquema y, si el día termina distinto, la diferencia se ajusta el mes siguiente.', ancho - 2 * margen), margen, y);
  }

  // ── Pie de cada página ──
  const paginas = doc.getNumberOfPages();
  const alto = doc.internal.pageSize.getHeight();
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.setDrawColor(229, 231, 235).line(margen, alto - 11, ancho - margen, alto - 11);
    doc.setTextColor(...GRIS).setFont('helvetica', 'normal').setFontSize(7.5);
    doc.text(limpiar(`${nombre} - ${formatDate(detail.period_from)} al ${formatDate(detail.period_to)}${borrador ? ' - BORRADOR' : ''}`), margen, alto - 6.5);
    doc.text(`Página ${p} de ${paginas}`, ancho - margen, alto - 6.5, { align: 'right' });
  }
  return doc;
}

/** Nombre de archivo: liquidacion-apellido-2026-09.pdf */
export function nombreDeArchivo(apellido: string, periodTo: string, borrador: boolean) {
  const seguro = apellido.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'agente';
  return `liquidacion-${seguro}-${periodTo.slice(0, 7)}${borrador ? '-borrador' : ''}.pdf`;
}

export async function descargarLiquidacionPdf(detail: PreSettlementDetail, nombre: string, apellido: string, legajo?: string | null) {
  const doc = await armarLiquidacionPdf(detail, nombre, legajo);
  doc.save(nombreDeArchivo(apellido, detail.period_to, detail.status !== 'confirmed'));
}
