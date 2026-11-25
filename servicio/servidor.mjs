// Servicio HTTP:
//   POST /pdf   { "dashboard_id": 13, "token": "<access token de Superset>" }  → application/pdf
//               opcional: "encabezado": { "descripcion": "…", "detalles": [{ "etiqueta": "…", "valor": "…" }] }
//   GET  /salud                                                                → estado
import http from 'node:http';
import crypto from 'node:crypto';
import { cargarConfig } from './config.mjs';
import { crearGenerador, ErrorCola, ErrorTiempo, leerEncabezado } from './generador.mjs';
import { ErrorSuperset } from './superset.mjs';

const cfg = cargarConfig();
if (!cfg.supersetUrl) {
  console.error('Falta SUPERSET_URL');
  process.exit(1);
}
const log = m => console.log(`${new Date().toISOString()} ${m}`);
const generador = crearGenerador(cfg, { log });
const MAX_CUERPO = 64 * 1024;

function responderJson(res, estado, cuerpo) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(cuerpo));
}

function claveValida(req) {
  if (!cfg.claveApi) return true;
  const recibida = Buffer.from(String(req.headers['x-api-key'] || ''));
  const esperada = Buffer.from(cfg.claveApi);
  return recibida.length === esperada.length && crypto.timingSafeEqual(recibida, esperada);
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes = [];
    req.on('data', c => {
      tam += c.length;
      if (tam > MAX_CUERPO) {
        reject(Object.assign(new Error('Cuerpo demasiado grande'), { estado: 413 }));
        req.destroy();
      } else partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

function nombreArchivo(titulo, id) {
  const base = String(titulo || `dashboard-${id}`)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || `dashboard-${id}`;
  return `${base}.pdf`;
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (req.method === 'GET' && url.pathname === '/salud') {
      return responderJson(res, 200, { ok: true, superset: cfg.versionSuperset || null, ...generador.estado() });
    }
    if (url.pathname !== '/pdf') return responderJson(res, 404, { error: 'no_encontrado' });
    if (req.method !== 'POST') return responderJson(res, 405, { error: 'metodo_no_permitido' });
    if (!claveValida(req)) return responderJson(res, 401, { error: 'clave_api_invalida' });

    let cuerpo;
    try {
      cuerpo = JSON.parse(await leerCuerpo(req));
    } catch (e) {
      return responderJson(res, e.estado || 400, { error: 'cuerpo_invalido' });
    }
    const dashboardId = cuerpo && cuerpo.dashboard_id;
    const token = cuerpo && cuerpo.token;
    if (!(Number.isInteger(dashboardId) || (typeof dashboardId === 'string' && /^[\w-]{1,100}$/.test(dashboardId)))) {
      return responderJson(res, 400, { error: 'dashboard_id_invalido' });
    }
    if (typeof token !== 'string' || token.length < 10) return responderJson(res, 400, { error: 'token_requerido' });
    let encabezado;
    try {
      encabezado = leerEncabezado(cuerpo.encabezado);
    } catch (e) {
      return responderJson(res, 400, { error: 'encabezado_invalido', detalle: e.message });
    }

    const inicio = Date.now();
    const r = await generador.generar({ dashboardId, token, encabezado });
    const fases = Object.entries(r.tiempos || {}).map(([k, v]) => `${k}=${v}`).join(' ');
    log(`pdf dashboard=${dashboardId} graficos=${r.total} fallidos=${r.fallidos.length} ms=${Date.now() - inicio} ${fases}`);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': r.pdf.length,
      'Content-Disposition': `attachment; filename="${nombreArchivo(r.datos.dashboard.titulo, dashboardId)}"`,
      'X-Graficos-Total': String(r.total),
      'X-Graficos-Fallidos': String(r.fallidos.length),
    });
    res.end(r.pdf);
  } catch (e) {
    if (e instanceof ErrorSuperset) {
      // 401/403/404 de Superset se devuelven tal cual; el resto es un fallo de Superset.
      const estado = [401, 403, 404].includes(e.estado) ? e.estado : 502;
      log(`superset ${e.estado}: ${e.message}`);
      return responderJson(res, estado, { error: 'superset', estado_superset: e.estado, detalle: e.message });
    }
    if (e instanceof ErrorCola) return responderJson(res, 429, { error: 'ocupado' });
    if (e instanceof ErrorTiempo) return responderJson(res, 504, { error: 'tiempo_agotado' });
    log(`error: ${e.stack || e.message}`);
    if (!res.headersSent) responderJson(res, 500, { error: 'interno' });
  }
});

servidor.listen(cfg.puerto, () => {
  log(`superset-pdf escuchando en :${cfg.puerto} (Superset ${cfg.versionSuperset || '?'}) → ${cfg.supersetUrl}`);
  generador.precalentar(); // Chromium y una página listos antes del primer pedido
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, async () => {
    servidor.close();
    await generador.cerrar();
    process.exit(0);
  });
}
