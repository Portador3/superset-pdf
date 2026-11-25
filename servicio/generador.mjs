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
    logo,
  };

  let navegador = null;
  async function obtenerNavegador() {
    if (navegador && navegador.isConnected()) return navegador;
    navegador = await chromium.launch({
      // Las fuentes de graficos.js se cargan desde archivos locales; /dev/shm suele ser chico en contenedores.
      args: ['--allow-file-access-from-files', '--disable-dev-shm-usage'],
    });
    navegador.on('disconnected', () => { navegador = null; });
    return navegador;
  }

  async function imprimir(obtenerDatosDashboard) {
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
      if (cfg.colorTitulos) await pagina.addStyleTag({ content: `:root{--pdf-color-titulos:${cfg.colorTitulos}}` });
      if (cssExtra) await pagina.addStyleTag({ content: cssExtra });
      await pagina.emulateMedia({ media: 'print' });

      const datos = await obtenerDatosDashboard(pagina);

      const cargarFuentes = () => pagina.evaluate(() =>
        Promise.all([...document.fonts].map(f => f.load().catch(() => null))));
      await cargarFuentes();
      const resultados = await pagina.evaluate(([d, op]) => window.armar(d, op), [datos, opcionesPagina]);
      await cargarFuentes();

      const pie = cfg.pie ? `<span>${escapar(cfg.pie)} · ${escapar(datos.dashboard.titulo)}</span>`
        : `<span>${escapar(datos.dashboard.titulo)}</span>`;
      const pdf = await pagina.pdf({
        format: cfg.pagina,
        landscape: cfg.orientacion === 'horizontal',
        printBackground: true,
        margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="width:100%;margin:0 12mm;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
          font-size:7.5px;color:#6b7280;display:flex;justify-content:space-between">
          ${pie}<span>${PIE_PAGINA[cfg.idioma] || PIE_PAGINA.en}</span></div>`,
      });
      const fallidos = resultados.filter(r => !r.ok);
      return { pdf, datos, total: resultados.length, fallidos };
    } finally {
      await contexto.close().catch(() => {});
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
    generar({ dashboardId, token }) {
      return enCola(() => imprimir(async pagina => {
        const api = clienteSuperset(cfg.supersetUrl, token);
        const datos = await obtenerDashboard(api, dashboardId, { idioma: cfg.idioma, paralelo: cfg.graficosParalelo });
        // Las consultas se arman en el navegador con buildQuery (igual que la pantalla) y se ejecutan aquí.
        const consultas = await pagina.evaluate(([d, op]) => window.prepararConsultas(d, op), [datos, opcionesPagina]);
        await obtenerDatos(api, datos, consultas, cfg.graficosParalelo);
        return datos;
      }));
    },

    /** Genera el PDF con datos ya resueltos (pruebas, o quien quiera pasar los datos directamente). */
    generarDesdeDatos(datos) {
      return enCola(() => imprimir(async () => datos));
    },

    async cerrar() {
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
