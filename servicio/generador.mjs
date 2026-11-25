// Genera el PDF: un Chromium compartido, un contexto por pedido, cola con límite.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { clienteSuperset, obtenerDashboard, obtenerDatos } from './superset.mjs';

const ESCAPAR = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapar = s => String(s).replace(/[&<>"']/g, c => ESCAPAR[c]);

const PIE_PAGINA = {
  es: 'Página <span class="pageNumber"></span> de <span class="totalPages"></span>',
  en: 'Page <span class="pageNumber"></span> of <span class="totalPages"></span>',
};

export class ErrorCola extends Error {}
export class ErrorTiempo extends Error {}

const texto = (v, max, nombre) => {
  if (v == null || v === '') return '';
  if (typeof v !== 'string') throw new Error(`${nombre} debe ser texto`);
  return v.trim().slice(0, max);
};

/**
 * Datos opcionales de la cabecera que manda quien llama (no los conoce Superset):
 *   { descripcion?: string, detalles?: [{ etiqueta, valor }] }   p. ej. [{ etiqueta: 'Generado por', valor: 'Ana' }]
 */
export function leerEncabezado(e) {
  if (e == null) return {};
  if (typeof e !== 'object' || Array.isArray(e)) throw new Error('encabezado debe ser un objeto');
  const detalles = e.detalles == null ? [] : e.detalles;
  if (!Array.isArray(detalles) || detalles.length > 6) throw new Error('detalles: lista de hasta 6 elementos');
  return {
    descripcion: texto(e.descripcion, 400, 'descripcion'),
    detalles: detalles
      .map(d => ({ etiqueta: texto(d && d.etiqueta, 40, 'etiqueta'), valor: texto(d && d.valor, 160, 'valor') }))
      .filter(d => d.etiqueta && d.valor),
  };
}

export function crearGenerador(cfg, { log = () => {} } = {}) {
  if (!fs.existsSync(cfg.graficosJs)) throw new Error(`No existe ${cfg.graficosJs} (compilación de graficos.js)`);
  const logo = cfg.logo ? aDataUri(cfg.logo) : null;
  const cssExtra = cfg.css ? fs.readFileSync(cfg.css, 'utf8') : '';
  const opcionesPagina = {
    anchoPx: cfg.anchoPx,
    altoMaxPx: cfg.altoMaxPx,
    escalaAlto: cfg.escalaAlto,
    idioma: cfg.idioma,
    locale: cfg.locale,
    zonaHoraria: cfg.zonaHoraria,
    localeGraficos: cfg.localeGraficos,
    fuente: cfg.fuente,
    institucion: cfg.institucion,
    etiquetaZona: cfg.etiquetaZona,
    logo,
  };
  const variablesCss = [
    `--pdf-fuente:${cfg.fuente}`,
    cfg.colorTitulos && `--pdf-color-titulos:${cfg.colorTitulos}`,
    cfg.colorAcento && `--pdf-color-acento:${cfg.colorAcento}`,
  ].filter(Boolean).join(';');

  let navegador = null;
  let cerrado = false;
  async function obtenerNavegador() {
    if (cerrado) throw new Error('Generador cerrado');
    if (navegador && navegador.isConnected()) return navegador;
    navegador = await chromium.launch({
      // Las fuentes de graficos.js se cargan desde archivos locales; /dev/shm suele ser chico en contenedores.
      // Los tres últimos evitan que Chromium frene los temporizadores de la página de reserva mientras espera.
      args: [
        '--allow-file-access-from-files', '--disable-dev-shm-usage',
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    navegador.on('disconnected', () => { navegador = null; });
    return navegador;
  }

  /** Contexto nuevo con la plantilla, graficos.js (~5 MB) y maquetar.js ya cargados. Cada PDF usa uno y lo cierra. */
  async function prepararPagina() {
    const nav = await obtenerNavegador();
    const contexto = await nav.newContext({
      deviceScaleFactor: 2, // ECharts dibuja en canvas: al doble de resolución queda nítido al imprimir
      viewport: { width: cfg.anchoPx, height: 800 },
    });
    try {
      const pagina = await contexto.newPage();
      pagina.on('pageerror', e => log(`[navegador] ${e.message}`));
      await pagina.goto(pathToFileURL(path.join(cfg.plantillaDir, 'pagina.html')).href);
      await pagina.addScriptTag({ url: pathToFileURL(cfg.graficosJs).href });
      await pagina.addScriptTag({ url: pathToFileURL(path.join(cfg.plantillaDir, 'maquetar.js')).href });
      await pagina.addStyleTag({ content: `:root{${variablesCss}}` });
      if (cssExtra) await pagina.addStyleTag({ content: cssExtra });
      await pagina.emulateMedia({ media: 'print' });
      return { contexto, pagina };
    } catch (e) {
      await contexto.close().catch(() => {});
      throw e;
    }
  }

  // Una página ya preparada espera al próximo pedido (se repone al terminar cada PDF): ahorra ~1 s por PDF.
  let reserva = null;
  function reponerReserva() {
    if (cerrado || reserva) return;
    reserva = prepararPagina();
    reserva.catch(() => { reserva = null; });
  }
  async function tomarPagina() {
    const lista = reserva;
    reserva = null;
    if (lista) {
      try {
        const p = await lista;
        if (!p.pagina.isClosed()) return p;
      } catch { /* se prepara otra */ }
    }
    return prepararPagina();
  }

  async function imprimir(obtenerDatosDashboard) {
    // Milisegundos de cada fase, para el log: dónde se va el tiempo de un PDF.
    const tiempos = {};
    let desde = Date.now();
    const marcar = fase => { const ahora = Date.now(); tiempos[fase] = ahora - desde; desde = ahora; };
    // La página se prepara mientras se piden los datos a Superset (no dependen una de otra).
    const pPagina = tomarPagina();
    pPagina.catch(() => {});
    try {
      const paginaLista = async () => (await pPagina).pagina;
      const datos = await obtenerDatosDashboard(paginaLista, marcar);
      const pagina = await paginaLista();

      const cargarFuentes = () => pagina.evaluate(() =>
        Promise.all([...document.fonts].map(f => f.load().catch(() => null))));
      await cargarFuentes();
      const resultados = await pagina.evaluate(([d, op]) => window.armar(d, op), [datos, opcionesPagina]);
      await cargarFuentes();
      marcar('dibujo');

      const pie = `<span>${[cfg.pie, datos.dashboard.titulo].filter(Boolean).map(escapar).join('  |  ')}</span>`;
      // El pie no hereda estilos de la página: la fuente y los colores van en línea.
      const fuentePie = escapar(cfg.fuente);
      const pdf = await pagina.pdf({
        format: cfg.pagina,
        landscape: cfg.orientacion === 'horizontal',
        printBackground: true,
        margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="width:100%;margin:0 12mm;padding-top:1.6mm;border-top:0.3mm solid #e2e8f0;
          font-family:${fuentePie};font-size:7.5px;color:#64748b;display:flex;justify-content:space-between">
          ${pie}<span style="font-weight:bold">${PIE_PAGINA[cfg.idioma] || PIE_PAGINA.en}</span></div>`,
      });
      marcar('pdf');
      const fallidos = resultados.filter(r => !r.ok);
      return { pdf, datos, total: resultados.length, fallidos, tiempos };
    } finally {
      const p = await pPagina.catch(() => null);
      if (p) await p.contexto.close().catch(() => {});
      reponerReserva();
    }
  }

  // --- cola ---
  let enCurso = 0;
  const espera = [];
  function enCola(trabajo) {
    if (enCurso >= cfg.concurrencia && espera.length >= cfg.maxCola) {
      return Promise.reject(new ErrorCola('Cola llena'));
    }
    return new Promise((resolve, reject) => {
      const correr = async () => {
        enCurso++;
        let temporizador;
        try {
          const limite = new Promise((_, rej) => {
            temporizador = setTimeout(() => rej(new ErrorTiempo('Tiempo agotado generando el PDF')), cfg.timeoutMs);
          });
          resolve(await Promise.race([trabajo(), limite]));
        } catch (e) {
          reject(e);
        } finally {
          clearTimeout(temporizador);
          enCurso--;
          const siguiente = espera.shift();
          if (siguiente) siguiente();
        }
      };
      if (enCurso < cfg.concurrencia) correr();
      else espera.push(correr);
    });
  }

  return {
    estado: () => ({ enCurso, enEspera: espera.length }),

    /** Pide todo a Superset con el token de quien llama y genera el PDF. */
    generar({ dashboardId, token, encabezado = {} }) {
      return enCola(() => imprimir(async (paginaLista, marcar) => {
        const api = clienteSuperset(cfg.supersetUrl, token);
        const datos = await obtenerDashboard(api, dashboardId, { idioma: cfg.idioma, paralelo: cfg.graficosParalelo });
        datos.encabezado = encabezado;
        marcar('dashboard');
        const pagina = await paginaLista();
        marcar('navegador'); // solo lo que faltaba para tener la página lista
        // Las consultas se arman en el navegador con buildQuery (igual que la pantalla) y se ejecutan aquí.
        const consultas = await pagina.evaluate(([d, op]) => window.prepararConsultas(d, op), [datos, opcionesPagina]);
        await obtenerDatos(api, datos, consultas, cfg.graficosParalelo);
        marcar('consultas');
        return datos;
      }));
    },

    /** Genera el PDF con datos ya resueltos (pruebas, o quien quiera pasar los datos directamente). */
    generarDesdeDatos(datos) {
      return enCola(() => imprimir(async () => datos));
    },

    /** Lanza Chromium y deja una página lista antes del primer pedido (el servicio lo llama al arrancar). */
    precalentar() {
      reponerReserva();
    },

    async cerrar() {
      cerrado = true;
      if (navegador) await navegador.close().catch(() => {});
    },
  };
}

function aDataUri(ruta) {
  const ext = path.extname(ruta).toLowerCase();
  const tipo = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[ext];
  if (!tipo) throw new Error(`PDF_LOGO: formato no soportado (${ext})`);
  return `data:${tipo};base64,${fs.readFileSync(ruta).toString('base64')}`;
}
