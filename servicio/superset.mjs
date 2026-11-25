// Cliente mínimo de la API REST de Superset. El token lo entrega quien llama; aquí no se guarda.

export class ErrorSuperset extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

export function clienteSuperset(base, token) {
  if (!base) throw new Error('Falta SUPERSET_URL');
  async function pedir(ruta, { metodo = 'GET', cuerpo, conToken = true } = {}) {
    let r;
    try {
      r = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: {
          Accept: 'application/json',
          ...(conToken && token ? { Authorization: `Bearer ${token}` } : {}),
          ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
        },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
    } catch (e) {
      throw new ErrorSuperset(0, `Superset no disponible (${(e.cause && e.cause.code) || e.message})`);
    }
    const texto = await r.text();
    if (!r.ok) {
      let detalle = texto.slice(0, 300);
      try {
        const j = JSON.parse(texto);
        detalle = j.message || j.msg || (j.errors && j.errors[0] && j.errors[0].message) || detalle;
        if (typeof detalle !== 'string') detalle = JSON.stringify(detalle).slice(0, 300);
      } catch { /* respuesta no JSON */ }
      throw new ErrorSuperset(r.status, `${metodo} ${ruta.split('?')[0]} → ${r.status}: ${detalle}`);
    }
    return texto ? JSON.parse(texto) : {};
  }
  return { pedir };
}

const parsear = s => (typeof s === 'string' && s ? JSON.parse(s) : s || {});

/** Todo lo necesario para dibujar un dashboard, sin los datos de los gráficos. */
export async function obtenerDashboard(api, id, { idioma, paralelo = 8 } = {}) {
  // Todo lo que no depende de otra respuesta se pide a la vez.
  const pIdioma = idioma && idioma !== 'en'
    ? api.pedir(`/superset/language_pack/${idioma}/`, { conToken: false }).catch(() => undefined) // sin él: inglés
    : Promise.resolve(undefined);
  const [{ result: dash }, { result: graficosDash }] = await Promise.all([
    api.pedir(`/api/v1/dashboard/${encodeURIComponent(id)}`),
    api.pedir(`/api/v1/dashboard/${encodeURIComponent(id)}/charts`),
  ]);

  const graficos = await enParalelo(graficosDash, paralelo, async g => {
    const base = { id: g.id, slice_name: g.slice_name, viz_type: g.form_data && g.form_data.viz_type };
    try {
      // form_data y dataset en el formato del frontend (verbose_map, column_formats…).
      let formData = g.form_data || {};
      let datasource;
      try {
        const { result: explore } = await api.pedir(`/api/v1/explore/?slice_id=${g.id}`);
        datasource = explore.dataset;
        formData = { ...explore.form_data, ...formData };
      } catch (e) {
        if (e.estado === 401) throw e;
      }
      return { ...base, viz_type: formData.viz_type, form_data: { ...formData, slice_id: g.id }, datasource };
    } catch (e) {
      if (e.estado === 401) throw e;
      return { ...base, error: e.message };
    }
  });

  const languagePack = await pIdioma;

  return {
    generado: new Date().toISOString(),
    dashboard: {
      id: dash.id,
      titulo: dash.dashboard_title,
      position: parsear(dash.position_json),
      metadata: parsear(dash.json_metadata),
    },
    graficos,
    languagePack,
  };
}

/** Ejecuta las consultas (query_context) y guarda el resultado en cada gráfico. */
export async function obtenerDatos(api, datos, consultas, paralelo = 4) {
  await enParalelo(datos.graficos, paralelo, async g => {
    const c = consultas[g.id];
    if (!c) return;
    if (c.error) {
      g.error = c.error;
      return;
    }
    try {
      const r = await api.pedir('/api/v1/chart/data', { metodo: 'POST', cuerpo: c.consulta });
      g.queriesData = r.result;
    } catch (e) {
      if (e.estado === 401) throw e;
      g.error = e.message;
    }
  });
}

async function enParalelo(lista, n, fn) {
  const salida = new Array(lista.length);
  let i = 0;
  const trabajadores = Array.from({ length: Math.min(n, lista.length) }, async () => {
    while (i < lista.length) {
      const k = i++;
      salida[k] = await fn(lista[k], k);
    }
  });
  await Promise.all(trabajadores);
  return salida;
}
