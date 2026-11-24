/**
 * Motor de gráficos para PDF: los plugins de Superset (misma versión que el servidor) fuera de Superset.
 *
 * Se compila dentro de superset-frontend (ver build/webpack.pdf.js), por eso puede importar
 * `src/setup/...` de Superset y los paquetes `@superset-ui/*` desde su código fuente.
 *
 * Expone `window.SupersetPDF`:
 *   init(opciones?)                      → configura idioma, formatos y colores (una vez)
 *   aplicarColoresDashboard(metadata)    → esquema y colores por etiqueta del dashboard
 *   renderChart(elemento, grafico, tam)  → dibuja un gráfico; la promesa se resuelve al terminar
 */
import './inicio';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { createStore } from 'redux';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import { configure as configurarTraduccion } from '@apache-superset/core/translation';
import { themeObject, supersetTheme } from '@apache-superset/core/theme';
import {
  SuperChart,
  VizType,
  CategoricalColorNamespace,
  getChartMetadataRegistry,
} from '@superset-ui/core';
import {
  BigNumberChartPlugin,
  BigNumberTotalChartPlugin,
  BigNumberPeriodOverPeriodChartPlugin,
  EchartsAreaChartPlugin,
  EchartsBoxPlotChartPlugin,
  EchartsBubbleChartPlugin,
  EchartsFunnelChartPlugin,
  EchartsGanttChartPlugin,
  EchartsGaugeChartPlugin,
  EchartsGraphChartPlugin,
  EchartsHeatmapChartPlugin,
  EchartsHistogramChartPlugin,
  EchartsMixedTimeseriesChartPlugin,
  EchartsPieChartPlugin,
  EchartsRadarChartPlugin,
  EchartsSankeyChartPlugin,
  EchartsSunburstChartPlugin,
  EchartsTimeseriesBarChartPlugin,
  EchartsTimeseriesChartPlugin,
  EchartsTimeseriesLineChartPlugin,
  EchartsTimeseriesScatterChartPlugin,
  EchartsTimeseriesSmoothLineChartPlugin,
  EchartsTimeseriesStepChartPlugin,
  EchartsTreeChartPlugin,
  EchartsTreemapChartPlugin,
  EchartsWaterfallChartPlugin,
} from '@superset-ui/plugin-chart-echarts';
import TableChartPlugin from '@superset-ui/plugin-chart-table';
import { PivotTableChartPlugin } from '@superset-ui/plugin-chart-pivot-table';
import { WordCloudChartPlugin } from '@superset-ui/plugin-chart-word-cloud';
import setupColors from 'src/setup/setupColors';
import setupFormatters from 'src/setup/setupFormatters';

type Json = Record<string, any>;

export interface Grafico {
  id: number;
  viz_type: string;
  /** params del gráfico (form_data), tal como los guarda Superset */
  form_data: Json;
  /** `result` de POST /api/v1/chart/data */
  queriesData: Json[];
  /** dataset (opcional): verbose_map, column_formats… lo usan las tablas */
  datasource?: Json;
}

export interface OpcionesInit {
  /** Paquete de idioma de Superset (GET /superset/language_pack/<lang>/) */
  languagePack?: Json;
  /** Locale de ECharts (meses, días): 'ES', 'EN'… */
  locale?: string;
  /** D3_FORMAT y D3_TIME_FORMAT de superset_config (opcionales) */
  d3Format?: Json;
  d3TimeFormat?: Json;
}

// Solo tipos de gráfico, sin filtros nativos ni vistas de la aplicación.
// Clave = viz_type, igual que MainPreset de Superset.
const PLUGINS: [any, string][] = [
  [BigNumberChartPlugin, VizType.BigNumber],
  [BigNumberTotalChartPlugin, VizType.BigNumberTotal],
  [BigNumberPeriodOverPeriodChartPlugin, VizType.BigNumberPeriodOverPeriod],
  [EchartsAreaChartPlugin, VizType.Area],
  [EchartsBoxPlotChartPlugin, VizType.BoxPlot],
  [EchartsBubbleChartPlugin, VizType.Bubble],
  [EchartsFunnelChartPlugin, VizType.Funnel],
  [EchartsGanttChartPlugin, VizType.Gantt],
  [EchartsGaugeChartPlugin, VizType.Gauge],
  [EchartsGraphChartPlugin, VizType.Graph],
  [EchartsHeatmapChartPlugin, VizType.Heatmap],
  [EchartsHistogramChartPlugin, VizType.Histogram],
  [EchartsMixedTimeseriesChartPlugin, VizType.MixedTimeseries],
  [EchartsPieChartPlugin, VizType.Pie],
  [EchartsRadarChartPlugin, VizType.Radar],
  [EchartsSankeyChartPlugin, VizType.Sankey],
  [EchartsSunburstChartPlugin, VizType.Sunburst],
  [EchartsTimeseriesBarChartPlugin, VizType.Bar],
  [EchartsTimeseriesChartPlugin, VizType.Timeseries],
  [EchartsTimeseriesLineChartPlugin, VizType.Line],
  [EchartsTimeseriesScatterChartPlugin, VizType.Scatter],
  [EchartsTimeseriesSmoothLineChartPlugin, VizType.SmoothLine],
  [EchartsTimeseriesStepChartPlugin, VizType.Step],
  [EchartsTreeChartPlugin, VizType.Tree],
  [EchartsTreemapChartPlugin, VizType.Treemap],
  [EchartsWaterfallChartPlugin, VizType.Waterfall],
  [TableChartPlugin, VizType.Table],
  [PivotTableChartPlugin, VizType.PivotTable],
  [WordCloudChartPlugin, VizType.WordCloud],
];

