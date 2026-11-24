/**
 * Compila src/graficos.tsx con la MISMA configuración de webpack de Superset (loaders, alias a los
 * paquetes fuente, swc + emotion). Solo cambia: la entrada, la salida (un único graficos.js) y los
 * plugins de la aplicación que aquí no aplican (manifest, páginas HTML, module federation…).
 *
 * Se copia dentro de superset-frontend/ y se ejecuta desde ahí (ver .github/workflows/build.yml):
 *   npx webpack --config webpack.pdf.js --mode production
 */
const path = require('path');
const webpack = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const base = require('./webpack.config.js');

const SALIDA = process.env.PDF_OUT || path.resolve(__dirname, 'pdf-dist');

// Plugins de Superset que se conservan; el resto son de la aplicación web.
const CONSERVAR = new Set(['ProvidePlugin', 'DefinePlugin']);

// El CSS va dentro del JS (style-loader) para que el resultado sea un solo archivo.
function sinExtraerCss(regla) {
  if (!Array.isArray(regla.use)) return regla;
  return {
    ...regla,
    use: regla.use.map(u =>
      u === MiniCssExtractPlugin.loader || (u && u.loader === MiniCssExtractPlugin.loader)
        ? 'style-loader'
        : u,
    ),
  };
}

// Las miniaturas de los plugins (png/jpg/gif) solo se usan en el selector de Explore: no se emiten.
function sinMiniaturas(regla) {
  const t = String(regla.test);
  if (/png|jpg|gif/.test(t)) {
    return { ...regla, generator: { ...(regla.generator || {}), emit: false } };
  }
  return regla;
}

module.exports = {
  ...base,
  entry: { graficos: path.resolve(__dirname, 'pdf/graficos.tsx') },
  output: {
    path: SALIDA,
    filename: 'graficos.js',
    publicPath: 'auto', // fuentes junto a graficos.js, sin importar desde dónde se sirva
    assetModuleFilename: 'assets/[name].[contenthash:8][ext]',
    clean: true,
  },
  cache: false,
  module: { ...base.module, rules: base.module.rules.map(sinExtraerCss).map(sinMiniaturas) },
  plugins: [
    ...base.plugins.filter(p => CONSERVAR.has(p.constructor.name)),
    new webpack.DefinePlugin({
      'process.env.SUPERSET_VERSION': JSON.stringify(process.env.SUPERSET_VERSION || ''),
    }),
    // Los plugins cargan su componente con import() dinámico: todo queda en el mismo archivo.
    new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
  ],
  optimization: { ...base.optimization, splitChunks: false, runtimeChunk: false },
  performance: { hints: false },
};
