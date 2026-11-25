// Prueba sin Superset: un dashboard inventado con los casos difíciles. Falla si algún gráfico no se dibuja.
//   node pruebas/sintetica.mjs [salida.pdf]
import fs from 'node:fs';
import { cargarConfig } from '../config.mjs';
import { crearGenerador } from '../generador.mjs';

const meses = [...Array(12)].map((_, i) => Date.UTC(2025, i, 1));
const categorias = ['Alfa', 'Beta', 'Gamma', 'Delta', 'Épsilon'];
const series = ['Serie uno', 'Serie dos', 'Serie tres', 'Serie cuatro', 'Serie cinco', 'Serie seis', 'Serie siete'];
const valor = (i, k = 1) => Math.round(1000 * k + 400 * Math.sin(i * k) + 37 * i);

const datos = {
  generado: new Date().toISOString(),
  dashboard: {
    id: 'sintetico',
    titulo: 'Prueba sintética',
    metadata: { color_scheme: 'supersetColors', label_colors: { Alfa: '#1f77b4' } },
    position: {
      ROOT_ID: { type: 'ROOT', children: ['TABS'] },
      TABS: { type: 'TABS', children: ['TAB1', 'TAB2'] },
      TAB1: { type: 'TAB', meta: { text: 'Resumen' }, children: ['R1', 'R2'] },
      TAB2: { type: 'TAB', meta: { text: 'Detalle' }, children: ['H1', 'R3', 'D1', 'R4'] },
      R1: { type: 'ROW', children: ['C1', 'COL1'] },
      COL1: { type: 'COLUMN', meta: { width: 8 }, children: ['C2'] },
      R2: { type: 'ROW', children: ['C3', 'C4'] },
      H1: { type: 'HEADER', meta: { text: 'Encabezado de sección' } },
      R3: { type: 'ROW', children: ['M1', 'C5'] },
      D1: { type: 'DIVIDER' },
      R4: { type: 'ROW', children: ['C6'] },
      C1: { type: 'CHART', meta: { chartId: 1, width: 4, height: 50 } },
      C2: { type: 'CHART', meta: { chartId: 2, width: 4, height: 50 } },
      C3: { type: 'CHART', meta: { chartId: 3, width: 6, height: 50 } },
      C4: { type: 'CHART', meta: { chartId: 4, width: 6, height: 50 } },
      M1: { type: 'MARKDOWN', meta: { width: 4, height: 50, code: '## Notas\n\nTexto con **negrita**, una lista:\n\n- uno\n- dos\n\n| a | b |\n|---|---|\n| 1 | 2 |' } },
      C5: { type: 'CHART', meta: { chartId: 5, width: 8, height: 50 } },
      C6: { type: 'CHART', meta: { chartId: 6, width: 12, height: 40 } },
    },
  },
  graficos: [
    { id: 1, slice_name: 'Total', viz_type: 'big_number_total',
      form_data: { viz_type: 'big_number_total', metric: 'SUM(valor)', y_axis_format: 'SMART_NUMBER', subheader: 'unidades' },
      queriesData: [{ data: [{ 'SUM(valor)': 4823150.75 }], colnames: ['SUM(valor)'], coltypes: [0] }] },
    { id: 2, slice_name: 'Barras mensuales (leyenda larga)', viz_type: 'echarts_timeseries_bar',
      form_data: { viz_type: 'echarts_timeseries_bar', x_axis: 'mes', metrics: series, groupby: [], legendType: 'scroll',
        legendOrientation: 'top', time_grain_sqla: 'P1M', color_scheme: 'supersetColors', y_axis_format: 'SMART_NUMBER',
        x_axis_time_format: 'smart_date', show_legend: true, stack: 'Stack' },
      queriesData: [{ data: meses.map((m, i) => Object.fromEntries([['mes', m], ...series.map((s, k) => [s, valor(i, k + 1)])])),
        colnames: ['mes', ...series], coltypes: [2, ...series.map(() => 0)] }] },
    { id: 3, slice_name: 'Torta', viz_type: 'pie',
      form_data: { viz_type: 'pie', groupby: ['cat'], metric: 'SUM(valor)', color_scheme: 'supersetColors',
        show_legend: true, show_labels: true, label_type: 'key_percent', number_format: 'SMART_NUMBER', donut: true },
      queriesData: [{ data: categorias.map((c, i) => ({ cat: c, 'SUM(valor)': valor(i, 3) })), colnames: ['cat', 'SUM(valor)'], coltypes: [1, 0] }] },
    { id: 4, slice_name: 'Sin datos', viz_type: 'echarts_timeseries_line',
      form_data: { viz_type: 'echarts_timeseries_line', x_axis: 'mes', metrics: ['SUM(valor)'], groupby: [] },
      queriesData: [{ data: [], colnames: ['mes', 'SUM(valor)'], coltypes: [2, 0] }] },
    { id: 5, slice_name: 'Tabla ancha y larga', viz_type: 'table',
      form_data: { viz_type: 'table', query_mode: 'raw', all_columns: [...Array(18)].map((_, k) => `COLUMNA_${k + 1}`),
        page_length: 50, include_search: true, show_cell_bars: true },
      queriesData: [{ data: [...Array(60)].map((_, i) => Object.fromEntries([...Array(18)].map((__, k) => [`COLUMNA_${k + 1}`, k % 3 ? valor(i, k) : `texto ${i}-${k}`]))),
        colnames: [...Array(18)].map((_, k) => `COLUMNA_${k + 1}`), coltypes: [...Array(18)].map((_, k) => (k % 3 ? 0 : 1)), rowcount: 60 }] },
    { id: 6, slice_name: 'Área por categoría', viz_type: 'echarts_area',
      form_data: { viz_type: 'echarts_area', x_axis: 'mes', metrics: categorias, groupby: [], time_grain_sqla: 'P1M',
        color_scheme: 'supersetColors', show_legend: true, legendType: 'scroll', stack: 'Stack' },
      queriesData: [{ data: meses.map((m, i) => Object.fromEntries([['mes', m], ...categorias.map((c, k) => [c, valor(i, k + 2)])])),
        colnames: ['mes', ...categorias], coltypes: [2, ...categorias.map(() => 0)] }] },
  ],
};

const cfg = cargarConfig();
const generador = crearGenerador(cfg, { log: m => console.log(m) });
try {
  const r = await generador.generarDesdeDatos(datos);
  const salida = process.argv[2] || 'prueba-sintetica.pdf';
  fs.writeFileSync(salida, r.pdf);
  const esPdf = r.pdf.subarray(0, 5).toString() === '%PDF-';
  console.log(`Gráficos dibujados: ${r.total - r.fallidos.length}/${r.total} · ${r.pdf.length} bytes → ${salida}`);
  r.fallidos.forEach(f => console.log(`  ✗ [${f.id}] ${f.viz_type}: ${f.error}`));
  if (!esPdf || r.total !== datos.graficos.length || r.fallidos.length) {
    console.error('PRUEBA FALLIDA');
    process.exitCode = 1;
  } else {
    console.log('PRUEBA OK');
  }
} finally {
  await generador.cerrar();
}