let iniciado = false;
let localeEcharts = 'EN';
let coloresDashboard: { esquema?: string } = {};

function init(op: OpcionesInit = {}) {
  if (iniciado) return;
  configurarTraduccion(op.languagePack ? { languagePack: op.languagePack as any } : undefined);
  setupFormatters((op.d3Format || {}) as any, (op.d3TimeFormat || {}) as any);
  setupColors();
  PLUGINS.forEach(([Plugin, key]) => new Plugin().configure({ key }).register());
  if (op.locale) localeEcharts = op.locale.toUpperCase();
  iniciado = true;
}

/** Igual que en el dashboard: su esquema reemplaza al del gráfico y sus label_colors se fijan. */
function aplicarColoresDashboard(metadata: Json = {}) {
  coloresDashboard = { esquema: metadata.color_scheme || undefined };
  const ns = CategoricalColorNamespace.getNamespace();
  ns.resetColors();
  Object.entries(metadata.label_colors || {}).forEach(([etiqueta, color]) =>
    ns.setColor(etiqueta, color as string),
  );
}

const sinAccion = () => {};
const HOOKS = {
  setDataMask: sinAccion,
  onContextMenu: sinAccion,
  setControlValue: sinAccion,
  onAddFilter: sinAccion,
  onFilterMenuOpen: sinAccion,
  onFilterMenuClose: sinAccion,
  setTooltip: sinAccion,
  onLegendStateChanged: sinAccion,
  onLegendScroll: sinAccion,
} as any;

// --- Leyenda completa en papel -------------------------------------------------------------
// Superset usa una leyenda "scroll" (flechas para paginar) y reserva espacio para UNA línea.
// En papel no se puede paginar: la leyenda pasa a "plain" (salta de línea o de columna) y se
// agranda el margen del área del gráfico en lo que ocupen las líneas/columnas extra.
const ALTO_FILA_LEYENDA = 24; // itemHeight (14) + itemGap (10) de ECharts por defecto
let lienzoMedida: CanvasRenderingContext2D | null = null;

function anchoTexto(texto: string, tamFuente = 12) {
  if (!lienzoMedida) lienzoMedida = document.createElement('canvas').getContext('2d');
  if (!lienzoMedida) return texto.length * tamFuente * 0.6;
  lienzoMedida.font = `${tamFuente}px ${(supersetTheme as any).fontFamily || 'sans-serif'}`;
  return lienzoMedida.measureText(texto).width;
}

function nombresLeyenda(op: Json, l: Json): string[] {
  const datos = Array.isArray(l.data) && l.data.length ? l.data : null;
  if (datos) return datos.map((d: any) => (typeof d === 'string' ? d : d && d.name)).filter(Boolean);
  const series = Array.isArray(op.series) ? op.series : op.series ? [op.series] : [];
  const nombres: string[] = [];
  series.forEach((s: Json) => {
    // En tortas/embudos la leyenda lista los datos, no la serie.
    if (['pie', 'funnel'].includes(s.type) && Array.isArray(s.data)) {
      s.data.forEach((d: Json) => d && d.name != null && nombres.push(String(d.name)));
    } else if (s.name != null) {
      nombres.push(String(s.name));
    }
  });
  return Array.from(new Set(nombres));
}

const sumar = (v: any, extra: number) => (typeof v === 'number' ? v + extra : v == null ? extra : v);

function leyendaCompleta(op: Json, l: Json, ancho: number, alto: number): { legend: Json; extra: Json } {
  const legend = { ...l, selector: false };
  if (l.show === false || l.type !== 'scroll' || !ancho || !alto) return { legend, extra: {} };
  legend.type = 'plain';
  const nombres = nombresLeyenda(op, l);
  if (!nombres.length) return { legend, extra: {} };
  const tam = (l.textStyle && l.textStyle.fontSize) || 12;
  const gap = typeof l.itemGap === 'number' ? l.itemGap : 10;
  const icono = (typeof l.itemWidth === 'number' ? l.itemWidth : 25) + 5;
  const anchos = nombres.map(n => icono + anchoTexto(n, tam) + gap);
  const horizontal = (l.orient || 'horizontal') === 'horizontal';

  if (horizontal) {
    const disponible = ancho - 20;
    let filas = 1;
    let x = 0;
    anchos.forEach(w => {
      if (x > 0 && x + w > disponible) { filas += 1; x = 0; }
      x += w;
    });
    const extraAlto = (filas - 1) * ALTO_FILA_LEYENDA;
    const abajo = l.bottom != null && l.top == null;
    return { legend, extra: extraAlto ? { [abajo ? 'bottom' : 'top']: extraAlto } : {} };
  }
  const porColumna = Math.max(1, Math.floor((alto - 20) / ALTO_FILA_LEYENDA));
  const columnas = Math.ceil(nombres.length / porColumna);
  const extraAncho = (columnas - 1) * Math.max(...anchos);
  const derecha = l.right != null && l.left == null;
  return { legend, extra: extraAncho ? { [derecha ? 'right' : 'left']: extraAncho } : {} };
}

