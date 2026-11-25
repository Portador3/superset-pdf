// Configuración por variables de entorno. Nada específico de un despliegue va en el código.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

// Tamaños de página (mm, vertical). Márgenes fijos: 12 mm a los lados.
const PAGINAS = {
  A4: [210, 297],
  A3: [297, 420],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
};
const MARGEN_LADO_MM = 12;
const MM_A_PX = 96 / 25.4;

function numero(nombre, defecto, { min = -Infinity, max = Infinity } = {}) {
  const v = process.env[nombre];
  if (v == null || v === '') return defecto;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${nombre} inválido: ${v}`);
  return n;
}

function archivoOpcional(nombre) {
  const ruta = process.env[nombre];
  if (!ruta) return null;
  if (!fs.existsSync(ruta)) throw new Error(`${nombre}: no existe ${ruta}`);
  return ruta;
}

function primerExistente(rutas) {
  return rutas.find(r => fs.existsSync(r)) || rutas[0];
}

export function cargarConfig() {
  const pagina = process.env.PDF_PAGINA || 'A4';
  if (!PAGINAS[pagina]) throw new Error(`PDF_PAGINA debe ser uno de: ${Object.keys(PAGINAS).join(', ')}`);
  const orientacion = process.env.PDF_ORIENTACION || 'horizontal';
  if (!['horizontal', 'vertical'].includes(orientacion)) throw new Error('PDF_ORIENTACION: horizontal o vertical');
  const [corto, largo] = PAGINAS[pagina];
  const anchoMm = orientacion === 'horizontal' ? largo : corto;
  const altoMm = orientacion === 'horizontal' ? corto : largo;

  const idioma = (process.env.PDF_IDIOMA || 'es').toLowerCase();
  const colorTitulos = process.env.PDF_COLOR_TITULOS || '';
  if (colorTitulos && !/^#[0-9a-fA-F]{3,8}$/.test(colorTitulos)) throw new Error('PDF_COLOR_TITULOS: color #RRGGBB');
  const colorAcento = process.env.PDF_COLOR_ACENTO || '';
  if (colorAcento && !/^#[0-9a-fA-F]{3,8}$/.test(colorAcento)) throw new Error('PDF_COLOR_ACENTO: color #RRGGBB');
  // Fuente de todo el PDF (textos, tablas y gráficos). Por defecto una estándar: Arial (Liberation Sans en Linux).
  const fuente = process.env.PDF_FUENTE || 'Arial, Helvetica, "Liberation Sans", sans-serif';
  if (!/^[\w\s,"'-]+$/.test(fuente)) throw new Error('PDF_FUENTE: lista de familias, p. ej. Arial, sans-serif');

  const graficosDir = process.env.PDF_GRAFICOS_DIR
    || primerExistente([path.join(AQUI, 'graficos'), path.join(AQUI, '..', 'dist')]);

  return {
    puerto: numero('PUERTO', 8080, { min: 1, max: 65535 }),
    supersetUrl: (process.env.SUPERSET_URL || '').replace(/\/$/, ''),
    claveApi: process.env.PDF_CLAVE_API || '',
    concurrencia: numero('PDF_CONCURRENCIA', 1, { min: 1, max: 8 }),
    maxCola: numero('PDF_MAX_COLA', 10, { min: 0, max: 1000 }),
    timeoutMs: numero('PDF_TIMEOUT_MS', 120000, { min: 5000 }),
    graficosParalelo: numero('PDF_CONSULTAS_PARALELAS', 8, { min: 1, max: 16 }),
    metadatosSeg: numero('PDF_CACHE_METADATOS_SEG', 600, { min: 0, max: 86400 }),

    pagina,
    orientacion,
    anchoPx: Math.floor((anchoMm - 2 * MARGEN_LADO_MM) * MM_A_PX),
    altoMaxPx: Math.floor((altoMm - 40) * MM_A_PX), // que un gráfico quepa en una hoja
    escalaAlto: numero('PDF_ESCALA_ALTO', 0.75, { min: 0.3, max: 2 }),

    idioma,
    locale: process.env.PDF_LOCALE || (idioma === 'es' ? 'es' : 'en-US'),
    zonaHoraria: process.env.PDF_ZONA_HORARIA || process.env.TZ || 'UTC',
    localeGraficos: (process.env.PDF_LOCALE_GRAFICOS || idioma).toUpperCase(),

    logo: archivoOpcional('PDF_LOGO'),
    css: archivoOpcional('PDF_CSS'),
    colorTitulos,
    colorAcento,
    fuente,
    pie: process.env.PDF_PIE || '',
    institucion: process.env.PDF_INSTITUCION || '',
    etiquetaZona: process.env.PDF_ZONA_ETIQUETA || '',

    graficosJs: path.join(graficosDir, 'graficos.js'),
    plantillaDir: path.join(AQUI, 'plantilla'),
    versionSuperset: (() => {
      try { return fs.readFileSync(path.join(graficosDir, 'SUPERSET_VERSION'), 'utf8').trim(); } catch { return ''; }
    })(),
  };
}
