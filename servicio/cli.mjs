// Exportar desde la línea de comandos (pruebas y uso manual), con la misma configuración que el servicio.
//   SUPERSET_URL=… SUPERSET_USUARIO=… SUPERSET_CONTRASENA=… node cli.mjs <dashboard_id> [salida.pdf]
// O con un token ya obtenido: SUPERSET_TOKEN=… node cli.mjs <dashboard_id>
import fs from 'node:fs';
import { cargarConfig } from './config.mjs';
import { crearGenerador } from './generador.mjs';
import { clienteSuperset } from './superset.mjs';

const [id, salida] = process.argv.slice(2);
if (!id) {
  console.error('Uso: node cli.mjs <dashboard_id> [salida.pdf]');
  process.exit(2);
}
const cfg = cargarConfig();

let token = process.env.SUPERSET_TOKEN;
if (!token) {
  const { access_token: t } = await clienteSuperset(cfg.supersetUrl).pedir('/api/v1/security/login', {
    metodo: 'POST',
    conToken: false,
    cuerpo: {
      username: process.env.SUPERSET_USUARIO,
      password: process.env.SUPERSET_CONTRASENA,
      provider: process.env.SUPERSET_PROVEEDOR || 'db',
      refresh: false,
    },
  });
  token = t;
}

const generador = crearGenerador(cfg, { log: m => console.log(m) });
try {
  const inicio = Date.now();
  const r = await generador.generar({ dashboardId: /^\d+$/.test(id) ? Number(id) : id, token });
  const archivo = salida || `dashboard-${id}.pdf`;
  fs.writeFileSync(archivo, r.pdf);
  console.log(`"${r.datos.dashboard.titulo}": ${r.total - r.fallidos.length}/${r.total} gráficos · ${Date.now() - inicio} ms → ${archivo}`);
  r.fallidos.forEach(f => console.log(`  ✗ [${f.id}] ${f.viz_type}: ${f.error}`));
  process.exitCode = r.fallidos.length ? 1 : 0;
} finally {
  await generador.cerrar();
}