function aplicarMargen(op: Json, extra: Json) {
  if (!Object.keys(extra).length) return op;
  const res = { ...op };
  const ajustarCaja = (caja: Json) => {
    const c = { ...caja };
    Object.entries(extra).forEach(([lado, v]) => { c[lado] = sumar(c[lado], v as number); });
    return c;
  };
  if (op.grid) {
    res.grid = Array.isArray(op.grid) ? op.grid.map(ajustarCaja) : ajustarCaja(op.grid);
  } else if (op.series) {
    // Sin grid (torta, embudo…): se reduce la caja de la serie.
    const series = Array.isArray(op.series) ? op.series : [op.series];
    res.series = series.map((s: Json) => ajustarCaja(s));
  }
  return res;
}

// Ajustes para papel: sin animaciones (se imprime cuando el gráfico ya está completo),
// sin los botones de la leyenda ("Todas" / "Inversa") y con la leyenda completa.
function paraImprimir(props: Json) {
  const op = props && props.echartOptions;
  if (!op) return props;
  const ancho = props.width || 0;
  const alto = props.height || 0;
  let extra: Json = {};
  let legend = op.legend;
  if (Array.isArray(op.legend)) {
    legend = op.legend.map((l: Json) => leyendaCompleta(op, l, ancho, alto).legend);
  } else if (op.legend) {
    const r = leyendaCompleta(op, op.legend, ancho, alto);
    legend = r.legend;
    extra = r.extra;
  }
  return { ...props, echartOptions: aplicarMargen({ ...op, animation: false, legend }, extra) };
}

const esperarCuadro = () => new Promise(r => requestAnimationFrame(() => r(null)));

function renderChart(
  elemento: HTMLElement,
  grafico: Grafico,
  tam: { width: number; height: number },
  { timeoutMs = 20000 } = {},
): Promise<void> {
  if (!iniciado) init();
  if (!getChartMetadataRegistry().has(grafico.viz_type)) {
    return Promise.reject(new Error(`Tipo de gráfico no incluido en el PDF: ${grafico.viz_type}`));
  }
  const formData = {
    ...grafico.form_data,
    viz_type: grafico.viz_type,
    ...(coloresDashboard.esquema ? { color_scheme: coloresDashboard.esquema } : {}),
    // En papel no hay buscador ni paginación: la tabla se dibuja de corrido y la plantilla
    // decide cuántas filas caben.
    ...(grafico.viz_type === VizType.Table
      ? { include_search: false, page_length: 0, server_pagination: false }
      : {}),
  };
  // El componente de ECharts lee el idioma y el estado del dashboard desde Redux.
  // isRefreshing=true además le quita la animación.
  const store = createStore(() => ({
    common: { locale: localeEcharts },
    dashboardState: { isRefreshing: true },
  }));
  const { SupersetThemeProvider } = themeObject as any;
  // Sin filas, SuperChart muestra su aviso de "sin resultados" pero no llama a onRenderSuccess.
  const sinDatos =
    !grafico.queriesData ||
    grafico.queriesData.every(q => !q || !Array.isArray(q.data) || q.data.length === 0);

  return new Promise<void>((resolve, reject) => {
    const limite = window.setTimeout(
      () => reject(new Error(`Tiempo agotado dibujando el gráfico ${grafico.id}`)),
      timeoutMs,
    );
    const ok = async () => {
      // onRenderSuccess llega cuando React montó el gráfico; ECharts pinta un instante después.
      await esperarCuadro();
      await esperarCuadro();
      await new Promise(r => setTimeout(r, 150));
      window.clearTimeout(limite);
      resolve();
    };
    const error = (e: any) => {
      window.clearTimeout(limite);
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    ReactDOM.render(
      <Provider store={store}>
        <SupersetThemeProvider>
          <SuperChart
            chartType={grafico.viz_type}
            width={tam.width}
            height={tam.height}
            formData={formData}
            queriesData={grafico.queriesData as any}
            datasource={grafico.datasource as any}
            hooks={HOOKS}
            theme={supersetTheme}
            postTransformProps={paraImprimir}
            onRenderSuccess={ok}
            onRenderFailure={error}
            onErrorBoundary={error}
            enableNoResults
          />
        </SupersetThemeProvider>
      </Provider>,
      elemento,
      () => {
        if (sinDatos) ok();
      },
    );
  });
}

const api = {
  version: process.env.SUPERSET_VERSION || 'desconocida',
  init,
  aplicarColoresDashboard,
  renderChart,
  tiposSoportados: () => PLUGINS.map(([, key]) => key),
};

(window as any).SupersetPDF = api;
export default api;
