# superset-pdf

Servicio que exporta dashboards de Apache Superset a PDF, con los gráficos dibujados por **el mismo código de Superset**.

Superset solo entrega los datos (API REST). Los gráficos los dibujan los plugins oficiales de Superset
(`@superset-ui/plugin-chart-*`), compilados desde el código fuente de la **misma versión** que corre en el servidor.
La maquetación del PDF es propia: respeta la disposición del dashboard y está pensada para papel.

```
POST /pdf { dashboard_id, token }
   │  1. Dashboard, gráficos y datasets por la API de Superset (con el token de quien llama)
   │  2. Consultas armadas desde los params con el buildQuery de cada plugin (igual que la pantalla)
   │  3. POST /api/v1/chart/data por gráfico
   │  4. Chromium dibuja con graficos.js y maquetar.js, e imprime
   ▼
application/pdf
```

## Uso

```bash
docker run -p 8080:8080 -e SUPERSET_URL=http://superset:8088 ghcr.io/portador3/superset-pdf:6.1.0

curl -X POST http://localhost:8080/pdf \
  -H 'Content-Type: application/json' \
  -d '{"dashboard_id": 13, "token": "<access_token de /api/v1/security/login>"}' \
  -o dashboard.pdf
```

La etiqueta de la imagen es la **versión de Superset** con la que es compatible (`6.1.0`). También se publican
`6.1.0-<commit>` y `latest`.

### API

| Método | Ruta | Respuesta |
|---|---|---|
| `POST` | `/pdf` | Cuerpo JSON `{"dashboard_id": <número o slug>, "token": "<access token>"}` → `200 application/pdf`. Cabeceras `X-Graficos-Total` y `X-Graficos-Fallidos`. Opcional `"encabezado"` (ver abajo) |
| `GET` | `/salud` | `{"ok": true, "superset": "6.1.0", "enCurso": 0, "enEspera": 0}` |

`encabezado` agrega a la cabecera datos que Superset no conoce (todos opcionales):

```json
"encabezado": {
  "descripcion": "Texto bajo el título (hasta 400 caracteres)",
  "detalles": [{ "etiqueta": "Generado por", "valor": "Ana Pérez" }, { "etiqueta": "Área", "valor": "Finanzas" }]
}
```

`detalles` admite hasta 6 pares; se muestran en una línea como "**Etiqueta:** valor", seguidos de "Fuente: Apache Superset".

Errores (JSON `{"error": …}`):

| Código | Cuándo |
|---|---|
| 400 | Falta `dashboard_id` o `token`, o `encabezado` no tiene el formato de arriba |
| 401 | `PDF_CLAVE_API` configurada y `X-Api-Key` incorrecta, o Superset rechazó el token |
| 403 / 404 | Lo que respondió Superset para ese dashboard |
| 429 | Cola llena |
| 502 | Superset no disponible u otro error de Superset |
| 504 | Se superó `PDF_TIMEOUT_MS` |

Un gráfico que falla no detiene el PDF: su tarjeta muestra el error y se cuenta en `X-Graficos-Fallidos`.

### Configuración

| Variable | Por defecto | Uso |
|---|---|---|
| `SUPERSET_URL` | — (obligatoria) | URL de Superset vista desde el servicio, p. ej. `http://superset:8088` |
| `PUERTO` | `8080` | Puerto HTTP |
| `PDF_CLAVE_API` | — | Si se define, se exige en la cabecera `X-Api-Key` |
| `PDF_CONCURRENCIA` | `1` | PDF en paralelo (Chromium usa ~300–500 MB por PDF) |
| `PDF_MAX_COLA` | `10` | Pedidos en espera; el resto recibe 429 |
| `PDF_TIMEOUT_MS` | `120000` | Tiempo máximo por PDF |
| `PDF_CONSULTAS_PARALELAS` | `8` | Consultas simultáneas a Superset por PDF |
| `PDF_CACHE_METADATOS_SEG` | `600` | Segundos que se reutiliza la definición de cada gráfico (y su dataset) mientras no cambie en Superset; `0` la apaga. Los datos se piden siempre (los cachea Superset) |
| `PDF_PAGINA` | `A4` | `A4`, `A3`, `Letter`, `Legal` |
| `PDF_ORIENTACION` | `horizontal` | `horizontal` o `vertical` |
| `PDF_ESCALA_ALTO` | `0.75` | Alto de los gráficos respecto del dashboard |
| `PDF_IDIOMA` | `es` | Textos del PDF (`es`, `en`) y paquete de idioma de Superset |
| `PDF_LOCALE` | `es` | Formato de la fecha de generación |
| `PDF_ZONA_HORARIA` | `TZ` o `UTC` | Zona horaria de la fecha de generación, p. ej. `America/Lima` |
| `PDF_LOGO` | — | Ruta a un logo (png, jpg, svg, webp) montado en el contenedor |
| `PDF_COLOR_TITULOS` | `#0f172a` | Color de títulos (`#RRGGBB`) |
| `PDF_COLOR_ACENTO` | `#475569` | Color de la etiqueta "Reporte de dashboard" de la cabecera |
| `PDF_FUENTE` | `Arial, Helvetica, "Liberation Sans", sans-serif` | Familia de letra de todo el PDF, gráficos incluidos |
| `PDF_INSTITUCION` | — | Nombre que va en la cabecera, sobre la fecha |
| `PDF_ZONA_ETIQUETA` | — | Texto entre paréntesis tras la fecha, p. ej. `hora de Lima` |
| `PDF_PIE` | — | Texto del pie de página (antes del título) |
| `PDF_CSS` | — | Ruta a un CSS adicional montado en el contenedor (ver `servicio/plantilla/base.css`) |

