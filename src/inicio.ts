// Se importa ANTES que los plugins: varios llaman a t() y consultan feature flags al cargarse.
// Es lo mismo que hace src/preamble.ts en Superset. init() vuelve a configurar el idioma con el paquete real.
import { configure } from '@apache-superset/core/translation';
import { initFeatureFlags } from '@superset-ui/core';

configure();
initFeatureFlags({});
