# superset-pdf

Exportación a PDF de dashboards de Superset, con los gráficos dibujados por **el mismo código de Superset**.

Superset solo entrega los datos (API REST). Los gráficos los dibujan los plugins oficiales de Superset
(`@superset-ui/plugin-chart-*`), compilados desde el código fuente de la **misma versión** que corre en el servidor.
La maquetación del PDF (A4, encabezado, saltos de página) es nuestra.

## Piezas

| Pieza | Dónde | Estado |
|---|---|---|
| Motor de gráficos `graficos.js` | `src/graficos.tsx` + `build/webpack.pdf.js`, compilado en Actions | Funciona (probado con big number, barras, torta y tabla) |
| Extracción de datos (API de Superset) | — | Pendiente (se valida en una prueba local) |
| Plantilla A4 + impresión con Playwright | — | Pendiente |
| Servicio HTTP + imagen Docker | — | Pendiente |

## Cómo se compila

`.github/workflows/build.yml`:

1. Baja `apache/superset` en la etiqueta `SUPERSET_VERSION` (solo `superset-frontend`).
2. `npm ci` en `superset-frontend`.
3. Copia `src/` a `superset-frontend/pdf/` y `build/webpack.pdf.js` a `superset-frontend/`.
4. Compila con la configuración de webpack de Superset; solo cambian la entrada y la salida.
5. Publica `dist/` (`graficos.js` + fuentes) como artifact `graficos-<versión>`.

Para otra versión de Superset, se cambia `SUPERSET_VERSION` en el workflow y se vuelve a compilar.

Bajar la última compilación (desde un clon de este repo):

```bash
gh run download -n graficos-6.1.0 -D graficos
```

## Uso de `graficos.js`

```html
<script src="graficos.js"></script>
<script>
  SupersetPDF.init({ locale: 'ES' });
  SupersetPDF.aplicarColoresDashboard(dashboard.json_metadata);   // opcional
  await SupersetPDF.renderChart(div, {
    id: 137,
    viz_type: 'echarts_timeseries_bar',
    form_data: params,          // params del gráfico
    queriesData: resp.result,   // POST /api/v1/chart/data con el query_context guardado
  }, { width: 700, height: 350 });
</script>
```

`SupersetPDF.tiposSoportados()` lista los `viz_type` incluidos. Los mapas (deck.gl, Mapbox), los gráficos NVD3
antiguos y Handlebars no se incluyen.

## Licencia

El motor incluye código de Apache Superset (Apache License 2.0).