Ejemplo con marca propia:

```yaml
pdf:
  image: ghcr.io/portador3/superset-pdf:6.1.0
  environment:
    SUPERSET_URL: http://superset:8088
    PDF_LOGO: /marca/logo.png
    PDF_COLOR_ACENTO: "#1e3c8f"
    PDF_INSTITUCION: Mi organización
    PDF_PIE: Mi organización | Uso interno
    PDF_ZONA_HORARIA: America/Lima
  volumes:
    - ./marca:/marca:ro
  mem_limit: 1g
```

## Seguridad

- El servicio **no guarda credenciales**. Cada pedido trae un access token de Superset (vence en minutos), que se usa solo
  para ese PDF y no se escribe en los logs.
- El PDF contiene lo que ese token puede ver. Quien llama decide si el usuario final puede exportar el dashboard.
- Pensado para una red interna. Si se expone, definir `PDF_CLAVE_API`.

## Qué hace la maquetación

- Respeta `position_json`: filas, columnas (un gráfico dentro de una columna ocupa su ancho), encabezados, divisores,
  markdown (con el componente de Superset) y pestañas (una sección por pestaña).
- El esquema y los `label_colors` del dashboard reemplazan los del gráfico, como en el dashboard.
- **Papel**: sin animaciones; leyenda que salta de línea en vez de paginar (el cálculo es el de Superset);
  tablas sin buscador ni paginación; si una tabla es más ancha que su tarjeta, se reduce; las filas que no caben
  se ocultan con la nota "Mostrando N de M filas".
- Una sola familia de letra en todo el PDF (`PDF_FUENTE`, Arial por defecto), gráficos y tablas incluidos.
- Fondo blanco: cada gráfico va en una tarjeta con borde fino, sin el gris del tablero de Superset.
- Cabecera en la primera página (logo, tipo de reporte, institución, fecha, título, descripción, detalles y filtros) y
  pie con el texto de `PDF_PIE`, el título y "Página N de M" en todas.

## Limitaciones

- Exporta el estado **guardado** del dashboard: no aplica filtros nativos ni cambios que el usuario haya hecho en pantalla.
- Tipos incluidos: los de ECharts (barras, líneas, área, torta, embudo, gauge, radar, treemap, sunburst, sankey,
  heatmap, histograma, box plot, waterfall, Gantt, grafo, árbol, burbuja, mixto), big number, tabla, tabla dinámica
  y nube de palabras. No: mapas (deck.gl, Mapbox), NVD3 heredados, Handlebars. Un tipo no incluido muestra un aviso.
- Si el token es un *guest token*, Superset aplica sus restricciones de invitado (dashboard embebido, `query_context`).

## Desarrollo

```
src/graficos.tsx, src/inicio.ts   motor: plugins de Superset + SuperChart → window.SupersetPDF
build/webpack.pdf.js              compila el motor con el webpack de Superset (solo cambia entrada y salida)
servicio/                         servicio Node: API, generador (Playwright), plantilla y pruebas
Dockerfile                        imagen del servicio (requiere dist/ con graficos.js)
```

### Cómo se compila

`.github/workflows/build.yml`:

1. Baja `apache/superset` en la etiqueta `SUPERSET_VERSION` (solo `superset-frontend`) y hace `npm ci`.
2. Copia `src/` a `superset-frontend/pdf/` y compila con `build/webpack.pdf.js` → `dist/graficos.js` + fuentes.
3. Construye la imagen, corre la prueba sintética (PDF sin Superset, falla si algún gráfico no se dibuja) y prueba la API.
4. En `main`, publica la imagen en GHCR.

Para otra versión de Superset se cambia `SUPERSET_VERSION` en el workflow.

### Probar en local (sin Docker)

```bash
gh run download -n graficos-6.1.0 -D dist        # motor compilado de la última ejecución
cd servicio && npm ci && npx playwright install chromium
node pruebas/sintetica.mjs                       # prueba sin Superset
SUPERSET_URL=… SUPERSET_USUARIO=… SUPERSET_CONTRASENA=… node cli.mjs 13 salida.pdf
SUPERSET_URL=… node servidor.mjs                 # servicio
```

## Licencia

El motor incluye código de Apache Superset (Apache License 2.0).
