// Exportar desde la línea de comandos (pruebas y uso manual), con la misma configuración que el servicio.
//   SUPERSET_URL=… SUPERSET_USUARIO=… SUPERSET_CONTRASENA=… node cli.mjs <dashboard_id> [salida.pdf]
// O con un token ya obtenido: SUPERSET_TOKEN=… node cli.mjs <dashboard_id>
import fs from 'node:fs';
import { cargarConfig } from './config.mjs';
import { crearGenerador } from './generador.mjs';
import { clienteSuperset } from './superset.mjs';

async function principal() {
  const [id, salida] = process.argv.slice(2);
  if (!id) {
    console.error('Uso: node cli.mjs <dashboard_id> [salida.pdf]');
    return 2;
  }
  const cfg = cargarConfig();

  let token = process.env.SUPERSET_TOKEN;
  if (!token) {
    const r = await clienteSuperset(cfg.supersetUrl).pedir('/api/v1/security/login', {
      metodo: 'POST',
      conToken: false,
      cuerpo: {
        username: process.env.SUPERSET_USUARIO,
        password: process.env.SUPERSET_CONTRASENA,
        provider: process.env.SUPERSET_PROVEEDOR || 'db',
        refresh: false,
      },
    });
    token = r.access_token;
  }

  const generador = crearGenerador(cfg, { log: m => console.log(m) });
  try {
    const inicio = Date.now();
    const r = await generador.generar({ dashboardId: /^\d+$/.test(id) ? Number(id) : id, token });
    const archivo = salida || `dashboard-${id}.pdf`;
    fs.writeFileSync(archivo, r.pdf);
    console.log(`"${r.datos.dashboard.titulo}": ${r.total - r.fallidos.length}/${r.total} gráficos · ${Date.now() - inicio} ms → ${archivo}`);
    console.log(`  fases (ms): ${Object.entries(r.tiempos).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    r.fallidos.forEach(f => console.log(`  ✗ [${f.id}] ${f.viz_type}: ${f.error}`));
    return r.fallidos.length ? 1 : 0;
  } finally {
    await generador.cerrar();
  }
}

principal().then(
  codigo => { process.exitCode = codigo; },
  e => {
    console.error(`Error: ${e && e.message ? e.message : e}`);
    process.exitCode = 1;
  },
);
