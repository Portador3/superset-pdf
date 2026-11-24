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

// Ajustes para papel: sin animaciones (se imprime cuando el gráfico ya está completo)
// y sin los botones interactivos de la leyenda ("Todas" / "Inversa").
function paraImprimir(props: Json) {
  const op = props && props.echartOptions;
  if (!op) return props;
  const sinSelector = (l: Json) => ({ ...l, selector: false });
  const legend = Array.isArray(op.legend)
    ? op.legend.map(sinSelector)
    : op.legend
      ? sinSelector(op.legend)
      : op.legend;
  return { ...props, echartOptions: { ...op, animation: false, legend } };
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
  };
  // El componente de ECharts lee el idioma y el estado del dashboard desde Redux.
  // isRefreshing=true además le quita la animación.
  const store = createStore(() => ({
    common: { locale: localeEcharts },
    dashboardState: { isRefreshing: true },
  }));
  const { SupersetThemeProvider } = themeObject as any;

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
