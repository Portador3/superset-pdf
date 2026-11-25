/* Maquetación del PDF: convierte position_json del dashboard en filas HTML y dibuja cada gráfico con
 * window.SupersetPDF (graficos.js). Lo llama el generador:
 *   await window.prepararConsultas(datos, opciones) → query_context de cada gráfico (los envía el generador)
 *   await window.armar(datos, opciones)             → dibuja todo; devuelve el resultado de cada gráfico
 */
(function () {
  const GAP = 12;
  const UNIDAD_SUPERSET = 8; // GRID_BASE_UNIT de Superset

  const TEXTOS = {
    es: {
      generado: (fecha, hora) => `Generado el ${fecha} a las ${hora}`,
      filas: (n, total) => `Mostrando ${n} de ${total} filas`,
      sinDatos: 'Sin datos para este gráfico',
      grafico: id => `Gráfico ${id}`,
      pestana: 'Pestaña',
    },
    en: {
      generado: (fecha, hora) => `Generated on ${fecha} at ${hora}`,
      filas: (n, total) => `Showing ${n} of ${total} rows`,
      sinDatos: 'No data for this chart',
      grafico: id => `Chart ${id}`,
      pestana: 'Tab',
    },
  };

  function el(tag, clase, texto) {
    const e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto != null) e.textContent = texto;
    return e;
  }

  // En pantalla una tabla ancha se desplaza; en papel no. Si no cabe en su tarjeta se reduce
  // (cabecera fija y cuerpo pueden ir en tablas separadas: todas con la misma escala).
  function ajustarTablas(lienzo, ancho) {
    const tablas = [...lienzo.querySelectorAll('table')];
    const max = Math.max(0, ...tablas.map(t => t.scrollWidth));
    if (max > ancho) {
      const escala = Math.max(0.4, ancho / max);
      tablas.forEach(t => { t.style.zoom = escala; });
      lienzo.querySelectorAll('*').forEach(e => {
        if (getComputedStyle(e).overflowX !== 'visible') e.style.overflowX = 'hidden';
      });
    }
  }

  function filasTotales(g) {
    const q = (g.queriesData || [])[0] || {};
    return q.rowcount != null ? q.rowcount : (q.data || []).length;
  }

  // La tabla conserva el alto de su tarjeta: se ocultan las filas que no caben enteras.
  function recortarFilas(lienzo, tarjeta, total, textos) {
    const filas = [...lienzo.querySelectorAll('tbody tr')];
    if (!filas.length) return;
    let limite = lienzo.getBoundingClientRect().bottom;
    for (let e = filas[0].parentElement; e && e !== lienzo; e = e.parentElement) {
      if (getComputedStyle(e).overflowY !== 'visible') limite = Math.min(limite, e.getBoundingClientRect().bottom);
    }
    let visibles = 0;
    filas.forEach(f => {
      if (f.getBoundingClientRect().bottom <= limite + 0.5) visibles++;
      else f.style.visibility = 'hidden';
    });
    if (visibles < total) tarjeta.appendChild(el('div', 'nota-filas', textos.filas(visibles, total)));
  }

  function crearMaquetador(datos, op) {
    const textos = TEXTOS[op.idioma] || TEXTOS.en;
    const ANCHO = op.anchoPx;
    const UNIDAD = UNIDAD_SUPERSET * op.escalaAlto;
    const graficos = new Map(datos.graficos.map(g => [g.id, g]));
    const tareas = [];

    // Como en Superset: los anchos se miden sobre la cuadrícula total de 12 columnas y un gráfico
    // (o markdown) dentro de una COLUMN ocupa todo el ancho de esa columna.
    function anchoDe(item, anchoPadre, padre) {
      if (padre && padre.type === 'COLUMN') return anchoPadre;
      const w = item.meta && item.meta.width ? item.meta.width : 12;
      return Math.min(anchoPadre, Math.floor((ANCHO + GAP) * (w / 12) - GAP));
    }

    function nodo(id, pos, anchoPadre, contenedor, padre) {
      const item = pos[id];
      if (!item) return;
      const meta = item.meta || {};
      const sub = (h, ancho, cont) => nodo(h, pos, ancho, cont, item);
      const hijos = item.children || [];
      switch (item.type) {
        case 'ROOT': case 'GRID': case 'TABS':
          hijos.forEach(h => sub(h, anchoPadre, contenedor)); break;
        case 'TAB':
          contenedor.appendChild(el('h2', 'seccion', meta.defaultText || meta.text || textos.pestana));
          hijos.forEach(h => sub(h, anchoPadre, contenedor)); break;
        case 'HEADER':
          contenedor.appendChild(el('h2', 'seccion', meta.text)); break;
        case 'DIVIDER':
          contenedor.appendChild(el('hr', 'divisor')); break;
        case 'ROW': {
          const fila = el('div', 'fila');
          contenedor.appendChild(fila);
          hijos.forEach(h => sub(h, anchoPadre, fila)); break;
        }
        case 'COLUMN': {
          const w = anchoDe(item, anchoPadre, padre);
          const col = el('div', 'columna'); col.style.width = w + 'px';
          contenedor.appendChild(col);
          hijos.forEach(h => sub(h, w, col)); break;
        }
        case 'MARKDOWN': {
          const w = anchoDe(item, anchoPadre, padre);
          const t = el('div', 'tarjeta markdown'); t.style.width = w + 'px';
          if (meta.height) t.style.maxHeight = Math.min(op.altoMaxPx, meta.height * UNIDAD) + 'px';
          contenedor.appendChild(t);
          tareas.push(SupersetPDF.renderMarkdown(t, meta.code || '').then(() => null));
          break;
        }
        case 'CHART': {
          const g = graficos.get(meta.chartId);
          const w = anchoDe(item, anchoPadre, padre);
          const h = Math.min(op.altoMaxPx, (meta.height || 50) * UNIDAD);
          const t = el('div', 'tarjeta'); t.style.width = w + 'px';
          t.appendChild(el('h3', null, meta.sliceNameOverride || (g && g.slice_name) || textos.grafico(meta.chartId)));
          const lienzo = el('div'); t.appendChild(lienzo);
          contenedor.appendChild(t);
          const anchoLienzo = w - 22;
          const altoLienzo = h - 40;
          lienzo.style.height = altoLienzo + 'px';
          if (!g || g.error) {
            lienzo.appendChild(el('div', 'error', g ? g.error : textos.sinDatos));
            if (g) tareas.push(Promise.resolve({ id: g.id, ok: false, error: g.error, viz_type: g.viz_type }));
          } else {
            tareas.push(
              SupersetPDF.renderChart(lienzo, g, { width: anchoLienzo, height: altoLienzo })
                .then(() => ajustarTablas(lienzo, anchoLienzo))
                .then(() => recortarFilas(lienzo, t, filasTotales(g), textos))
                .then(() => ({ id: g.id, ok: true }))
                .catch(e => {
                  lienzo.innerHTML = '';
                  lienzo.appendChild(el('div', 'error', e.message));
                  return { id: g.id, ok: false, error: e.message, viz_type: g.viz_type };
                }),
            );
          }
          break;
        }
        default: break;
      }
    }

    return { nodo, tareas, textos, ANCHO };
  }

  function iniciar(datos, op) {
    SupersetPDF.init({ languagePack: datos.languagePack, locale: op.localeGraficos });
    SupersetPDF.aplicarColoresDashboard(datos.dashboard.metadata || {});
  }

  window.prepararConsultas = async function (datos, op) {
    iniciar(datos, op);
    const salida = {};
    for (const g of datos.graficos) {
      if (g.error || g.queriesData) continue;
      try {
        salida[g.id] = { consulta: await SupersetPDF.construirConsulta(g) };
      } catch (e) {
        salida[g.id] = { error: e.message };
      }
    }
    return salida;
  };

  window.armar = async function (datos, op) {
    iniciar(datos, op);
    const hoja = document.getElementById('hoja');
    hoja.style.width = op.anchoPx + 'px';
    const { nodo, tareas, textos, ANCHO } = crearMaquetador(datos, op);

    const portada = el('div', op.logo ? 'portada' : 'portada sin-logo');
    let logo = null;
    if (op.logo) {
      logo = el('img');
      logo.src = op.logo;
      logo.alt = '';
      portada.appendChild(logo);
    }
    const titulos = el('div', 'titulos');
    titulos.appendChild(el('h1', null, datos.dashboard.titulo));
    const f = new Date(datos.generado);
    const loc = op.locale;
    const zona = op.zonaHoraria;
    titulos.appendChild(el('div', 'meta', textos.generado(
      f.toLocaleDateString(loc, { day: '2-digit', month: 'long', year: 'numeric', timeZone: zona }),
      f.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', timeZone: zona }),
    )));
    portada.appendChild(titulos);
    hoja.appendChild(portada);
    if (logo) await new Promise(r => (logo.complete ? r() : (logo.onload = logo.onerror = r)));

    const pos = datos.dashboard.position || {};
    if (pos.ROOT_ID) {
      nodo('ROOT_ID', pos, ANCHO, hoja);
    } else {
      // Dashboard sin disposición guardada: un gráfico por fila.
      datos.graficos.forEach(g => {
        pos['c' + g.id] = { type: 'CHART', meta: { chartId: g.id, width: 12, height: 50 } };
        const fila = el('div', 'fila');
        hoja.appendChild(fila);
        nodo('c' + g.id, pos, ANCHO, fila);
      });
    }
    const resultados = (await Promise.all(tareas)).filter(Boolean);
    await document.fonts.ready;
    return resultados;
  };
})();
